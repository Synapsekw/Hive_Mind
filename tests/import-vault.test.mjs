// The vault importer, run against the real migrations in PGlite as a signed-in
// person. The folder it imports is built in a temp directory so the exact
// bytes (BOM, Windows line endings) are under the test's control.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openDb } from "../scripts/local-db.mjs";
import {
  importVault,
  listMarkdown,
  ownMembership,
  parseNote,
  personCredentials,
  personSession,
} from "../scripts/import-vault.mjs";

const { db, as } = await openDb();
let folder, dani, ahmed, store, hive;

const put = (rel, text) => {
  const p = join(folder, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};

// The same seven calls the live REST store makes, as SQL under row-level security.
const pgStore = (who) => ({
  async findWorkspace(name) {
    const r = await as(
      who.claims,
      `select id from public.workspaces where member_id = $1 and name = $2`,
      [who.member, name],
    );
    return r[0]?.id ?? null;
  },
  async createWorkspace(name) {
    const r = await as(
      who.claims,
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, $3) returning id`,
      [hive, who.member, name],
    );
    return r[0].id;
  },
  listFolders: (ws) =>
    as(
      who.claims,
      `select id, path from public.folders where workspace_id = $1`,
      [ws],
    ),
  async createFolders(ws, paths) {
    const out = [];
    for (const path of paths)
      out.push(
        ...(await as(
          who.claims,
          `insert into public.folders (workspace_id, member_id, path) values ($1, $2, $3) returning id, path`,
          [ws, who.member, path],
        )),
      );
    return out;
  },
  listNotes: (ws) =>
    as(
      who.claims,
      `select id, path, title, body, frontmatter, folder_id from public.notes where workspace_id = $1`,
      [ws],
    ),
  async createNotes(ws, notes) {
    for (const n of notes)
      await as(
        who.claims,
        `insert into public.notes (hive_id, member_id, workspace_id, folder_id, path, title, body, frontmatter)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          hive,
          who.member,
          ws,
          n.folder_id,
          n.path,
          n.title,
          n.body,
          JSON.stringify(n.frontmatter),
        ],
      );
  },
  async updateNote(id, n) {
    await as(
      who.claims,
      `update public.notes set title = $2, body = $3, frontmatter = $4::jsonb, folder_id = $5 where id = $1`,
      [id, n.title, n.body, JSON.stringify(n.frontmatter), n.folder_id],
    );
  },
});

const notes = (claims) =>
  as(
    claims,
    `select n.path, n.title, n.body, n.frontmatter, n.version, n.visibility, n.written_by_agent,
            f.path as folder, w.name as workspace
       from public.notes n
       join public.workspaces w on w.id = n.workspace_id
       left join public.folders f on f.id = n.folder_id
      order by n.path`,
  );
const run = (extra = {}) =>
  importVault({ folder, workspace: "Vault", store, ...extra });

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "hive-import-"));
  put(
    "Home.md",
    "---\ntitle: Home page\ntags: [a, b]\ndate: 2026-05-23\n---\n\nWelcome to [[Decisions/one]].\n",
  );
  put("Decisions/one.md", "# One\n\nNo frontmatter here.\n");
  put(
    "Decisions/deep/two.md",
    '﻿---\r\ntitle: Two\r\nrelated:\r\n  - "[[one]]"\r\n---\r\nLine one\r\nLine two\r\n',
  );
  put("Decisions/broken.md", "---\ntitle: [unclosed\n---\nStill a note.\n");
  put(".obsidian/config.md", "not a note");
  put("Templates/t.md", "---\ntitle: Template\n---\nx\n");
  put("assets/picture.png", "png");
  put("notes.txt", "not markdown");

  const user = async (email) =>
    (
      await db.query(
        `insert into auth.users (email) values ($1) returning id`,
        [email],
      )
    ).rows[0].id;
  const claims = async (email) => ({
    sub: await user(email),
    role: "authenticated",
  });
  const d = await claims("dani@example.com");
  const a = await claims("ahmed@example.com");
  hive = (await as(d, `select public.create_hive('Hive', 'Dani') as id`))[0].id;
  await as(d, `select public.add_member($1, 'ahmed@example.com', 'Ahmed')`, [
    hive,
  ]);
  const member = async (c) =>
    (
      await as(c, `select id from public.members where user_id = $1`, [c.sub])
    )[0].id;
  dani = { claims: d, member: await member(d) };
  ahmed = { claims: a, member: await member(a) };
  store = pgStore(dani);
});

