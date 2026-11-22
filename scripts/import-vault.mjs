#!/usr/bin/env node
// Import a folder of markdown notes into one workspace of a hive.
//
//   node --env-file=.env scripts/import-vault.mjs <folder> <workspace>
//        [--include <path>]... [--exclude <path>]... [--dry-run]
//
// One hive note per .md file, at the file's relative path. Running it again
// updates the notes whose file changed (a new version) and touches nothing
// else. It never deletes a note and never sets sharing: everything arrives
// private. Wiki links stay in the text for the later link job.
//
// It signs in as the person who owns the agent token in .env, not as an
// agent: the notes are theirs, and an agent may only write in its own workspace.
// Every permission is still decided by the database.
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

const MAX_BYTES = 1_000_000;
const BATCH = 50;

// ------------------------------------------------------------------ parsing

const FRONTMATTER = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/;

export function parseNote(raw, relPath) {
  const text = raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replaceAll("\u0000", "");
  const fallbackTitle = basename(relPath).replace(/\.md$/i, "");
  const plain = (warning) => ({
    title: fallbackTitle,
    frontmatter: {},
    body: text,
    ...(warning ? { warning } : {}),
  });

  const m = FRONTMATTER.exec(text);
  if (!m) return plain();

  let data;
  try {
    data = parseYaml(m[1] ?? "") ?? {};
  } catch (e) {
    return plain(
      `unreadable frontmatter, kept as text: ${e.message.split("\n")[0]}`,
    );
  }
  if (typeof data !== "object" || Array.isArray(data))
    return plain("frontmatter is not a set of fields, kept as text");

  // Only what JSON can hold goes into the database.
  const frontmatter = JSON.parse(JSON.stringify(data));
  const title =
    typeof frontmatter.title === "string" && frontmatter.title.trim()
      ? frontmatter.title.trim()
      : fallbackTitle;
  return {
    title,
    frontmatter,
    body: text.slice(m[0].length).replace(/^\n+/, ""),
  };
}

// ------------------------------------------------------------------ walking

const clean = (p) =>
  p
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
const under = (rel, pattern) =>
  rel === pattern || rel.startsWith(`${pattern}/`);

// Which relative paths an include/exclude pair selects.
function selector({ include = [], exclude = [] } = {}) {
  const inc = include.map(clean).filter(Boolean);
  const exc = exclude.map(clean).filter(Boolean);
  return (rel) => {
    const r = rel.toLowerCase();
    if (r.split("/").some((part) => part.startsWith("."))) return false;
    if (exc.some((p) => under(r, p))) return false;
    return inc.length === 0 || inc.some((p) => under(r, p));
  };
}

export function listMarkdown(folder, options) {
  const selected = selector(options);
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), childRel);
      else if (
        entry.isFile() &&
        /\.md$/i.test(entry.name) &&
        selected(childRel)
      )
        out.push(childRel);
    }
  };
  walk(folder, "");
  return out.sort();
}

// ---------------------------------------------------------------- importing

const stable = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : x,
  );
const message = (e) => (e instanceof Error ? e.message : String(e));

// `store` is the only thing that talks to a database: see restStore() below
// and the PGlite one in tests/import-vault.test.mjs.
export async function importVault({
  folder,
  workspace,
  store,
  include,
  exclude,
  dryRun = false,
}) {
  const report = {
    workspace,
    created: [],
    updated: [],
    unchanged: [],
    skipped: [],
    warnings: [],
    failed: [],
    notInFolder: [],
  };

  const files = [];
  for (const rel of listMarkdown(folder, { include, exclude })) {
    const full = join(folder, rel);
    if (statSync(full).size > MAX_BYTES) {
      report.skipped.push({ path: rel, reason: "larger than 1 MB" });
      continue;
    }
    const note = parseNote(readFileSync(full, "utf8"), rel);
    if (note.warning)
      report.warnings.push({ path: rel, warning: note.warning });
    const dir = posix.dirname(rel);
    files.push({ path: rel, dir: dir === "." ? null : dir, ...note });
  }

  let ws = await store.findWorkspace(workspace);
  if (!ws && !dryRun) ws = await store.createWorkspace(workspace);

  const existing = new Map(
    (ws ? await store.listNotes(ws) : []).map((n) => [n.path, n]),
  );
  const folders = new Map(
    (ws ? await store.listFolders(ws) : []).map((f) => [f.path, f.id]),
  );
  const newDirs = [
    ...new Set(files.map((f) => f.dir).filter((d) => d && !folders.has(d))),
  ];
  if (newDirs.length && !dryRun)
    for (const f of await store.createFolders(ws, newDirs))
      folders.set(f.path, f.id);

  const toCreate = [];
  for (const f of files) {
    const row = {
      path: f.path,
      title: f.title,
      body: f.body,
      frontmatter: f.frontmatter,
      folder_id: f.dir ? (folders.get(f.dir) ?? null) : null,
    };
    const old = existing.get(f.path);
    if (!old) {
      toCreate.push(row);
      continue;
    }
    const same =
      old.title === row.title &&
      old.body === row.body &&
      stable(old.frontmatter) === stable(row.frontmatter) &&
      (dryRun || old.folder_id === row.folder_id);
    if (same) {
      report.unchanged.push(f.path);
      continue;
    }
    if (!dryRun) {
      try {
        await store.updateNote(old.id, row);
      } catch (e) {
        report.failed.push({ path: f.path, error: message(e) });
        continue;
      }
    }
    report.updated.push(f.path);
  }

  for (let i = 0; i < toCreate.length; i += BATCH) {
    const batch = toCreate.slice(i, i + BATCH);
    if (dryRun) {
      report.created.push(...batch.map((n) => n.path));
      continue;
    }
    try {
      await store.createNotes(ws, batch);
      report.created.push(...batch.map((n) => n.path));
    } catch {
      // Find the note the database refused; the others still go in.
      for (const n of batch) {
        try {
          await store.createNotes(ws, [n]);
          report.created.push(n.path);
        } catch (e) {
          report.failed.push({ path: n.path, error: message(e) });
        }
      }
    }
  }

  // Notes this run would have covered whose file is gone. Reported, never deleted.
  const selected = selector({ include, exclude });
  const seen = new Set(files.map((f) => f.path));
  const skipped = new Set(report.skipped.map((s) => s.path));
  report.notInFolder = [...existing.keys()]
    .filter((p) => selected(p) && !seen.has(p) && !skipped.has(p))
    .sort();
  for (const key of ["created", "updated", "unchanged"]) report[key].sort();
  return report;
}

