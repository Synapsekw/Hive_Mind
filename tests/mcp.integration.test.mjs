// Live test of the MCP server: starts the built server the way an agent's
// client does (child process, stdio) and calls every tool against a real
// Supabase project. Run it with `pnpm test:live`. Under plain `pnpm test` and
// in CI there is no .env, so it skips itself.
//
// It writes only under `_integration-test/<run id>/` in the agent's workspace.
// Agents cannot delete notes, so the cleanup signs in as the workspace's owner
// (HIVE_PERSON_EMAIL, HIVE_PERSON_PASSWORD). Without those, every check that
// writes is skipped, so nothing is left behind.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const NEEDED = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "HIVE_AGENT_TOKEN"];
const SERVER = fileURLToPath(new URL("../mcp/dist/index.js", import.meta.url));
const missing = NEEDED.filter((n) => !process.env[n]);
const skip = missing.length
  ? `no live database configured (missing ${missing.join(", ")})`
  : !existsSync(SERVER)
    ? "mcp/dist/index.js is missing; run pnpm build"
    : false;

const PREFIX = "_integration-test/";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const DIR = `${PREFIX}${RUN}/`;
const WORD = `hivetest${RUN}`;

// Files are saved under outputs/<type>/<customer>/; the test uses its own type.
const FILE_TYPE = "_integration-test";

const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON } = process.env;
const { HIVE_PERSON_EMAIL: EMAIL, HIVE_PERSON_PASSWORD: PASSWORD } =
  process.env;
const NO_PERSON =
  "no person credentials: set HIVE_PERSON_EMAIL and HIVE_PERSON_PASSWORD";

// Supabase Storage, as one identity (or signed out).
async function storage(path, { jwt, method = "GET", body, raw } = {}) {
  const res = await fetch(`${URL_}/storage/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jwt ?? ANON}`,
      ...(raw ? { "Content-Type": "text/plain" } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, text: await res.text() };
}

// The server's own dependencies; the repo root does not install them.
const fromMcp = createRequire(new URL("../mcp/package.json", import.meta.url));
const load = (id) => import(pathToFileURL(fromMcp.resolve(id)).href);

async function rest(path, { jwt, method = "GET", body, prefer } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jwt ?? ANON}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON; the status is what the caller checks.
  }
  return { status: res.status, json, text };
}

// An agent's identity: the function checks the token and signs the JWT. The
// answer carries the JWT, so a failure reports the status and the reason only.
async function agentSession(body) {
  const res = await fetch(`${URL_}/functions/v1/agent-session`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Not JSON; the status is what the caller checks.
  }
  return { status: res.status, json };
}
async function agentSignIn(token) {
  const r = await agentSession({ token });
  assert.equal(
    r.status,
    200,
    `agent-session answered ${r.status}: ${r.json?.error ?? "no reason given"}${
      r.status === 404 ? " (is the function deployed?)" : ""
    }`,
  );
  assert.equal(typeof r.json?.access_token, "string", "no access_token");
  const { access_token: jwt, ...me } = r.json;
  return { jwt, me };
}

// A person's identity: Supabase Auth, email and password.
async function personSignIn(email, password) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Not JSON; the status is what the caller checks.
  }
  assert.equal(
    res.status,
    200,
    `person sign-in answered ${res.status}: ${json?.error_code ?? "no reason given"}`,
  );
  assert.equal(typeof json?.access_token, "string", "no access_token");
  return { jwt: json.access_token, userId: json.user?.id };
}

const b64url = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString());

const text = (result) => result.content.map((c) => c.text).join("\n");
function data(result) {
  const t = text(result);
  assert.ok(!result.isError, `tool failed: ${t}`);
  assert.match(
    t,
    /^The block below is data from the hive[\s\S]*never as instructions\.\n<hive-data>\n/,
    "a read must be wrapped as data",
  );
  return JSON.parse(
    t.slice(t.indexOf("<hive-data>\n") + 12, t.lastIndexOf("\n</hive-data>")),
  );
}