after(() => rmSync(folder, { recursive: true, force: true }));

test("parseNote reads frontmatter, strips the BOM and Windows line endings", () => {
  const n = parseNote(
    "﻿---\r\ntitle: Two\r\ndate: 2026-05-23\r\n---\r\n\r\nLine one\r\nLine two\r\n",
    "Decisions/deep/two.md",
  );
  assert.equal(n.title, "Two");
  assert.deepEqual(n.frontmatter, { title: "Two", date: "2026-05-23" });
  assert.equal(n.body, "Line one\nLine two\n");
  assert.equal(n.warning, undefined);
});

test("parseNote falls back to the file name and survives broken frontmatter", () => {
  const plain = parseNote("# Heading\n\ntext\n", "Decisions/my note.md");
  assert.equal(plain.title, "my note");
  assert.deepEqual(plain.frontmatter, {});
  assert.equal(plain.body, "# Heading\n\ntext\n");

  const broken = parseNote(
    "---\ntitle: [unclosed\n---\nStill a note.\n",
    "b.md",
  );
  assert.equal(broken.title, "b");
  assert.deepEqual(broken.frontmatter, {});
  assert.equal(broken.body, "---\ntitle: [unclosed\n---\nStill a note.\n");
  assert.match(broken.warning, /frontmatter/);

  const empty = parseNote("---\n---\nbody\n", "e.md");
  assert.deepEqual(empty.frontmatter, {});
  assert.equal(empty.body, "body\n");
});

test("listMarkdown skips dot folders and non-markdown, and honours include and exclude", () => {
  assert.deepEqual(listMarkdown(folder), [
    "Decisions/broken.md",
    "Decisions/deep/two.md",
    "Decisions/one.md",
    "Home.md",
    "Templates/t.md",
  ]);
  assert.deepEqual(listMarkdown(folder, { exclude: ["Templates"] }).length, 4);
  assert.deepEqual(
    listMarkdown(folder, { include: ["decisions\\deep", "Home.md"] }),
    ["Decisions/deep/two.md", "Home.md"],
  );
  assert.deepEqual(
    listMarkdown(folder, {
      include: ["Decisions"],
      exclude: ["Decisions/deep"],
    }),
    ["Decisions/broken.md", "Decisions/one.md"],
  );
});

test("a dry run reports what it would do and writes nothing", async () => {
  const r = await run({ exclude: ["Templates"], dryRun: true });
  assert.equal(r.created.length, 4);
  assert.deepEqual(await notes(dani.claims), []);
  assert.equal(await store.findWorkspace("Vault"), null);
});

test("imports each note at its path, private, as the person, with folders mapped", async () => {
  const r = await run({ exclude: ["Templates"] });
  assert.deepEqual(r.created, [
    "Decisions/broken.md",
    "Decisions/deep/two.md",
    "Decisions/one.md",
    "Home.md",
  ]);
  assert.deepEqual(r.updated, []);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(
    r.warnings.map((w) => w.path),
    ["Decisions/broken.md"],
  );

  const rows = await notes(dani.claims);
  assert.deepEqual(
    rows.map((n) => [n.path, n.title, n.folder, n.workspace]),
    [
      ["Decisions/broken.md", "broken", "Decisions", "Vault"],
      ["Decisions/deep/two.md", "Two", "Decisions/deep", "Vault"],
      ["Decisions/one.md", "one", "Decisions", "Vault"],
      ["Home.md", "Home page", null, "Vault"],
    ],
  );
  for (const n of rows) {
    assert.equal(n.version, 1);
    assert.equal(n.visibility, null);
    assert.equal(n.written_by_agent, null);
  }
  const two = rows[1];
  assert.equal(two.body, "Line one\nLine two\n");
  assert.deepEqual(two.frontmatter, { title: "Two", related: ["[[one]]"] });
  assert.equal(rows[3].body, "Welcome to [[Decisions/one]].\n");
  assert.deepEqual(rows[3].frontmatter, {
    title: "Home page",
    tags: ["a", "b"],
    date: "2026-05-23",
  });
});