// ------------------------------------------------------------- live database

// Talks to Supabase's REST API as one signed-in person.
export function restStore({ url, anonKey, jwt, memberId, hiveId }) {
  const call = async (path, { method = "GET", body, prefer } = {}) => {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        detail = JSON.parse(text).message ?? text;
      } catch {
        // Not JSON; report it as it came.
      }
      throw new Error(`${res.status} ${detail}`);
    }
    return text ? JSON.parse(text) : null;
  };
  const all = async (path) => {
    const rows = [];
    for (let offset = 0; ; offset += 200) {
      const page = await call(`${path}&order=path&limit=200&offset=${offset}`);
      rows.push(...page);
      if (page.length < 200) return rows;
    }
  };
  const q = encodeURIComponent;

  return {
    async findWorkspace(name) {
      const rows = await call(
        `workspaces?select=id&member_id=eq.${memberId}&name=eq.${q(name)}`,
      );
      return rows[0]?.id ?? null;
    },
    async createWorkspace(name) {
      const rows = await call("workspaces", {
        method: "POST",
        prefer: "return=representation",
        body: { hive_id: hiveId, member_id: memberId, name },
      });
      return rows[0].id;
    },
    listFolders: (ws) => all(`folders?select=id,path&workspace_id=eq.${ws}`),
    createFolders: (ws, paths) =>
      call("folders?select=id,path", {
        method: "POST",
        prefer: "return=representation",
        body: paths.map((path) => ({
          workspace_id: ws,
          member_id: memberId,
          path,
        })),
      }),
    listNotes: (ws) =>
      all(
        `notes?select=id,path,title,body,frontmatter,folder_id&workspace_id=eq.${ws}`,
      ),
    async createNotes(ws, notes) {
      await call("notes", {
        method: "POST",
        prefer: "return=minimal",
        body: notes.map((n) => ({
          hive_id: hiveId,
          member_id: memberId,
          workspace_id: ws,
          ...n,
        })),
      });
    },
    async updateNote(id, n) {
      await call(`notes?id=eq.${id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          title: n.title,
          body: n.body,
          frontmatter: n.frontmatter,
          folder_id: n.folder_id,
        },
      });
    },
  };
}

// A short-lived identity for the person behind the agent token. No agent_id
// claim, so the database treats it as the person.
function personJwt(userId, secret) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    role: "authenticated",
    sub: userId,
    aud: "authenticated",
    iat: now,
    exp: now + 1800,
  })}`;
  return `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`;
}

async function main(argv) {
  const positional = [];
  const include = [];
  const exclude = [];
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--include") include.push(argv[++i]);
    else if (argv[i] === "--exclude") exclude.push(argv[++i]);
    else if (argv[i] === "--dry-run") dryRun = true;
    else positional.push(argv[i]);
  }
  const [folder, workspace] = positional;
  const env = (n) => process.env[n];
  const missing = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_JWT_SECRET",
    "HIVE_AGENT_TOKEN",
  ].filter((n) => !env(n));
  if (!folder || !workspace || positional.length > 2 || missing.length) {
    console.error(
      "Usage: node --env-file=.env scripts/import-vault.mjs <folder> <workspace> " +
        "[--include <path>]... [--exclude <path>]... [--dry-run]" +
        (missing.length
          ? `\nMissing in the environment: ${missing.join(", ")}`
          : ""),
    );
    process.exit(2);
  }

  const login = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/agent_login`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_ANON_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_token: env("HIVE_AGENT_TOKEN") }),
  });
  if (!login.ok) throw new Error(`Hive sign-in failed: ${await login.text()}`);
  const [me] = await login.json();

  const report = await importVault({
    folder,
    workspace,
    include,
    exclude,
    dryRun,
    store: restStore({
      url: env("SUPABASE_URL"),
      anonKey: env("SUPABASE_ANON_KEY"),
      jwt: personJwt(me.user_id, env("SUPABASE_JWT_SECRET")),
      memberId: me.member_id,
      hiveId: me.hive_id,
    }),
  });

  const n = (k) => report[k].length;
  console.log(
    `${dryRun ? "Dry run, nothing written. Would have: " : ""}` +
      `workspace "${workspace}": ${n("created")} created, ${n("updated")} updated, ` +
      `${n("unchanged")} unchanged, ${n("skipped")} skipped, ${n("failed")} failed.`,
  );
  for (const s of report.skipped)
    console.log(`  skipped ${s.path}: ${s.reason}`);
  for (const w of report.warnings)
    console.log(`  warning ${w.path}: ${w.warning}`);
  for (const f of report.failed) console.log(`  FAILED  ${f.path}: ${f.error}`);
  for (const p of report.notInFolder)
    console.log(`  in the hive but no longer in the folder (kept): ${p}`);
  if (n("failed")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2));