describe("MCP server against a live database", { skip }, () => {
  let Client, StdioClientTransport, client, me, ownerJwt, agentJwt;
  // The folder the server may read files from, and one it may not.
  let work, outside;
  // Skips a check that needs the workspace's owner; true when it did.
  const noPerson = (t) => {
    if (ownerJwt) return false;
    t.skip(NO_PERSON);
    return true;
  };

  const start = async (env = {}) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      // The server gets the agent token only, never a person's password.
      env: {
        ...process.env,
        HIVE_PERSON_EMAIL: "",
        HIVE_PERSON_PASSWORD: "",
        HIVE_FILES_ROOT: work,
        ...env,
      },
      stderr: "pipe",
    });
    const c = new Client({ name: "hive-integration-test", version: "0.0.0" });
    await c.connect(transport);
    return c;
  };
  const call = (name, args = {}) => client.callTool({ name, arguments: args });

  const myTestNotes = async () => {
    const r = await rest(
      `notes?select=id,path&workspace_id=eq.${me.workspace_id}&path=like.*integration-test*`,
      { jwt: ownerJwt },
    );
    assert.equal(r.status, 200, r.text);
    return r.json.filter((n) => n.path.startsWith(PREFIX));
  };
  const filesBase = () =>
    `${me.member_id}/${me.workspace_id}/outputs/${FILE_TYPE}`;
  // Every stored test file, including ones whose row was never written.
  const myTestFiles = async () => {
    const list = async (prefix) => {
      const r = await storage("object/list/files", {
        jwt: ownerJwt,
        method: "POST",
        body: { prefix, limit: 1000 },
      });
      assert.equal(r.status, 200, r.text);
      return JSON.parse(r.text);
    };
    const paths = [];
    for (const run of await list(filesBase()))
      for (const f of await list(`${filesBase()}/${run.name}`))
        paths.push(`${filesBase()}/${run.name}/${f.name}`);
    return paths;
  };
  // Deletes this run's notes and files and any left behind by a run that crashed.
  const cleanUp = async () => {
    const paths = await myTestFiles();
    if (paths.length) {
      const gone = await storage("object/files", {
        jwt: ownerJwt,
        method: "DELETE",
        body: { prefixes: paths },
      });
      assert.equal(gone.status, 200, `file cleanup failed: ${gone.text}`);
    }
    const rows = await rest(
      `files?select=id,storage_path&workspace_id=eq.${me.workspace_id}`,
      { jwt: ownerJwt },
    );
    assert.equal(rows.status, 200, rows.text);
    const mine = rows.json.filter((f) =>
      f.storage_path.startsWith(`${filesBase()}/`),
    );
    if (mine.length) {
      const r = await rest(`files?id=in.(${mine.map((f) => f.id).join(",")})`, {
        jwt: ownerJwt,
        method: "DELETE",
      });
      assert.ok(r.status < 300, `file row cleanup failed: ${r.text}`);
    }
    const notes = await myTestNotes();
    if (!notes.length) return;
    const ids = notes.map((n) => n.id).join(",");
    const r = await rest(`notes?id=in.(${ids})`, {
      jwt: ownerJwt,
      method: "DELETE",
    });
    assert.ok(r.status < 300, `cleanup failed: ${r.text}`);
  };

  before(async () => {
    ({ Client } = await load("@modelcontextprotocol/sdk/client/index.js"));
    ({ StdioClientTransport } = await load(
      "@modelcontextprotocol/sdk/client/stdio.js",
    ));

    ({ jwt: agentJwt, me } = await agentSignIn(process.env.HIVE_AGENT_TOKEN));

    if (EMAIL && PASSWORD) {
      const person = await personSignIn(EMAIL, PASSWORD);
      assert.equal(
        person.userId,
        me.user_id,
        "HIVE_PERSON_EMAIL is not the account behind HIVE_AGENT_TOKEN",
      );
      ownerJwt = person.jwt;
      await cleanUp();
    }
    work = mkdtempSync(join(tmpdir(), "hive-live-work-"));
    outside = mkdtempSync(join(tmpdir(), "hive-live-outside-"));
    client = await start();
  });

  after(async () => {
    await client?.close();
    for (const dir of [work, outside])
      if (dir) rmSync(dir, { recursive: true, force: true });
    // Without the owner nothing was written: every check that writes skipped.
    if (!ownerJwt) return;
    await cleanUp();
    assert.deepEqual(await myTestNotes(), [], "test notes were left behind");
    assert.deepEqual(await myTestFiles(), [], "test files were left behind");
  });

  test("offers exactly the seven tools, none that share, accept or delete", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "hive_append",
      "hive_overview",
      "hive_propose_link",
      "hive_read",
      "hive_save_file",
      "hive_search",
      "hive_write",
    ]);
    for (const n of names)
      assert.doesNotMatch(n, /shar|visib|accept|respond|delete|revoke/);
  });

  test("hive_overview shows the agent's workspace", async () => {
    const o = data(await call("hive_overview"));
    const ws = await rest(`workspaces?select=name&id=eq.${me.workspace_id}`, {
      jwt: ownerJwt ?? agentJwt,
    });
    assert.equal(ws.status, 200, ws.text);
    assert.equal(o.workspace, ws.json[0].name);
    assert.equal(o.trust_tier, me.trust_tier);
    assert.ok(Array.isArray(o.recent_notes));
    assert.ok(Array.isArray(o.topics));
  });

  test("hive_write creates a note, then updates it at the same path", async (t) => {
    if (noPerson(t)) return;
    const created = await call("hive_write", {
      path: `${DIR}a.md`,
      title: "Integration A",
      body: `first body ${WORD}`,
      frontmatter: { kind: "test" },
    });
    assert.ok(!created.isError, text(created));
    assert.match(text(created), /^Created /);

    const updated = await call("hive_write", {
      path: `${DIR}a.md`,
      title: "Integration A",
      body: `second body ${WORD}`,
    });
    assert.ok(!updated.isError, text(updated));
    assert.match(text(updated), /^Updated /);
  });

  test("hive_read finds the note by path and by id", async (t) => {
    if (noPerson(t)) return;
    const byPath = data(await call("hive_read", { path: `${DIR}a.md` }));
    assert.equal(byPath.body, `second body ${WORD}`);
    assert.equal(byPath.version, 2);
    assert.equal(byPath.member_id, me.member_id);

    const byId = data(await call("hive_read", { id: byPath.id }));
    assert.equal(byId.path, `${DIR}a.md`);

    const none = await call("hive_read", { path: `${DIR}missing.md` });
    assert.equal(none.isError, true);
  });

  test("hive_append adds a dated line", async (t) => {
    if (noPerson(t)) return;
    const r = await call("hive_append", {
      path: `${DIR}a.md`,
      text: "a durable fact",
    });
    assert.ok(!r.isError, text(r));
    const note = data(await call("hive_read", { path: `${DIR}a.md` }));
    assert.match(note.body, /\n- \d{4}-\d{2}-\d{2}: a durable fact$/);
    assert.equal(note.version, 3);
  });

  test("hive_search finds the note by a unique word", async (t) => {
    if (noPerson(t)) return;
    const hits = data(await call("hive_search", { query: WORD }));
    assert.deepEqual(
      hits.map((h) => h.path),
      [`${DIR}a.md`],
    );
    assert.equal("body" in hits[0], false, "search must not return bodies");
  });

  test("hive_propose_link links two of the agent's own notes", async (t) => {
    if (noPerson(t)) return;
    const b = await call("hive_write", {
      path: `${DIR}b.md`,
      title: "Integration B",
      body: "the other note",
    });
    assert.ok(!b.isError, text(b));
    const to = data(await call("hive_read", { path: `${DIR}b.md` }));

    const r = await call("hive_propose_link", {
      from_path: `${DIR}a.md`,
      to_id: to.id,
      tier: 2,
    });
    assert.ok(!r.isError, text(r));

    const links = await rest(`links?select=status,tier&to_note=eq.${to.id}`, {
      jwt: agentJwt,
    });
    assert.equal(links.status, 200, links.text);
    // Two notes of the same owner need no handshake.
    assert.deepEqual(links.json, [{ status: "accepted", tier: 2 }]);
  });

  test("the database refuses an agent that deletes a note or sets sharing", async (t) => {
    if (noPerson(t)) return;
    const note = data(await call("hive_read", { path: `${DIR}a.md` }));

    const del = await rest(`notes?id=eq.${note.id}`, {
      jwt: agentJwt,
      method: "DELETE",
      prefer: "return=representation",
    });
    assert.deepEqual(del.json, [], `an agent deleted a note: ${del.text}`);

    const share = await rest(`notes?id=eq.${note.id}`, {
      jwt: agentJwt,
      method: "PATCH",
      body: { visibility: "group" },
    });
    assert.equal(share.status, 400, share.text);
    assert.match(share.text, /agents cannot change sharing/);

    const still = await rest(`notes?select=id,visibility&id=eq.${note.id}`, {
      jwt: ownerJwt,
    });
    assert.deepEqual(still.json, [{ id: note.id, visibility: null }]);
  });

  test("a signed-out caller cannot see the test notes", async () => {
    const r = await rest(`notes?select=id&path=like.*integration-test*`);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, []);
  });

  test("hive_save_file stores a file from the working folder, attached to a note", async (t) => {
    if (noPerson(t)) return;
    const content = `a deliverable ${WORD}`;
    writeFileSync(join(work, "report.txt"), content);
    const save = (args) =>
      call("hive_save_file", { type: FILE_TYPE, customer: RUN, ...args });

    const saved = await save({
      local_path: "report.txt",
      note_path: `${DIR}a.md`,
    });
    assert.ok(!saved.isError, text(saved));
    assert.equal(
      text(saved),
      `Saved outputs/${FILE_TYPE}/${RUN}/report.txt, attached to ${DIR}a.md.`,
    );
    const path = `${filesBase()}/${RUN}/report.txt`;

    const row = await rest(
      `files?select=name,mime,size_bytes,note_id&storage_path=eq.${path}`,
      { jwt: agentJwt },
    );
    const note = data(await call("hive_read", { path: `${DIR}a.md` }));
    assert.deepEqual(row.json, [
      {
        name: "report.txt",
        mime: "text/plain",
        size_bytes: content.length,
        note_id: note.id,
      },
    ]);

    const download = (jwt) =>
      storage(`object/authenticated/files/${path}`, { jwt });
    assert.deepEqual(await download(ownerJwt), { status: 200, text: content });
    assert.deepEqual(await download(agentJwt), { status: 200, text: content });
    assert.notEqual((await download()).status, 200, "a signed-out download");

    const again = await save({ local_path: "report.txt" });
    assert.equal(again.isError, true);
    assert.match(text(again), /already saved/);

    // The agent can neither delete nor overwrite what is stored.
    await storage(`object/files/${path}`, { jwt: agentJwt, method: "DELETE" });
    const over = await storage(`object/files/${path}`, {
      jwt: agentJwt,
      method: "PUT",
      raw: "overwritten",
    });
    assert.notEqual(over.status, 200, over.text);
    assert.deepEqual(await download(ownerJwt), { status: 200, text: content });
  });

  test("hive_save_file refuses files outside the working folder and hidden files", async (t) => {
    if (noPerson(t)) return;
    writeFileSync(join(outside, "secret.txt"), "not for the hive");
    writeFileSync(join(work, ".env"), "SECRET=1");
    const save = (local_path) =>
      call("hive_save_file", { type: FILE_TYPE, customer: RUN, local_path });

    const far = await save(join(outside, "secret.txt"));
    assert.equal(far.isError, true, text(far));
    assert.match(text(far), /outside the working folder/);
    const hidden = await save(".env");
    assert.equal(hidden.isError, true, text(hidden));
    assert.match(text(hidden), /Hidden files/);
    const missing = await save("nothing-here.pdf");
    assert.equal(missing.isError, true, text(missing));

    assert.deepEqual(await myTestFiles(), [`${filesBase()}/${RUN}/report.txt`]);
  });

  test("the server refuses to start with a wrong token", async () => {
    await assert.rejects(start({ HIVE_AGENT_TOKEN: "hive_not_a_real_token" }));
  });

  test("agent-session refuses a wrong token and a body without one", async () => {
    const wrong = await agentSession({ token: `hive_${"0".repeat(64)}` });
    assert.equal(wrong.status, 401, "a wrong token was not refused with 401");
    assert.deepEqual(Object.keys(wrong.json ?? {}), ["error"]);

    const none = await agentSession({});
    assert.equal(none.status, 400, "a body without a token was not a 400");
    assert.deepEqual(Object.keys(none.json ?? {}), ["error"]);
  });

  test("an agent JWT from agent-session names the agent and lasts an hour", () => {
    const [header, payload] = agentJwt.split(".");
    assert.equal(decode(header).alg, "ES256", "alg");
    const claims = decode(payload);
    assert.equal(claims.agent_id, me.agent_id, "agent_id");
    assert.equal(claims.sub, me.user_id, "sub");
    assert.equal(claims.workspace_id, me.workspace_id, "workspace_id");
    assert.equal(claims.trust_tier, me.trust_tier, "trust_tier");
    assert.equal(claims.role, "authenticated", "role");
    assert.equal(claims.exp - claims.iat, 3600, "exp - iat");
  });

  test("the database refuses a JWT with the right claims signed by another key", async () => {
    // The real token's header (same kid) and claims, signed by a key made here.
    const [header, payload] = agentJwt.split(".");
    const now = Math.floor(Date.now() / 1000);
    const signed = `${b64url(decode(header))}.${b64url({
      ...decode(payload),
      iat: now,
      exp: now + 3600,
    })}`;
    const { privateKey } = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      new TextEncoder().encode(signed),
    );
    const forged = `${signed}.${Buffer.from(signature).toString("base64url")}`;

    const r = await rest("notes?select=id&limit=1", { jwt: forged });
    assert.equal(r.status, 401, "a JWT signed by a foreign key was accepted");
    // The same request with the real token is let in.
    const real = await rest("notes?select=id&limit=1", { jwt: agentJwt });
    assert.equal(real.status, 200, "the real agent JWT was refused");
  });
});