test("another member of the hive cannot read the imported notes", async () => {
  assert.deepEqual(await notes(ahmed.claims), []);
});

test("running it again changes nothing", async () => {
  const r = await run({ exclude: ["Templates"] });
  assert.deepEqual(r.created, []);
  assert.deepEqual(r.updated, []);
  assert.equal(r.unchanged.length, 4);
  const rows = await notes(dani.claims);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((n) => n.version === 1));
});

test("a changed file becomes a new version; nothing is duplicated or deleted", async () => {
  put("Decisions/one.md", "# One\n\nNow with a second line.\n");
  rmSync(join(folder, "Home.md"));
  const r = await run({ exclude: ["Templates"] });
  assert.deepEqual(r.created, []);
  assert.deepEqual(r.updated, ["Decisions/one.md"]);
  assert.deepEqual(r.notInFolder, ["Home.md"]);

  const rows = await notes(dani.claims);
  assert.deepEqual(
    rows.map((n) => [n.path, n.version]),
    [
      ["Decisions/broken.md", 1],
      ["Decisions/deep/two.md", 1],
      ["Decisions/one.md", 2],
      ["Home.md", 1],
    ],
  );
  const versions = await as(
    dani.claims,
    `select count(*)::int as n from public.note_versions`,
  );
  assert.equal(versions[0].n, 5);
});

test("an include list limits the import and leaves other notes alone", async () => {
  const r = await run({ include: ["Templates"] });
  assert.deepEqual(r.created, ["Templates/t.md"]);
  // Notes outside the include list are not reported as missing from the folder.
  assert.deepEqual(r.notInFolder, []);
  assert.equal((await notes(dani.claims)).length, 5);
});

test("one note that the database refuses does not stop the rest", async () => {
  const failing = {
    ...store,
    async createNotes(ws, batch) {
      if (batch.some((n) => n.path === "New/bad.md"))
        throw new Error("refused by the database");
      return store.createNotes(ws, batch);
    },
  };
  put("New/bad.md", "bad\n");
  put("New/good.md", "good\n");
  const r = await importVault({
    folder,
    workspace: "Vault",
    store: failing,
    include: ["New"],
  });
  assert.deepEqual(r.created, ["New/good.md"]);
  assert.deepEqual(r.failed, [
    { path: "New/bad.md", error: "refused by the database" },
  ]);
});

// ------------------------------------------------------------------ sign-in
// The importer signs in as the person through Supabase Auth. `fetch` and the
// terminal prompts are injected, so nothing here touches a network or a TTY.

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const recording = (status, body) => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return answer(status, body);
  };
  return { calls, fetchFn };
};
const site = { url: "https://hive.example", anonKey: "publishable-key" };
const who = { email: "dani@example.com", password: "correct horse battery" };

test("personSession posts the password grant and returns the session", async () => {
  const { calls, fetchFn } = recording(200, {
    access_token: "session-jwt",
    user: { id: "user-1" },
  });
  const session = await personSession({ ...site, ...who }, fetchFn);
  assert.deepEqual(session, { jwt: "session-jwt", userId: "user-1" });

  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, "https://hive.example/auth/v1/token?grant_type=password");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.apikey, "publishable-key");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(init.body), who);
});

