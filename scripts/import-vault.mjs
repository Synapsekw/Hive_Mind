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
// It signs in as a person, not as an agent: the notes are theirs, and an agent
// may only write in its own workspace. It asks for the person's email and
// password on the terminal (the password is not shown), or takes them from
// HIVE_PERSON_EMAIL and HIVE_PERSON_PASSWORD for an unattended run. The
// password is used once to sign in and is not stored. Every permission is
// still decided by the database.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, posix } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
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

// ------------------------------------------------------------------ sign-in

// Signs the person in through Supabase Auth. What the server answers on a
// refusal is not repeated: it may quote the email, and nothing here may ever
// carry the password.
export async function personSession(
  { url, anonKey, email, password },
  fetchFn = fetch,
) {
  let res;
  try {
    res = await fetchFn(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error("Sign-in failed: the hive is not reachable");
  }
  if (!res.ok)
    throw new Error(
      res.status === 400 || res.status === 401
        ? `Sign-in failed (${res.status}): check the email and the password`
        : `Sign-in failed (${res.status})`,
    );
  let data;
  try {
    data = JSON.parse(await res.text());
  } catch {
    data = null;
  }
  const jwt = data?.access_token;
  const userId = data?.user?.id;
  if (typeof jwt !== "string" || !jwt || typeof userId !== "string" || !userId)
    throw new Error("Sign-in failed: the answer held no session");
  return { jwt, userId };
}

// The person's own oldest membership, read with their session: the member row
// and hive the notes go under. The database decides what they may see.
export async function ownMembership(
  { url, anonKey, jwt, userId },
  fetchFn = fetch,
) {
  const res = await fetchFn(
    `${url}/rest/v1/members?user_id=eq.${encodeURIComponent(userId)}` +
      "&order=created_at,id&limit=1&select=id,hive_id",
    { headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` } },
  );
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = JSON.parse(text).message ?? text;
    } catch {
      // Not JSON; report it as it came.
    }
    throw new Error(`Could not read your membership: ${res.status} ${detail}`);
  }
  const [row] = JSON.parse(text);
  if (!row) throw new Error("You are not in a hive");
  return { memberId: row.id, hiveId: row.hive_id };
}

// Email and password: from the environment when both are there, otherwise
// asked on the terminal. `ask` shows what is typed, `askHidden` does not.
export async function personCredentials({ env, isTTY, ask, askHidden }) {
  if (env.HIVE_PERSON_EMAIL && env.HIVE_PERSON_PASSWORD)
    return {
      email: env.HIVE_PERSON_EMAIL,
      password: env.HIVE_PERSON_PASSWORD,
    };
  if (!isTTY)
    throw new Error(
      "No terminal to ask for your email and password. Run this in a terminal, " +
        "or set both HIVE_PERSON_EMAIL and HIVE_PERSON_PASSWORD.",
    );
  const email = (await ask("Hive email: ")).trim();
  const password = await askHidden("Hive password (not shown): ");
  if (!email || !password)
    throw new Error("Sign-in needs an email and a password");
  return { email, password };
}

// The two prompts on the real terminal. Questions go to stderr so the report
// on stdout stays clean. While the password is typed, nothing readline writes
// reaches the screen.
function terminalPrompts() {
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!hidden) process.stderr.write(chunk, encoding);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  rl.on("SIGINT", () => {
    hidden = false;
    rl.close();
    process.stderr.write("\n");
    process.exit(130);
  });
  return {
    ask: (question) => rl.question(question),
    async askHidden(question) {
      const answer = rl.question(question); // the question itself is shown
      hidden = true;
      try {
        return await answer;
      } finally {
        hidden = false;
        process.stderr.write("\n");
      }
    },
    close: () => rl.close(),
  };
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
  const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY"].filter((n) => !env(n));
  if (!folder || !workspace || positional.length > 2 || missing.length) {
    console.error(
      "Usage: node --env-file=.env scripts/import-vault.mjs <folder> <workspace> " +
        "[--include <path>]... [--exclude <path>]... [--dry-run]\n" +
        "Asks for your hive email and password, or reads HIVE_PERSON_EMAIL and " +
        "HIVE_PERSON_PASSWORD when both are set." +
        (missing.length
          ? `\nMissing in the environment: ${missing.join(", ")}`
          : ""),
    );
    process.exit(2);
  }

  const site = { url: env("SUPABASE_URL"), anonKey: env("SUPABASE_ANON_KEY") };
  const isTTY = Boolean(process.stdin.isTTY);
  const fromEnv = env("HIVE_PERSON_EMAIL") && env("HIVE_PERSON_PASSWORD");
  const prompts = !fromEnv && isTTY ? terminalPrompts() : {};
  let session;
  try {
    // The password lives only inside this call.
    session = await personSession({
      ...site,
      ...(await personCredentials({ env: process.env, isTTY, ...prompts })),
    });
  } finally {
    prompts.close?.();
    delete process.env.HIVE_PERSON_PASSWORD;
  }
  const mine = await ownMembership({ ...site, ...session });

  const report = await importVault({
    folder,
    workspace,
    include,
    exclude,
    dryRun,
    store: restStore({ ...site, jwt: session.jwt, ...mine }),
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
  try {
    await main(process.argv.slice(2));
  } catch (e) {
    console.error(message(e));
    process.exit(1);
  }