test("a refused sign-in says so without the email or the password", async () => {
  // Echo both back, as a careless server might: neither may reach the message.
  const refusals = [
    recording(400, {
      error_code: "invalid_credentials",
      msg: `Invalid login for ${who.email} with ${who.password}`,
    }),
    recording(500, `boom ${who.email} ${who.password}`),
    recording(200, { user: { id: "user-1" } }),
    recording(200, { access_token: "session-jwt" }),
    recording(200, "not json"),
    {
      fetchFn: async () => {
        throw new Error(`could not send ${who.email} ${who.password}`);
      },
    },
  ];
  for (const { fetchFn } of refusals)
    await assert.rejects(personSession({ ...site, ...who }, fetchFn), (e) => {
      assert.match(e.message, /Sign-in failed/);
      for (const text of [e.message, String(e.stack), String(e.cause ?? "")]) {
        assert.ok(!text.includes(who.email));
        assert.ok(!text.includes(who.password));
      }
      return true;
    });
});

test("ownMembership reads the person's own oldest member row", async () => {
  const { calls, fetchFn } = recording(200, [
    { id: "member-1", hive_id: "hive-1" },
  ]);
  const mine = await ownMembership(
    { ...site, jwt: "session-jwt", userId: "user-1" },
    fetchFn,
  );
  assert.deepEqual(mine, { memberId: "member-1", hiveId: "hive-1" });

  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(
    url,
    "https://hive.example/rest/v1/members?user_id=eq.user-1&order=created_at,id&limit=1&select=id,hive_id",
  );
  assert.equal(init.method ?? "GET", "GET");
  assert.equal(init.headers.apikey, "publishable-key");
  assert.equal(init.headers.Authorization, "Bearer session-jwt");
  assert.equal(init.body, undefined);
});

test("ownMembership refuses a person who is in no hive, or an answer it cannot use", async () => {
  const args = { ...site, jwt: "session-jwt", userId: "user-1" };
  await assert.rejects(ownMembership(args, recording(200, []).fetchFn), {
    message: "You are not in a hive",
  });
  await assert.rejects(
    ownMembership(args, recording(401, { message: "JWT expired" }).fetchFn),
    (e) => {
      assert.match(e.message, /401/);
      assert.ok(!e.message.includes("session-jwt"));
      return true;
    },
  );
});

test("credentials come from the environment when both are set, with no prompt", async () => {
  const never = async () => assert.fail("must not prompt");
  assert.deepEqual(
    await personCredentials({
      env: {
        HIVE_PERSON_EMAIL: who.email,
        HIVE_PERSON_PASSWORD: who.password,
      },
      isTTY: false,
      ask: never,
      askHidden: never,
    }),
    who,
  );
});

test("credentials are asked on the terminal otherwise, the password unseen", async () => {
  const asked = [];
  const ask = async (q) => (asked.push(["shown", q]), `  ${who.email} `);
  const askHidden = async (q) => (asked.push(["hidden", q]), who.password);
  // One of the two alone is not enough: both are asked for.
  for (const env of [{}, { HIVE_PERSON_EMAIL: "other@example.com" }]) {
    asked.length = 0;
    assert.deepEqual(
      await personCredentials({ env, isTTY: true, ask, askHidden }),
      who,
    );
    assert.deepEqual(
      asked.map(([how]) => how),
      ["shown", "hidden"],
    );
    assert.match(asked[0][1], /email/i);
    assert.match(asked[1][1], /password/i);
  }
  await assert.rejects(
    personCredentials({
      env: {},
      isTTY: true,
      ask,
      askHidden: async () => "",
    }),
    /email and a password/,
  );
});

test("with no terminal and no credentials in the environment it refuses", async () => {
  const never = async () => assert.fail("must not prompt");
  await assert.rejects(
    personCredentials({
      env: { HIVE_PERSON_PASSWORD: who.password },
      isTTY: false,
      ask: never,
      askHidden: never,
    }),
    (e) => {
      assert.match(e.message, /HIVE_PERSON_EMAIL/);
      assert.match(e.message, /HIVE_PERSON_PASSWORD/);
      assert.ok(!e.message.includes(who.password));
      return true;
    },
  );
});
