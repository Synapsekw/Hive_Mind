// Runs the real migrations in an in-process Postgres (PGlite) and checks the
// sharing rules as three different people and two kinds of agent.
// Supabase's auth schema and roles are stubbed in scripts/local-db.mjs;
// everything else is the SQL that ships. Run with: npm test
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../scripts/local-db.mjs";

const { db, as, addUser, addMember, addClient, addConsent } = await openDb();
const users = {};
const members = {};
const ws = {};
let hive;

const person = (name) => ({ sub: users[name], role: "authenticated" });
const titles = async (claims) =>
  (await as(claims, "select title from public.notes order by title")).map(
    (r) => r.title,
  );

before(async () => {
  for (const name of ["dani", "ahmed", "sara", "outsider"]) {
    const r = await db.query(
      `insert into auth.users (email) values ($1) returning id`,
      [`${name}@example.com`],
    );
    users[name] = r.rows[0].id;
  }
  hive = (
    await as(
      person("dani"),
      `select public.create_hive('Test hive', 'Dani') as id`,
    )
  )[0].id;
  // Put there as the database owner: these tests are about what members may
  // do. How a person becomes one is tested under "Emailed invitations".
  await addMember(hive, users.ahmed, "Ahmed");
  await addMember(hive, users.sara, "Sara");
  await as(
    person("outsider"),
    `select public.create_hive('Other hive', 'Outsider')`,
  );
  for (const name of ["dani", "ahmed", "sara"]) {
    const m = await as(
      person(name),
      `select id from public.members where user_id = $1 and hive_id = $2`,
      [users[name], hive],
    );
    members[name] = m[0].id;
    const w = await as(
      person(name),
      `select id from public.workspaces where member_id = $1`,
      [members[name]],
    );
    ws[name] = w[0].id;
  }
});

// A hive makes at most 20 invitations in 24 hours (invite_member), and this
// file makes more than that in the one hive. Before each test the invitations
// made so far are moved two days back, so every test starts with the whole
// allowance; the limit itself has a test of its own. A hive that is being
// deleted is left alone: nothing in it can be written, by this either, and
// nobody can invite into it.
beforeEach(async () => {
  await db.exec("reset role");
  await db.exec(
    `update public.invitations set created_at = created_at - interval '2 days'
      where created_at > now() - interval '1 day'
        and hive_id in (select id from public.hives where delete_after is null)`,
  );
});

const addNote = (name, title, extra = {}) =>
  as(
    person(name),
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body, visibility, shared_with)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      hive,
      members[name],
      ws[name],
      `${title}.md`,
      title,
      extra.body ?? "body",
      extra.visibility ?? null,
      extra.shared_with ?? [],
    ],
  );

test("a note is private until its owner shares it", async () => {
  await addNote("dani", "dani private");
  await addNote("dani", "dani group", { visibility: "group" });
  await addNote("dani", "dani for ahmed", {
    visibility: "members",
    shared_with: [members.ahmed],
  });

  assert.deepEqual(await titles(person("dani")), [
    "dani for ahmed",
    "dani group",
    "dani private",
  ]);
  assert.deepEqual(await titles(person("ahmed")), [
    "dani for ahmed",
    "dani group",
  ]);
  assert.deepEqual(await titles(person("sara")), ["dani group"]);
});

test("another hive and the public see nothing", async () => {
  assert.deepEqual(await titles(person("outsider")), []);
  assert.deepEqual(await titles(null), []);
});

test("a folder rule shares every note inside it", async () => {
  // The rule reaches notes by their path; folder_id plays no part.
  const f = await as(
    person("ahmed"),
    `insert into public.folders (workspace_id, member_id, path, visibility) values ($1, $2, 'clients', 'group') returning id`,
    [ws.ahmed, members.ahmed],
  );
  await as(
    person("ahmed"),
    `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     values ($1, $2, $3, 'clients/a.md', 'ahmed in shared folder')`,
    [hive, members.ahmed, ws.ahmed],
  );
  await as(
    person("ahmed"),
    `insert into public.notes (hive_id, member_id, workspace_id, folder_id, path, title)
     values ($1, $2, $3, $4, 'elsewhere/b.md', 'ahmed linked to folder by id only')`,
    [hive, members.ahmed, ws.ahmed, f[0].id],
  );
  const seen = await titles(person("sara"));
  assert.ok(seen.includes("ahmed in shared folder"));
  assert.ok(!seen.includes("ahmed linked to folder by id only"));
});

test("nobody can write into someone else's space", async () => {
  await assert.rejects(
    as(
      person("ahmed"),
      `insert into public.notes (hive_id, member_id, workspace_id, path, title) values ($1, $2, $3, 'x.md', 'forged')`,
      [hive, members.dani, ws.dani],
    ),
  );
  const changed = await as(
    person("ahmed"),
    `update public.notes set body = 'hacked' where title = 'dani group' returning id`,
  );
  assert.equal(changed.length, 0);
});

test("a link opens two private notes only after both owners accept", async () => {
  const a = (await addNote("dani", "dani kestrel"))[0].id;
  const b = (await addNote("sara", "sara kestrel"))[0].id;
  const link = (
    await as(
      person("dani"),
      `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $2, $3, 1, 1) returning id, status`,
      [hive, a, b],
    )
  )[0];
  assert.equal(link.status, "proposed");
  assert.ok(!(await titles(person("dani"))).includes("sara kestrel"));
  assert.ok(!(await titles(person("sara"))).includes("dani kestrel"));

  const status = await as(
    person("sara"),
    `select public.respond_to_link($1, true) as s`,
    [link.id],
  );
  assert.equal(status[0].s, "accepted");
  assert.ok((await titles(person("dani"))).includes("sara kestrel"));
  assert.ok((await titles(person("sara"))).includes("dani kestrel"));
  assert.ok(!(await titles(person("ahmed"))).includes("sara kestrel"));
});

test("a declined link shares nothing", async () => {
  const a = (await addNote("dani", "dani adnoc"))[0].id;
  const b = (await addNote("ahmed", "ahmed adnoc"))[0].id;
  const link = (
    await as(
      person("dani"),
      `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $2, $3, 1, 1) returning id`,
      [hive, a, b],
    )
  )[0];
  await as(person("ahmed"), `select public.respond_to_link($1, false)`, [
    link.id,
  ]);
  assert.ok(!(await titles(person("dani"))).includes("ahmed adnoc"));
  await assert.rejects(
    as(person("ahmed"), `select public.respond_to_link($1, true)`, [link.id]),
  );
});

test("an agent writes only in its own workspace and never changes sharing", async () => {
  const made = (
    await as(
      person("dani"),
      `select * from public.create_agent($1, 'Claude desktop', 'claude')`,
      [ws.dani],
    )
  )[0];
  const login = (
    await as(null, `select * from public.agent_login($1)`, [made.token])
  )[0];
  assert.equal(login.workspace_id, ws.dani);
  const agent = {
    sub: login.user_id,
    role: "authenticated",
    agent_id: login.agent_id,
    workspace_id: login.workspace_id,
    trust_tier: login.trust_tier,
  };

  const n = (
    await as(
      agent,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
     values ($1, $2, $3, 'agent.md', 'written by agent', 'v1') returning id, quarantined, written_by_agent`,
      [hive, members.dani, ws.dani],
    )
  )[0];
  assert.equal(n.quarantined, false);
  assert.equal(n.written_by_agent, login.agent_id);

  await as(agent, `update public.notes set body = 'v2' where id = $1`, [n.id]);
  const versions = await as(
    person("dani"),
    `select version from public.note_versions where note_id = $1 order by version`,
    [n.id],
  );
  assert.deepEqual(
    versions.map((v) => v.version),
    [1, 2],
  );

  await assert.rejects(
    as(agent, `update public.notes set visibility = 'group' where id = $1`, [
      n.id,
    ]),
  );
  await assert.rejects(
    as(
      agent,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title, visibility)
     values ($1, $2, $3, 'pub.md', 'agent tries to publish', 'group')`,
      [hive, members.dani, ws.dani],
    ),
  );
  const deleted = await as(
    agent,
    `delete from public.notes where id = $1 returning id`,
    [n.id],
  );
  assert.equal(deleted.length, 0);
  await assert.rejects(
    as(agent, `select public.respond_to_link(gen_random_uuid(), true)`),
  );

  await as(person("dani"), `select public.revoke_agent($1)`, [login.agent_id]);
  await assert.rejects(
    as(null, `select * from public.agent_login($1)`, [made.token]),
  );
});

test("a self-hosted agent is quarantined and sees only shared notes", async () => {
  const made = (
    await as(
      person("sara"),
      `select * from public.create_agent($1, 'Local agent', 'other', 'self_hosted')`,
      [ws.sara],
    )
  )[0];
  const login = (
    await as(null, `select * from public.agent_login($1)`, [made.token])
  )[0];
  const agent = {
    sub: login.user_id,
    role: "authenticated",
    agent_id: login.agent_id,
    workspace_id: login.workspace_id,
    trust_tier: login.trust_tier,
  };

  const n = (
    await as(
      agent,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     values ($1, $2, $3, 'held.md', 'held for review') returning quarantined`,
      [hive, members.sara, ws.sara],
    )
  )[0];
  assert.equal(n.quarantined, true);

  const seen = await titles(agent);
  assert.ok(seen.includes("held for review"));
  assert.ok(seen.includes("dani group"));
  assert.ok(
    !seen.includes("sara kestrel"),
    "must not read the member's private notes",
  );
  assert.ok(!(await titles(person("dani"))).includes("held for review"));
  assert.ok((await titles(person("sara"))).includes("held for review"));
});

test("token hashes are never readable", async () => {
  await assert.rejects(
    as(person("dani"), `select token_hash from public.agents`),
  );
  const rows = await as(person("ahmed"), `select id from public.agents`);
  assert.equal(rows.length, 0);
});

test("search returns only what the caller may read", async () => {
  const mine = await as(
    person("dani"),
    `select title from public.search_notes('kestrel')`,
  );
  assert.deepEqual(mine.map((r) => r.title).sort(), [
    "dani kestrel",
    "sara kestrel",
  ]);
  const ahmed = await as(
    person("ahmed"),
    `select title from public.search_notes('kestrel')`,
  );
  assert.equal(ahmed.length, 0);
});

// ------------------------------------------------------------------- files
// storage.objects is stubbed in scripts/local-db.mjs: one row per stored file,
// under row-level security, as in Supabase Storage. These tests cover the
// rules; `pnpm test:live` covers the real Storage API.

const agentFor = async (name, tier = "vendor") => {
  const made = (
    await as(
      person(name),
      `select * from public.create_agent($1, 'Files agent', 'other', $2)`,
      [ws[name], tier],
    )
  )[0];
  const login = (
    await as(null, `select * from public.agent_login($1)`, [made.token])
  )[0];
  return {
    sub: login.user_id,
    role: "authenticated",
    agent_id: login.agent_id,
    workspace_id: login.workspace_id,
    trust_tier: login.trust_tier,
  };
};
const filePath = (name, file, workspace = ws[name]) =>
  `${members[name]}/${workspace}/outputs/proposal/acme/${file}`;
const upload = (who, path) =>
  as(
    who,
    `insert into storage.objects (bucket_id, name) values ('files', $1) returning name`,
    [path],
  );
const stored = async (who) =>
  (
    await as(
      who,
      `select name from storage.objects where bucket_id = 'files' order by name`,
    )
  )
    .map((r) => r.name.split("/").pop())
    .sort();
const fileRow = (who, name, path, { note = null, workspace = ws[name] } = {}) =>
  as(
    who,
    `insert into public.files (hive_id, member_id, workspace_id, note_id, storage_path, name)
     values ($1, $2, $3, $4, $5, 'a file') returning id`,
    [hive, members[name], workspace, note, path],
  );
const noteId = async (title) =>
  (await db.query(`select id from public.notes where title = $1`, [title]))
    .rows[0].id;

test("a file is stored in its owner's space and nowhere else", async () => {
  await upload(person("dani"), filePath("dani", "loose.pdf"));

  await assert.rejects(upload(person("ahmed"), filePath("dani", "forged.pdf")));
  await assert.rejects(upload(person("dani"), "no-owner.pdf"));
  await assert.rejects(
    upload(person("dani"), `${members.dani}/${ws.ahmed}/outputs/x.pdf`),
  );
  await assert.rejects(upload(null, filePath("dani", "anonymous.pdf")));

  assert.deepEqual(await stored(person("dani")), ["loose.pdf"]);
  assert.deepEqual(await stored(person("ahmed")), []);
  assert.deepEqual(await stored(person("outsider")), []);
  assert.deepEqual(await stored(null), []);
});

test("a file is read by whoever can read the note it is attached to", async () => {
  const shared = filePath("dani", "for-group.pdf");
  const priv = filePath("dani", "private.pdf");
  await upload(person("dani"), shared);
  await upload(person("dani"), priv);
  await fileRow(person("dani"), "dani", shared, {
    note: await noteId("dani group"),
  });
  await fileRow(person("dani"), "dani", priv, {
    note: await noteId("dani private"),
  });

  assert.deepEqual(await stored(person("sara")), ["for-group.pdf"]);
  assert.deepEqual(await stored(person("outsider")), []);
  assert.deepEqual(await stored(null), []);
  assert.deepEqual(await stored(person("dani")), [
    "for-group.pdf",
    "loose.pdf",
    "private.pdf",
  ]);
  const rows = await as(
    person("sara"),
    `select storage_path from public.files`,
  );
  assert.deepEqual(
    rows.map((r) => r.storage_path),
    [shared],
  );
});

test("a file row cannot point at someone else's file or note", async () => {
  // Ahmed claims Dani's private file as his own.
  await assert.rejects(
    fileRow(person("ahmed"), "ahmed", filePath("dani", "private.pdf")),
    /own member and workspace/,
  );
  const mine = filePath("ahmed", "mine.pdf");
  await upload(person("ahmed"), mine);
  await assert.rejects(
    fileRow(person("ahmed"), "ahmed", mine, {
      note: await noteId("dani group"),
    }),
    /your own note/,
  );
  assert.deepEqual(await stored(person("ahmed")), [
    "for-group.pdf",
    "mine.pdf",
  ]);
});

test("an agent saves files only in its own workspace and never deletes or overwrites", async () => {
  const agent = await agentFor("dani");
  const second = (
    await as(
      person("dani"),
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'Second') returning id`,
      [hive, members.dani],
    )
  )[0].id;

  const path = filePath("dani", "by-agent.pdf");
  await upload(agent, path);
  await fileRow(agent, "dani", path);

  const elsewhere = filePath("dani", "elsewhere.pdf", second);
  await assert.rejects(upload(agent, elsewhere));
  await assert.rejects(
    fileRow(agent, "dani", elsewhere, { workspace: second }),
  );
  await upload(person("dani"), elsewhere);

  const gone = (who) =>
    as(who, `delete from storage.objects where name = $1 returning name`, [
      path,
    ]);
  const renamed = (who) =>
    as(
      who,
      `update storage.objects set name = name || '.x' where name = $1 returning name`,
      [path],
    );
  assert.equal((await gone(agent)).length, 0);
  assert.equal((await renamed(agent)).length, 0);
  assert.equal((await gone(person("ahmed"))).length, 0);
  assert.equal((await renamed(person("dani"))).length, 0);
  assert.equal((await gone(person("dani"))).length, 1);
});

test("a self-hosted agent cannot save files", async () => {
  const agent = await agentFor("sara", "self_hosted");
  const path = filePath("sara", "held.pdf");
  await assert.rejects(upload(agent, path));
  await upload(person("sara"), path);
  await assert.rejects(fileRow(agent, "sara", path), /self-hosted/);
  // It does not see the member's own files either, only shared ones.
  assert.deepEqual(await stored(agent), ["for-group.pdf"]);
});

// --------------------------------------------------------------------- map
// public.map_graph(hive) draws every note and file of a hive in one call. It
// is security definer, so these tests check what each caller gets back.

const map = async (who, h = hive) =>
  (await as(who, `select public.map_graph($1) as m`, [h]))[0].m;
const nodeOf = (payload, id) => payload.nodes.find((n) => n.id === id);
const addAt = (who, name, path, title, extra = {}) =>
  as(
    who,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body, visibility, shared_with)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      hive,
      members[name],
      ws[name],
      path,
      title,
      extra.body ?? "body",
      extra.visibility ?? null,
      extra.shared_with ?? [],
    ],
  ).then((r) => r[0].id);
const addFile = (who, name, file, note = null) =>
  as(
    who,
    `insert into public.files (hive_id, member_id, workspace_id, note_id, storage_path, name)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [hive, members[name], ws[name], note, filePath(name, file), file],
  ).then((r) => r[0].id);
const STUB_KEYS = [
  "agent_id",
  "by_agent",
  "created_at",
  "id",
  "kind",
  "locked",
  "member_id",
  "note_id",
  "path",
  "title",
  "topic",
  "topics",
  "updated_at",
  "workspace_id",
];
const ids = {};

test("note_topic cuts the folder to two levels", async () => {
  const topic = async (p) =>
    (await db.query(`select public.note_topic($1) as t`, [p])).rows[0].t;
  assert.equal(await topic("clients/acme/pricing.md"), "clients/acme");
  assert.equal(await topic("clients/acme/2026/q1/x.md"), "clients/acme");
  assert.equal(await topic("Decisions/x.md"), "Decisions");
  assert.equal(await topic("Home.md"), "General");
  assert.equal(await topic("/Home.md"), "General");
  assert.equal(await topic(""), "General");
  assert.equal(await topic(null), "General");
  assert.equal(await topic("a//b/c.md"), "a/b");
});

test("the map shows your own notes in full", async () => {
  ids.secret = await addAt(
    person("dani"),
    "dani",
    "maps/dani/deep/secret.md",
    "map dani secret",
    { body: "map-secret-body-text" },
  );
  const m = await map(person("dani"));
  const n = nodeOf(m, ids.secret);
  assert.equal(n.locked, false);
  assert.equal(n.kind, "note");
  assert.equal(n.title, "map dani secret");
  assert.equal(n.path, "maps/dani/deep/secret.md");
  assert.equal(n.workspace_id, ws.dani);
  assert.equal(n.topic, "maps/dani");
  assert.equal(n.member_id, members.dani);
  assert.equal(n.by_agent, false);
  assert.equal(n.agent_id, null);
  assert.equal(n.note_id, null);
  assert.equal(m.truncated, false);
  const me = m.members.find((x) => x.id === members.dani);
  assert.deepEqual(me, { id: members.dani, display_name: "Dani", is_me: true });
  assert.equal(m.members.find((x) => x.id === members.ahmed).is_me, false);
  assert.equal(m.members.length, 3);
});

test("a colleague's private note is a stub", async () => {
  const n = nodeOf(await map(person("ahmed")), ids.secret);
  assert.deepEqual(Object.keys(n).sort(), STUB_KEYS);
  assert.equal(n.locked, true);
  for (const k of [
    "title",
    "path",
    "workspace_id",
    "by_agent",
    "agent_id",
    "note_id",
  ])
    assert.equal(n[k], null, k);
  assert.equal(n.kind, "note");
  assert.equal(n.topic, "maps/dani");
  assert.equal(n.member_id, members.dani);
  assert.ok(n.updated_at);
});

test("a shared note is shown in full", async () => {
  const agent = await agentFor("dani");
  ids.daniAgent = agent.agent_id;
  ids.byAgent = (
    await as(
      agent,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'maps/shared/by-agent.md', 'map dani group') returning id`,
      [hive, members.dani, ws.dani],
    )
  )[0].id;
  await as(
    person("dani"),
    `update public.notes set visibility = 'group' where id = $1`,
    [ids.byAgent],
  );

  const mine = nodeOf(await map(person("dani")), ids.byAgent);
  assert.equal(mine.by_agent, true);
  assert.equal(mine.agent_id, ids.daniAgent);

  const n = nodeOf(await map(person("ahmed")), ids.byAgent);
  assert.equal(n.locked, false);
  assert.equal(n.title, "map dani group");
  assert.equal(n.path, "maps/shared/by-agent.md");
  assert.equal(n.workspace_id, ws.dani);
  assert.equal(n.by_agent, true);
  assert.equal(n.agent_id, null);
});

test("quarantined items of others are absent", async () => {
  const agent = await agentFor("sara", "self_hosted");
  const held = (
    await as(
      agent,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'maps/held/x.md', 'map sara held') returning id, quarantined`,
      [hive, members.sara, ws.sara],
    )
  )[0];
  assert.equal(held.quarantined, true);
  const file = await addFile(person("sara"), "sara", "map-held.pdf", held.id);

  const sara = await map(person("sara"));
  assert.equal(nodeOf(sara, held.id).locked, false);
  assert.equal(nodeOf(sara, file).locked, false);
  for (const who of ["dani", "ahmed"]) {
    const m = await map(person(who));
    assert.equal(nodeOf(m, held.id), undefined, who);
    assert.equal(nodeOf(m, file), undefined, who);
  }
  // The earlier quarantined note is absent too.
  const earlier = await noteId("held for review");
  assert.equal(nodeOf(await map(person("dani")), earlier), undefined);
});

test("a colleague's private file is a stub and a shared file is not", async () => {
  ids.looseFile = await addFile(person("dani"), "dani", "map-loose.pdf");
  ids.sharedFile = await addFile(
    person("dani"),
    "dani",
    "map-shared.pdf",
    ids.byAgent,
  );
  ids.privFile = await addFile(
    person("dani"),
    "dani",
    "map-private.pdf",
    ids.secret,
  );

  const mine = await map(person("dani"));
  const own = nodeOf(mine, ids.privFile);
  assert.equal(own.locked, false);
  assert.equal(own.kind, "file");
  assert.equal(own.title, "map-private.pdf");
  assert.equal(own.path, filePath("dani", "map-private.pdf"));
  assert.equal(own.note_id, ids.secret);
  assert.equal(own.by_agent, false);
  assert.equal(own.agent_id, null);
  assert.equal(own.topic, "maps/dani");
  assert.equal(nodeOf(mine, ids.looseFile).topic, "Files");

  const m = await map(person("ahmed"));
  for (const id of [ids.looseFile, ids.privFile]) {
    const n = nodeOf(m, id);
    assert.deepEqual(Object.keys(n).sort(), STUB_KEYS);
    assert.equal(n.locked, true);
    assert.equal(n.kind, "file");
    for (const k of [
      "title",
      "path",
      "workspace_id",
      "by_agent",
      "agent_id",
      "note_id",
    ])
      assert.equal(n[k], null, k);
    assert.equal(n.member_id, members.dani);
    assert.ok(n.updated_at);
  }
  assert.equal(nodeOf(m, ids.looseFile).topic, "Files");
  const shared = nodeOf(m, ids.sharedFile);
  assert.equal(shared.locked, false);
  assert.equal(shared.title, "map-shared.pdf");
  assert.equal(shared.note_id, ids.byAgent);
  assert.equal(shared.by_agent, false);
  assert.equal(shared.topic, "maps/shared");
});

test("links stay as narrow as links_select", async () => {
  const g1 = await addAt(person("ahmed"), "ahmed", "maps/a/g1.md", "map g1", {
    visibility: "group",
  });
  const g2 = await addAt(person("ahmed"), "ahmed", "maps/a/g2.md", "map g2", {
    visibility: "group",
  });
  const between = (
    await as(
      person("ahmed"),
      `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $2, $3, 2, 0.5) returning status`,
      [hive, g1, g2],
    )
  )[0];
  assert.equal(between.status, "accepted");

  const mine = await addAt(
    person("dani"),
    "dani",
    "maps/l/mine.md",
    "map mine",
  );
  const theirs = await addAt(
    person("ahmed"),
    "ahmed",
    "maps/l/theirs.md",
    "map theirs",
  );
  const link = (
    await as(
      person("dani"),
      `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $2, $3, 1, 0.75) returning id`,
      [hive, mine, theirs],
    )
  )[0].id;
  const pending = await addAt(
    person("ahmed"),
    "ahmed",
    "maps/l/pending.md",
    "map pending",
  );
  await as(
    person("dani"),
    `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $2, $3, 3, 0.25)`,
    [hive, mine, pending],
  );

  const has = (m, from, to) =>
    m.links.some((l) => l.from === from && l.to === to);
  let dani = await map(person("dani"));
  assert.ok(!has(dani, mine, theirs), "a proposed link is not on the map");
  assert.ok(!has(dani, mine, pending));
  await as(person("ahmed"), `select public.respond_to_link($1, true)`, [link]);

  dani = await map(person("dani"));
  assert.ok(!has(dani, g1, g2), "a link between two colleagues' notes leaked");
  assert.deepEqual(
    dani.links.find((l) => l.from === mine),
    { from: mine, to: theirs, tier: 1, score: 0.75 },
  );
  assert.equal(nodeOf(dani, theirs).locked, false);
  assert.ok(!has(dani, mine, pending));
  const unlocked = new Set(
    dani.nodes.filter((n) => !n.locked).map((n) => n.id),
  );
  for (const l of dani.links) {
    assert.ok(unlocked.has(l.from) && unlocked.has(l.to), "link to a stub");
  }

  const ahmed = await map(person("ahmed"));
  assert.ok(has(ahmed, g1, g2));
  assert.ok(has(ahmed, mine, theirs));
  const sara = await map(person("sara"));
  assert.ok(!has(sara, g1, g2));
  assert.ok(!has(sara, mine, theirs));
});

test("a link to an item that is not on the map is absent", async () => {
  // Sara's self-hosted agent writes a note: it is held, invisible to others.
  const agent = await agentFor("sara", "self_hosted");
  const held = (
    await as(
      agent,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'maps/held/linked.md', 'map sara held linked') returning id`,
      [hive, members.sara, ws.sara],
    )
  )[0].id;
  const saras = await addAt(
    person("sara"),
    "sara",
    "maps/held/own.md",
    "map sara own",
  );
  const insertLink = (who, from, to) =>
    as(
      who,
      `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $2, $3, 1, 1) returning id, status`,
      [hive, from, to],
    ).then((r) => r[0]);
  // Two of Sara's notes: accepted at once.
  assert.equal(
    (await insertLink(person("sara"), saras, held)).status,
    "accepted",
  );
  // Dani's note to Sara's held note, accepted by both people.
  const dmine = await addAt(
    person("dani"),
    "dani",
    "maps/l/to-held.md",
    "map to held",
  );
  const link = await insertLink(person("dani"), dmine, held);
  assert.equal(
    (
      await as(person("sara"), `select public.respond_to_link($1, true) as s`, [
        link.id,
      ])
    )[0].s,
    "accepted",
  );

  const dani = await map(person("dani"));
  assert.ok(!dani.links.some((l) => l.from === dmine || l.to === dmine));
  assert.ok(nodeOf(dani, dmine), "Dani's own note is still on the map");
  assert.ok(!JSON.stringify(dani).includes(held), "the held note leaked");

  const sara = await map(person("sara"));
  const touching = sara.links.filter((l) => l.to === held);
  assert.deepEqual(touching.map((l) => l.from).sort(), [dmine, saras].sort());
});

test("agents, outsiders and the public are refused", async () => {
  await assert.rejects(map(await agentFor("dani")), /map_graph is for people/);
  await assert.rejects(
    map(await agentFor("ahmed", "self_hosted")),
    /map_graph is for people/,
  );
  await assert.rejects(map(person("outsider")), /not a member of this hive/);
  await assert.rejects(map(null), /permission denied/);
  await assert.rejects(
    map({ role: "authenticated" }),
    /not a member of this hive/,
  );

  const other = (
    await as(
      person("outsider"),
      `select hive_id from public.members where user_id = $1`,
      [users.outsider],
    )
  )[0].hive_id;
  await assert.rejects(map(person("dani"), other), /not a member/);
  const theirs = await map(person("outsider"), other);
  const text = JSON.stringify(theirs);
  for (const id of [
    hive,
    members.dani,
    members.ahmed,
    members.sara,
    ws.dani,
    ids.secret,
    ids.byAgent,
    ids.looseFile,
  ])
    assert.ok(!text.includes(id), `outsider's map carries ${id}`);
  assert.deepEqual(theirs.nodes, []);
  assert.deepEqual(theirs.links, []);
  assert.equal(theirs.members.length, 1);
});

test("the map never carries bodies", async () => {
  for (const who of ["dani", "ahmed", "sara"]) {
    const text = JSON.stringify(await map(person(who)));
    assert.ok(!text.includes('"body"'), who);
    assert.ok(!text.includes('"frontmatter"'), who);
    assert.ok(!text.includes("map-secret-body-text"), who);
    assert.ok(!text.includes("token_hash"), who);
  }
  const ahmed = JSON.stringify(await map(person("ahmed")));
  assert.ok(!ahmed.includes("map dani secret"));
  assert.ok(!ahmed.includes("secret.md"));
  assert.ok(!ahmed.includes("map-private.pdf"));
  assert.ok(!ahmed.includes("map-loose.pdf"));
});

test("only your own agents are named", async () => {
  const made = (
    await as(
      person("ahmed"),
      `select * from public.create_agent($1, 'map ahmed agent', 'chatgpt')`,
      [ws.ahmed],
    )
  )[0];
  const dani = await map(person("dani"));
  const theirs = dani.agents.find((a) => a.id === made.agent_id);
  assert.deepEqual(theirs, {
    id: made.agent_id,
    member_id: members.ahmed,
    provider: "chatgpt",
    trust_tier: "vendor",
    last_used_at: null,
    name: null,
  });
  assert.ok(!JSON.stringify(dani).includes("map ahmed agent"));
  assert.equal(
    dani.agents.find((a) => a.id === ids.daniAgent).name,
    "Files agent",
  );
  const ahmed = await map(person("ahmed"));
  assert.equal(
    ahmed.agents.find((a) => a.id === made.agent_id).name,
    "map ahmed agent",
  );
  assert.equal(ahmed.agents.find((a) => a.id === ids.daniAgent).name, null);

  // A revoked agent is gone from the map.
  await as(person("ahmed"), `select public.revoke_agent($1)`, [made.agent_id]);
  const after = await map(person("dani"));
  assert.equal(
    after.agents.find((a) => a.id === made.agent_id),
    undefined,
  );

  // So is an expired one.
  const expiring = (
    await as(
      person("ahmed"),
      `select * from public.create_agent($1, 'map expiring agent', 'chatgpt')`,
      [ws.ahmed],
    )
  )[0].agent_id;
  assert.ok((await map(person("dani"))).agents.some((a) => a.id === expiring));
  await db.query(
    `update public.agents set expires_at = now() - interval '1 minute' where id = $1`,
    [expiring],
  );
  assert.ok(!(await map(person("dani"))).agents.some((a) => a.id === expiring));
  assert.ok(
    !(await map(person("ahmed"))).agents.some((a) => a.id === expiring),
  );
});

// ------------------------------------------------------------ folder rules
// A note's sharing is its own setting, else the rule of the nearest folder
// above it by path (same workspace), else the member's default. These tests
// run before the 5,000-note cap test so they stay fast.

const fr = {};
const addFolder = (
  name,
  path,
  visibility = null,
  shared_with = [],
  workspace,
) =>
  as(
    person(name),
    `insert into public.folders (workspace_id, member_id, path, visibility, shared_with)
     values ($1, $2, $3, $4, $5) returning id`,
    [workspace ?? ws[name], members[name], path, visibility, shared_with],
  ).then((r) => r[0].id);
const canRead = async (who, id) =>
  (await as(who, `select id from public.notes where id = $1`, [id])).length ===
  1;
const sharing = async (who, id) =>
  (
    await as(
      who,
      `select public.note_visibility(n) as effective,
              public.note_shared_with(n) as effective_with,
              public.note_rule_folder(n) as rule_folder,
              public.note_access(n) as access
         from public.notes n where n.id = $1`,
      [id],
    )
  )[0];
const agentWrites = (agent, name, path, title) =>
  as(
    agent,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     values ($1, $2, $3, $4, $5) returning id, quarantined`,
    [hive, members[name], ws[name], path, title],
  ).then((r) => r[0]);

test("a folder rule reaches a note by its path", async () => {
  await addFolder("dani", "fr/reach", "group");
  fr.reach = await addAt(
    person("dani"),
    "dani",
    "fr/reach/deep/x.md",
    "fr reach",
  );
  fr.beside = await addAt(person("dani"), "dani", "fr/reachx.md", "fr beside");
  assert.equal(await canRead(person("ahmed"), fr.reach), true);
  assert.equal(await canRead(person("sara"), fr.reach), true);
  assert.equal(await canRead(person("ahmed"), fr.beside), false);
  assert.equal(await canRead(person("outsider"), fr.reach), false);
});

test("a note an agent writes into a shared folder is shared at once", async () => {
  await addFolder("dani", "fr/team", "group");
  await addFolder("dani", "fr/forsara", "members", [members.sara]);
  const agent = await agentFor("dani");
  fr.team = (
    await agentWrites(agent, "dani", "fr/team/by-agent.md", "fr team")
  ).id;
  fr.forSara = (
    await agentWrites(agent, "dani", "fr/forsara/by-agent.md", "fr for sara")
  ).id;
  assert.equal(await canRead(person("ahmed"), fr.team), true);
  assert.equal(await canRead(person("sara"), fr.forSara), true);
  assert.equal(await canRead(person("ahmed"), fr.forSara), false);
});

test("the nearest folder with a rule wins", async () => {
  await addFolder("dani", "fr/nest", "group");
  await addFolder("dani", "fr/nest/inner", "members", [members.sara]);
  fr.outer = await addAt(person("dani"), "dani", "fr/nest/y.md", "fr outer");
  fr.inner = await addAt(
    person("dani"),
    "dani",
    "fr/nest/inner/x.md",
    "fr inner",
  );
  assert.equal(await canRead(person("ahmed"), fr.outer), true);
  assert.equal(await canRead(person("ahmed"), fr.inner), false);
  assert.equal(await canRead(person("sara"), fr.inner), true);
});

test("a folder with no rule inherits from the one above", async () => {
  await addFolder("dani", "fr/inh", "group");
  await addFolder("dani", "fr/inh/sub", null);
  fr.inherits = await addAt(
    person("dani"),
    "dani",
    "fr/inh/sub/x.md",
    "fr inherits",
  );
  assert.equal(await canRead(person("ahmed"), fr.inherits), true);
});

test("a note's own setting beats its folder", async () => {
  fr.ownPrivate = await addAt(
    person("dani"),
    "dani",
    "fr/team/mine.md",
    "fr own private",
    { visibility: "private" },
  );
  fr.ownSara = await addAt(
    person("dani"),
    "dani",
    "fr/team/sara.md",
    "fr own sara",
    { visibility: "members", shared_with: [members.sara] },
  );
  assert.equal(await canRead(person("ahmed"), fr.ownPrivate), false);
  assert.equal(await canRead(person("sara"), fr.ownPrivate), false);
  assert.equal(await canRead(person("ahmed"), fr.ownSara), false);
  assert.equal(await canRead(person("sara"), fr.ownSara), true);
});

test("a folder only captures its own path", async () => {
  await addFolder("dani", "fr/clients/ac", "group");
  const acme = await addAt(
    person("dani"),
    "dani",
    "fr/clients/acme/x.md",
    "fr acme",
  );
  assert.equal(await canRead(person("ahmed"), acme), false);

  // like-wildcards in a folder path match literally.
  await addFolder("dani", "fr/a%b", "group");
  await addFolder("dani", "fr/a_b", "group");
  const axb = await addAt(person("dani"), "dani", "fr/axb/n.md", "fr axb");
  const deep = await addAt(person("dani"), "dani", "fr/axbz/n.md", "fr axbz");
  const literal = await addAt(person("dani"), "dani", "fr/a%b/n.md", "fr a%b");
  assert.equal(await canRead(person("ahmed"), axb), false);
  assert.equal(await canRead(person("ahmed"), deep), false);
  assert.equal(await canRead(person("ahmed"), literal), true);

  // Case-sensitive.
  const upper = await addAt(person("dani"), "dani", "fr/Team/x.md", "fr Team");
  assert.equal(await canRead(person("ahmed"), upper), false);

  // The same path in another workspace, or another member's, has no effect.
  const other = (
    await as(
      person("dani"),
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'Folder rules') returning id`,
      [hive, members.dani],
    )
  )[0].id;
  await addFolder("dani", "fr/elsewhere", "group", [], other);
  await addFolder("sara", "fr/elsewhere", "group");
  const here = await addAt(
    person("dani"),
    "dani",
    "fr/elsewhere/x.md",
    "fr elsewhere",
  );
  assert.equal(await canRead(person("ahmed"), here), false);
  assert.equal(await canRead(person("sara"), here), false);
});

test("an agent cannot move a note", async () => {
  const agent = await agentFor("dani");
  const n = (await agentWrites(agent, "dani", "fr/move/a.md", "fr move")).id;
  await assert.rejects(
    as(agent, `update public.notes set path = 'fr/team/a.md' where id = $1`, [
      n,
    ]),
    /agents cannot move a note/,
  );
  assert.equal(await canRead(person("ahmed"), n), false);
  // The agent may still edit the note in place.
  await as(agent, `update public.notes set body = 'edited' where id = $1`, [n]);

  // A person may move it, and the note then follows its new folder.
  const moved = await as(
    person("dani"),
    `update public.notes set path = 'fr/team/a.md' where id = $1 returning path`,
    [n],
  );
  assert.equal(moved[0].path, "fr/team/a.md");
  assert.equal(await canRead(person("ahmed"), n), true);
});

test("a self-hosted agent's note in a shared folder stays held", async () => {
  await addFolder("sara", "fr/held", "group");
  const agent = await agentFor("sara", "self_hosted");
  const n = await agentWrites(agent, "sara", "fr/held/x.md", "fr held");
  assert.equal(n.quarantined, true);
  assert.equal(await canRead(person("dani"), n.id), false);
  assert.equal(await canRead(person("ahmed"), n.id), false);
  assert.equal(await canRead(person("sara"), n.id), true);
  // Its owner sees what it would become once released.
  const s = await sharing(person("sara"), n.id);
  assert.equal(s.effective, "group");
  assert.equal(s.access, "own");
});

test("note_rule_folder and note_access say where sharing comes from", async () => {
  assert.deepEqual(await sharing(person("ahmed"), fr.team), {
    effective: "group",
    effective_with: [],
    rule_folder: "fr/team",
    access: "shared",
  });
  assert.equal((await sharing(person("dani"), fr.team)).access, "own");
  assert.deepEqual(await sharing(person("sara"), fr.forSara), {
    effective: "members",
    effective_with: [members.sara],
    rule_folder: "fr/forsara",
    access: "shared",
  });
  // The nearest rule is named, and a folder with no rule is skipped.
  assert.equal(
    (await sharing(person("sara"), fr.inner)).rule_folder,
    "fr/nest/inner",
  );
  assert.equal(
    (await sharing(person("ahmed"), fr.inherits)).rule_folder,
    "fr/inh",
  );
  // A note with its own setting still names the folder it sits in.
  assert.deepEqual(await sharing(person("sara"), fr.ownSara), {
    effective: "members",
    effective_with: [members.sara],
    rule_folder: "fr/team",
    access: "shared",
  });
  assert.deepEqual(await sharing(person("dani"), fr.ownPrivate), {
    effective: "private",
    effective_with: [],
    rule_folder: "fr/team",
    access: "own",
  });
  // No rule folder above: null.
  assert.equal(
    (await sharing(person("dani"), await noteId("dani group"))).rule_folder,
    null,
  );
  // Opened only by an accepted link.
  assert.deepEqual(
    await sharing(person("dani"), await noteId("sara kestrel")),
    {
      effective: "private",
      effective_with: [],
      rule_folder: null,
      access: "link",
    },
  );

  // Handed a note the caller cannot read, they reveal nothing.
  const raw = (
    await db.query(
      `select to_jsonb(n) as j from public.notes n where id = $1`,
      [fr.inner],
    )
  ).rows[0].j;
  const probe = (
    await as(
      person("ahmed"),
      `select public.note_rule_folder(r) as rule_folder, public.note_access(r) as access
         from jsonb_populate_record(null::public.notes, $1) r`,
      [raw],
    )
  )[0];
  assert.deepEqual(probe, { rule_folder: null, access: null });
  // A forged row claiming to be the caller's own reveals nothing either.
  const forged = { ...raw, member_id: members.ahmed };
  const probe2 = (
    await as(
      person("ahmed"),
      `select public.note_rule_folder(r) as rule_folder, public.note_access(r) as access
         from jsonb_populate_record(null::public.notes, $1) r`,
      [forged],
    )
  )[0];
  assert.deepEqual(probe2, { rule_folder: null, access: null });
  // The internal lookup is not callable by anyone signed in.
  await assert.rejects(
    as(
      person("dani"),
      `select public.note_folder_rule(n) from public.notes n limit 1`,
    ),
    /permission denied/,
  );
});

test("folder_share_preview counts exactly", async () => {
  await addFolder("dani", "fp", "group");
  await addFolder("dani", "fp/dec", "group");
  await addFolder("dani", "fp/dec/norule", null);
  await addFolder("dani", "fp/dec/inner", "private");
  for (const p of ["fp/dec/a.md", "fp/dec/b.md", "fp/dec/norule/c.md"])
    await addAt(person("dani"), "dani", p, `fp ${p}`);
  await addAt(person("dani"), "dani", "fp/dec/own.md", "fp own", {
    visibility: "private",
  });
  await addAt(person("dani"), "dani", "fp/dec/inner/x.md", "fp inner x");
  await addAt(person("dani"), "dani", "fp/dec/inner/deep/y.md", "fp inner y");
  const held = await agentWrites(
    await agentFor("dani", "self_hosted"),
    "dani",
    "fp/dec/held.md",
    "fp held",
  );
  assert.equal(held.quarantined, true);
  // Not under fp/dec.
  await addAt(person("dani"), "dani", "fp/dec.md", "fp dec file");
  await addAt(person("dani"), "dani", "fp/decx/z.md", "fp decx");
  await addAt(person("ahmed"), "ahmed", "fp/dec/ahmed.md", "fp ahmed");

  const preview = (who, w, p) =>
    as(who, `select public.folder_share_preview($1, $2) as p`, [w, p]).then(
      (r) => r[0].p,
    );
  assert.deepEqual(await preview(person("dani"), ws.dani, "fp/dec"), {
    follows: 4,
    own_setting: 1,
    under_nested_rule: 2,
    held: 1,
  });
  assert.deepEqual(await preview(person("dani"), ws.dani, "fp/nothing"), {
    follows: 0,
    own_setting: 0,
    under_nested_rule: 0,
    held: 0,
  });

  await assert.rejects(
    preview(await agentFor("dani"), ws.dani, "fp/dec"),
    /for people only/,
  );
  await assert.rejects(
    preview(person("ahmed"), ws.dani, "fp/dec"),
    /not your workspace/,
  );
  await assert.rejects(
    preview(person("outsider"), ws.dani, "fp/dec"),
    /not your workspace/,
  );
  await assert.rejects(preview(null, ws.dani, "fp/dec"), /permission denied/);
});

const auditSince = async (id) =>
  (
    await db.query(
      `select id, hive_id, member_id, agent_id, action, note_id, detail
         from public.audit_log where id > $1 order by id`,
      [id],
    )
  ).rows;
const lastAudit = async () =>
  Number(
    (await db.query(`select coalesce(max(id), 0) as m from public.audit_log`))
      .rows[0].m,
  );

test("every sharing change leaves one audit row", async () => {
  const start = await lastAudit();
  const none = { visibility: null, shared_with: [] };
  const note = await addAt(
    person("dani"),
    "dani",
    "au/secret-path.md",
    "audit secret title",
    { body: "audit-secret-body" },
  );
  assert.deepEqual(
    await auditSince(start),
    [],
    "a plain insert is not audited",
  );

  const set = (v, sw = []) =>
    as(
      person("dani"),
      `update public.notes set visibility = $2, shared_with = $3 where id = $1`,
      [note, v, sw],
    );
  let mark = await lastAudit();
  await set("group");
  let rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "note.sharing");
  assert.equal(rows[0].note_id, note);
  assert.equal(rows[0].hive_id, hive);
  assert.equal(rows[0].member_id, members.dani);
  assert.equal(rows[0].agent_id, null);
  assert.deepEqual(rows[0].detail, {
    from: none,
    to: { visibility: "group", shared_with: [] },
  });

  mark = await lastAudit();
  await set("private");
  rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].detail, {
    from: { visibility: "group", shared_with: [] },
    to: { visibility: "private", shared_with: [] },
  });

  mark = await lastAudit();
  await set("members", [members.ahmed]);
  rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].detail, {
    from: { visibility: "private", shared_with: [] },
    to: { visibility: "members", shared_with: [members.ahmed] },
  });

  // Unchanged updates, and edits to the text, write nothing.
  mark = await lastAudit();
  await set("members", [members.ahmed]);
  await as(
    person("dani"),
    `update public.notes set body = 'audit-secret-body 2' where id = $1`,
    [note],
  );
  assert.deepEqual(await auditSince(mark), []);

  // An insert that carries a setting counts.
  mark = await lastAudit();
  const born = await addAt(person("dani"), "dani", "au/born.md", "au born", {
    visibility: "group",
  });
  rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "note.sharing");
  assert.equal(rows[0].note_id, born);
  assert.deepEqual(rows[0].detail, {
    from: none,
    to: { visibility: "group", shared_with: [] },
  });

  // A folder rule created by insert, then changed by update (an upsert).
  mark = await lastAudit();
  await addFolder("dani", "au/plain", null);
  assert.deepEqual(await auditSince(mark), [], "a folder with no rule");
  await addFolder("dani", "au/rule", "group");
  rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "folder.sharing");
  assert.equal(rows[0].note_id, null);
  assert.equal(rows[0].member_id, members.dani);
  assert.equal(rows[0].hive_id, hive);
  assert.deepEqual(rows[0].detail, {
    path: "au/rule",
    from: none,
    to: { visibility: "group", shared_with: [] },
  });
  const upsert = (v, sw) =>
    as(
      person("dani"),
      `insert into public.folders (workspace_id, member_id, path, visibility, shared_with)
       values ($1, $2, 'au/rule', $3, $4)
       on conflict (workspace_id, path) do update
         set visibility = excluded.visibility, shared_with = excluded.shared_with`,
      [ws.dani, members.dani, v, sw],
    );
  mark = await lastAudit();
  await upsert("members", [members.sara]);
  rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "folder.sharing");
  assert.deepEqual(rows[0].detail, {
    path: "au/rule",
    from: { visibility: "group", shared_with: [] },
    to: { visibility: "members", shared_with: [members.sara] },
  });
  mark = await lastAudit();
  await upsert("members", [members.sara]);
  assert.deepEqual(await auditSince(mark), [], "an unchanged upsert");

  // A release.
  const agent = await agentFor("dani", "self_hosted");
  mark = await lastAudit();
  const held = await agentWrites(agent, "dani", "au/held.md", "au held");
  assert.equal(held.quarantined, true);
  assert.deepEqual(await auditSince(mark), [], "an agent's write");
  await as(
    person("dani"),
    `update public.notes set quarantined = false where id = $1`,
    [held.id],
  );
  rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "note.released");
  assert.equal(rows[0].note_id, held.id);
  assert.equal(rows[0].member_id, members.dani);
  assert.equal(rows[0].agent_id, null);
  assert.deepEqual(rows[0].detail, {});

  // A write with no person behind it is not audited.
  mark = await lastAudit();
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.query(`update public.notes set visibility = 'group' where id = $1`, [
    note,
  ]);
  assert.deepEqual(await auditSince(mark), []);

  // No row carries a note's path, title or body.
  const text = JSON.stringify(await auditSince(start));
  for (const s of [
    "au/secret-path.md",
    "audit secret title",
    "audit-secret-body",
    "au/born.md",
    "au/held.md",
  ])
    assert.ok(!text.includes(s), `the audit log carries ${s}`);
});

test("only the hive owner reads the audit log", async () => {
  // Ahmed's own change is recorded for the owner to read.
  const mark = await lastAudit();
  const a = await addAt(person("ahmed"), "ahmed", "au/ahmed.md", "au ahmed");
  await as(
    person("ahmed"),
    `update public.notes set visibility = 'group' where id = $1`,
    [a],
  );
  const read = (who) =>
    as(who, `select action, member_id from public.audit_log where id > $1`, [
      mark,
    ]);
  assert.deepEqual(await read(person("dani")), [
    { action: "note.sharing", member_id: members.ahmed },
  ]);
  assert.ok(
    (await as(person("dani"), `select id from public.audit_log`)).length,
  );
  for (const who of [person("ahmed"), person("sara"), await agentFor("dani")])
    assert.deepEqual(await as(who, `select id from public.audit_log`), []);
  // The outsider owns another hive, whose log holds its own start
  // (hive.created). That is all they read: nothing of this hive.
  assert.deepEqual(
    await as(
      person("outsider"),
      `select action, hive_id = $1 as here from public.audit_log`,
      [hive],
    ),
    [{ action: "hive.created", here: false }],
  );
  assert.deepEqual(await as(null, `select id from public.audit_log`), []);
  // Nobody writes it by hand.
  await assert.rejects(
    as(
      person("dani"),
      `insert into public.audit_log (hive_id, action) values ($1, 'forged')`,
      [hive],
    ),
    /row-level security/,
  );
});

// The outsider's own member and workspace (another hive).
const outsiderSpace = async () =>
  (
    await db.query(
      `select m.id as member_id, w.id as workspace_id
         from public.members m join public.workspaces w on w.member_id = m.id
        where m.user_id = $1 limit 1`,
      [users.outsider],
    )
  ).rows[0];

test("nobody can move a folder rule into someone else's workspace", async () => {
  const secret = await addAt(
    person("dani"),
    "dani",
    "fx/victim/secret.md",
    "fx secret",
  );
  const out = await outsiderSpace();
  const mark = await lastAudit();
  const repoint = (who, id, set) =>
    as(who, `update public.folders set ${set} = $2 where id = $1`, [
      id,
      set === "workspace_id" ? ws.dani : members.dani,
    ]);

  // A colleague re-points their own rule folder at Dani's workspace.
  const mine = await addFolder("ahmed", "fx/victim", "group");
  await assert.rejects(
    repoint(person("ahmed"), mine, "workspace_id"),
    /a folder cannot move to another member or workspace/,
  );
  await assert.rejects(
    repoint(person("ahmed"), mine, "member_id"),
    /a folder cannot move to another member or workspace/,
  );
  // A member of another hive tries the same.
  const theirs = (
    await as(
      person("outsider"),
      `insert into public.folders (workspace_id, member_id, path, visibility)
       values ($1, $2, 'fx/victim', 'group') returning id`,
      [out.workspace_id, out.member_id],
    )
  )[0].id;
  await assert.rejects(
    repoint(person("outsider"), theirs, "workspace_id"),
    /a folder cannot move to another member or workspace/,
  );
  // Even between one's own workspaces.
  const second = (
    await db.query(
      `select id from public.workspaces where member_id = $1 and name = 'Folder rules'`,
      [members.dani],
    )
  ).rows[0].id;
  const own = await addFolder("dani", "fx/own", "group");
  await assert.rejects(
    as(
      person("dani"),
      `update public.folders set workspace_id = $2 where id = $1`,
      [own, second],
    ),
    /a folder cannot move/,
  );

  // Nor can anyone insert a folder into a workspace that is not their own.
  await assert.rejects(
    addFolder("ahmed", "fx/victim", "group", [], ws.dani),
    /workspace does not belong to this member/,
  );
  await assert.rejects(
    as(
      person("ahmed"),
      `insert into public.folders (workspace_id, member_id, path, visibility)
       values ($1, $2, 'fx/victim', 'group')`,
      [ws.dani, members.dani],
    ),
    /row-level security/,
  );
  await assert.rejects(
    as(
      person("outsider"),
      `insert into public.folders (workspace_id, member_id, path, visibility)
       values ($1, $2, 'fx/victim', 'group')`,
      [ws.dani, out.member_id],
    ),
    /workspace does not belong to this member/,
  );

  for (const who of ["ahmed", "sara"])
    assert.equal(await canRead(person(who), secret), false, who);
  // The only rows in this hive are the colleagues' own folder inserts.
  for (const r of (await auditSince(mark)).filter((r) => r.hive_id === hive))
    assert.ok([members.ahmed, members.dani].includes(r.member_id), r.detail);

  // Defence in depth: a folder row whose member is not the workspace's owner
  // (impossible through the API now) still shares nothing.
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.query(
    `alter table public.folders disable trigger folders_before_write`,
  );
  try {
    await db.query(
      `insert into public.folders (workspace_id, member_id, path, visibility)
       values ($1, $2, 'fx/victim', 'group')`,
      [ws.dani, members.ahmed],
    );
  } finally {
    await db.query(
      `alter table public.folders enable trigger folders_before_write`,
    );
  }
  for (const who of ["ahmed", "sara"])
    assert.equal(await canRead(person(who), secret), false, who);
  assert.equal((await sharing(person("dani"), secret)).rule_folder, null);
});

test("nobody can move a note into someone else's space", async () => {
  const out = await outsiderSpace();
  const n = await addAt(person("ahmed"), "ahmed", "nx/a.md", "nx ahmed");
  await assert.rejects(
    as(
      person("ahmed"),
      `update public.notes set workspace_id = $2 where id = $1`,
      [n, ws.dani],
    ),
    /a note cannot move to another member, workspace or hive/,
  );
  await assert.rejects(
    as(
      person("ahmed"),
      `update public.notes set member_id = $2 where id = $1`,
      [n, members.dani],
    ),
    /a note cannot move to another member, workspace or hive/,
  );
  // An outsider cannot touch a note in this hive at all.
  const touched = await as(
    person("outsider"),
    `update public.notes set workspace_id = $2 where id = $1 returning id`,
    [n, out.workspace_id],
  );
  assert.equal(touched.length, 0);
  // Nor insert one into a workspace that is not theirs.
  await assert.rejects(
    as(
      person("ahmed"),
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'nx/forged.md', 'nx forged')`,
      [hive, members.ahmed, ws.dani],
    ),
    /workspace does not belong to this member/,
  );
  await assert.rejects(
    as(
      person("outsider"),
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'nx/forged.md', 'nx forged')`,
      [hive, out.member_id, ws.dani],
    ),
    /workspace does not belong to this member/,
  );
  const row = (
    await db.query(
      `select member_id, workspace_id from public.notes where id = $1`,
      [n],
    )
  ).rows[0];
  assert.deepEqual(row, { member_id: members.ahmed, workspace_id: ws.ahmed });
});

test("a forged note row reveals no folder rule", async () => {
  await addFolder("dani", "fg/acme-secret", "members", [members.sara]);
  const forged = {
    id: "00000000-0000-0000-0000-000000000001",
    hive_id: hive,
    member_id: members.dani,
    workspace_id: ws.dani,
    path: "fg/acme-secret/guess.md",
    title: "x",
    quarantined: false,
    shared_with: [],
  };
  const ask = (who, row) =>
    as(
      who,
      `select public.note_visibility(r) as v, public.note_shared_with(r) as sw,
              coalesce(public.can_read_note(r), false) as c
         from jsonb_populate_record(null::public.notes, $1) r`,
      [row],
    ).then((r) => r[0]);
  // Not even the member's default visibility.
  const nothing = { v: null, sw: null, c: false };
  assert.deepEqual(await ask(person("ahmed"), forged), nothing);
  assert.deepEqual(await ask(person("sara"), forged), nothing);
  assert.deepEqual(await ask(person("outsider"), forged), nothing);
  assert.deepEqual(await ask(await agentFor("ahmed"), forged), nothing);
  const out = await outsiderSpace();
  assert.deepEqual(
    await ask(person("outsider"), {
      ...forged,
      member_id: members.sara,
      workspace_id: out.workspace_id,
    }),
    nothing,
  );
  // A stored note's id with a guessed path is still a forgery.
  const real = await addAt(person("dani"), "dani", "fg/other.md", "fg other");
  assert.deepEqual(
    await ask(person("ahmed"), { ...forged, id: real }),
    nothing,
  );
  // The public cannot call them at all.
  for (const fn of ["note_visibility", "note_shared_with", "can_read_note"])
    await assert.rejects(
      as(
        null,
        `select public.${fn}(r) from jsonb_populate_record(null::public.notes, $1) r`,
        [forged],
      ),
      /permission denied/,
      fn,
    );
  // The workspace's owner gets the real answer, and a stored note under the
  // folder resolves for the colleague it is shared with.
  assert.deepEqual(await ask(person("dani"), forged), {
    v: "members",
    sw: [members.sara],
    c: true,
  });
  const stored = await addAt(
    person("dani"),
    "dani",
    "fg/acme-secret/real.md",
    "fg real",
  );
  assert.equal((await sharing(person("sara"), stored)).effective, "members");
  assert.equal(await canRead(person("ahmed"), stored), false);
});

test("a locked note's path cannot be guessed", async () => {
  // Dani's note under a rule naming Sara only; Ahmed sees a locked stub.
  const locked = await addAt(
    person("dani"),
    "dani",
    "fg/acme-secret/deal.md",
    "fg deal",
  );
  const stub = nodeOf(await map(person("ahmed")), locked);
  assert.equal(stub.locked, true);
  const probe = (who, row, path) =>
    as(
      who,
      `select public.note_visibility(r) as v, public.note_shared_with(r) as sw,
              coalesce(public.can_read_note(r), false) as c,
              public.note_rule_folder(r) as rf, public.note_access(r) as a
         from jsonb_populate_record(null::public.notes, $1) r`,
      [{ ...row, path }],
    ).then((r) => r[0]);
  const row = {
    id: stub.id,
    hive_id: hive,
    member_id: stub.member_id,
    workspace_id: ws.dani,
    title: "x",
    quarantined: false,
    shared_with: [],
  };
  const nothing = { v: null, sw: null, c: false, rf: null, a: null };
  for (const who of [person("ahmed"), await agentFor("ahmed")]) {
    assert.deepEqual(await probe(who, row, "fg/acme-secret/other.md"), nothing);
    assert.deepEqual(await probe(who, row, "fg/acme-secret/deal.md"), nothing);
  }

  // A private rule over a member whose default is the whole hive: a wrong
  // guess must not answer "readable" while the right one answers "not".
  await db.query(
    `update public.members set default_visibility = 'group' where id = $1`,
    [members.ahmed],
  );
  try {
    await addFolder("ahmed", "po/locked", "private");
    const hidden = await addAt(
      person("ahmed"),
      "ahmed",
      "po/locked/deal.md",
      "po deal",
    );
    assert.equal(await canRead(person("sara"), hidden), false);
    const r2 = {
      ...row,
      id: hidden,
      member_id: members.ahmed,
      workspace_id: ws.ahmed,
    };
    assert.deepEqual(
      await probe(person("sara"), r2, "po/locked/other.md"),
      nothing,
    );
    assert.deepEqual(
      await probe(person("sara"), r2, "po/locked/deal.md"),
      nothing,
    );
    // The owner, and a reader of a shared note, still get real answers.
    assert.equal(
      (await probe(person("ahmed"), r2, "po/locked/deal.md")).v,
      "private",
    );
    const open = await addAt(person("ahmed"), "ahmed", "po/open.md", "po open");
    assert.deepEqual(
      await probe(person("sara"), { ...r2, id: open }, "anything.md"),
      { v: "group", sw: [], c: true, rf: null, a: "shared" },
    );
    // The owner's insert ... returning still sees the folder rule.
    const back = await as(
      person("ahmed"),
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'po/locked/new.md', 'po new')
       returning public.note_visibility(notes) as v, public.note_shared_with(notes) as sw`,
      [hive, members.ahmed, ws.ahmed],
    );
    assert.deepEqual(back, [{ v: "private", sw: [] }]);
  } finally {
    await db.query(
      `update public.members set default_visibility = 'private' where id = $1`,
      [members.ahmed],
    );
  }
});

test("moving a note, renaming or deleting a rule folder is audited", async () => {
  const none = { visibility: null, shared_with: [] };
  const group = { visibility: "group", shared_with: [] };
  const priv = { visibility: "private", shared_with: [] };
  await addFolder("dani", "ad/shared", "group");
  const n = await addAt(person("dani"), "dani", "ad/plain/x.md", "ad x");
  const move = (to, extra = "") =>
    as(
      person("dani"),
      `update public.notes set path = $2 ${extra} where id = $1`,
      [n, to],
    );

  // Into a shared folder: one row with the effective values, no path.
  let mark = await lastAudit();
  await move("ad/shared/x.md");
  let rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "note.sharing");
  assert.equal(rows[0].note_id, n);
  assert.equal(rows[0].member_id, members.dani);
  assert.deepEqual(rows[0].detail, { from: priv, to: group, moved: true });
  assert.equal(await canRead(person("ahmed"), n), true);

  // And out again.
  mark = await lastAudit();
  await move("ad/plain/x.md");
  rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].detail, { from: group, to: priv, moved: true });

  // A move that changes nothing effective writes nothing.
  mark = await lastAudit();
  await move("ad/plain2/x.md");
  assert.deepEqual(await auditSince(mark), []);

  // A move and an own setting in one update: one row.
  mark = await lastAudit();
  await move("ad/shared/x.md", ", visibility = 'private'");
  rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].detail, { from: none, to: priv });

  // Renaming a rule folder.
  const f = await addFolder("dani", "ad/ren", "group");
  const inside = await addAt(person("dani"), "dani", "ad/ren/y.md", "ad y");
  assert.equal(await canRead(person("ahmed"), inside), true);
  mark = await lastAudit();
  await as(
    person("dani"),
    `update public.folders set path = 'ad/ren2' where id = $1`,
    [f],
  );
  rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "folder.sharing");
  assert.equal(rows[0].note_id, null);
  assert.deepEqual(rows[0].detail, {
    path: "ad/ren",
    new_path: "ad/ren2",
    from: group,
    to: group,
  });
  assert.equal(await canRead(person("ahmed"), inside), false);

  // Deleting a rule folder.
  await as(
    person("dani"),
    `update public.folders set path = 'ad/ren' where id = $1`,
    [f],
  );
  assert.equal(await canRead(person("ahmed"), inside), true);
  mark = await lastAudit();
  await as(person("dani"), `delete from public.folders where id = $1`, [f]);
  rows = await auditSince(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "folder.sharing");
  assert.equal(rows[0].member_id, members.dani);
  assert.equal(rows[0].hive_id, hive);
  assert.deepEqual(rows[0].detail, { path: "ad/ren", from: group, to: null });
  assert.equal(await canRead(person("ahmed"), inside), false);

  // A folder with no rule, renamed or deleted, writes nothing.
  const plain = await addFolder("dani", "ad/norule", null);
  mark = await lastAudit();
  await as(
    person("dani"),
    `update public.folders set path = 'ad/norule2' where id = $1`,
    [plain],
  );
  await as(person("dani"), `delete from public.folders where id = $1`, [plain]);
  assert.deepEqual(await auditSince(mark), []);

  // Deleting a workspace takes its folders and notes with it: the folders
  // leave no row of their own, only the workspace's one.
  const gone = (
    await as(
      person("dani"),
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'Doomed') returning id`,
      [hive, members.dani],
    )
  )[0].id;
  await addFolder("dani", "doomed", "group", [], gone);
  mark = await lastAudit();
  const deleted = await as(
    person("dani"),
    `delete from public.workspaces where id = $1 returning id`,
    [gone],
  );
  assert.equal(deleted.length, 1);
  assert.deepEqual(
    (await auditSince(mark)).map((r) => [r.action, r.detail]),
    [["workspace.deleted", { notes: 0, folders: 1 }]],
  );

  const text = JSON.stringify(await auditSince(0));
  for (const s of ["ad/plain", "ad/shared/x.md", "ad x", "ad/ren/y.md"])
    assert.ok(!text.includes(s), `the audit log carries ${s}`);
});

test("the map follows folder rules", async () => {
  const ahmed = await map(person("ahmed"));
  const team = nodeOf(ahmed, fr.team);
  assert.equal(team.locked, false);
  assert.equal(team.path, "fr/team/by-agent.md");
  assert.equal(nodeOf(ahmed, fr.reach).locked, false);
  assert.equal(nodeOf(ahmed, fr.inherits).locked, false);
  assert.equal(nodeOf(ahmed, fr.inner).locked, true);
  assert.equal(nodeOf(ahmed, fr.ownPrivate).locked, true);
  assert.equal(nodeOf(await map(person("sara")), fr.inner).locked, false);
});

test("the map is capped at 5,000 items, newest first", async () => {
  // Everything Dani sees before the bulk insert is newer than the bulk rows.
  const before = (await map(person("dani"))).nodes.map((n) => n.id);
  assert.ok(before.length < 5000);
  // Old notes, bulk-inserted outside any session, push the hive over the cap.
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.query(
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, updated_at)
     select $1, $2, $3, 'maps/bulk/' || g || '.md', 'map bulk ' || g,
            timestamptz '2000-01-01' + g * interval '1 second'
       from generate_series(1, 5000) g`,
    [hive, members.sara, ws.sara],
  );
  const m = await map(person("dani"));
  assert.equal(m.truncated, true);
  assert.equal(m.nodes.length, 5000);
  assert.ok(nodeOf(m, ids.secret), "the newest items are kept");
  assert.ok(nodeOf(m, ids.looseFile));
  const times = m.nodes.map((n) => Date.parse(n.updated_at));
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i]);

  // The rows that were cut are exactly the oldest bulk rows.
  const kept = new Set(m.nodes.map((n) => n.id));
  for (const id of before) assert.ok(kept.has(id), `newer item ${id} was cut`);
  const bulk = (
    await db.query(
      `select id from public.notes where path like 'maps/bulk/%' order by updated_at desc, id`,
    )
  ).rows.map((r) => r.id);
  const room = 5000 - before.length;
  assert.ok(bulk.slice(0, room).every((id) => kept.has(id)));
  assert.ok(bulk.slice(room).every((id) => !kept.has(id)));
});

// ------------------------------------------------------------------- inbox
// public.inbox(hive) lists what waits for the caller's own decision: link
// proposals they have not answered and their held notes. inbox_count(hive)
// is the two totals added. Both are security definer, so these tests check
// what each caller gets back. Earlier tests leave rows behind: every test
// finds its own link or note by id.

const inbox = async (who, h = hive) =>
  (await as(who, "select public.inbox($1) as i", [h]))[0].i;
const inboxCount = async (who, h = hive) =>
  (await as(who, "select public.inbox_count($1) as c", [h]))[0].c;
const linkIn = (i, id) => i.links.find((l) => l.id === id);
const heldIn = (i, id) => i.held.find((n) => n.id === id);
const propose = (who, from, to, tier = 3) =>
  as(
    who,
    `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $2, $3, $4, 0.5) returning id`,
    [hive, from, to, tier],
  ).then((r) => r[0].id);
const respond = (who, link, accept) =>
  as(who, `select public.respond_to_link($1, $2) as s`, [link, accept]).then(
    (r) => r[0].s,
  );
const release = (who, id) =>
  as(who, `update public.notes set quarantined = false where id = $1`, [id]);
const ib = { links: [] };

test("a link proposed by an agent waits in both owners' inboxes", async () => {
  const theirs = await addAt(
    person("ahmed"),
    "ahmed",
    "Clients/Acme/ib-ahmed-one.md",
    "ib ahmed one",
  );
  const mine = await addAt(
    person("dani"),
    "dani",
    "ib/dani/one.md",
    "ib dani one",
  );
  const link = await propose(await agentFor("ahmed"), theirs, mine, 3);
  ib.links.push(link);

  const dani = linkIn(await inbox(person("dani")), link);
  assert.deepEqual(Object.keys(dani).sort(), [
    "created_at",
    "id",
    "mine",
    "proposed_by",
    "theirs",
    "they_accepted",
    "tier",
  ]);
  assert.equal(dani.tier, 3);
  assert.ok(dani.created_at);
  assert.equal(dani.proposed_by, "theirs");
  assert.equal(dani.they_accepted, false);
  assert.deepEqual(dani.mine, {
    id: mine,
    title: "ib dani one",
    path: "ib/dani/one.md",
    workspace_id: ws.dani,
  });
  assert.deepEqual(Object.keys(dani.theirs).sort(), [
    "member_name",
    "title",
    "topic",
  ]);
  assert.deepEqual(dani.theirs, {
    member_name: "Ahmed",
    topic: "Clients/Acme",
    title: null,
  });
  // Nothing else of Ahmed's private note: not its id, title or file name.
  const text = JSON.stringify(dani);
  for (const s of [theirs, "ib ahmed one", "ib-ahmed-one", members.ahmed])
    assert.ok(!text.includes(s), `Dani's item carries ${s}`);

  const ahmed = linkIn(await inbox(person("ahmed")), link);
  assert.equal(ahmed.proposed_by, "mine");
  assert.equal(ahmed.they_accepted, false);
  assert.equal(ahmed.mine.id, theirs);
  assert.equal(ahmed.mine.title, "ib ahmed one");
  assert.equal(ahmed.mine.path, "Clients/Acme/ib-ahmed-one.md");
  assert.equal(ahmed.mine.workspace_id, ws.ahmed);
  assert.deepEqual(ahmed.theirs, {
    member_name: "Dani",
    topic: "ib/dani",
    title: null,
  });
  const back = JSON.stringify(ahmed);
  for (const s of [mine, "ib dani one", "ib/dani/one", members.dani])
    assert.ok(!back.includes(s), `Ahmed's item carries ${s}`);
});

test("the title appears only when the note is already readable", async () => {
  const theirs = await addAt(
    person("ahmed"),
    "ahmed",
    "Clients/Acme/ib-ahmed-open.md",
    "ib ahmed open",
    { visibility: "group" },
  );
  const mine = await addAt(
    person("dani"),
    "dani",
    "ib/dani/two.md",
    "ib dani two",
  );
  const link = await propose(await agentFor("ahmed"), theirs, mine, 1);
  ib.links.push(link);

  const dani = linkIn(await inbox(person("dani")), link);
  assert.deepEqual(dani.theirs, {
    member_name: "Ahmed",
    topic: "Clients/Acme",
    title: "ib ahmed open",
  });
  assert.equal(dani.tier, 1);
  // Dani's note is still private: Ahmed gets no title.
  const ahmed = linkIn(await inbox(person("ahmed")), link);
  assert.equal(ahmed.theirs.title, null);
});

test("an answered side no longer waits", async () => {
  const theirs = await addAt(
    person("ahmed"),
    "ahmed",
    "Clients/Acme/ib-ahmed-three.md",
    "ib ahmed three",
  );
  const mine = await addAt(
    person("dani"),
    "dani",
    "ib/dani/three.md",
    "ib dani three",
  );
  const link = await propose(await agentFor("ahmed"), theirs, mine);
  ib.links.push(link);
  assert.ok(linkIn(await inbox(person("dani")), link));

  assert.equal(await respond(person("dani"), link, true), "proposed");
  assert.equal(linkIn(await inbox(person("dani")), link), undefined);
  const ahmed = linkIn(await inbox(person("ahmed")), link);
  assert.equal(ahmed.they_accepted, true);
  assert.equal(ahmed.proposed_by, "mine");
  assert.equal(ahmed.theirs.title, null);

  assert.equal(await respond(person("ahmed"), link, true), "accepted");
  assert.equal(linkIn(await inbox(person("dani")), link), undefined);
  assert.equal(linkIn(await inbox(person("ahmed")), link), undefined);
});

test("a declined link leaves both inboxes", async () => {
  const theirs = await addAt(
    person("ahmed"),
    "ahmed",
    "Clients/Acme/ib-ahmed-four.md",
    "ib ahmed four",
  );
  const mine = await addAt(
    person("dani"),
    "dani",
    "ib/dani/four.md",
    "ib dani four",
  );
  const link = await propose(await agentFor("ahmed"), theirs, mine);
  ib.links.push(link);
  assert.ok(linkIn(await inbox(person("dani")), link));
  assert.ok(linkIn(await inbox(person("ahmed")), link));

  assert.equal(await respond(person("dani"), link, false), "declined");
  assert.equal(linkIn(await inbox(person("dani")), link), undefined);
  assert.equal(linkIn(await inbox(person("ahmed")), link), undefined);
});

test("a person who proposes has already accepted", async () => {
  const theirs = await addAt(
    person("ahmed"),
    "ahmed",
    "Clients/Acme/ib-ahmed-five.md",
    "ib ahmed five",
  );
  const mine = await addAt(
    person("dani"),
    "dani",
    "ib/dani/five.md",
    "ib dani five",
  );
  const link = await propose(person("dani"), mine, theirs, 2);
  ib.links.push(link);

  assert.equal(linkIn(await inbox(person("dani")), link), undefined);
  const ahmed = linkIn(await inbox(person("ahmed")), link);
  assert.equal(ahmed.proposed_by, "theirs");
  assert.equal(ahmed.they_accepted, true);
  assert.equal(ahmed.mine.id, theirs);
  assert.deepEqual(ahmed.theirs, {
    member_name: "Dani",
    topic: "ib/dani",
    title: null,
  });
});

test("others see nothing in the inbox", async () => {
  assert.ok(ib.links.length >= 5);
  const sara = await inbox(person("sara"));
  for (const id of ib.links) assert.equal(linkIn(sara, id), undefined, id);
  const text = JSON.stringify(sara);
  for (const s of [...ib.links, "ib dani", "ib ahmed", "ib-ahmed"])
    assert.ok(!text.includes(s), `Sara's inbox carries ${s}`);

  await assert.rejects(inbox(person("outsider")), /not a member of this hive/);
  await assert.rejects(
    inboxCount(person("outsider")),
    /not a member of this hive/,
  );
  await assert.rejects(
    inbox({ role: "authenticated" }),
    /not a member of this hive/,
  );
  await assert.rejects(inbox(null), /permission denied/);
  await assert.rejects(inboxCount(null), /permission denied/);

  // A member of another hive gets that hive's inbox only, and not this one's.
  const other = (
    await as(
      person("outsider"),
      `select hive_id from public.members where user_id = $1`,
      [users.outsider],
    )
  )[0].hive_id;
  assert.deepEqual(await inbox(person("outsider"), other), {
    links: [],
    links_total: 0,
    held: [],
    held_total: 0,
  });
  assert.equal(await inboxCount(person("outsider"), other), 0);
  await assert.rejects(
    inbox(person("dani"), other),
    /not a member of this hive/,
  );
  await assert.rejects(
    inboxCount(person("dani"), other),
    /not a member of this hive/,
  );
});

test("agents are refused by the inbox", async () => {
  for (const agent of [
    await agentFor("dani"),
    await agentFor("ahmed", "self_hosted"),
  ]) {
    await assert.rejects(inbox(agent), /inbox is for people/);
    await assert.rejects(inboxCount(agent), /inbox is for people/);
  }
  // A self-hosted claim without an agent id is refused as well.
  const claim = { ...person("dani"), trust_tier: "self_hosted" };
  await assert.rejects(inbox(claim), /inbox is for people/);
  await assert.rejects(inboxCount(claim), /inbox is for people/);
});

test("held notes wait for their owner only", async () => {
  const agent = await agentFor("sara", "self_hosted");
  const held = await agentWrites(
    agent,
    "sara",
    "ib/held/first.md",
    "ib sara held",
  );
  assert.equal(held.quarantined, true);

  const sara = await inbox(person("sara"));
  const item = heldIn(sara, held.id);
  assert.deepEqual(Object.keys(item).sort(), [
    "agent_name",
    "id",
    "path",
    "title",
    "updated_at",
    "workspace_id",
  ]);
  assert.equal(item.title, "ib sara held");
  assert.equal(item.path, "ib/held/first.md");
  assert.equal(item.workspace_id, ws.sara);
  assert.equal(item.agent_name, "Files agent");
  assert.ok(item.updated_at);
  assert.ok(sara.held_total >= 1);

  for (const who of ["dani", "ahmed"]) {
    const theirs = await inbox(person(who));
    assert.equal(heldIn(theirs, held.id), undefined, who);
    const text = JSON.stringify(theirs);
    assert.ok(!text.includes(held.id), who);
    assert.ok(!text.includes("ib sara held"), who);
  }

  const before = sara.held_total;
  await release(person("sara"), held.id);
  const after = await inbox(person("sara"));
  assert.equal(heldIn(after, held.id), undefined);
  assert.equal(after.held_total, before - 1);
});

test("a link to a held note is not listed", async () => {
  const held = (
    await agentWrites(
      await agentFor("sara", "self_hosted"),
      "sara",
      "ib/held/linked.md",
      "ib sara held linked",
    )
  ).id;
  const mine = await addAt(
    person("dani"),
    "dani",
    "ib/dani/nine.md",
    "ib dani nine",
  );
  const daniBefore = await inboxCount(person("dani"));
  const saraBefore = (await inbox(person("sara"))).links_total;
  const link = await propose(await agentFor("dani"), mine, held);

  const dani = await inbox(person("dani"));
  assert.equal(linkIn(dani, link), undefined);
  assert.equal(await inboxCount(person("dani")), daniBefore);
  const text = JSON.stringify(dani);
  assert.ok(!text.includes("ib sara held linked"));
  assert.ok(!text.includes("ib/held"));
  const sara = await inbox(person("sara"));
  assert.equal(linkIn(sara, link), undefined);
  assert.equal(sara.links_total, saraBefore);
  assert.ok(heldIn(sara, held), "the held note itself still waits for Sara");

  await release(person("sara"), held);
  const daniAfter = linkIn(await inbox(person("dani")), link);
  assert.equal(daniAfter.proposed_by, "mine");
  assert.deepEqual(daniAfter.theirs, {
    member_name: "Sara",
    topic: "ib/held",
    title: null,
  });
  assert.equal(await inboxCount(person("dani")), daniBefore + 1);
  const saraAfter = linkIn(await inbox(person("sara")), link);
  assert.equal(saraAfter.proposed_by, "theirs");
  assert.equal(saraAfter.mine.id, held);
  assert.equal(saraAfter.theirs.member_name, "Dani");
});

test("the inbox count equals the two totals", async () => {
  let waiting = 0;
  for (const who of ["dani", "ahmed", "sara"]) {
    const i = await inbox(person(who));
    assert.equal(
      await inboxCount(person(who)),
      i.links_total + i.held_total,
      who,
    );
    assert.equal(i.links.length, i.links_total, who);
    assert.equal(i.held.length, i.held_total, who);
    waiting += i.links_total + i.held_total;
  }
  assert.ok(waiting > 0);
});

test("the inbox never carries a body", async () => {
  const marker = "ib-body-marker-7f3a";
  const theirs = await addAt(
    person("ahmed"),
    "ahmed",
    "Clients/Acme/ib-ahmed-body.md",
    "ib ahmed body",
    { body: `${marker} ahmed`, visibility: "group" },
  );
  const mine = await addAt(
    person("dani"),
    "dani",
    "ib/dani/body.md",
    "ib dani body",
    { body: `${marker} dani` },
  );
  const link = await propose(await agentFor("ahmed"), theirs, mine);
  const held = (
    await as(
      await agentFor("dani", "self_hosted"),
      `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
       values ($1, $2, $3, 'ib/held/body.md', 'ib dani held body', $4) returning id`,
      [hive, members.dani, ws.dani, `${marker} held`],
    )
  )[0].id;

  const dani = await inbox(person("dani"));
  assert.ok(linkIn(dani, link));
  assert.ok(heldIn(dani, held));
  const ahmed = await inbox(person("ahmed"));
  assert.ok(linkIn(ahmed, link));
  for (const [who, i] of [
    ["dani", dani],
    ["ahmed", ahmed],
    ["sara", await inbox(person("sara"))],
  ]) {
    const text = JSON.stringify(i);
    assert.ok(!text.includes(marker), who);
    assert.ok(!text.includes('"body"'), who);
    assert.ok(!text.includes('"frontmatter"'), who);
  }
});

test("each inbox list is the newest 100 and the totals count everything", async () => {
  // Old held notes and old proposals, inserted outside any session.
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.query(
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, quarantined, updated_at)
     select $1, $2, $3, 'ib/bulk/held-' || g || '.md', 'ib bulk held ' || g, true,
            timestamptz '2001-01-01' + g * interval '1 second'
       from generate_series(1, 101) g`,
    [hive, members.ahmed, ws.ahmed],
  );
  await db.query(
    `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     select $1, $2, $3, 'ib/bulk/a-' || g || '.md', 'ib bulk a ' || g
       from generate_series(1, 101) g`,
    [hive, members.ahmed, ws.ahmed],
  );
  await db.query(
    `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     select $1, $2, $3, 'ib/bulk/d-' || g || '.md', 'ib bulk d ' || g
       from generate_series(1, 101) g`,
    [hive, members.dani, ws.dani],
  );
  const before = await inbox(person("ahmed"));
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.query(
    `insert into public.links (hive_id, from_note, to_note, tier, score, created_at)
     select $1, d.id, a.id, 4, 0.1,
            timestamptz '2001-01-01' + d.g * interval '1 second'
       from (select id, substring(path from 'd-(\\d+)')::int as g
               from public.notes where path like 'ib/bulk/d-%') d
       join (select id, substring(path from 'a-(\\d+)')::int as g
               from public.notes where path like 'ib/bulk/a-%') a using (g)`,
    [hive],
  );

  const i = await inbox(person("ahmed"));
  assert.equal(i.held.length, 100);
  assert.equal(i.held_total, before.held_total);
  assert.ok(i.held_total >= 101);
  assert.equal(i.links.length, 100);
  assert.equal(i.links_total, before.links_total + 101);
  assert.equal(await inboxCount(person("ahmed")), i.links_total + i.held_total);
  // Newest first, and what was listed before is still listed.
  const order = (rows, key) => rows.map((r) => Date.parse(r[key]));
  for (const times of [
    order(i.links, "created_at"),
    order(i.held, "updated_at"),
  ])
    for (let k = 1; k < times.length; k++) assert.ok(times[k - 1] >= times[k]);
  for (const l of before.links) assert.ok(linkIn(i, l.id), "a newer link cut");
  // The oldest bulk note fell off the list.
  assert.ok(!i.held.some((n) => n.title === "ib bulk held 1"));
});

// --------------------------------------------------------- link behaviours
// One link per pair of notes, whichever way it points. A decline is final and
// answers a proposal only; ending an accepted link is unlink(). note_links()
// lists a note's accepted links for the vault. Every test makes its own notes.

const lbNote = (name, tag, n = "a", extra = {}) =>
  addAt(
    person(name),
    name,
    `lb/${tag}/${name}-${n}.md`,
    `lb ${tag} ${name} ${n}`,
    extra,
  );
// A note of Dani's and one of Ahmed's.
const lbPair = async (tag) => [
  await lbNote("dani", tag),
  await lbNote("ahmed", tag),
];
// The same two, linked and accepted by both: Dani proposed, Ahmed accepted.
const lbAccepted = async (tag) => {
  const [mine, theirs] = await lbPair(tag);
  const link = await propose(person("dani"), mine, theirs);
  assert.equal(await respond(person("ahmed"), link, true), "accepted");
  return { mine, theirs, link };
};
const linkRow = async (id) =>
  (await db.query(`select * from public.links where id = $1`, [id])).rows[0];
const unlink = (who, link) => as(who, `select public.unlink($1)`, [link]);
const noteLinks = (who, note) =>
  as(who, `select * from public.note_links($1)`, [note]);
const linkAudits = async (since) =>
  (await auditSince(since)).filter((r) => r.action.startsWith("link."));
const DECLINED = /^error: this link was declined$/;
const HAS_LINK = /^error: these notes already have a link$/;
const NOT_ACCEPTED = /^error: this link is not accepted$/;
const LINK_NOT_FOUND = /^error: link not found$/;
const PEOPLE_UNLINK = /^error: only a person can unlink notes$/;

test("a declined pair cannot be proposed again, from either side", async () => {
  const [mine, theirs] = await lbPair("declined");
  const link = await propose(person("dani"), mine, theirs);
  assert.equal(await respond(person("ahmed"), link, false), "declined");

  await assert.rejects(propose(person("ahmed"), theirs, mine), DECLINED);
  await assert.rejects(propose(person("dani"), mine, theirs), DECLINED);
  assert.equal((await linkRow(link)).status, "declined");
  const rows = await db.query(
    `select id from public.links where from_note in ($1, $2) or to_note in ($1, $2)`,
    [mine, theirs],
  );
  assert.deepEqual(rows.rows, [{ id: link }]);
});

test("a pair with a proposed or an accepted link takes no second one", async () => {
  const [mine, theirs] = await lbPair("second");
  const link = await propose(person("dani"), mine, theirs);
  await assert.rejects(propose(person("ahmed"), theirs, mine), HAS_LINK);
  await assert.rejects(propose(person("dani"), mine, theirs), HAS_LINK);

  assert.equal(await respond(person("ahmed"), link, true), "accepted");
  await assert.rejects(propose(person("ahmed"), theirs, mine), HAS_LINK);
  await assert.rejects(propose(person("dani"), mine, theirs), HAS_LINK);
  assert.equal((await linkRow(link)).status, "accepted");
});

test("an agent cannot propose a declined pair again either", async () => {
  const [mine, theirs] = await lbPair("agent");
  const link = await propose(await agentFor("dani"), mine, theirs);
  assert.equal(await respond(person("ahmed"), link, false), "declined");

  await assert.rejects(
    propose(await agentFor("ahmed"), theirs, mine),
    DECLINED,
  );
  await assert.rejects(propose(await agentFor("dani"), mine, theirs), DECLINED);
});

test("the pair index refuses a reversed row when the trigger does not run", async () => {
  const [mine, theirs] = await lbPair("index");
  await propose(person("dani"), mine, theirs);
  await db.exec("reset role");
  await db.exec("set session_replication_role = replica");
  try {
    await assert.rejects(
      db.query(
        `insert into public.links (hive_id, from_note, to_note, tier, score)
         values ($1, $2, $3, 3, 0.5)`,
        [hive, theirs, mine],
      ),
      /links_pair_idx/,
    );
  } finally {
    await db.exec("set session_replication_role = origin");
  }
  const index = (
    await db.query(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'links_pair_idx'`,
    )
  ).rows[0].indexdef;
  assert.match(index, /UNIQUE/);
  assert.match(
    index,
    /LEAST\(from_note, to_note\), GREATEST\(from_note, to_note\)/,
  );
});

test("only an owner of one of the two notes is told a pair has a link", async () => {
  const [mine, theirs] = await lbPair("oracle");
  const link = await propose(person("dani"), mine, theirs);
  const insert = `insert into public.links (hive_id, from_note, to_note, tier, score)
                  values ($1, $2, $3, 3, 0.5)`;
  const told = /this link was declined|these notes already have a link/;
  const probe = async (what) => {
    for (const [who, role] of [
      [person("sara")],
      [person("outsider")],
      [await agentFor("sara")],
      [passOf(person("dani"))],
      [passOf(person("sara"))],
      [null, "anon"],
    ])
      for (const [from, to] of [
        [mine, theirs],
        [theirs, mine],
      ]) {
        const r = await trial(who, insert, [hive, from, to], role);
        assert.ok(r.error, `${what}: a stranger made a link`);
        assert.doesNotMatch(r.error.message, told, what);
      }
  };
  await probe("proposed");
  assert.equal(await respond(person("ahmed"), link, false), "declined");
  await probe("declined");
  // A pair with no link at all answers a stranger the same way.
  const [free1, free2] = await lbPair("oracle-free");
  const none = await trial(person("sara"), insert, [hive, free1, free2]);
  const some = await trial(person("sara"), insert, [hive, mine, theirs]);
  assert.equal(none.error.message, some.error.message);
});

test("a proposer cannot stamp a link as ended", async () => {
  const [mine, theirs] = await lbPair("stamp");
  const link = (
    await as(
      person("dani"),
      `insert into public.links (hive_id, from_note, to_note, tier, score, ended_at, ended_by)
       values ($1, $2, $3, 3, 0.5, now(), $4) returning id`,
      [hive, mine, theirs, members.ahmed],
    )
  )[0].id;
  const row = await linkRow(link);
  assert.equal(row.status, "proposed");
  assert.equal(row.ended_at, null);
  assert.equal(row.ended_by, null);
});

test("declining an accepted link is refused and the link stays", async () => {
  const { mine, theirs, link } = await lbAccepted("keep");
  const mark = await lastAudit();
  for (const who of ["dani", "ahmed"])
    await assert.rejects(
      respond(person(who), link, false),
      /^error: this link is accepted; unlink it instead$/,
      who,
    );
  const row = await linkRow(link);
  assert.equal(row.status, "accepted");
  assert.equal(row.ended_at, null);
  assert.equal(row.ended_by, null);
  assert.equal(await canRead(person("dani"), theirs), true);
  assert.equal(await canRead(person("ahmed"), mine), true);
  assert.deepEqual(await linkAudits(mark), []);
});

test("declining twice changes nothing the second time", async () => {
  const [mine, theirs] = await lbPair("twice");
  const link = await propose(person("dani"), mine, theirs);
  const mark = await lastAudit();
  assert.equal(await respond(person("ahmed"), link, false), "declined");
  const first = await linkRow(link);
  assert.equal(await respond(person("ahmed"), link, false), "declined");
  // The other owner's decline of it is the same no-op.
  assert.equal(await respond(person("dani"), link, false), "declined");
  assert.deepEqual(await linkRow(link), first);
  assert.equal(first.ended_by, members.ahmed);
  const audits = await linkAudits(mark);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "link.declined");
  // And it still cannot be accepted.
  await assert.rejects(respond(person("dani"), link, true), DECLINED);
});

test("a decline is stamped and leaves one audit row", async () => {
  const [mine, theirs] = await lbPair("stamped");
  const link = await propose(person("dani"), mine, theirs);
  const mark = await lastAudit();
  assert.equal(await respond(person("ahmed"), link, false), "declined");
  const row = await linkRow(link);
  assert.equal(row.status, "declined");
  assert.ok(row.ended_at instanceof Date);
  assert.equal(row.ended_by, members.ahmed);
  assert.deepEqual(await linkAudits(mark), [
    {
      id: mark + 1,
      hive_id: hive,
      member_id: members.ahmed,
      agent_id: null,
      action: "link.declined",
      note_id: theirs,
      detail: { link, other_note: mine },
    },
  ]);

  // The proposer may take their own proposal back: the same decline.
  const [mine2, theirs2] = await lbPair("stamped-back");
  const link2 = await propose(person("dani"), mine2, theirs2);
  const mark2 = await lastAudit();
  assert.equal(await respond(person("dani"), link2, false), "declined");
  assert.equal((await linkRow(link2)).ended_by, members.dani);
  const audits = await linkAudits(mark2);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].member_id, members.dani);
  assert.equal(audits[0].note_id, mine2);
  assert.deepEqual(audits[0].detail, { link: link2, other_note: theirs2 });
});

test("the accept that completes a link leaves one audit row", async () => {
  const [mine, theirs] = await lbPair("completes");
  // Proposed by an agent: neither side has accepted.
  const link = await propose(await agentFor("dani"), mine, theirs);
  const mark = await lastAudit();
  assert.equal(await respond(person("dani"), link, true), "proposed");
  assert.equal(await respond(person("dani"), link, true), "proposed");
  assert.deepEqual(await linkAudits(mark), []);

  assert.equal(await respond(person("ahmed"), link, true), "accepted");
  assert.deepEqual(await linkAudits(mark), [
    {
      id: mark + 1,
      hive_id: hive,
      member_id: members.ahmed,
      agent_id: null,
      action: "link.accepted",
      note_id: theirs,
      detail: { link, other_note: mine },
    },
  ]);
  const row = await linkRow(link);
  assert.equal(row.ended_at, null);
  assert.equal(row.ended_by, null);
  // Accepting an accepted link again says so and writes nothing.
  assert.equal(await respond(person("dani"), link, true), "accepted");
  assert.equal(await respond(person("ahmed"), link, true), "accepted");
  assert.equal((await linkAudits(mark)).length, 1);
  assert.deepEqual(await linkRow(link), row);
});

test("either owner unlinks, and the two notes close to each other at once", async () => {
  const onMap = async (who, l) =>
    (await map(who)).links.some((x) => x.from === l.mine && x.to === l.theirs);
  for (const [tag, who, own, other] of [
    ["unlink-from", "dani", "mine", "theirs"],
    ["unlink-to", "ahmed", "theirs", "mine"],
  ]) {
    const l = await lbAccepted(tag);
    assert.equal(await canRead(person("dani"), l.theirs), true, tag);
    assert.equal(await canRead(person("ahmed"), l.mine), true, tag);
    assert.equal(await onMap(person("dani"), l), true, tag);
    assert.equal(await onMap(person("ahmed"), l), true, tag);

    const mark = await lastAudit();
    await unlink(person(who), l.link);

    assert.equal(await canRead(person("dani"), l.theirs), false, tag);
    assert.equal(await canRead(person("ahmed"), l.mine), false, tag);
    assert.ok(!(await titles(person("dani"))).includes(`lb ${tag} ahmed a`));
    assert.ok(!(await titles(person("ahmed"))).includes(`lb ${tag} dani a`));
    assert.equal(await onMap(person("dani"), l), false, tag);
    assert.equal(await onMap(person("ahmed"), l), false, tag);
    // Each still reads their own.
    assert.equal(await canRead(person("dani"), l.mine), true, tag);
    assert.equal(await canRead(person("ahmed"), l.theirs), true, tag);

    const row = await linkRow(l.link);
    assert.equal(row.status, "declined", tag);
    assert.ok(row.ended_at instanceof Date, tag);
    assert.equal(row.ended_by, members[who], tag);
    assert.deepEqual(
      await linkAudits(mark),
      [
        {
          id: mark + 1,
          hive_id: hive,
          member_id: members[who],
          agent_id: null,
          action: "link.unlinked",
          note_id: l[own],
          detail: { link: l.link, other_note: l[other] },
        },
      ],
      tag,
    );
    // Unlinked is not accepted: a second unlink is refused and writes nothing.
    for (const again of ["dani", "ahmed"])
      await assert.rejects(unlink(person(again), l.link), NOT_ACCEPTED, tag);
    assert.equal((await linkAudits(mark)).length, 1, tag);
  }
});

test("only a person who owns one of the two notes unlinks, and only an accepted link", async () => {
  const l = await lbAccepted("refused");
  const mark = await lastAudit();
  for (const name of ["dani", "ahmed"]) {
    await assert.rejects(
      unlink(await agentFor(name), l.link),
      PEOPLE_UNLINK,
      `${name}'s agent`,
    );
    await assert.rejects(
      unlink(await agentFor(name, "self_hosted"), l.link),
      PEOPLE_UNLINK,
      `${name}'s self-hosted agent`,
    );
    await assert.rejects(
      unlink(passOf(person(name)), l.link),
      PASS_REFUSED,
      `${name}'s app`,
    );
  }
  // A claim of self-hosted with no agent behind it is not a person either.
  await assert.rejects(unlink(selfHosted("dani"), l.link), PEOPLE_UNLINK);
  // A member who owns neither note, a person of another hive, and a link that
  // is not there get the same answer.
  await assert.rejects(unlink(person("sara"), l.link), LINK_NOT_FOUND);
  await assert.rejects(unlink(person("outsider"), l.link), LINK_NOT_FOUND);
  await assert.rejects(
    as(person("dani"), `select public.unlink(gen_random_uuid())`),
    LINK_NOT_FOUND,
  );
  await assert.rejects(
    as(person("dani"), `select public.unlink(null)`),
    LINK_NOT_FOUND,
  );
  await assert.rejects(unlink(null, l.link), /permission denied/);

  const row = await linkRow(l.link);
  assert.equal(row.status, "accepted");
  assert.equal(row.ended_at, null);
  assert.equal(await canRead(person("ahmed"), l.mine), true);
  assert.deepEqual(await linkAudits(mark), []);

  const [p1, p2] = await lbPair("refused-proposed");
  const proposed = await propose(person("dani"), p1, p2);
  for (const who of ["dani", "ahmed"])
    await assert.rejects(unlink(person(who), proposed), NOT_ACCEPTED);
  // Sara is not told whether it is accepted.
  await assert.rejects(unlink(person("sara"), proposed), LINK_NOT_FOUND);
  assert.equal((await linkRow(proposed)).status, "proposed");

  assert.equal(await respond(person("ahmed"), proposed, false), "declined");
  const declined = await linkRow(proposed);
  for (const who of ["dani", "ahmed"])
    await assert.rejects(unlink(person(who), proposed), NOT_ACCEPTED);
  assert.deepEqual(await linkRow(proposed), declined);
});

test("an unlinked pair cannot be proposed again, from either side", async () => {
  const l = await lbAccepted("final");
  await unlink(person("dani"), l.link);
  await assert.rejects(propose(person("dani"), l.mine, l.theirs), DECLINED);
  await assert.rejects(propose(person("ahmed"), l.theirs, l.mine), DECLINED);
  await assert.rejects(
    propose(await agentFor("ahmed"), l.theirs, l.mine),
    DECLINED,
  );
  // Nor accepted again.
  await assert.rejects(respond(person("ahmed"), l.link, true), DECLINED);
  await assert.rejects(respond(person("dani"), l.link, true), DECLINED);
  assert.equal(await canRead(person("ahmed"), l.mine), false);
});

test("unlinking two notes of one owner removes the link, and they can be linked again", async () => {
  const one = await lbNote("dani", "own", "one");
  const two = await lbNote("dani", "own", "two");
  const link = await propose(person("dani"), one, two);
  assert.equal((await linkRow(link)).status, "accepted");
  // A second one is refused like any other pair.
  await assert.rejects(propose(person("dani"), two, one), HAS_LINK);
  // Declining it is not the way to end it.
  await assert.rejects(
    respond(person("dani"), link, false),
    /unlink it instead/,
  );
  // Nobody else can end it.
  await assert.rejects(unlink(person("ahmed"), link), LINK_NOT_FOUND);

  const mark = await lastAudit();
  await unlink(person("dani"), link);
  assert.equal(await linkRow(link), undefined);
  assert.deepEqual(await linkAudits(mark), [
    {
      id: mark + 1,
      hive_id: hive,
      member_id: members.dani,
      agent_id: null,
      action: "link.unlinked",
      note_id: one,
      detail: { link, other_note: two },
    },
  ]);
  await assert.rejects(unlink(person("dani"), link), LINK_NOT_FOUND);

  const again = await propose(person("dani"), two, one);
  assert.notEqual(again, link);
  assert.equal((await linkRow(again)).status, "accepted");
});

test("note_links lists a note's accepted links to each owner", async () => {
  const l = await lbAccepted("list");
  const own = await lbNote("dani", "list", "own");
  const ownLink = await propose(person("dani"), l.mine, own);

  // Dani, on Dani's note: Ahmed's note, and the other note of Dani's.
  const dani = await noteLinks(person("dani"), l.mine);
  assert.deepEqual(
    dani.toSorted((x, y) => x.title.localeCompare(y.title)),
    [
      {
        id: l.link,
        note_id: l.theirs,
        title: "lb list ahmed a",
        owner: "Ahmed",
        mine: false,
      },
      {
        id: ownLink,
        note_id: own,
        title: "lb list dani own",
        owner: "Dani",
        mine: true,
      },
    ],
  );
  // Ahmed, on Ahmed's note: Dani's note.
  assert.deepEqual(await noteLinks(person("ahmed"), l.theirs), [
    {
      id: l.link,
      note_id: l.mine,
      title: "lb list dani a",
      owner: "Dani",
      mine: false,
    },
  ]);
  // Each on the other's note, which the link lets them open: their own note
  // on the far side, and not the links that note has with anyone else.
  assert.deepEqual(await noteLinks(person("ahmed"), l.mine), [
    {
      id: l.link,
      note_id: l.theirs,
      title: "lb list ahmed a",
      owner: "Ahmed",
      mine: true,
    },
  ]);
  assert.deepEqual(await noteLinks(person("dani"), l.theirs), [
    {
      id: l.link,
      note_id: l.mine,
      title: "lb list dani a",
      owner: "Dani",
      mine: true,
    },
  ]);
  // The other side of the same-owner link.
  assert.deepEqual(await noteLinks(person("dani"), own), [
    {
      id: ownLink,
      note_id: l.mine,
      title: "lb list dani a",
      owner: "Dani",
      mine: true,
    },
  ]);

  // After an unlink the list is empty for both.
  await unlink(person("ahmed"), l.link);
  assert.deepEqual(await noteLinks(person("ahmed"), l.theirs), []);
  assert.deepEqual(await noteLinks(person("ahmed"), l.mine), []);
  assert.deepEqual(
    (await noteLinks(person("dani"), l.mine)).map((r) => r.id),
    [ownLink],
  );
  await unlink(person("dani"), ownLink);
  assert.deepEqual(await noteLinks(person("dani"), l.mine), []);
});

test("note_links lists nothing that is proposed or declined", async () => {
  const [mine, theirs] = await lbPair("waiting");
  const link = await propose(person("dani"), mine, theirs);
  for (const state of ["proposed", "declined"]) {
    assert.equal((await linkRow(link)).status, state);
    assert.deepEqual(await noteLinks(person("dani"), mine), [], state);
    assert.deepEqual(await noteLinks(person("dani"), theirs), [], state);
    assert.deepEqual(await noteLinks(person("ahmed"), theirs), [], state);
    assert.deepEqual(await noteLinks(person("ahmed"), mine), [], state);
    if (state === "proposed") await respond(person("ahmed"), link, false);
  }
});

test("note_links tells nothing to anyone who owns neither note", async () => {
  // Both notes are open to the whole group, so Sara can read them: she still
  // does not own a side of the link.
  const mine = await lbNote("dani", "narrow", "a", { visibility: "group" });
  const theirs = await lbNote("ahmed", "narrow", "a", { visibility: "group" });
  const link = await propose(person("dani"), mine, theirs);
  assert.equal(await respond(person("ahmed"), link, true), "accepted");
  assert.equal((await noteLinks(person("dani"), mine)).length, 1);
  assert.equal(await canRead(person("sara"), mine), true);

  for (const note of [mine, theirs]) {
    for (const [what, who] of [
      ["a third member", person("sara")],
      ["another hive", person("outsider")],
      ["Dani's agent", await agentFor("dani")],
      ["Ahmed's agent", await agentFor("ahmed")],
      ["Dani's self-hosted agent", await agentFor("dani", "self_hosted")],
      ["a self-hosted claim", selfHosted("dani")],
      ["Dani's app", passOf(person("dani"))],
      ["Ahmed's app", passOf(person("ahmed"))],
    ])
      assert.deepEqual(await noteLinks(who, note), [], what);
    await assert.rejects(noteLinks(null, note), /permission denied/);
  }
  assert.deepEqual(
    await as(person("dani"), `select * from public.note_links(null)`),
    [],
  );
  assert.deepEqual(
    await as(
      person("dani"),
      `select * from public.note_links(gen_random_uuid())`,
    ),
    [],
  );
});

test("note_links does not name a note that is held", async () => {
  const l = await lbAccepted("held");
  assert.equal((await noteLinks(person("dani"), l.mine)).length, 1);
  // Ahmed's note is held for review: Dani cannot read it, link or no link.
  await asDbOwner(
    null,
    `update public.notes set quarantined = true where id = $1`,
    [l.theirs],
  );
  assert.equal(await canRead(person("dani"), l.theirs), false);
  for (const note of [l.mine, l.theirs]) {
    const rows = await noteLinks(person("dani"), note);
    assert.deepEqual(rows, [], JSON.stringify(rows));
  }
  // Ahmed reads both, and still sees the link from his side.
  assert.deepEqual(
    (await noteLinks(person("ahmed"), l.theirs)).map((r) => r.title),
    ["lb held dani a"],
  );
  await release(person("ahmed"), l.theirs);
  assert.deepEqual(
    (await noteLinks(person("dani"), l.mine)).map((r) => r.title),
    ["lb held ahmed a"],
  );
});

test("note_links gives the 50 newest", async () => {
  const hub = await lbNote("dani", "many", "hub");
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.query(
    `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     select $1, $2, $3, 'lb/many/n-' || g || '.md', 'lb many ' || g
       from generate_series(1, 52) g`,
    [hive, members.dani, ws.dani],
  );
  // Odd ones point at the hub, even ones away from it. 51 and 52 share a time.
  await db.query(
    `insert into public.links (hive_id, from_note, to_note, tier, score, created_at)
     select $1,
            case when n.g % 2 = 1 then n.id else $2 end,
            case when n.g % 2 = 1 then $2 else n.id end,
            4, 0.1,
            timestamptz '2001-01-01' + least(n.g, 51) * interval '1 second'
       from (select id, substring(path from 'n-(\\d+)')::int as g
               from public.notes where path like 'lb/many/n-%') n`,
    [hive, hub],
  );
  const total = await db.query(
    `select id from public.links
      where status = 'accepted' and (from_note = $1 or to_note = $1)
      order by created_at desc, id`,
    [hub],
  );
  assert.equal(total.rows.length, 52);

  const rows = await noteLinks(person("dani"), hub);
  assert.equal(rows.length, 50);
  assert.deepEqual(
    rows.map((r) => r.id),
    total.rows.slice(0, 50).map((r) => r.id),
  );
  const numbers = rows.map((r) => Number(r.title.replace("lb many ", "")));
  assert.deepEqual(
    numbers.slice(0, 2).toSorted((x, y) => x - y),
    [51, 52],
  );
  assert.deepEqual(
    numbers.slice(2),
    Array.from({ length: 48 }, (_, k) => 50 - k),
  );
  for (const r of rows) {
    assert.equal(r.mine, true);
    assert.equal(r.owner, "Dani");
    assert.notEqual(r.note_id, hub);
  }
});

test("unlink and note_links are for signed-in callers only", async () => {
  const acl = (
    await db.query(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              pg_get_function_identity_arguments(p.oid) as args,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('public', p.oid, 'execute') as everyone,
              has_function_privilege('authenticated', p.oid, 'execute') as signed_in
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('unlink', 'note_links', 'respond_to_link')
        order by 1`,
    )
  ).rows;
  const signedInOnly = {
    definer: true,
    config: ['search_path=""'],
    anon: false,
    everyone: false,
    signed_in: true,
  };
  assert.deepEqual(acl, [
    { name: "note_links", args: "p_note uuid", ...signedInOnly },
    {
      name: "respond_to_link",
      args: "p_link uuid, p_accept boolean",
      ...signedInOnly,
    },
    { name: "unlink", args: "p_link uuid", ...signedInOnly },
  ]);
  const l = await lbAccepted("anon");
  // No token, and a token that names a real owner but carries the role of a
  // visitor.
  for (const claims of [null, { sub: users.dani, role: "anon" }]) {
    for (const [sql, params] of [
      [`select public.unlink($1)`, [l.link]],
      [`select * from public.note_links($1)`, [l.mine]],
    ]) {
      const r = await trial(claims, sql, params, "anon");
      assert.match(r.error?.message ?? "(answered)", /permission denied/, sql);
    }
  }
  assert.equal((await linkRow(l.link)).status, "accepted");
});

// ---------------------------------------------------------------- settings
// What the settings screen leans on: `create_agent` and `revoke_agent` refuse
// on their own, whatever the app sends. `add_member` is not callable at all:
// a person joins a hive by accepting an invitation (see "Emailed invitations").

const memberCount = async () =>
  (
    await as(
      person("dani"),
      `select count(*)::int as n from public.members where hive_id = $1`,
      [hive],
    )
  )[0].n;
const agentsOf = (name) =>
  as(
    person(name),
    `select id, revoked_at from public.agents where member_id = $1`,
    [members[name]],
  );

test("nobody adds a member directly: add_member is not callable", async () => {
  const before = await memberCount();
  const spare = await addUser("settings-spare@example.com");
  for (const who of [
    person("dani"),
    person("ahmed"),
    person("outsider"),
    asUser(spare),
    await agentFor("dani"),
    { role: "authenticated" },
    null,
  ])
    await assert.rejects(
      as(
        who,
        `select public.add_member($1, 'settings-spare@example.com', 'Spare')`,
        [hive],
      ),
      /permission denied for function add_member/,
    );
  assert.equal(await memberCount(), before);
  assert.deepEqual(await membershipsOf(spare), []);
  const acl = (
    await db.query(
      `select has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('public', p.oid, 'execute') as everyone,
              has_function_privilege('authenticated', p.oid, 'execute') as signed_in
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = 'add_member'`,
    )
  ).rows;
  assert.deepEqual(acl, [{ anon: false, everyone: false, signed_in: false }]);
});

test("an agent cannot create an agent or revoke one", async () => {
  // The owner's own agent: refused for being an agent, not for whose it is.
  const agent = await agentFor("dani");
  const agentsBefore = await agentsOf("dani");

  await assert.rejects(
    as(agent, `select * from public.create_agent($1, 'Spawned', 'other')`, [
      ws.dani,
    ]),
    /agents cannot create agents/,
  );
  await assert.rejects(
    as(agent, `select public.revoke_agent($1)`, [agent.agent_id]),
    /agents cannot revoke agents/,
  );
  const other = agentsBefore.find((a) => a.id !== agent.agent_id);
  await assert.rejects(
    as(agent, `select public.revoke_agent($1)`, [other.id]),
    /agents cannot revoke agents/,
  );

  assert.deepEqual(await agentsOf("dani"), agentsBefore);
});

test("a person cannot revoke a colleague's agent or connect one to a colleague's workspace", async () => {
  const theirs = await agentFor("ahmed");
  const daniBefore = await agentsOf("dani");

  await assert.rejects(
    as(person("dani"), `select public.revoke_agent($1)`, [theirs.agent_id]),
    /that agent is not yours/,
  );
  const still = (await agentsOf("ahmed")).find((a) => a.id === theirs.agent_id);
  assert.equal(still.revoked_at, null);

  await assert.rejects(
    as(
      person("ahmed"),
      `select * from public.create_agent($1, 'In your space', 'other')`,
      [ws.dani],
    ),
    /that workspace is not yours/,
  );
  assert.deepEqual(await agentsOf("dani"), daniBefore);
});

// ------------------------------------------------------------- invitations
// The owner invites by email. Nobody is added by being invited: the person
// joins by accepting the invitation, signed in with the invited address, and
// only once that address is confirmed. Fresh `invite-…` users in every test.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Answers the invitation's id.
const invite = (who, email, name, h = hive) =>
  as(who, `select public.invite_member($1, $2, $3) as r`, [
    h,
    email,
    name,
  ]).then((r) => r[0].r);
const revokeInvitation = (who, id) =>
  as(who, `select public.revoke_invitation($1)`, [id]);
const toEmail = (who, id) =>
  as(who, `select public.invitation_to_email($1) as email`, [id]);
const myInvitations = (who) => as(who, `select * from public.my_invitations()`);
// Answers the hive joined.
const accept = (who, id) =>
  as(who, `select public.accept_invitation($1) as hive`, [id]).then(
    (r) => r[0].hive,
  );
const asUser = (id) => ({ sub: id, role: "authenticated" });
// Read as the database owner: what is really there, whoever may see it.
const invitationsFor = async (email) =>
  (
    await db.query(
      `select * from public.invitations where email = $1 order by created_at, id`,
      [email],
    )
  ).rows;
const membershipsOf = async (userId) =>
  (
    await db.query(
      `select m.id, m.hive_id, m.display_name, m.role,
              (select array_agg(w.name order by w.name) from public.workspaces w
                where w.member_id = m.id) as workspaces
         from public.members m where m.user_id = $1 order by m.created_at, m.id`,
      [userId],
    )
  ).rows;
// Everything an invitation call could have changed, to compare before and after.
const inviteState = async () =>
  (
    await db.query(
      `select (select count(*)::int from public.members) as members,
              (select count(*)::int from public.workspaces) as workspaces,
              (select count(*)::int from public.audit_log
                where action like 'member.%') as audits,
              (select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]')
                 from public.invitations i) as invitations`,
    )
  ).rows[0];
const unchanged = async (before) =>
  assert.deepEqual(await inviteState(), before);
const otherHive = async () =>
  (
    await db.query(
      `select hive_id from public.members where user_id = $1 and role = 'owner' limit 1`,
      [users.outsider],
    )
  ).rows[0].hive_id;
// A hive of its own, with a fresh owner.
const freshHive = async (tag) => {
  const owner = asUser(await addUser(`invite-${tag}-owner@example.com`));
  const id = (
    await as(owner, `select public.create_hive($1, 'Owner') as id`, [
      `Hive ${tag}`,
    ])
  )[0].id;
  return { owner, id };
};
const expire = (id) =>
  db.query(
    `update public.invitations set expires_at = now() - interval '1 second'
      where id = $1`,
    [id],
  );
const selfHosted = (name) => ({ ...person(name), trust_tier: "self_hosted" });
const NO_CLIENT = "00000000-0000-0000-0000-000000000000";
// An app pass: the person's own identity plus a client_id (see "connected apps").
const passOf = (who) => ({ ...who, client_id: NO_CLIENT });
const PASS_REFUSED = /an app pass cannot do this/;

test("the owner invites an email nobody signed up with", async () => {
  const before = await inviteState();
  const mark = await lastAudit();
  const id = await invite(
    person("dani"),
    "  Invite-Unknown@Example.com ",
    " Una ",
  );
  assert.match(id, UUID);

  assert.deepEqual(await invitationsFor("Invite-Unknown@Example.com"), []);
  const rows = await invitationsFor("invite-unknown@example.com");
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.id, id);
  assert.equal(row.hive_id, hive);
  assert.equal(row.display_name, "Una");
  assert.equal(row.invited_by, members.dani);
  assert.equal(row.accepted_at, null);
  assert.equal(row.accepted_member, null);
  assert.equal(row.revoked_at, null);
  // Not emailed yet: that is counted by invitation_to_email.
  assert.equal(row.last_emailed_at, null);
  assert.equal(row.email_count, 0);
  const days = (row.expires_at - row.created_at) / 86_400_000;
  assert.ok(Math.abs(days - 14) < 0.01, `expires in ${days} days`);

  const after = await inviteState();
  assert.equal(after.members, before.members);
  assert.equal(after.workspaces, before.workspaces);
  const audits = await auditSince(mark);
  assert.deepEqual(
    audits.map((r) => [r.action, r.hive_id, r.member_id, r.detail]),
    [
      [
        "member.invited",
        hive,
        members.dani,
        { invitation: id, email: "invite-unknown@example.com" },
      ],
    ],
  );
});

test("inviting adds nobody, whether or not the address has an account", async () => {
  const known = await addUser("Invite-Known@example.com");
  const unconfirmed = await addUser("invite-unconfirmed@example.com", {
    confirmed: false,
  });
  const before = await inviteState();
  const mark = await lastAudit();

  // The owner gets the same kind of answer for all three: an invitation's id.
  for (const [email, name] of [
    ["invite-known@EXAMPLE.com", "Known"],
    ["invite-unconfirmed@example.com", "Unconfirmed"],
    ["invite-nobody@example.com", "Nobody"],
  ]) {
    const id = await invite(person("dani"), email, name);
    assert.match(id, UUID);
    const rows = await invitationsFor(email.toLowerCase());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id);
    assert.equal(rows[0].accepted_at, null);
    assert.equal(rows[0].accepted_member, null);
  }

  const after = await inviteState();
  assert.equal(after.members, before.members);
  assert.equal(after.workspaces, before.workspaces);
  assert.deepEqual(await membershipsOf(known), []);
  assert.deepEqual(await membershipsOf(unconfirmed), []);
  assert.deepEqual(
    (await auditSince(mark)).map((r) => r.action),
    ["member.invited", "member.invited", "member.invited"],
  );
  // Invited is not in: the person with the account reads nothing of the hive.
  for (const table of ["members", "hives", "workspaces", "notes"])
    assert.deepEqual(
      await as(asUser(known), `select 1 from public.${table}`),
      [],
      table,
    );
});

test("only the hive owner invites, and never twice", async () => {
  await addUser("invite-refused@example.com");
  const other = await otherHive();
  const before = await inviteState();

  for (const who of [
    person("ahmed"),
    person("outsider"),
    await agentFor("dani"),
    await agentFor("dani", "self_hosted"),
    selfHosted("dani"),
    { role: "authenticated" },
  ]) {
    for (const email of [
      "invite-refused@example.com",
      "invite-refused-new@example.com",
    ])
      await assert.rejects(
        invite(who, email, "Refused"),
        /only the hive owner can invite members/,
      );
  }
  // An app the owner approved is not the owner.
  await assert.rejects(
    invite(passOf(person("dani")), "invite-refused-new@example.com", "R"),
    PASS_REFUSED,
  );
  // An owner invites into their own hive only; a member's agent is no owner.
  await assert.rejects(
    invite(person("dani"), "invite-refused@example.com", "Refused", other),
    /only the hive owner can invite members/,
  );
  await assert.rejects(
    invite(await agentFor("ahmed"), "invite-refused-new@example.com", "R"),
    /only the hive owner can invite members/,
  );
  await assert.rejects(
    invite(person("dani"), "invite-refused@example.com", "Refused", null),
    /only the hive owner can invite members/,
  );
  // The public cannot call it at all.
  await assert.rejects(
    invite(null, "invite-refused@example.com", "Refused"),
    /permission denied/,
  );

  // Someone who is in the hive already, in any letter case.
  for (const email of [
    "ahmed@example.com",
    " AHMED@Example.com",
    "dani@example.com",
  ])
    await assert.rejects(
      invite(person("dani"), email, "Again"),
      /that person is already a member/,
    );
  await unchanged(before);
  // A member whose address was never confirmed is a member all the same.
  const loose = await addUser("invite-loose@example.com", { confirmed: false });
  await db.query(
    `insert into public.members (hive_id, user_id, display_name) values ($1, $2, 'Loose')`,
    [hive, loose],
  );
  const withLoose = await inviteState();
  await assert.rejects(
    invite(person("dani"), "invite-loose@example.com", "Loose again"),
    /that person is already a member/,
  );
  await unchanged(withLoose);
  await db.query(`delete from public.members where user_id = $1`, [loose]);
  await unchanged(before);

  // The same email twice.
  assert.match(
    await invite(person("dani"), "invite-twice@example.com", "Twice"),
    UUID,
  );
  const once = await inviteState();
  for (const email of ["INVITE-TWICE@EXAMPLE.COM", "invite-twice@example.com "])
    await assert.rejects(
      invite(person("dani"), email, "Twice again"),
      /that email is already invited/,
    );
  await unchanged(once);
  const rows = await invitationsFor("invite-twice@example.com");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].display_name, "Twice");
});

test("an invitation needs a real email address and a name", async () => {
  // One of these addresses has an account: it makes no difference.
  const known = await addUser("invite-shape@example.com");
  const before = await inviteState();
  const bad = [
    ["invite-shape@example.com", ""],
    ["invite-shape@example.com", "   "],
    ["invite-shape@example.com", null],
    ["invite-shape@example.com", "x".repeat(61)],
    ["invite-shape@example.com", "Sha\npe"],
    ["invite-shape-new@example.com", ""],
    ["invite-shape-new@example.com", " \t "],
    ["invite-shape-new@example.com", "x".repeat(61)],
    ["", "Shape"],
    ["   ", "Shape"],
    [null, "Shape"],
    ["invite-shape", "Shape"],
    ["@example.com", "Shape"],
    ["invite-shape@", "Shape"],
    ["invite shape@example.com", "Shape"],
    ["invite-shape@example.com@example.com", "Shape"],
    ["invite-shape@exam\nple.com", "Shape"],
    [`${"a".repeat(250)}@example.com`, "Shape"],
  ];
  for (const [email, name] of bad) {
    await assert.rejects(
      invite(person("dani"), email, name),
      /enter a valid email address|enter a name of 1 to 60 characters/,
      `accepted ${JSON.stringify([email, name])}`,
    );
    await unchanged(before);
  }
  assert.deepEqual(await membershipsOf(known), []);
  // The limits themselves are allowed.
  assert.match(
    await invite(
      person("dani"),
      "invite-shape-new@example.com",
      "x".repeat(60),
    ),
    UUID,
  );
});

test("only white space is trimmed from an invitation's email and name", async () => {
  // An earlier version trimmed the letter "v" as if it were a vertical tab,
  // so alice@company.dev was stored, and would have been emailed, as
  // alice@company.de.
  const dani = person("dani");
  for (const [email, name, storedEmail, storedName] of [
    ["vera@company.dev", "vlad v", "vera@company.dev", "vlad v"],
    [" Viv@Example.DEV ", " Viv ", "viv@example.dev", "Viv"],
    ["v@invite-v.tv", "v", "v@invite-v.tv", "v"],
    ["vv@invite-vv.dev\n", "\tvv\r\n", "vv@invite-vv.dev", "vv"],
    [
      "\u000B\finvite-vt@example.dev\u000B",
      "\u000B Valve V \f",
      "invite-vt@example.dev",
      "Valve V",
    ],
  ]) {
    const id = await invite(dani, email, name);
    const [row] = (
      await db.query(
        `select email, display_name from public.invitations where id = $1`,
        [id],
      )
    ).rows;
    assert.deepEqual(row, { email: storedEmail, display_name: storedName });
    assert.deepEqual(await toEmail(dani, id), [{ email: storedEmail }]);
    // The same address again is the same address.
    await assert.rejects(
      invite(dani, storedEmail, "Again"),
      /that email is already invited/,
    );
  }
  // A name or an address of nothing but white space is still refused.
  await assert.rejects(
    invite(dani, "invite-v-empty@example.dev", "\u000B \f"),
    /enter a name of 1 to 60 characters/,
  );
  await assert.rejects(
    invite(dani, "\u000B", "Name"),
    /enter a valid email address/,
  );
});

test("an expired invitation can be made again", async () => {
  const first = await invite(
    person("dani"),
    "invite-again@example.com",
    "First",
  );
  await expire(first);
  const second = await invite(
    person("dani"),
    "invite-again@example.com",
    "Second",
  );
  assert.match(second, UUID);
  assert.notEqual(second, first);

  const rows = await invitationsFor("invite-again@example.com");
  assert.equal(rows.length, 2);
  const pending = rows.filter((i) => !i.accepted_at && !i.revoked_at);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, second);
  assert.equal(pending[0].display_name, "Second");
  assert.ok(pending[0].expires_at > new Date());
  // The new one is the one honoured.
  const me = asUser(await addUser("invite-again@example.com"));
  await assert.rejects(accept(me, first), /invitation not found/);
  assert.equal(await accept(me, second), hive);
  assert.equal((await membershipsOf(me.sub))[0].display_name, "Second");
});

test("there is never a second pending invitation for one email in a hive", async () => {
  await invite(person("dani"), "invite-single@example.com", "Single");
  const dup = (h, email) =>
    db.query(
      `insert into public.invitations (hive_id, email, display_name) values ($1, $2, 'Dup')`,
      [h, email],
    );
  // Even the database owner cannot store one, so two calls at the same moment cannot.
  await assert.rejects(
    dup(hive, "invite-single@example.com"),
    (e) => e.code === "23505",
  );
  // Nor an address that is not lower-case, which the match would miss.
  await assert.rejects(
    dup(hive, "Invite-Single@example.com"),
    (e) => e.code === "23514",
  );
  // Another hive may invite the same address.
  const other = await otherHive();
  assert.match(
    await invite(
      person("outsider"),
      "invite-single@example.com",
      "Single there",
      other,
    ),
    UUID,
  );
  // A revoked one does not block a new one.
  const [mine] = (await invitationsFor("invite-single@example.com")).filter(
    (i) => i.hive_id === hive,
  );
  await revokeInvitation(person("dani"), mine.id);
  assert.match(
    await invite(person("dani"), "invite-single@example.com", "Single"),
    UUID,
  );
  const pending = (await invitationsFor("invite-single@example.com")).filter(
    (i) => !i.accepted_at && !i.revoked_at,
  );
  assert.deepEqual(pending.map((i) => i.hive_id).sort(), [hive, other].sort());
});

test("only the hive owner revokes an invitation", async () => {
  const id = await invite(
    person("dani"),
    "invite-revoke@example.com",
    "Revoke",
  );
  const invited = await addUser("invite-revoke@example.com");
  const [inv] = await invitationsFor("invite-revoke@example.com");
  assert.equal(inv.id, id);
  const before = await inviteState();

  for (const who of [
    person("ahmed"),
    person("outsider"),
    asUser(invited),
    await agentFor("ahmed"),
    { role: "authenticated" },
  ]) {
    await assert.rejects(
      revokeInvitation(who, inv.id),
      /invitation not found|only the hive owner can invite members/,
    );
    await unchanged(before);
  }
  for (const who of [
    await agentFor("dani"),
    await agentFor("dani", "self_hosted"),
    selfHosted("dani"),
  ]) {
    await assert.rejects(
      revokeInvitation(who, inv.id),
      /only the hive owner can invite members/,
    );
    await unchanged(before);
  }
  await assert.rejects(revokeInvitation(null, inv.id), /permission denied/);
  await assert.rejects(
    revokeInvitation(person("dani"), null),
    /invitation not found/,
  );
  await assert.rejects(
    revokeInvitation(person("dani"), NO_CLIENT),
    /invitation not found/,
  );
  await unchanged(before);

  await revokeInvitation(person("dani"), inv.id);
  const [gone] = await invitationsFor("invite-revoke@example.com");
  assert.ok(gone.revoked_at);
  assert.equal(gone.accepted_at, null);
  const after = await inviteState();
  await assert.rejects(
    revokeInvitation(person("dani"), inv.id),
    /invitation not found/,
  );
  await unchanged(after);
  // A revoked invitation lets nobody in, and is no longer shown or emailed.
  assert.deepEqual(await myInvitations(asUser(invited)), []);
  await assert.rejects(accept(asUser(invited), inv.id), /invitation not found/);
  await assert.rejects(toEmail(person("dani"), inv.id), /invitation not found/);
  await unchanged(after);
  assert.deepEqual(await membershipsOf(invited), []);
});

test("only the hive owner reads invitations, and nobody writes them by hand", async () => {
  await invite(person("dani"), "invite-read@example.com", "Read");
  const invited = await addUser("invite-read@example.com");
  const [inv] = await invitationsFor("invite-read@example.com");
  const read = (who) => as(who, `select id from public.invitations`);

  const mine = await as(
    person("dani"),
    `select id, hive_id, email, display_name, created_at, expires_at,
            accepted_at, revoked_at, last_emailed_at, email_count
       from public.invitations where id = $1`,
    [inv.id],
  );
  assert.equal(mine.length, 1);
  assert.equal(mine[0].email, "invite-read@example.com");
  assert.equal(mine[0].email_count, 0);
  // The owner sees their own hive's only.
  const other = await otherHive();
  await invite(person("outsider"), "invite-read-there@example.com", "T", other);
  const seen = await as(
    person("dani"),
    `select distinct hive_id from public.invitations`,
  );
  assert.deepEqual(seen, [{ hive_id: hive }]);
  assert.ok(!(await read(person("outsider"))).some((r) => r.id === inv.id));

  // The invited person does not read the table either: my_invitations is
  // what shows them their own.
  for (const who of [
    person("ahmed"),
    person("sara"),
    asUser(invited),
    await agentFor("dani"),
    await agentFor("dani", "self_hosted"),
    selfHosted("dani"),
    await agentFor("ahmed"),
    { role: "authenticated" },
  ])
    assert.deepEqual(await read(who), []);
  await assert.rejects(read(null), /permission denied/);

  const before = await inviteState();
  for (const who of [
    person("dani"),
    person("ahmed"),
    asUser(invited),
    await agentFor("dani"),
  ]) {
    await assert.rejects(
      as(
        who,
        `insert into public.invitations (hive_id, email, display_name)
         values ($1, 'invite-forged@example.com', 'Forged')`,
        [hive],
      ),
      /permission denied/,
    );
    await assert.rejects(
      as(
        who,
        `update public.invitations set email = 'invite-forged@example.com' where id = $1`,
        [inv.id],
      ),
      /permission denied/,
    );
    await assert.rejects(
      as(
        who,
        `update public.invitations set expires_at = now() + interval '10 years'`,
      ),
      /permission denied/,
    );
    // The email limits cannot be wound back.
    await assert.rejects(
      as(
        who,
        `update public.invitations set email_count = 0, last_emailed_at = null`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      as(who, `delete from public.invitations where id = $1`, [inv.id]),
      /permission denied/,
    );
  }
  await unchanged(before);
});

test("inviting, joining and revoking are in the audit log for the owner only", async () => {
  const mark = await lastAudit();
  await addUser("invite-audit-known@example.com");
  await invite(person("dani"), "invite-audit-known@example.com", "Known");
  const joinId = await invite(
    person("dani"),
    "invite-audit-join@example.com",
    "Join",
  );
  const joiner = await addUser("invite-audit-join@example.com");
  // Emailing is in the log; looking writes nothing.
  await toEmail(person("dani"), joinId);
  await myInvitations(asUser(joiner));
  await accept(asUser(joiner), joinId);
  await invite(person("dani"), "invite-audit-gone@example.com", "Gone");
  const [gone] = await invitationsFor("invite-audit-gone@example.com");
  await revokeInvitation(person("dani"), gone.id);
  const [joined] = await invitationsFor("invite-audit-join@example.com");

  const rows = await as(
    person("dani"),
    `select action, hive_id, member_id, agent_id, detail
       from public.audit_log where id > $1 order by id`,
    [mark],
  );
  assert.deepEqual(
    rows.map((r) => r.action),
    [
      "member.invited",
      "member.invited",
      "member.invitation_emailed",
      "member.joined",
      "member.invited",
      "member.invitation_revoked",
    ],
  );
  for (const r of rows) {
    assert.equal(r.hive_id, hive);
    assert.equal(r.agent_id, null);
  }
  const [known, invited, emailed, join, , revoked] = rows;
  assert.equal(emailed.member_id, members.dani);
  assert.deepEqual(emailed.detail, {
    invitation: joined.id,
    email: "invite-audit-join@example.com",
  });
  assert.equal(known.member_id, members.dani);
  assert.equal(known.detail.email, "invite-audit-known@example.com");
  assert.equal(invited.member_id, members.dani);
  assert.deepEqual(invited.detail, {
    invitation: joined.id,
    email: "invite-audit-join@example.com",
  });
  assert.equal(join.member_id, joined.accepted_member);
  assert.deepEqual(join.detail, {
    invitation: joined.id,
    email: "invite-audit-join@example.com",
  });
  assert.equal(revoked.member_id, members.dani);
  assert.deepEqual(revoked.detail, {
    invitation: gone.id,
    email: "invite-audit-gone@example.com",
  });

  for (const who of [
    person("ahmed"),
    asUser(joiner),
    person("outsider"),
    await agentFor("dani"),
  ])
    assert.deepEqual(
      await as(
        who,
        `select id from public.audit_log
          where action like 'member.%' and hive_id = $1`,
        [hive],
      ),
      [],
    );
  // The agent reads none at all, of any hive.
  assert.deepEqual(
    await as(await agentFor("dani"), `select id from public.audit_log`),
    [],
  );
});

// ------------------------------------------------------ emailed invitations
// The server emails the invitation and the person presses Join. The mail
// function asks the database one thing, invitation_to_email, with the owner's
// own session; the Join page asks my_invitations and accept_invitation with
// the invited person's.

test("a hive makes at most 20 invitations in 24 hours", async () => {
  const a = await freshHive("cap-a");
  const b = await freshHive("cap-b");
  const ids = [];
  for (let i = 1; i <= 20; i++)
    ids.push(
      await invite(a.owner, `invite-cap-${i}@example.com`, `Cap ${i}`, a.id),
    );
  const full = await inviteState();
  const more = (email = "invite-cap-21@example.com") =>
    invite(a.owner, email, "Cap more", a.id);

  await assert.rejects(more(), /too many invitations today/);
  await unchanged(full);
  // Revoking one makes no room, not even for the address it was for.
  await revokeInvitation(a.owner, ids[0]);
  const revoked = await inviteState();
  await assert.rejects(more(), /too many invitations today/);
  await assert.rejects(
    more("invite-cap-1@example.com"),
    /too many invitations today/,
  );
  // An address that is still invited is told so, as on any other day.
  await assert.rejects(
    more("invite-cap-2@example.com"),
    /that email is already invited/,
  );
  await unchanged(revoked);
  // The limit is each hive's own.
  assert.match(
    await invite(b.owner, "invite-cap-21@example.com", "Cap", b.id),
    UUID,
  );
  await assert.rejects(more(), /too many invitations today/);

  // Once one of the twenty is more than a day old there is room for one.
  await db.query(
    `update public.invitations
        set created_at = now() - interval '24 hours 1 second' where id = $1`,
    [ids[1]],
  );
  assert.match(await more(), UUID);
  await assert.rejects(
    more("invite-cap-22@example.com"),
    /too many invitations today/,
  );
});

test("a person makes at most 20 invitations in 24 hours, over all their hives", async () => {
  const a = await freshHive("person-a");
  const me = a.owner;
  const hiveOf = async (name) =>
    (await as(me, `select public.create_hive($1, 'Owner') as id`, [name]))[0]
      .id;
  const second = await hiveOf("Hive person second");
  const ids = [];
  for (let i = 1; i <= 12; i++)
    ids.push(await invite(me, `invite-person-${i}@example.com`, "P", a.id));
  for (let i = 13; i <= 20; i++)
    ids.push(await invite(me, `invite-person-${i}@example.com`, "P", second));
  const third = await hiveOf("Hive person third");
  const full = await inviteState();

  // No hive is at its own limit; the person is at theirs.
  for (const h of [a.id, second, third]) {
    await assert.rejects(
      invite(me, "invite-person-21@example.com", "P", h),
      /too many invitations today/,
    );
    await unchanged(full);
  }
  // Revoking makes no room.
  await revokeInvitation(me, ids[0]);
  await assert.rejects(
    invite(me, "invite-person-21@example.com", "P", third),
    /too many invitations today/,
  );
  // Someone else is not held back by it.
  const b = await freshHive("person-b");
  assert.match(
    await invite(b.owner, "invite-person-21@example.com", "P", b.id),
    UUID,
  );

  // Once one of the twenty is more than a day old there is room for one.
  await db.query(
    `update public.invitations
        set created_at = now() - interval '24 hours 1 second' where id = $1`,
    [ids[19]],
  );
  assert.match(
    await invite(me, "invite-person-21@example.com", "P", third),
    UUID,
  );
  await assert.rejects(
    invite(me, "invite-person-22@example.com", "P", a.id),
    /too many invitations today/,
  );
});

test("the owner gets an invitation's address to email, within limits", async () => {
  const dani = person("dani");
  const id = await invite(dani, " Invite-Mail@Example.com", "Mail");
  const sent = async () =>
    (
      await db.query(
        `select email_count as count, last_emailed_at as at,
                extract(epoch from now() - last_emailed_at)::float8 as ago
           from public.invitations where id = $1`,
        [id],
      )
    ).rows[0];
  const lastSent = (ago) =>
    db.query(
      `update public.invitations set last_emailed_at = now() - $2::interval
        where id = $1`,
      [id, ago],
    );
  assert.deepEqual(await sent(), { count: 0, at: null, ago: null });
  const mark = await lastAudit();

  assert.deepEqual(await toEmail(dani, id), [
    { email: "invite-mail@example.com" },
  ]);
  let s = await sent();
  assert.equal(s.count, 1);
  assert.ok(s.ago >= 0 && s.ago < 5, `stamped ${s.ago} s ago`);

  // At once again, and just short of two minutes later.
  const once = await inviteState();
  await assert.rejects(toEmail(dani, id), /wait before sending again/);
  await unchanged(once);
  await lastSent("1 minute 55 seconds");
  const almost = await inviteState();
  await assert.rejects(toEmail(dani, id), /wait before sending again/);
  await unchanged(almost);

  // Two minutes on it is sent again, up to five times in all.
  for (const count of [2, 3, 4, 5]) {
    await lastSent("2 minutes 1 second");
    assert.deepEqual(await toEmail(dani, id), [
      { email: "invite-mail@example.com" },
    ]);
    s = await sent();
    assert.equal(s.count, count);
    assert.ok(s.ago >= 0 && s.ago < 5, `stamped ${s.ago} s ago`);
  }
  for (const ago of ["0 seconds", "3 minutes", "3 days"]) {
    await lastSent(ago);
    const five = await inviteState();
    await assert.rejects(
      toEmail(dani, id),
      /too many emails for this invitation/,
    );
    await unchanged(five);
  }
  // The limits are each invitation's own.
  const other = await invite(dani, "invite-mail-other@example.com", "Other");
  assert.deepEqual(await toEmail(dani, other), [
    { email: "invite-mail-other@example.com" },
  ]);
  // Each email that went out is in the audit log, under the owner's name;
  // the refusals above left nothing.
  const mail = { invitation: id, email: "invite-mail@example.com" };
  assert.deepEqual(
    (await auditSince(mark))
      .filter((r) => r.action !== "member.invited")
      .map((r) => [r.action, r.hive_id, r.member_id, r.agent_id, r.detail]),
    [
      ...[1, 2, 3, 4, 5].map(() => [
        "member.invitation_emailed",
        hive,
        members.dani,
        null,
        mail,
      ]),
      [
        "member.invitation_emailed",
        hive,
        members.dani,
        null,
        { invitation: other, email: "invite-mail-other@example.com" },
      ],
    ],
  );
});

test("a person emails one address at most 5 times in 24 hours, however often it is invited", async () => {
  const a = await freshHive("rcpt-a");
  const me = a.owner;
  const second = (
    await as(me, `select public.create_hive('Hive rcpt second', 'Owner') as id`)
  )[0].id;
  const address = "invite-rcpt@example.com";
  // The two-minute wait is not what is tested here.
  const rested = () =>
    db.query(
      `update public.invitations set last_emailed_at = now() - interval '3 minutes'
        where email = $1`,
      [address],
    );
  const send = async (id) => {
    await rested();
    return toEmail(me, id);
  };

  // Two emails, revoked, invited again, two more, then one from another
  // hive of the same person: five in all.
  let id = await invite(me, address, "Rcpt", a.id);
  await send(id);
  await send(id);
  await revokeInvitation(me, id);
  id = await invite(me, address, "Rcpt", a.id);
  await send(id);
  await send(id);
  const there = await invite(me, address, "Rcpt", second);
  await send(there);

  // The sixth is refused whichever invitation it is asked for, and a fresh
  // invitation does not help.
  const five = await inviteState();
  for (const inv of [id, there]) {
    await rested();
    const before = await inviteState();
    await assert.rejects(
      toEmail(me, inv),
      /too many emails for this invitation/,
    );
    await unchanged(before);
  }
  assert.equal((await inviteState()).audits, five.audits);
  await revokeInvitation(me, id);
  id = await invite(me, address, "Rcpt", a.id);
  await assert.rejects(toEmail(me, id), /too many emails for this invitation/);
  assert.equal(
    (
      await db.query(
        `select email_count from public.invitations where id = $1`,
        [id],
      )
    ).rows[0].email_count,
    0,
  );

  // Another address is not held back, nor is another person inviting this one.
  const other = await invite(me, "invite-rcpt-other@example.com", "O", a.id);
  assert.deepEqual(await toEmail(me, other), [
    { email: "invite-rcpt-other@example.com" },
  ]);
  const b = await freshHive("rcpt-b");
  const theirs = await invite(b.owner, address, "Rcpt", b.id);
  assert.deepEqual(await toEmail(b.owner, theirs), [{ email: address }]);

  // A day after the first of the five there is room for one more.
  await db.query(
    `update public.audit_log set at = now() - interval '24 hours 1 second'
      where id = (select min(id) from public.audit_log
                   where action = 'member.invitation_emailed'
                     and detail ->> 'email' = $1)`,
    [address],
  );
  assert.deepEqual(await toEmail(me, id), [{ email: address }]);
  await rested();
  await assert.rejects(toEmail(me, id), /too many emails for this invitation/);
});

test("nobody but the hive's owner gets an invitation's address", async () => {
  const dani = person("dani");
  const id = await invite(dani, "invite-mail-refused@example.com", "Refused");
  const invited = await addUser("invite-mail-refused@example.com");
  const revoked = await invite(dani, "invite-mail-revoked@example.com", "R");
  await revokeInvitation(dani, revoked);
  const late = await invite(dani, "invite-mail-late@example.com", "L");
  await expire(late);
  const joined = await invite(dani, "invite-mail-joined@example.com", "J");
  await accept(asUser(await addUser("invite-mail-joined@example.com")), joined);
  const before = await inviteState();

  for (const who of [
    person("ahmed"),
    person("sara"),
    person("outsider"),
    asUser(invited),
    { role: "authenticated" },
    { role: "authenticated", sub: "" },
  ]) {
    await assert.rejects(toEmail(who, id), /invitation not found/);
    await unchanged(before);
  }
  for (const who of [
    await agentFor("dani"),
    await agentFor("dani", "self_hosted"),
    selfHosted("dani"),
    await agentFor("ahmed"),
  ]) {
    await assert.rejects(
      toEmail(who, id),
      /only the hive owner can invite members/,
    );
    await unchanged(before);
  }
  for (const who of [passOf(dani), { ...dani, aud: "some-client" }]) {
    await assert.rejects(toEmail(who, id), PASS_REFUSED);
    await unchanged(before);
  }
  await assert.rejects(toEmail(null, id), /permission denied/);
  // Not there, or no longer open.
  for (const gone of [null, NO_CLIENT, revoked, late, joined]) {
    await assert.rejects(toEmail(dani, gone), /invitation not found/);
    await unchanged(before);
  }
  // Another hive's owner gets their own invitation's address, not this one.
  const there = await invite(
    person("outsider"),
    "invite-mail-there@example.com",
    "There",
    await otherHive(),
  );
  await assert.rejects(toEmail(dani, there), /invitation not found/);
  assert.deepEqual(await toEmail(person("outsider"), there), [
    { email: "invite-mail-there@example.com" },
  ]);
  // The open one is the owner's to send: none of the refusals was about it.
  assert.deepEqual(await toEmail(dani, id), [
    { email: "invite-mail-refused@example.com" },
  ]);
});

test("a person sees the invitations waiting for their own confirmed address", async () => {
  const other = await otherHive();
  const here = await invite(person("dani"), "invite-mine@example.com", "Mine");
  const there = await invite(
    person("outsider"),
    "INVITE-MINE@example.com",
    "Mine there",
    other,
  );
  await invite(person("dani"), "invite-mine-not@example.com", "Not mine");
  // Two more hives: one took its invitation back, the other's ran out.
  const c = await freshHive("mine-c");
  const d = await freshHive("mine-d");
  await revokeInvitation(
    c.owner,
    await invite(c.owner, "invite-mine@example.com", "Mine", c.id),
  );
  await expire(await invite(d.owner, "invite-mine@example.com", "Mine", d.id));
  const me = asUser(await addUser("Invite-Mine@Example.com"));
  const before = await inviteState();

  // The two were made within the same millisecond now and then, and the order then falls to
  // the id: put the one from this hive first, whichever way they came back.
  const rows = (await myInvitations(me)).sort(
    (x, y) => (y.id === here) - (x.id === here),
  );
  assert.deepEqual(
    rows.map((r) => Object.keys(r)),
    [
      ["id", "hive_name", "invited_by", "expires_at"],
      ["id", "hive_name", "invited_by", "expires_at"],
    ],
  );
  assert.deepEqual(
    rows.map(({ id, hive_name, invited_by }) => ({
      id,
      hive_name,
      invited_by,
    })),
    [
      { id: here, hive_name: "Test hive", invited_by: "Dani" },
      { id: there, hive_name: "Other hive", invited_by: "Outsider" },
    ],
  );
  const [stored] = (await invitationsFor("invite-mine@example.com")).filter(
    (i) => i.id === here,
  );
  assert.deepEqual(rows[0].expires_at, stored.expires_at);
  // Looking changes nothing, and lets nobody in.
  await unchanged(before);
  assert.deepEqual(await membershipsOf(me.sub), []);

  // Nobody else is shown them: not the owners, not a member, not a person
  // whose address is close to it.
  for (const who of [
    person("dani"),
    person("ahmed"),
    person("outsider"),
    c.owner,
    asUser(await addUser("xinvite-mine@example.com")),
    asUser(await addUser("invite-mine@example.com.evil.test")),
    asUser(await addUser("invite-min_@example.com")),
    asUser(await addUser("invite-%@example.com")),
  ])
    assert.deepEqual(await myInvitations(who), []);

  // An account that never proved the address sees none until it has.
  await invite(person("dani"), "invite-mine-unproved@example.com", "Unproved");
  const unproved = await addUser("invite-mine-unproved@example.com", {
    confirmed: false,
  });
  assert.deepEqual(await myInvitations(asUser(unproved)), []);
  await db.query(
    `update auth.users set email_confirmed_at = now() where id = $1`,
    [unproved],
  );
  assert.equal((await myInvitations(asUser(unproved))).length, 1);

  // An invitation whose inviter has left the hive is still shown, unnamed.
  await db.query(
    `insert into public.invitations (hive_id, email, display_name)
     values ($1, 'invite-mine-orphan@example.com', 'Orphan')`,
    [hive],
  );
  const orphan = await myInvitations(
    asUser(await addUser("invite-mine-orphan@example.com")),
  );
  assert.deepEqual(
    orphan.map(({ hive_name, invited_by }) => [hive_name, invited_by]),
    [["Test hive", ""]],
  );
});

test("the invited person joins by accepting, once", async () => {
  const id = await invite(person("dani"), "invite-join@example.com", "Joiner");
  // The account appears later, as it does when the emailed link is opened.
  const me = asUser(await addUser("Invite-Join@Example.com"));
  // Signing in is not joining.
  assert.deepEqual(await membershipsOf(me.sub), []);
  assert.deepEqual(
    await as(me, `select 1 from public.members where hive_id = $1`, [hive]),
    [],
  );
  const mark = await lastAudit();

  assert.equal(await accept(me, id), hive);
  const ms = await membershipsOf(me.sub);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].hive_id, hive);
  assert.equal(ms[0].display_name, "Joiner");
  assert.equal(ms[0].role, "member");
  assert.deepEqual(ms[0].workspaces, ["Main"]);
  const [inv] = await invitationsFor("invite-join@example.com");
  assert.ok(inv.accepted_at);
  assert.equal(inv.accepted_member, ms[0].id);
  assert.equal(inv.revoked_at, null);
  assert.deepEqual(
    (await auditSince(mark)).map((r) => [r.action, r.member_id, r.detail]),
    [
      [
        "member.joined",
        ms[0].id,
        { invitation: id, email: "invite-join@example.com" },
      ],
    ],
  );
  // They are in: they read the member list, and nothing is left waiting.
  assert.ok(
    (await as(me, `select id from public.members where hive_id = $1`, [hive]))
      .length > 1,
  );
  assert.deepEqual(await myInvitations(me), []);

  const after = await inviteState();
  await assert.rejects(accept(me, id), /invitation not found/);
  await unchanged(after);
  assert.deepEqual(await membershipsOf(me.sub), ms);
  // Joined: the owner can no longer invite, email or revoke that invitation.
  await assert.rejects(
    invite(person("dani"), "invite-join@example.com", "Joiner"),
    /that person is already a member/,
  );
  await assert.rejects(toEmail(person("dani"), id), /invitation not found/);
  await assert.rejects(
    revokeInvitation(person("dani"), id),
    /invitation not found/,
  );
  await unchanged(after);
});

test("a person invited to two hives joins each one by itself", async () => {
  const other = await otherHive();
  const here = await invite(
    person("dani"),
    "invite-two@example.com",
    "Two here",
  );
  const there = await invite(
    person("outsider"),
    "INVITE-TWO@example.com",
    "Two there",
    other,
  );
  // A third hive that did not invite them.
  const third = await freshHive("third");
  const me = asUser(await addUser("invite-two@example.com"));

  assert.equal(await accept(me, there), other);
  let ms = await membershipsOf(me.sub);
  assert.deepEqual(
    ms.map((m) => [m.hive_id, m.display_name, m.role, m.workspaces]),
    [[other, "Two there", "member", ["Main"]]],
  );
  // The other invitation is still waiting, and still theirs to take.
  assert.deepEqual(
    (await myInvitations(me)).map((r) => r.id),
    [here],
  );
  assert.equal(await accept(me, here), hive);
  ms = await membershipsOf(me.sub);
  assert.deepEqual(
    Object.fromEntries(ms.map((m) => [m.hive_id, m.display_name])),
    { [hive]: "Two here", [other]: "Two there" },
  );
  assert.ok(!ms.some((m) => m.hive_id === third.id));
  assert.deepEqual(await myInvitations(me), []);
});

test("nobody joins without the invited, confirmed email address", async () => {
  const dani = person("dani");
  const proof = await invite(dani, "invite-proof@example.com", "Proof");
  // An account with the invited address that never proved it.
  const unproved = await addUser("invite-proof@example.com", {
    confirmed: false,
  });
  // Other, confirmed people, with addresses close to the invited one.
  const others = [];
  for (const email of [
    "invite-other@example.com",
    "xinvite-proof@example.com",
    "invite-proof@example.com.evil.test",
    "invite-proof@example.co",
    "invite-proo_@example.com",
    "invite-%@example.com",
    " invite-proof@example.com",
  ])
    others.push(await addUser(email));
  // A revoked and an expired invitation, each for a confirmed person.
  const gone = await invite(dani, "invite-gone@example.com", "Gone");
  const goneUser = await addUser("invite-gone@example.com");
  await revokeInvitation(dani, gone);
  const late = await invite(dani, "invite-late@example.com", "Late");
  const lateUser = await addUser("invite-late@example.com");
  await expire(late);

  const before = await inviteState();
  const everyone = [
    unproved,
    ...others,
    goneUser,
    lateUser,
    users.ahmed,
    users.dani,
    users.outsider,
  ];
  for (const id of everyone) {
    for (const inv of [proof, gone, late, null, NO_CLIENT])
      await assert.rejects(
        accept(asUser(id), inv),
        /invitation not found/,
        `${id} accepted ${inv}`,
      );
    assert.deepEqual(await myInvitations(asUser(id)), []);
    await unchanged(before);
  }
  for (const id of [unproved, ...others, goneUser, lateUser])
    assert.deepEqual(await membershipsOf(id), []);

  // Once the address is proved, the same person does join.
  await db.query(
    `update auth.users set email_confirmed_at = now() where id = $1`,
    [unproved],
  );
  assert.equal(await accept(asUser(unproved), proof), hive);
  assert.equal((await membershipsOf(unproved))[0].display_name, "Proof");
});

test("an account with no email address is shown nothing and joins nothing", async () => {
  const id = await invite(person("dani"), "invite-noemail@example.com", "No");
  const before = await inviteState();
  for (const email of [null, ""]) {
    const user = (
      await db.query(
        `insert into auth.users (email, email_confirmed_at)
         values ($1, now()) returning id`,
        [email],
      )
    ).rows[0].id;
    assert.deepEqual(await myInvitations(asUser(user)), []);
    await assert.rejects(accept(asUser(user), id), /invitation not found/);
    assert.deepEqual(await membershipsOf(user), []);
  }
  await unchanged(before);
});

test("an agent, an app or an anonymous caller neither sees nor accepts an invitation", async () => {
  const id = await invite(person("dani"), "invite-agent@example.com", "Agent");
  // The invited person's own agent, were they to have one: the claims an
  // agent identity carries, on the invited person's account.
  const me = asUser(await addUser("invite-agent@example.com"));
  const agent = (tier) => ({
    ...me,
    agent_id: "11111111-1111-4111-8111-111111111111",
    workspace_id: ws.dani,
    trust_tier: tier,
  });
  const before = await inviteState();

  for (const who of [
    agent("vendor"),
    agent("self_hosted"),
    { ...me, trust_tier: "self_hosted" },
    { role: "authenticated" },
    { role: "authenticated", sub: "" },
  ]) {
    await assert.rejects(accept(who, id), /sign in as a person/);
    await assert.rejects(myInvitations(who), /sign in as a person/);
    await unchanged(before);
  }
  // A member's real agent is refused the same way.
  for (const who of [await agentFor("ahmed"), await agentFor("dani")]) {
    await assert.rejects(accept(who, id), /sign in as a person/);
    await assert.rejects(myInvitations(who), /sign in as a person/);
  }
  for (const who of [
    passOf(me),
    { ...me, aud: "some-client" },
    passOf(agent("vendor")),
  ]) {
    await assert.rejects(accept(who, id), PASS_REFUSED);
    await assert.rejects(myInvitations(who), PASS_REFUSED);
    await unchanged(before);
  }
  await assert.rejects(accept(null, id), /permission denied/);
  await assert.rejects(myInvitations(null), /permission denied/);
  await unchanged(before);
  assert.deepEqual(await membershipsOf(me.sub), []);

  // The person themself, signed in: it was theirs all along.
  assert.deepEqual(
    (await myInvitations(me)).map((r) => r.id),
    [id],
  );
  assert.equal(await accept(me, id), hive);
});

test("accepting changes nothing for someone who is already a member", async () => {
  // Invited, then put into the hive another way before accepting.
  const id = await invite(
    person("dani"),
    "invite-already@example.com",
    "Invited name",
  );
  const user = await addUser("invite-already@example.com");
  await addMember(hive, user, "Added name");
  const ms = await membershipsOf(user);
  const audits = (await inviteState()).audits;

  assert.equal(await accept(asUser(user), id), hive);
  assert.deepEqual(await membershipsOf(user), ms);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].display_name, "Added name");
  assert.deepEqual(ms[0].workspaces, ["Main"]);
  assert.equal((await inviteState()).audits, audits);
  const [inv] = await invitationsFor("invite-already@example.com");
  assert.ok(inv.accepted_at);
  assert.equal(inv.accepted_member, ms[0].id);

  // An owner invited to their own hive stays the owner, under their own name.
  const own = await freshHive("own");
  const mark = await inviteState();
  const mine = (
    await db.query(
      `insert into public.invitations (hive_id, email, display_name)
       values ($1, 'invite-own-owner@example.com', 'Demoted') returning id`,
      [own.id],
    )
  ).rows[0].id;
  assert.equal(await accept(own.owner, mine), own.id);
  const owner = await membershipsOf(own.owner.sub);
  assert.equal(owner.length, 1);
  assert.equal(owner[0].role, "owner");
  assert.equal(owner[0].display_name, "Owner");
  assert.deepEqual(owner[0].workspaces, ["Main"]);
  const after = await inviteState();
  assert.equal(after.members, mark.members);
  assert.equal(after.workspaces, mark.workspaces);
  assert.equal(after.audits, mark.audits);
});

test("nothing joins a hive silently: claim_invitations is gone", async () => {
  const left = (
    await db.query(
      `select p.proname from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname = 'claim_invitations'`,
    )
  ).rows;
  assert.deepEqual(left, []);
  const id = await invite(person("dani"), "invite-silent@example.com", "S");
  const me = asUser(await addUser("invite-silent@example.com"));
  await assert.rejects(
    as(me, `select public.claim_invitations()`),
    /does not exist/,
  );
  // Signed in, looked at the hive, looked at the invitation: still not in.
  await as(me, `select * from public.hives`);
  await myInvitations(me);
  assert.deepEqual(await membershipsOf(me.sub), []);
  const [inv] = await invitationsFor("invite-silent@example.com");
  assert.equal(inv.id, id);
  assert.equal(inv.accepted_at, null);
});

// ---------------------------------------------------------- deleting a note
// The notes_delete policy decides who deletes: the note's owner, signed in as
// a person. The notes_deleted_audit trigger records it with the note's id and
// two counts, never its path, title or body.

// As the database owner (no row-level security), with or without a person
// behind the call. `as` leaves the last caller's claims set, so "no person"
// has to clear them.
const asDbOwner = async (claims, sql, params = []) => {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify(claims ?? {}),
  ]);
  return (await db.query(sql, params)).rows;
};
const deleteNote = (who, id) =>
  as(who, `delete from public.notes where id = $1 returning id`, [id]);
const noteExists = async (id) =>
  (await db.query(`select 1 from public.notes where id = $1`, [id])).rows
    .length === 1;
const deletedAudits = async (since) =>
  (await auditSince(since)).filter((r) => r.action === "note.deleted");
const dn = {};

test("a person deletes their own note, with its history, links and tags", async () => {
  dn.mark = await lastAudit();
  dn.note = await addAt(
    person("dani"),
    "dani",
    "zebrafinch/quillon.md",
    "marrowfat title",
    { body: "pumpernickel body" },
  );
  await as(
    person("dani"),
    `update public.notes set body = 'pumpernickel body, second' where id = $1`,
    [dn.note],
  );
  dn.sara = await addAt(person("sara"), "sara", "dn/sara.md", "dn sara");
  dn.ahmed = await addAt(person("ahmed"), "ahmed", "dn/ahmed.md", "dn ahmed");
  // One accepted link out of the note, one proposed link into it.
  dn.out = await propose(person("dani"), dn.note, dn.sara);
  assert.equal(await respond(person("sara"), dn.out, true), "accepted");
  dn.in = await propose(person("ahmed"), dn.ahmed, dn.note);
  const entity = (
    await as(
      person("dani"),
      `insert into public.entities (hive_id, type, canonical_name)
       values ($1, 'client', 'dn client') returning id`,
      [hive],
    )
  )[0].id;
  await as(
    person("dani"),
    `insert into public.note_entities (note_id, entity_id) values ($1, $2)`,
    [dn.note, entity],
  );
  const path = filePath("dani", "dn-attached.pdf");
  await upload(person("dani"), path);
  dn.file = (
    await fileRow(person("dani"), "dani", path, { note: dn.note })
  )[0].id;

  const count = async (sql) => (await db.query(sql, [dn.note])).rows[0].n;
  const versions = `select count(*)::int as n from public.note_versions where note_id = $1`;
  const links = `select count(*)::int as n from public.links where from_note = $1 or to_note = $1`;
  const tags = `select count(*)::int as n from public.note_entities where note_id = $1`;
  assert.ok((await count(versions)) >= 1);
  assert.equal(await count(links), 2);
  assert.equal(await count(tags), 1);

  assert.deepEqual(await deleteNote(person("dani"), dn.note), [
    { id: dn.note },
  ]);

  assert.equal(await noteExists(dn.note), false);
  assert.equal(await count(versions), 0);
  assert.equal(await count(links), 0);
  assert.equal(await count(tags), 0);
  // The file stays, attached to nothing; so do the notes it was linked to.
  assert.deepEqual(
    (
      await db.query(`select id, note_id from public.files where id = $1`, [
        dn.file,
      ])
    ).rows,
    [{ id: dn.file, note_id: null }],
  );
  assert.ok(await noteExists(dn.sara));
  assert.ok(await noteExists(dn.ahmed));
  assert.equal(
    (await db.query(`select 1 from public.entities where id = $1`, [entity]))
      .rows.length,
    1,
  );
});

test("deleting a note leaves one audit row with its id and two counts, no text", async () => {
  const rows = await deletedAudits(dn.mark);
  assert.equal(rows.length, 1);
  dn.audit = rows[0].id;
  assert.deepEqual(rows[0], {
    id: dn.audit,
    hive_id: hive,
    member_id: members.dani,
    agent_id: null,
    action: "note.deleted",
    note_id: dn.note,
    detail: { links: 2, files: 1 },
  });
  // Every column of the row, as text: nothing of the note's path, title or body.
  const whole = (
    await db.query(
      `select to_jsonb(a)::text as t from public.audit_log a where id = $1`,
      [dn.audit],
    )
  ).rows[0].t.toLowerCase();
  for (const word of [
    "zebrafinch",
    "quillon",
    "marrowfat",
    "pumpernickel",
    "dn-attached",
  ])
    assert.ok(!whole.includes(word), `the audit row contains "${word}"`);
});

test("only the note's owner, signed in as a person, deletes it", async () => {
  const note = await addAt(
    person("dani"),
    "dani",
    "dn/guarded.md",
    "dn guarded",
    { visibility: "members", shared_with: [members.ahmed] },
  );
  await as(
    person("dani"),
    `update public.notes set body = 'guarded, second' where id = $1`,
    [note],
  );
  await propose(person("dani"), note, dn.sara);
  const path = filePath("dani", "dn-guarded.pdf");
  await upload(person("dani"), path);
  await fileRow(person("dani"), "dani", path, { note });
  const state = async () =>
    (
      await db.query(
        `select (select to_jsonb(n) from public.notes n where n.id = $1) as note,
                (select count(*)::int from public.note_versions where note_id = $1) as versions,
                (select count(*)::int from public.links
                  where from_note = $1 or to_note = $1) as links,
                (select count(*)::int from public.files where note_id = $1) as files,
                (select count(*)::int from public.notes) as notes,
                (select count(*)::int from public.audit_log) as audits`,
        [note],
      )
    ).rows[0];

  // Ahmed can read the note (it is shared with him) and still cannot delete it.
  assert.ok(await canRead(person("ahmed"), note));
  const refused = [
    ["the owner's agent", await agentFor("dani")],
    ["the owner's self-hosted agent", await agentFor("dani", "self_hosted")],
    ["a member it is shared with", person("ahmed")],
    ["another member", person("sara")],
    ["another member's agent", await agentFor("ahmed")],
    ["another hive's owner", person("outsider")],
    ["nobody", null],
  ];
  // Measured from here: connecting the agents above is not a delete.
  const start = await state();
  assert.ok(start.note);
  assert.ok(start.versions >= 1);
  assert.equal(start.links, 1);
  assert.equal(start.files, 1);
  for (const [label, who] of refused) {
    let rows = [];
    try {
      rows = await deleteNote(who, note);
    } catch (e) {
      assert.match(e.message, /permission denied|row-level security/, label);
    }
    assert.deepEqual(rows, [], label);
    assert.deepEqual(await state(), start, label);
  }
  // A delete with a wide filter takes nothing of anyone else's either.
  for (const who of [person("outsider"), person("ahmed")]) {
    assert.deepEqual(
      await as(
        who,
        `delete from public.notes where member_id = $1 returning id`,
        [members.dani],
      ),
      [],
    );
    assert.deepEqual(await state(), start);
  }

  // The owner still can.
  const mark = await lastAudit();
  assert.deepEqual(await deleteNote(person("dani"), note), [{ id: note }]);
  const rows = await deletedAudits(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].note_id, note);
  assert.equal(rows[0].member_id, members.dani);
  assert.deepEqual(rows[0].detail, { links: 1, files: 1 });
});

test("only the hive owner reads that a note was deleted", async () => {
  const read = (who) =>
    as(
      who,
      `select action, note_id, member_id from public.audit_log where id = $1`,
      [dn.audit],
    );
  assert.deepEqual(await read(person("dani")), [
    { action: "note.deleted", note_id: dn.note, member_id: members.dani },
  ]);
  for (const who of [
    person("ahmed"),
    person("sara"),
    person("outsider"),
    await agentFor("dani"),
    null,
  ])
    assert.deepEqual(await read(who), []);

  // A member's own delete is the owner's to read, not the member's.
  const mark = await lastAudit();
  const note = await addAt(person("sara"), "sara", "dn/own.md", "dn sara own");
  assert.deepEqual(await deleteNote(person("sara"), note), [{ id: note }]);
  const since = (who) =>
    as(
      who,
      `select action, note_id, member_id, detail from public.audit_log
        where id > $1 and action = 'note.deleted'`,
      [mark],
    );
  assert.deepEqual(await since(person("dani")), [
    {
      action: "note.deleted",
      note_id: note,
      member_id: members.sara,
      detail: { links: 0, files: 0 },
    },
  ]);
  assert.deepEqual(await since(person("sara")), []);
});

test("a delete with no person behind it writes no audit row", async () => {
  const note = await addAt(person("dani"), "dani", "dn/service.md", "dn svc");
  const mark = await lastAudit();
  const gone = await asDbOwner(
    null,
    `delete from public.notes where id = $1 returning id`,
    [note],
  );
  assert.deepEqual(gone, [{ id: note }]);
  assert.equal(await noteExists(note), false);
  assert.deepEqual(await auditSince(mark), []);
});

test("deleting a workspace, a member, an account or a hive still works", async () => {
  // A workspace, by its person: its notes go and each one is recorded.
  const space = (
    await as(
      person("dani"),
      `insert into public.workspaces (hive_id, member_id, name)
       values ($1, $2, 'dn scratch') returning id`,
      [hive, members.dani],
    )
  )[0].id;
  const inSpace = async (path, title) =>
    (
      await as(
        person("dani"),
        `insert into public.notes (hive_id, member_id, workspace_id, path, title)
         values ($1, $2, $3, $4, $5) returning id`,
        [hive, members.dani, space, path, title],
      )
    )[0].id;
  const one = await inSpace("dn/one.md", "dn space one");
  const two = await inSpace("dn/two.md", "dn space two");
  await propose(person("dani"), one, dn.sara);
  // No file in it: a workspace that holds files is not deleted through the
  // API (see "a workspace with an agent in use, or with files").
  let mark = await lastAudit();
  assert.deepEqual(
    await as(
      person("dani"),
      `delete from public.workspaces where id = $1 returning id`,
      [space],
    ),
    [{ id: space }],
  );
  assert.equal(await noteExists(one), false);
  assert.equal(await noteExists(two), false);
  let rows = await deletedAudits(mark);
  assert.deepEqual(rows.map((r) => r.note_id).sort(), [one, two].sort());
  for (const r of rows) {
    assert.equal(r.member_id, members.dani);
    assert.equal(r.hive_id, hive);
    assert.deepEqual(Object.keys(r.detail).sort(), ["files", "links"]);
  }
  assert.equal(rows.find((r) => r.note_id === one).detail.links, 1);

  // A member, as the database owner: with nobody signed in, then with a
  // person signed in (the owner, then the member themself).
  const leaver = async (tag) => {
    const email = `dn-${tag}@example.com`;
    const user = await addUser(email);
    await addMember(hive, user, `Leaver ${tag}`);
    const m = (
      await db.query(
        `select m.id as member, w.id as space from public.members m
           join public.workspaces w on w.member_id = m.id
          where m.user_id = $1 and m.hive_id = $2`,
        [user, hive],
      )
    ).rows[0];
    const who = asUser(user);
    const mine = (
      await as(
        who,
        `insert into public.notes (hive_id, member_id, workspace_id, path, title)
         values ($1, $2, $3, 'dn/leaving.md', 'dn leaving') returning id`,
        [hive, m.member, m.space],
      )
    )[0].id;
    await as(
      who,
      `insert into public.links (hive_id, from_note, to_note, tier, score)
       values ($1, $2, $3, 3, 0.5)`,
      [hive, mine, dn.sara],
    );
    return { who, member: m.member, note: mine };
  };
  const removeMember = (claims, id) =>
    asDbOwner(claims, `delete from public.members where id = $1 returning id`, [
      id,
    ]);

  const a = await leaver("a");
  mark = await lastAudit();
  assert.deepEqual(await removeMember(null, a.member), [{ id: a.member }]);
  assert.equal(await noteExists(a.note), false);
  assert.deepEqual(await deletedAudits(mark), []);

  const b = await leaver("b");
  mark = await lastAudit();
  assert.deepEqual(await removeMember(person("dani"), b.member), [
    { id: b.member },
  ]);
  assert.equal(await noteExists(b.note), false);
  rows = await deletedAudits(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].note_id, b.note);
  assert.equal(rows[0].member_id, members.dani);
  assert.deepEqual(rows[0].detail, { links: 1, files: 0 });

  const c = await leaver("c");
  mark = await lastAudit();
  assert.deepEqual(await removeMember(c.who, c.member), [{ id: c.member }]);
  assert.equal(await noteExists(c.note), false);
  rows = await deletedAudits(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].note_id, c.note);
  // Their member row went first, so the row names nobody.
  assert.equal(rows[0].member_id, null);

  // A person's account, which takes their member rows and notes with it.
  const d = await leaver("d");
  mark = await lastAudit();
  await asDbOwner(d.who, `delete from auth.users where id = $1`, [d.who.sub]);
  assert.equal(await noteExists(d.note), false);
  assert.equal((await deletedAudits(mark)).length, 1);

  // A whole hive, as the database owner: with nobody signed in, then with its
  // owner signed in. The audit log goes with the hive, so the trigger must
  // not write a row that points at a hive that is no longer there.
  const doomed = async (tag) => {
    const user = await addUser(`dn-hive-${tag}@example.com`);
    const who = asUser(user);
    const h = (
      await as(who, `select public.create_hive($1, 'Doomed') as id`, [
        `Doomed ${tag}`,
      ])
    )[0].id;
    const m = (
      await db.query(
        `select m.id as member, w.id as space from public.members m
           join public.workspaces w on w.member_id = m.id where m.hive_id = $1`,
        [h],
      )
    ).rows[0];
    const made = [];
    for (const n of ["x", "y", "z"])
      made.push(
        (
          await as(
            who,
            `insert into public.notes (hive_id, member_id, workspace_id, path, title, visibility)
             values ($1, $2, $3, $4, $5, 'group') returning id`,
            [h, m.member, m.space, `dn/${n}.md`, `dn doomed ${n}`],
          )
        )[0].id,
      );
    await as(
      who,
      `insert into public.links (hive_id, from_note, to_note, tier, score)
       values ($1, $2, $3, 3, 0.5)`,
      [h, made[0], made[1]],
    );
    const path = `${m.member}/${m.space}/outputs/dn/${tag}.pdf`;
    await upload(who, path);
    await as(
      who,
      `insert into public.files (hive_id, member_id, workspace_id, note_id, storage_path, name)
       values ($1, $2, $3, $4, $5, 'a file')`,
      [h, m.member, m.space, made[2], path],
    );
    return { who, hive: h };
  };
  const hiveLeft = async (h) =>
    (
      await db.query(
        `select (select count(*)::int from public.hives where id = $1) as hives,
                (select count(*)::int from public.notes where hive_id = $1) as notes,
                (select count(*)::int from public.audit_log where hive_id = $1) as audits`,
        [h],
      )
    ).rows[0];
  for (const tag of ["quiet", "signed-in"]) {
    const gone = await doomed(tag);
    assert.ok((await hiveLeft(gone.hive)).audits > 0);
    mark = await lastAudit();
    assert.deepEqual(
      await asDbOwner(
        tag === "quiet" ? null : gone.who,
        `delete from public.hives where id = $1 returning id`,
        [gone.hive],
      ),
      [{ id: gone.hive }],
    );
    assert.deepEqual(await hiveLeft(gone.hive), {
      hives: 0,
      notes: 0,
      audits: 0,
    });
    assert.deepEqual(await auditSince(mark), []);
  }
  await asDbOwner(null, `select 1`);
});

// ---------------------------------------------------------- connected apps
// Supabase's OAuth server gives a third-party app an access token that is the
// person's own identity plus a `client_id` claim: an "app pass". The database
// refuses it everywhere except connector_login(), which swaps it for the
// limited agent identity the person approved. The app itself is a row the
// sign-in server keeps (auth.oauth_clients); its id is the claim.

// The apps registered in these tests, by a short name.
const apps = {};
const CLAUDE_URI = "https://claude.ai/api/mcp/auth_callback";
const NOBODY = "00000000-0000-0000-0000-000000000000";
const appPass = (name, client = apps.a) => ({
  sub: users[name],
  role: "authenticated",
  client_id: client,
});
const APP_REFUSED = /an app pass cannot do this/;
const NO_APP_AGENT = /no connected agent for this app/;
const UNKNOWN_APP = /unknown app/;
const NOT_APPROVED = /this app is not approved/;

// One statement in a transaction that is always rolled back, so a call that
// would succeed for a person changes nothing. Answers { rows } or { error }.
const trial = async (claims, sql, params = [], role) => {
  await db.exec("reset role");
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claims ?? {}),
    ]);
    await db.exec(
      `set local role ${role ?? (claims ? "authenticated" : "anon")}`,
    );
    return { rows: (await db.query(sql, params)).rows };
  } catch (error) {
    return { error };
  } finally {
    await db.exec("rollback");
  }
};
const connectApp = (who, client, workspace) =>
  as(who, `select public.connect_app($1, $2) as id`, [client, workspace]).then(
    (r) => r[0].id,
  );
// What the approval window does, in its order: the app is connected here,
// then the sign-in server records the person's approval.
const approveApp = async (name, client, workspace) => {
  const id = await connectApp(person(name), client, workspace);
  await addConsent(users[name], client);
  return id;
};
const connectorLogin = (who) =>
  as(who, `select * from public.connector_login()`);
const agentRow = async (id) =>
  (await db.query(`select * from public.agents where id = $1`, [id])).rows[0];
const identityOf = (login) => ({
  sub: login.user_id,
  role: "authenticated",
  agent_id: login.agent_id,
  workspace_id: login.workspace_id,
  trust_tier: login.trust_tier,
});

// A hive of its own (kai owns it, lena is a member, omar is outside), with a
// row in every table, so "sees nothing" is never true by accident.
const ca = {};
let caReady;
const caSetup = () =>
  (caReady ??= (async () => {
    for (const name of ["kai", "lena", "omar"])
      users[name] = await addUser(`${name}@ca.example.com`);
    ca.spareEmail = "spare@ca.example.com";
    await addUser(ca.spareEmail);
    ca.hive = (
      await as(
        person("kai"),
        `select public.create_hive('CA hive', 'Kai') as id`,
      )
    )[0].id;
    await addMember(ca.hive, users.lena, "Lena");
    ca.omarHive = (
      await as(
        person("omar"),
        `select public.create_hive('Omar hive', 'Omar') as id`,
      )
    )[0].id;
    for (const name of ["kai", "lena", "omar"]) {
      const row = (
        await db.query(
          `select m.id as member, w.id as space
             from public.members m join public.workspaces w on w.member_id = m.id
            where m.user_id = $1`,
          [users[name]],
        )
      ).rows[0];
      members[name] = row.member;
      ws[name] = row.space;
    }
    const kai = person("kai");
    await as(
      kai,
      `insert into public.folders (workspace_id, member_id, path, visibility)
       values ($1, $2, 'shared', 'group')`,
      [ws.kai, members.kai],
    );
    const note = (who, name, path, title) =>
      as(
        who,
        `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
         values ($1, $2, $3, $4, $5, 'zeppelin') returning id`,
        [ca.hive, members[name], ws[name], path, title],
      ).then((r) => r[0].id);
    ca.note = await note(kai, "kai", "shared/zeppelin.md", "ca zeppelin");
    ca.lenaNote = await note(person("lena"), "lena", "lena.md", "ca lena");
    ca.link = (
      await as(
        person("lena"),
        `insert into public.links (hive_id, from_note, to_note, tier, score)
         values ($1, $2, $3, 2, 0.5) returning id`,
        [ca.hive, ca.lenaNote, ca.note],
      )
    )[0].id;
    // Two more notes of kai's with a link between them, accepted at once: an
    // accepted link for kai to list and to unlink, and a note that has no
    // link with lena's.
    ca.ownNote = await note(kai, "kai", "own/one.md", "ca own one");
    const ownOther = await note(kai, "kai", "own/two.md", "ca own two");
    ca.ownLink = (
      await as(
        kai,
        `insert into public.links (hive_id, from_note, to_note, tier, score)
         values ($1, $2, $3, 2, 0.5) returning id`,
        [ca.hive, ca.ownNote, ownOther],
      )
    )[0].id;
    ca.filePath = `${members.kai}/${ws.kai}/outputs/ca/a.pdf`;
    await upload(kai, ca.filePath);
    await as(
      kai,
      `insert into public.files (hive_id, member_id, workspace_id, note_id, storage_path, name)
       values ($1, $2, $3, $4, $5, 'a file')`,
      [ca.hive, members.kai, ws.kai, ca.note, ca.filePath],
    );
    const made = (
      await as(
        kai,
        `select * from public.create_agent($1, 'Token agent', 'other')`,
        [ws.kai],
      )
    )[0];
    ca.tokenAgent = made.agent_id;
    ca.token = made.token;
    await as(
      kai,
      `select public.invite_member($1, 'pending@ca.example.com', 'Pending')`,
      [ca.hive],
    );
    ca.invitation = (
      await db.query(`select id from public.invitations where hive_id = $1`, [
        ca.hive,
      ])
    ).rows[0].id;
    // One waiting for kai, so that as a person kai has something to see and
    // to accept.
    ca.kaiInvitation = (
      await as(
        person("omar"),
        `select public.invite_member($1, 'kai@ca.example.com', 'Kai') as id`,
        [ca.omarHive],
      )
    )[0].id;
    // No person writes these four tables yet; the rows are put there directly.
    await db.exec("reset role");
    const entity = (
      await db.query(
        `insert into public.entities (hive_id, type, canonical_name)
         values ($1, 'client', 'Zeppelin Ltd') returning id`,
        [ca.hive],
      )
    ).rows[0].id;
    await db.query(
      `insert into public.note_entities (note_id, entity_id) values ($1, $2)`,
      [ca.note, entity],
    );
    await db.query(
      `insert into public.synthesis_pages (entity_id, hive_id) values ($1, $2)`,
      [entity, ca.hive],
    );
    await db.query(
      `insert into public.notifications (hive_id, member_id, kind) values ($1, $2, 'test')`,
      [ca.hive, members.kai],
    );
    ca.noteRow = (
      await db.query(
        `select to_jsonb(n) - 'search' as j from public.notes n where id = $1`,
        [ca.note],
      )
    ).rows[0].j;
    // The app pass used below is a real one: its client is connected.
    apps.a = await addClient("Claude", CLAUDE_URI);
    ca.appAgent = await approveApp("kai", apps.a, ws.kai);
  })());

test("an app pass reads and writes nothing", async () => {
  await caSetup();
  const kai = person("kai");
  const pass = appPass("kai");
  const tables = (
    await db.query(
      `select schemaname as s, tablename as t, rowsecurity
         from pg_tables
        where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')
        order by 1, 2`,
    )
  ).rows;
  // Every table that exists today has a row the person can see (caSetup).
  const seeded = [
    "agents",
    "audit_log",
    "entities",
    "files",
    "folders",
    "hives",
    "invitations",
    "links",
    "members",
    "note_entities",
    "note_versions",
    "notes",
    "notifications",
    "objects",
    "synthesis_pages",
    "workspaces",
  ];
  assert.deepEqual(
    seeded.filter((t) => !tables.some((x) => x.t === t)),
    [],
  );
  const count = async (who, name) => {
    const r = await trial(who, `select count(*)::int as n from ${name}`);
    assert.equal(r.error, undefined, `${name}: ${r.error?.message}`);
    return r.rows[0].n;
  };
  const nothing = (r, what) =>
    assert.ok(r.error || r.rows.length === 0, `an app pass could ${what}`);

  // The server's own tables: no API role has any right on them, so there is
  // no policy to look for. Every statement fails for the person, the pass
  // and a visitor alike, before row-level security is asked.
  const serverOnly = {
    deleted_hives: "name",
    sync_manifest: "path",
    sync_orphans: "storage_path",
  };
  for (const { s, t, rowsecurity } of tables) {
    const name = `${s}.${t}`;
    // The rule itself: a restrictive policy for every command, so a table
    // added later without one fails here.
    assert.equal(rowsecurity, true, `${name} has no row-level security`);
    if (s === "public" && t in serverOnly) {
      for (const who of [kai, pass, null])
        for (const sql of [
          `select count(*) from ${name}`,
          `update ${name} set ${serverOnly[t]} = ${serverOnly[t]} returning 1`,
          `delete from ${name} returning 1`,
          `insert into ${name} default values returning 1`,
        ]) {
          const r = await trial(who, sql);
          assert.match(
            r.error?.message ?? "(answered)",
            /permission denied/,
            `${sql} as ${who ? "a signed-in caller" : "a visitor"}`,
          );
        }
      continue;
    }
    const policy = (
      await db.query(
        `select permissive, cmd, roles::text[] as roles, qual, with_check
           from pg_policies
          where schemaname = $1 and tablename = $2 and policyname = $3`,
        [s, t, `${t}_no_app`],
      )
    ).rows[0];
    assert.ok(policy, `${name} has no ${t}_no_app policy`);
    assert.equal(policy.permissive, "RESTRICTIVE", name);
    assert.equal(policy.cmd, "ALL", name);
    assert.deepEqual(policy.roles, ["authenticated"], name);
    assert.match(policy.qual, /jwt_oauth_client\(\) IS NULL/, name);
    assert.match(policy.with_check, /jwt_oauth_client\(\) IS NULL/, name);

    if (seeded.includes(t))
      assert.ok((await count(kai, name)) > 0, `${name}: nothing to hide`);
    assert.equal(await count(pass, name), 0, `an app pass read ${name}`);

    const column = (
      await db.query(
        `select column_name as c from information_schema.columns
          where table_schema = $1 and table_name = $2 order by ordinal_position limit 1`,
        [s, t],
      )
    ).rows[0].c;
    nothing(
      await trial(pass, `update ${name} set ${column} = ${column} returning 1`),
      `update ${name}`,
    );
    nothing(
      await trial(pass, `delete from ${name} returning 1`),
      `delete from ${name}`,
    );
    nothing(
      await trial(pass, `insert into ${name} default values returning 1`),
      `insert into ${name}`,
    );
  }

  // The same statement works for the person and is refused for the pass.
  const writes = [
    [
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'pass.md', 'by a pass') returning id`,
      [ca.hive, members.kai, ws.kai],
    ],
    [
      `insert into public.folders (workspace_id, member_id, path) values ($1, $2, 'pass') returning id`,
      [ws.kai, members.kai],
    ],
    [
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'Pass') returning id`,
      [ca.hive, members.kai],
    ],
    [
      `insert into public.links (hive_id, from_note, to_note, tier, score)
       values ($1, $2, $3, 2, 0.5) returning id`,
      [ca.hive, ca.ownNote, ca.lenaNote],
    ],
    [
      `insert into public.files (hive_id, member_id, workspace_id, storage_path, name)
       values ($1, $2, $3, $4, 'f') returning id`,
      [ca.hive, members.kai, ws.kai, `${members.kai}/${ws.kai}/outputs/p.pdf`],
    ],
    [
      `insert into storage.objects (bucket_id, name) values ('files', $1) returning id`,
      [`${members.kai}/${ws.kai}/outputs/p.pdf`],
    ],
    [
      `update public.notes set body = 'changed', visibility = 'group' where id = $1 returning id`,
      [ca.note],
    ],
    [
      `update public.members set display_name = 'Renamed' where id = $1 returning id`,
      [members.kai],
    ],
    [
      `update public.folders set visibility = 'private'
        where workspace_id = $1 and path = 'shared' returning id`,
      [ws.kai],
    ],
    [`delete from public.notes where id = $1 returning id`, [ca.note]],
    [`delete from storage.objects where name = $1 returning id`, [ca.filePath]],
  ];
  for (const [sql, params] of writes) {
    const mine = await trial(kai, sql, params);
    assert.equal(mine.error, undefined, `${sql}: ${mine.error?.message}`);
    assert.equal(mine.rows.length, 1, sql);
    nothing(await trial(pass, sql, params), sql);
  }
  // A pass for a client nobody connected is refused just the same.
  assert.equal(await count(appPass("kai", NOBODY), "public.notes"), 0);
});

test("every function refuses an app pass except connector_login", async () => {
  await caSetup();
  const kai = person("kai");
  const pass = appPass("kai");
  const listed = (
    await db.query(
      `select p.proname as name, p.prosecdef as definer, p.prosrc as src,
              p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prokind = 'f'
          and p.prorettype <> 'trigger'::regtype
          and has_function_privilege('authenticated', p.oid, 'execute')
        order by 1`,
    )
  ).rows;
  const names = listed.map((f) => f.name);
  assert.deepEqual(names, [...new Set(names)], "an overloaded function");

  // Read no table: they answer from the caller's own claims or argument.
  const pure = [
    "jwt_agent_id", // the caller's own agent_id claim
    "jwt_is_self_hosted", // the caller's own trust_tier claim
    "jwt_oauth_client", // the caller's own client_id and aud claims
    "jwt_has_sync_claim", // the caller's own sync_key_id claim
    "note_topic", // cuts a path given as the argument
    "_sync_path_ok", // checks a path given as the argument
    "_sync_date", // reads a date given as the argument
    "file_kind", // a name and a type given as arguments
  ];
  // Signs in by the token in its argument, for anyone, as it does for anon:
  // the caller's identity plays no part, so a pass gains nothing from it.
  const byToken = ["agent_login", "sync_login"];
  // Answers only for the sync's own claims: null for a person and for a pass.
  const bySyncClaim = ["jwt_sync_key"];
  // Refused to a pass in their own words: only a person makes or revokes a key.
  const forSyncKeys = ["create_sync_key", "revoke_sync_key"];
  // Refused to anyone but the sync's own identity: a person and a pass both get
  // "this sync key is not live".
  const forSync = [
    "sync_open_run",
    "sync_plan",
    "sync_put_notes",
    "sync_link_notes",
  ];
  // The one function made for an app pass.
  const forApps = ["connector_login"];

  // Everything else: [sql, params, raises]. With `raises` the call must fail
  // with the app-pass refusal. Without it the first value must be empty (no
  // row, null or false) for the pass, while the same call gives the person a
  // real answer.
  const row = JSON.stringify(ca.noteRow);
  const asRow = `jsonb_populate_record(null::public.notes, $1::jsonb)`;
  const closingHive = (
    await as(kai, `select public.create_hive('CA closing', 'Kai') as id`)
  )[0].id;
  await as(kai, `select public.request_hive_deletion($1, 'CA closing')`, [
    closingHive,
  ]);
  // Two upload sessions of kai's: one to retitle, one to end.
  const uploadSessions = [];
  for (let i = 0; i < 2; i++)
    uploadSessions.push(
      (
        await as(kai, `select public.upload_session_open($1) as id`, [ws.kai])
      )[0].id,
    );
  const syncKey = (
    await as(kai, `select * from public.create_sync_key($1)`, [ws.kai])
  )[0];
  const calls = {
    my_member_ids: [`select id from public.my_member_ids() as id`],
    my_hive_ids: [`select id from public.my_hive_ids() as id`],
    is_hive_owner: [`select public.is_hive_owner($1)`, [ca.hive]],
    agent_write_ok: [`select public.agent_write_ok($1)`, [ws.kai]],
    can_read_note: [`select public.can_read_note(${asRow})`, [row]],
    note_rule_folder: [`select public.note_rule_folder(${asRow})`, [row]],
    note_access: [`select public.note_access(${asRow})`, [row]],
    owns_file_path: [`select public.owns_file_path($1)`, [ca.filePath]],
    can_write_file: [`select public.can_write_file($1)`, [ca.filePath]],
    can_read_file: [`select public.can_read_file($1)`, [ca.filePath]],
    search_notes: [`select id from public.search_notes('zeppelin')`],
    note_visibility: [`select public.note_visibility(${asRow})`, [row], true],
    note_shared_with: [`select public.note_shared_with(${asRow})`, [row], true],
    map_graph: [`select public.map_graph($1)`, [ca.hive], true],
    inbox: [`select public.inbox($1)`, [ca.hive], true],
    inbox_count: [`select public.inbox_count($1)`, [ca.hive], true],
    folder_share_preview: [
      `select public.folder_share_preview($1, 'shared')`,
      [ws.kai],
      true,
    ],
    create_hive: [`select public.create_hive('By a pass', 'Kai')`, [], true],
    invite_member: [
      `select public.invite_member($1, 'new@ca.example.com', 'New')`,
      [ca.hive],
      true,
    ],
    revoke_invitation: [
      `select public.revoke_invitation($1)`,
      [ca.invitation],
      true,
    ],
    invitation_to_email: [
      `select public.invitation_to_email($1)`,
      [ca.invitation],
      true,
    ],
    my_invitations: [`select id from public.my_invitations()`, [], true],
    accept_invitation: [
      `select public.accept_invitation($1)`,
      [ca.kaiInvitation],
      true,
    ],
    create_agent: [
      `select * from public.create_agent($1, 'By a pass', 'other')`,
      [ws.kai],
      true,
    ],
    revoke_agent: [`select public.revoke_agent($1)`, [ca.tokenAgent], true],
    respond_to_link: [
      `select public.respond_to_link($1, true)`,
      [ca.link],
      true,
    ],
    unlink: [`select public.unlink($1)`, [ca.ownLink], true],
    note_links: [`select id from public.note_links($1)`, [ca.ownNote]],
    vault_index: [`select id from public.vault_index($1)`, [ws.kai]],
    connect_app: [`select public.connect_app($1, $2)`, [apps.a, ws.kai], true],
    can_delete_file: [`select public.can_delete_file($1)`, [ca.filePath]],
    hive_deletion_preview: [
      `select * from public.hive_deletion_preview($1)`,
      [ca.hive],
      true,
    ],
    request_hive_deletion: [
      `select public.request_hive_deletion($1, 'CA hive')`,
      [ca.hive],
      true,
    ],
    upload_session_open: [
      `select public.upload_session_open($1)`,
      [ws.kai],
      true,
    ],
    upload_session_end: [
      `select public.upload_session_end($1, $2)`,
      [uploadSessions[0], ca.ownNote],
      true,
    ],
    session_retitle: [
      `select public.session_retitle($1, 'Retitled')`,
      [uploadSessions[1]],
      true,
    ],
    // Cancelling needs a hive that is being deleted: one of kai's own, made
    // for this and taken away again at the end of the test.
    cancel_hive_deletion: [
      `select public.cancel_hive_deletion($1)`,
      [closingHive],
      true,
    ],
  };

  // Made for an agent: a person is refused for another reason, so the proof
  // for an app pass is its own check below.
  const forAgents = ["session_end"];
  // Made for a person: an app pass is refused before any file is looked up.
  const forPeople = ["file_set_home"];

  const known = [
    ...pure,
    ...byToken,
    ...bySyncClaim,
    ...forSyncKeys,
    ...forSync,
    ...forApps,
    ...forAgents,
    ...forPeople,
    ...Object.keys(calls),
  ];
  // A function added later must be put in one of the groups above, and the
  // only group that asks for no proof is `pure`, which is checked to touch
  // no table.
  assert.deepEqual(
    names.filter((n) => !known.includes(n)),
    [],
    "a function authenticated may execute is not covered here",
  );
  assert.deepEqual(
    known.filter((n) => !names.includes(n)),
    [],
    "listed here but not executable by authenticated",
  );
  // The functions of this migration, so none is missing from the list by a
  // grant it should have had. oauth_client_tier is the database's own.
  for (const name of ["connect_app", "connector_login", "jwt_oauth_client"])
    assert.ok(names.includes(name), name);
  assert.ok(!names.includes("oauth_client_tier"));
  // The functions of the emailed-invitations migration, and the two it took
  // away from people.
  for (const name of [
    "invite_member",
    "invitation_to_email",
    "my_invitations",
    "accept_invitation",
  ])
    assert.ok(names.includes(name), name);
  for (const name of ["add_member", "claim_invitations"])
    assert.ok(!names.includes(name), name);
  for (const f of listed.filter((x) => pure.includes(x.name))) {
    assert.equal(f.definer, false, `${f.name} is security definer`);
    // With an empty search_path every table must be named with its schema.
    assert.ok(f.config?.includes('search_path=""'), `${f.name}: search_path`);
    assert.doesNotMatch(
      f.src,
      /\b(public|storage|auth)\.(?!jwt\(\))/,
      `${f.name} reads something`,
    );
  }

  const first = (r) => (r.rows.length ? Object.values(r.rows[0])[0] : null);
  for (const [name, [sql, params = [], raises = false]] of Object.entries(
    calls,
  )) {
    const mine = await trial(kai, sql, params);
    assert.equal(mine.error, undefined, `${name}: ${mine.error?.message}`);
    const theirs = await trial(pass, sql, params);
    if (raises) {
      assert.match(theirs.error?.message ?? "(no error)", APP_REFUSED, name);
      continue;
    }
    assert.ok(![null, false].includes(first(mine)), `${name}: nothing to hide`);
    assert.ok(
      theirs.error || [null, false].includes(first(theirs)),
      `${name} answered an app pass`,
    );
  }

  const homed = await trial(
    pass,
    `select public.file_set_home(gen_random_uuid(), null)`,
  );
  assert.match(homed.error?.message ?? "(no error)", APP_REFUSED);

  const ended = await trial(pass, `select public.session_end('t', 's')`);
  assert.match(
    ended.error?.message ?? "(no error)",
    APP_REFUSED,
    "session_end",
  );

  // agent_login: a pass that holds no token gets what anyone gets.
  const guess = await trial(pass, `select * from public.agent_login('hive_x')`);
  assert.match(guess.error?.message ?? "", /unknown, expired or revoked/);
  for (const [sql, params] of [
    [`select * from public.create_sync_key($1)`, [ws.kai]],
    [`select public.revoke_sync_key($1)`, [syncKey.key_id]],
  ]) {
    assert.equal((await trial(kai, sql, params)).error, undefined, sql);
    assert.match(
      (await trial(pass, sql, params)).error?.message ?? "(no error)",
      /only a person (makes|revokes) a sync key/,
      sql,
    );
  }
  for (const [sql, params] of [
    [`select public.sync_open_run(false)`, []],
    [`select public.sync_plan(gen_random_uuid(), '[]', true)`, []],
    [`select public.sync_put_notes(gen_random_uuid(), '[]')`, []],
    [`select public.sync_link_notes(gen_random_uuid(), '[]')`, []],
  ])
    for (const who of [kai, pass])
      assert.match(
        (await trial(who, sql, params)).error?.message ?? "(no error)",
        /this sync key is not live/,
        sql,
      );
  // sync_login likewise: the pass has no sync key, so it gets what anyone gets.
  const syncGuess = await trial(
    pass,
    `select * from public.sync_login('hsync_x')`,
  );
  assert.match(syncGuess.error?.message ?? "", /unknown or revoked sync key/);
  for (const who of [kai, pass])
    assert.equal(
      (await trial(who, `select public.jwt_sync_key() as k`)).rows[0].k,
      null,
    );
  // connector_login is the exception: it answers the pass.
  const login = await trial(pass, `select * from public.connector_login()`);
  assert.equal(login.error, undefined, login.error?.message);
  assert.equal(login.rows.length, 1);
  await asDbOwner(null, `delete from public.hives where id = $1`, [
    closingHive,
  ]);
  await asDbOwner(
    null,
    `delete from public.agents where id = (select agent_id from public.sync_keys where id = $1)`,
    [syncKey.key_id],
  );
});

test("a person connects an app to their own workspace", async () => {
  await caSetup();
  const kai = person("kai");
  const mark = await lastAudit();
  const client = await addClient(
    "ChatGPT",
    "https://chatgpt.com/connector_platform_oauth_redirect",
  );
  const id = await connectApp(kai, client, ws.kai);
  const made = await agentRow(id);
  assert.equal(made.oauth_client_id, client);
  assert.equal(made.token_hash, null);
  assert.equal(made.provider, "Connected app");
  assert.equal(made.name, "ChatGPT");
  assert.equal(made.member_id, members.kai);
  assert.equal(made.workspace_id, ws.kai);
  assert.equal(made.trust_tier, "vendor");
  assert.equal(made.revoked_at, null);
  assert.equal(made.expires_at, null);

  const audit = await auditSince(mark);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "agent.connected");
  assert.equal(audit[0].hive_id, ca.hive);
  assert.equal(audit[0].member_id, members.kai);
  assert.deepEqual(audit[0].detail, {
    agent: id,
    client_id: client,
    workspace: ws.kai,
    trust_tier: "vendor",
  });

  // The client id is stored the one way the database writes a uuid, however
  // the caller spelled it, so a pass's claim finds it.
  assert.equal(await connectApp(kai, client.toUpperCase(), ws.kai), id);
  assert.equal((await agentRow(id)).oauth_client_id, client);

  // An agent has exactly one of a token and a client.
  await db.exec("reset role");
  await assert.rejects(
    db.query(`update public.agents set token_hash = 'x' where id = $1`, [id]),
  );
  await assert.rejects(
    db.query(`update public.agents set oauth_client_id = null where id = $1`, [
      id,
    ]),
  );
  await assert.rejects(
    db.query(`update public.agents set oauth_client_id = 'c' where id = $1`, [
      ca.tokenAgent,
    ]),
  );
});

test("only the person reads which app an agent of theirs stands for", async () => {
  await caSetup();
  const kai = person("kai");
  const mine = `select name, provider, oauth_client_id from public.agents where id = $1`;
  assert.deepEqual(await as(kai, mine, [ca.appAgent]), [
    { name: "Claude", provider: "Connected app", oauth_client_id: apps.a },
  ]);
  // An agent with a token has none.
  assert.deepEqual(
    await as(kai, `select oauth_client_id from public.agents where id = $1`, [
      ca.tokenAgent,
    ]),
    [{ oauth_client_id: null }],
  );
  // A colleague in the hive, someone outside it, an app pass: no row.
  for (const who of [person("lena"), person("omar"), appPass("kai")])
    assert.deepEqual(await as(who, mine, [ca.appAgent]), []);
  assert.deepEqual(
    await as(
      person("lena"),
      `select id from public.agents where oauth_client_id = $1`,
      [apps.a],
    ),
    [],
  );
  await assert.rejects(
    as(null, `select oauth_client_id from public.agents`),
    /permission denied/,
  );
  // The token hash stays unreadable, and the column cannot be written.
  await assert.rejects(
    as(kai, `select token_hash from public.agents`),
    /permission denied/,
  );
  await assert.rejects(
    as(kai, `update public.agents set oauth_client_id = null where id = $1`, [
      ca.appAgent,
    ]),
    /permission denied/,
  );
});

test("only a person connects an app, and only to their own workspace", async () => {
  await caSetup();
  const agents = async () =>
    (await db.query(`select count(*)::int as n from public.agents`)).rows[0].n;
  const tokenAgent = identityOf(
    (await as(null, `select * from public.agent_login($1)`, [ca.token]))[0],
  );
  const appAgent = identityOf((await connectorLogin(appPass("kai")))[0]);
  const client = await addClient("App", CLAUDE_URI);
  const before = await agents();
  for (const who of [
    tokenAgent,
    appAgent,
    { ...person("kai"), trust_tier: "self_hosted" },
  ])
    await assert.rejects(
      connectApp(who, client, ws.kai),
      /only a person can connect an app/,
    );
  await assert.rejects(connectApp(appPass("kai"), client, ws.kai), APP_REFUSED);
  await assert.rejects(connectApp(null, client, ws.kai), /permission denied/);
  // Someone else's workspace: a colleague's, another hive's, one that is not there.
  for (const who of ["lena", "omar"])
    await assert.rejects(
      connectApp(person(who), client, ws.kai),
      /that workspace is not yours/,
    );
  await assert.rejects(
    connectApp(person("kai"), client, NOBODY),
    /that workspace is not yours/,
  );
  await assert.rejects(
    connectApp(person("kai"), client, null),
    /that workspace is not yours/,
  );
  // The app is one the sign-in server knows: an id that is not a uuid, one
  // nobody registered and one that was deleted are all refused.
  const deleted = await addClient("Gone", CLAUDE_URI, { deleted: true });
  for (const unknown of [
    "",
    null,
    "client-a",
    "Claude",
    `${client}x`,
    ` ${client}`,
    `${client}' or '1'='1`,
    "c".repeat(201),
    NOBODY,
    deleted,
  ])
    await assert.rejects(
      connectApp(person("kai"), unknown, ws.kai),
      UNKNOWN_APP,
      String(unknown),
    );
  assert.equal(await agents(), before);
});

test("an app is a vendor only when every address it registered is a known one", async () => {
  await caSetup();
  const tierOf = async (uris, options) => {
    const id = await addClient("App", uris, options);
    return (await db.query(`select public.oauth_client_tier($1) as tier`, [id]))
      .rows[0].tier;
  };
  const vendor = [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.ai",
    "https://claude.com/cb?x=1",
    "https://x.claude.ai/cb",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://auth.openai.com/cb",
    "HTTPS://CLAUDE.AI/cb",
    "https://A.B.ChatGPT.com/cb",
    "https://claude.ai:443/cb",
    // Several addresses: separated by commas, by spaces or lines, or a JSON array.
    "https://claude.ai/cb,https://claude.com/cb",
    "https://claude.ai/cb, https://chatgpt.com/cb",
    "https://claude.ai/cb https://auth.openai.com/cb",
    "https://claude.ai/cb\nhttps://x.chatgpt.com/cb\n",
    '["https://claude.ai/cb"]',
    '["https://claude.ai/cb","https://chatgpt.com/cb"]',
    ' [ "https://a.b.openai.com/cb?x=1" ,\n "https://claude.com/cb" ] ',
    // White space around the list, a vertical tab included, is not part of it.
    "\u000B\f https://claude.ai/cb \t\u000B",
  ];
  const selfHosted = [
    // One address that is not known, among known ones.
    "https://claude.ai/cb,https://evil.example/cb",
    "https://evil.example/cb,https://claude.ai/cb",
    "https://claude.ai/cb https://evil.example/cb",
    '["https://claude.ai/cb","https://evil.example/cb"]',
    "https://claude.ai/cb,http://localhost:6274/oauth/callback",
    // A letter before the scheme is not white space: an earlier version
    // trimmed "v" as if it were a vertical tab and read these as https.
    "vhttps://claude.ai/x",
    "vvhttps://claude.ai/x",
    "Vhttps://claude.ai/x",
    "vhttps://claude.ai/xv",
    "https://claude.ai/cb,vhttps://chatgpt.com/cb",
    'v["https://claude.ai/cb"]',
    // Not https.
    "http://claude.ai/cb",
    "evilapp://claude.ai/cb",
    "claude.ai/cb",
    "//claude.ai/cb",
    '["http://claude.ai/cb"]',
    '["https://claude.ai/cb","evilapp://claude.ai/cb"]',
    // No address at all.
    "",
    null,
    "   ",
    ",",
    "[]",
    // A host that only looks like a known one.
    "https://evil-claude.ai/cb",
    "https://claude.ai.evil.com/cb",
    "https://notopenai.com/cb",
    "https://claude.ai./cb",
    "https://evil.com/.claude.ai",
    "https://evil.com?x=.claude.ai",
    "https://evil.com#.claude.ai",
    "https://evil.com:443/x.claude.ai",
    "https://localhost/cb",
    // User info, or anything else between the host and the path.
    "https://user@claude.ai/cb",
    "https://user:pw@claude.ai/cb",
    "https://claude.ai@evil.com/cb",
    "https://claude.ai:443@evil.com/cb",
    "https://claude.ai\\@evil.com/cb",
    "https://claude.ai%2f@evil.com/cb",
    "https://claude.ai:99999999/cb",
    "https://claude.ai:/cb",
    "https:///claude.ai/cb",
    "https://%63laude.ai/cb",
    // Not a list of addresses.
    '["https://claude.ai/cb", 7]',
    '["https://claude.ai/cb", null]',
    '[["https://claude.ai/cb"]]',
    '["https://claude.ai/cb"',
    '{"a":"https://claude.ai/cb"}',
    '"https://claude.ai/cb"',
    "{https://claude.ai/cb}",
    '["https://claude.ai/cb https://evil.example/cb"]',
    '["https://claude.ai/cb\\nx"]',
  ];
  for (const uris of vendor)
    assert.equal(await tierOf(uris), "vendor", String(uris));
  for (const uris of selfHosted)
    assert.equal(await tierOf(uris), "self_hosted", String(uris));
  // A deleted client and one nobody registered.
  assert.equal(await tierOf(CLAUDE_URI, { deleted: true }), "self_hosted");
  for (const id of [NOBODY, null])
    assert.equal(
      (await db.query(`select public.oauth_client_tier($1) as tier`, [id]))
        .rows[0].tier,
      "self_hosted",
    );

  // Nobody asks for a tier through the API: the database works it out itself.
  const fn = (
    await db.query(
      `select p.oid, p.prosecdef, p.proconfig from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = 'oauth_client_tier'`,
    )
  ).rows;
  assert.equal(fn.length, 1);
  assert.equal(fn[0].prosecdef, true);
  assert.ok(fn[0].proconfig.includes('search_path=""'));
  for (const role of ["authenticated", "anon", "public"])
    assert.equal(
      (
        await db.query(
          `select has_function_privilege($1, $2::oid, 'execute') as can`,
          [role, fn[0].oid],
        )
      ).rows[0].can,
      false,
      role,
    );
  for (const who of [person("kai"), appPass("kai"), null])
    await assert.rejects(
      as(who, `select public.oauth_client_tier($1)`, [apps.a]),
      /permission denied/,
    );
  // Nor are the sign-in server's own tables readable.
  for (const table of ["auth.oauth_clients", "auth.oauth_consents"])
    await assert.rejects(
      as(person("kai"), `select * from ${table}`),
      /permission denied/,
    );
});

test("the trust tier follows the app's registration on every call", async () => {
  await caSetup();
  const kai = person("kai");
  const setUris = (client, uris) =>
    db.query(`update auth.oauth_clients set redirect_uris = $2 where id = $1`, [
      client,
      uris,
    ]);
  const tierAtLogin = async (client) =>
    (await connectorLogin(appPass("kai", client)))[0].trust_tier;

  // Registered with a known address and one that is not: held for review,
  // whichever of the two the approval came back through.
  const mixed = await addClient(
    "Mixed",
    `${CLAUDE_URI},https://attacker.example/cb`,
  );
  const mixedAgent = await approveApp("kai", mixed, ws.kai);
  assert.equal((await agentRow(mixedAgent)).trust_tier, "self_hosted");
  assert.equal(await tierAtLogin(mixed), "self_hosted");

  // Approved while every address was known, then the registration changed:
  // the next call is held, and Settings shows it.
  const client = await addClient("Claude", CLAUDE_URI);
  const id = await approveApp("kai", client, ws.kai);
  assert.equal((await agentRow(id)).trust_tier, "vendor");
  assert.equal(await tierAtLogin(client), "vendor");
  await setUris(client, `${CLAUDE_URI},https://attacker.example/cb`);
  assert.equal(await tierAtLogin(client), "self_hosted");
  assert.equal((await agentRow(id)).trust_tier, "self_hosted");
  // A stored tier is never the source: written back by hand, it changes nothing.
  await db.query(
    `update public.agents set trust_tier = 'vendor' where id = $1`,
    [id],
  );
  assert.equal(await tierAtLogin(client), "self_hosted");
  assert.equal((await agentRow(id)).trust_tier, "self_hosted");
  // What the registration says now is what counts, in both directions.
  await setUris(client, `["${CLAUDE_URI}"]`);
  assert.equal(await tierAtLogin(client), "vendor");
  assert.equal((await agentRow(id)).trust_tier, "vendor");
  await setUris(client, "https://attacker.example/cb");
  assert.equal(await connectApp(kai, client, ws.kai), id);
  assert.equal((await agentRow(id)).trust_tier, "self_hosted");
});

test("an app's name is the one it registered, cleaned", async () => {
  await caSetup();
  const nameFor = async (registered) =>
    (
      await agentRow(
        await connectApp(
          person("lena"),
          await addClient(registered, CLAUDE_URI),
          ws.lena,
        ),
      )
    ).name;
  assert.equal(await nameFor("Claude"), "Claude");
  assert.equal(await nameFor("  Claude \n"), "Claude");
  assert.equal(await nameFor("Zoë's 助手 app"), "Zoë's 助手 app");
  // Control characters become a space; the marks that reorder or hide text
  // are dropped.
  assert.equal(await nameFor("Claude\r\n(verified)"), "Claude (verified)");
  assert.equal(await nameFor("Cl\tau\u0007d\u0085e"), "Cl au d e");
  assert.equal(await nameFor("a b c"), "a b c");
  assert.equal(await nameFor("‮edualc‬ ⁦x⁩‏‎؜"), "edualc x");
  assert.equal(await nameFor("Cla​u‍de﻿­⁠"), "Claude");
  assert.equal(await nameFor("Claude\u{E0041}\u{E007F}"), "Claude");
  // Only white space is trimmed: a name keeps a "v" at either end.
  for (const name of ["vivid dev", "Viv", "v", "vv", "v v", "Vera's MCP v"])
    assert.equal(await nameFor(name), name);
  assert.equal(await nameFor("\u000B valve \u000B"), "valve");
  assert.equal(await nameFor(`${"v".repeat(130)}`), "v".repeat(120));
  // Cut to 120 characters; never empty.
  assert.equal(await nameFor("x".repeat(500)), "x".repeat(120));
  assert.equal(await nameFor(`${"x".repeat(119)} y`), "x".repeat(119));
  for (const empty of ["", null, "   ", "​‮", "\n\t"])
    assert.equal(await nameFor(empty), "Connected app", JSON.stringify(empty));
});

test("connecting the same app again updates it and reconnects a revoked one", async () => {
  await caSetup();
  const kai = person("kai");
  const second = (
    await as(
      kai,
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'Second') returning id`,
      [ca.hive, members.kai],
    )
  )[0].id;
  const client = await addClient("First", CLAUDE_URI);
  const id = await approveApp("kai", client, ws.kai);
  await as(kai, `select public.revoke_agent($1)`, [id]);
  assert.notEqual((await agentRow(id)).revoked_at, null);
  await assert.rejects(connectorLogin(appPass("kai", client)), NO_APP_AGENT);

  await db.query(
    `update auth.oauth_clients set client_name = 'Second' where id = $1`,
    [client],
  );
  const mark = await lastAudit();
  assert.equal(await connectApp(kai, client, second), id);
  const again = await agentRow(id);
  assert.equal(again.name, "Second");
  assert.equal(again.workspace_id, second);
  assert.equal(again.revoked_at, null);
  assert.equal(again.trust_tier, "vendor");
  assert.deepEqual(
    (await auditSince(mark)).map((r) => r.action),
    ["agent.connected"],
  );
  assert.equal(
    (await connectorLogin(appPass("kai", client)))[0].workspace_id,
    second,
  );
  assert.equal(
    (
      await db.query(
        `select count(*)::int as n from public.agents where oauth_client_id = $1`,
        [client],
      )
    ).rows[0].n,
    1,
  );
});

test("connector_login gives an app pass its own agent and nobody else's", async () => {
  await caSetup();
  const lenaAgent = await approveApp("lena", apps.a, ws.lena);
  await db.query(`update public.agents set last_used_at = null where id = $1`, [
    ca.appAgent,
  ]);
  const mine = await connectorLogin(appPass("kai"));
  assert.deepEqual(mine, [
    {
      agent_id: ca.appAgent,
      user_id: users.kai,
      member_id: members.kai,
      workspace_id: ws.kai,
      hive_id: ca.hive,
      trust_tier: "vendor",
    },
  ]);
  assert.notEqual((await agentRow(ca.appAgent)).last_used_at, null);
  // A real pass names the audience every signed-in identity has.
  assert.deepEqual(
    await connectorLogin({ ...appPass("kai"), aud: "authenticated" }),
    mine,
  );
  // The same client id, another person: each gets their own.
  const hers = await connectorLogin(appPass("lena"));
  assert.equal(hers.length, 1);
  assert.equal(hers[0].agent_id, lenaAgent);
  assert.equal(hers[0].member_id, members.lena);

  // A person without a client id, an agent, nobody at all.
  const notAnApp = /only a connected app can do this/;
  await assert.rejects(connectorLogin(person("kai")), notAnApp);
  await assert.rejects(connectorLogin(appPass("kai", "")), notAnApp);
  await assert.rejects(connectorLogin(identityOf(mine[0])), notAnApp);
  await assert.rejects(
    connectorLogin({ ...identityOf(mine[0]), client_id: apps.a }),
    notAnApp,
  );
  await assert.rejects(
    connectorLogin({ role: "authenticated", client_id: apps.a }),
    notAnApp,
  );
  await assert.rejects(connectorLogin(null), /permission denied/);
  // A client id that is not one, a client nobody registered, and a token for
  // another audience that names no client.
  for (const client of ["client-none", `${apps.a}x`, NOBODY])
    await assert.rejects(
      connectorLogin(appPass("kai", client)),
      UNKNOWN_APP,
      client,
    );
  await assert.rejects(
    connectorLogin({ ...person("kai"), aud: apps.a }),
    UNKNOWN_APP,
  );
  // An app the person never approved; one they approved at the sign-in server
  // but never connected here; one only someone else connected.
  await assert.rejects(connectorLogin(appPass("omar")), NOT_APPROVED);
  await addConsent(users.omar, apps.a);
  await assert.rejects(connectorLogin(appPass("omar")), NO_APP_AGENT);
  const hersOnly = await addClient("App", CLAUDE_URI);
  await approveApp("lena", hersOnly, ws.lena);
  await assert.rejects(connectorLogin(appPass("kai", hersOnly)), NOT_APPROVED);
  await addConsent(users.kai, hersOnly);
  await assert.rejects(connectorLogin(appPass("kai", hersOnly)), NO_APP_AGENT);
  // A connected app has no token to sign in with.
  await assert.rejects(as(null, `select * from public.agent_login(null)`));

  // Revoked, then expired.
  await as(person("lena"), `select public.revoke_agent($1)`, [lenaAgent]);
  await assert.rejects(connectorLogin(appPass("lena")), NO_APP_AGENT);
  assert.equal((await connectorLogin(appPass("kai"))).length, 1);
  await db.query(
    `update public.agents set expires_at = now() - interval '1 minute' where id = $1`,
    [ca.appAgent],
  );
  await assert.rejects(connectorLogin(appPass("kai")), NO_APP_AGENT);
  await db.query(`update public.agents set expires_at = null where id = $1`, [
    ca.appAgent,
  ]);
});

test("connector_login needs the app to exist and the person's approval to stand", async () => {
  await caSetup();
  const kai = person("kai");
  const client = await addClient("Claude", CLAUDE_URI);
  const pass = appPass("kai", client);
  // Connected here, but the sign-in server holds no approval.
  const id = await connectApp(kai, client, ws.kai);
  await assert.rejects(connectorLogin(pass), NOT_APPROVED);
  assert.equal((await agentRow(id)).last_used_at, null);
  // Someone else's approval of the same app is not this person's.
  await addConsent(users.lena, client);
  await assert.rejects(connectorLogin(pass), NOT_APPROVED);
  // Approved: it works.
  await addConsent(users.kai, client);
  assert.equal((await connectorLogin(pass))[0].agent_id, id);
  // The approval is taken back at the sign-in server: refused at once, though
  // the agent here is still live.
  await addConsent(users.kai, client, { revoked: true });
  await assert.rejects(connectorLogin(pass), NOT_APPROVED);
  assert.equal((await agentRow(id)).revoked_at, null);
  // Approved again.
  await addConsent(users.kai, client);
  assert.equal((await connectorLogin(pass)).length, 1);

  // The app is deleted at the sign-in server: refused. It comes back with
  // the registration.
  await db.query(
    `update auth.oauth_clients set deleted_at = now() where id = $1`,
    [client],
  );
  await assert.rejects(connectorLogin(pass), UNKNOWN_APP);
  await db.query(
    `update auth.oauth_clients set deleted_at = null where id = $1`,
    [client],
  );
  assert.equal((await connectorLogin(pass)).length, 1);

  // Revoked in Settings, then handed a new pass without asking (the sign-in
  // server still holds the approval): refused until the person approves in
  // the window again.
  await as(kai, `select public.revoke_agent($1)`, [id]);
  await assert.rejects(connectorLogin(pass), NO_APP_AGENT);
  await assert.rejects(
    connectorLogin({ ...pass, aud: "authenticated" }),
    NO_APP_AGENT,
  );
});

test("an app approved in a second hive answers for the latest approval only", async () => {
  await caSetup();
  // Kai is a member of two hives and approves the same app in each in turn.
  const kai = person("kai");
  const other = (
    await as(kai, `select public.create_hive('Kai second hive', 'Kai') as id`)
  )[0].id;
  const space = (
    await db.query(`select id from public.workspaces where hive_id = $1`, [
      other,
    ])
  ).rows[0].id;
  const client = await addClient("App", CLAUDE_URI);
  const first = await approveApp("kai", client, ws.kai);
  const second = await connectApp(kai, client, space);
  assert.notEqual(second, first);
  assert.notEqual((await agentRow(first)).revoked_at, null);
  let login = await connectorLogin(appPass("kai", client));
  assert.equal(login.length, 1);
  assert.equal(login[0].agent_id, second);
  assert.equal(login[0].hive_id, other);

  assert.equal(await connectApp(kai, client, ws.kai), first);
  assert.notEqual((await agentRow(second)).revoked_at, null);
  login = await connectorLogin(appPass("kai", client));
  assert.equal(login.length, 1);
  assert.equal(login[0].agent_id, first);
  assert.equal(login[0].hive_id, ca.hive);
  // Lena's agent for the same client is somebody else's and stays as it is.
  const hers = await connectApp(person("lena"), client, ws.lena);
  assert.equal((await agentRow(first)).revoked_at, null);
  assert.equal((await agentRow(hers)).revoked_at, null);
});

test("a connected app's agent identity behaves as any vendor agent", async () => {
  await caSetup();
  const kai = person("kai");
  const client = await addClient("App", CLAUDE_URI);
  const id = await approveApp("kai", client, ws.kai);
  const login = (await connectorLogin(appPass("kai", client)))[0];
  assert.equal(login.agent_id, id);
  const agent = identityOf(login);
  const n = (
    await as(
      agent,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
       values ($1, $2, $3, 'app/written.md', 'written by a connected app', 'v1')
       returning id, quarantined, written_by_agent`,
      [ca.hive, members.kai, ws.kai],
    )
  )[0];
  assert.equal(n.quarantined, false);
  assert.equal(n.written_by_agent, id);
  assert.ok((await titles(agent)).includes("ca zeppelin"));
  await assert.rejects(
    as(agent, `update public.notes set visibility = 'group' where id = $1`, [
      n.id,
    ]),
    /agents cannot change sharing/,
  );
  assert.deepEqual(await deleteNote(agent, n.id), []);
  await assert.rejects(
    as(agent, `select public.respond_to_link($1, true)`, [ca.link]),
    /only a person/,
  );
  await assert.rejects(
    as(agent, `select public.revoke_agent($1)`, [id]),
    /agents cannot revoke agents/,
  );
  // An app held for review writes held notes.
  const unknown = await addClient("Unknown app", "https://tools.example/cb");
  const heldId = await approveApp("kai", unknown, ws.kai);
  const held = identityOf((await connectorLogin(appPass("kai", unknown)))[0]);
  assert.equal(held.trust_tier, "self_hosted");
  const h = (
    await as(
      held,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'app/held.md', 'held from an unknown app')
       returning quarantined, written_by_agent`,
      [ca.hive, members.kai, ws.kai],
    )
  )[0];
  assert.deepEqual(h, { quarantined: true, written_by_agent: heldId });
});

test("a token made for another audience is refused like an app pass", async () => {
  await caSetup();
  const kai = person("kai");
  const row = JSON.stringify(ca.noteRow);
  const asRow = `jsonb_populate_record(null::public.notes, $1::jsonb)`;
  const client = async (who) =>
    (await as(who, `select public.jwt_oauth_client() as c`))[0].c;

  // A person and an agent: no audience at all (as elsewhere in these tests)
  // or the one Supabase gives every signed-in identity.
  const agent = identityOf(
    (await as(null, `select * from public.agent_login($1)`, [ca.token]))[0],
  );
  for (const who of [
    kai,
    { ...kai, aud: "authenticated" },
    { ...kai, aud: ["authenticated"] },
    { ...kai, aud: null },
    agent,
    { ...agent, aud: "authenticated" },
  ]) {
    assert.equal(await client(who), null, JSON.stringify(who.aud));
    assert.ok((await titles(who)).includes("ca zeppelin"));
    assert.ok((await as(who, `select public.my_member_ids() as id`)).length);
  }

  // Any other audience is an app, with or without a client id.
  const others = [
    "some-client",
    apps.a,
    "",
    "Authenticated",
    "authenticated ",
    "anon",
    ["some-client"],
    ["authenticated", "some-client"],
    [],
    7,
    true,
    { a: "authenticated" },
  ];
  for (const aud of others) {
    const who = { ...kai, aud };
    const what = JSON.stringify(aud);
    assert.equal(await client(who), "unknown-audience", what);
    for (const table of [
      "notes",
      "hives",
      "members",
      "workspaces",
      "agents",
      "folders",
      "files",
      "links",
      "audit_log",
      "invitations",
    ])
      assert.deepEqual(
        await as(who, `select 1 from public.${table}`),
        [],
        `${what} read ${table}`,
      );
    assert.deepEqual(await as(who, `select 1 from storage.objects`), [], what);
    assert.deepEqual(await as(who, `select public.my_member_ids()`), [], what);
    assert.deepEqual(await as(who, `select public.my_hive_ids()`), [], what);
    assert.deepEqual(
      await as(who, `select public.is_hive_owner($1) as o`, [ca.hive]),
      [{ o: false }],
      what,
    );
    assert.deepEqual(
      await as(who, `select id from public.search_notes('zeppelin')`),
      [],
      what,
    );
    assert.deepEqual(
      await as(who, `select public.can_read_note(${asRow}) as r`, [row]),
      [{ r: false }],
      what,
    );
    for (const [sql, params] of [
      [`select public.map_graph($1)`, [ca.hive]],
      [`select public.inbox($1)`, [ca.hive]],
      [`select public.create_hive('By another audience', 'Kai')`, []],
      [`select * from public.create_agent($1, 'x', 'other')`, [ws.kai]],
      [`select public.revoke_agent($1)`, [ca.tokenAgent]],
      [`select public.respond_to_link($1, true)`, [ca.link]],
      [`select public.unlink($1)`, [ca.ownLink]],
      [`select public.connect_app($1, $2)`, [apps.a, ws.kai]],
      [`select public.note_visibility(${asRow})`, [row]],
      [`select public.invite_member($1, 'aud@ca.example.com', 'A')`, [ca.hive]],
      [`select public.invitation_to_email($1)`, [ca.invitation]],
      [`select public.my_invitations()`, []],
      [`select public.accept_invitation($1)`, [ca.kaiInvitation]],
    ])
      await assert.rejects(as(who, sql, params), APP_REFUSED, `${what} ${sql}`);
    const written = await trial(
      who,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'aud.md', 'by another audience') returning id`,
      [ca.hive, members.kai, ws.kai],
    );
    assert.ok(written.error, `${what} wrote a note`);
    // It names no app, so there is nothing to swap it for.
    await assert.rejects(connectorLogin(who), UNKNOWN_APP, what);
  }
  // With a client id it is that app's pass, whatever the audience says.
  for (const aud of ["some-client", "authenticated", apps.a])
    assert.equal(await client({ ...appPass("kai"), aud }), apps.a);
});

test("only a signed-in identity may ask who it is", async () => {
  await caSetup();
  for (const name of ["my_member_ids", "my_hive_ids", "is_hive_owner"]) {
    const acl = (
      await db.query(
        `select has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('public', p.oid, 'execute') as everyone,
                has_function_privilege('authenticated', p.oid, 'execute') as signed_in
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
        [name],
      )
    ).rows;
    assert.deepEqual(
      acl,
      [{ anon: false, everyone: false, signed_in: true }],
      name,
    );
  }
  // A token that names a real person but carries the role of a visitor: the
  // database runs it as anon, and it learns nothing about that person.
  const visitor = { sub: users.kai, role: "anon" };
  for (const [sql, params] of [
    [`select public.my_member_ids()`, []],
    [`select public.my_hive_ids()`, []],
    [`select public.is_hive_owner($1)`, [ca.hive]],
  ]) {
    const r = await trial(visitor, sql, params, "anon");
    assert.match(r.error?.message ?? "(answered)", /permission denied/, sql);
    const mine = await trial(person("kai"), sql, params);
    assert.equal(mine.error, undefined, sql);
    assert.ok(mine.rows.length >= 1, sql);
  }
  for (const table of ["notes", "members", "hives", "workspaces", "agents"]) {
    const r = await trial(
      visitor,
      `select count(*)::int as n from public.${table}`,
      [],
      "anon",
    );
    assert.ok(r.error || r.rows[0].n === 0, `a visitor read ${table}`);
  }
  // A visitor with no token still gets an empty answer from a table, not the
  // failure of a policy that calls these functions.
  assert.deepEqual(await titles(null), []);
});

// ---------------------------------------------------------------------------
// Starting a hive: create_hive checks both names and caps the hives one
// person owns (20261124082437_hive_cap.sql).
// ---------------------------------------------------------------------------

const HIVE_CAP = /you already own 5 hives/;
// Every character create_hive trims: space, tab, newline, carriage return,
// form feed and the vertical tab.
const ALL_SPACE = " \t\n\r\f\u000B";
let hivePeople = 0;
const hivePerson = async () =>
  asUser(await addUser(`hive-cap-${++hivePeople}@example.com`));
const startHive = async (who, name, displayName = "Owner") =>
  (
    await as(who, `select public.create_hive($1, $2) as id`, [
      name,
      displayName,
    ])
  )[0].id;
// Read as the database owner, in the order of the hives' names.
const hivesOwnedBy = async (who) =>
  (
    await db.query(
      `select h.name, m.display_name from public.members m
         join public.hives h on h.id = m.hive_id
        where m.user_id = $1 and m.role = 'owner' order by h.name`,
      [who.sub],
    )
  ).rows;

test("a hive needs a name of 1 to 60 characters", async () => {
  const me = await hivePerson();
  for (const name of ["", "   ", ALL_SPACE, null])
    await assert.rejects(
      startHive(me, name),
      /a hive needs a name/,
      JSON.stringify(name),
    );
  await assert.rejects(
    startHive(me, "n".repeat(61)),
    /that hive name is too long/,
  );
  // Characters are counted, not bytes.
  await assert.rejects(
    startHive(me, "é".repeat(61)),
    /that hive name is too long/,
  );
  assert.deepEqual(await hivesOwnedBy(me), []);

  // Sixty is allowed, and the white space around it is not counted.
  assert.match(await startHive(me, "n".repeat(60)), UUID);
  assert.match(await startHive(me, `  ${"é".repeat(60)}\n`), UUID);
  assert.deepEqual(
    (await hivesOwnedBy(me)).map((r) => r.name).sort(),
    ["n".repeat(60), "é".repeat(60)].sort(),
  );
});

test("the person starting a hive needs a name of 1 to 60 characters in it", async () => {
  const me = await hivePerson();
  for (const name of ["", "   ", ALL_SPACE, null])
    await assert.rejects(
      startHive(me, "Hive", name),
      /you need a name in the hive/,
      JSON.stringify(name),
    );
  await assert.rejects(
    startHive(me, "Hive", "n".repeat(61)),
    /that name is too long/,
  );
  await assert.rejects(
    startHive(me, "Hive", "é".repeat(61)),
    /that name is too long/,
  );
  assert.deepEqual(await hivesOwnedBy(me), []);

  assert.match(await startHive(me, "Hive sixty a", "n".repeat(60)), UUID);
  assert.match(
    await startHive(me, "Hive sixty b", `\t${"é".repeat(60)}  `),
    UUID,
  );
  assert.deepEqual(
    (await hivesOwnedBy(me)).map((r) => r.display_name).sort(),
    ["n".repeat(60), "é".repeat(60)].sort(),
  );
});

test("a refused hive says what is wrong with the hive's name first", async () => {
  const me = await hivePerson();
  await assert.rejects(startHive(me, " ", " "), /a hive needs a name/);
  await assert.rejects(
    startHive(me, "n".repeat(61), ""),
    /that hive name is too long/,
  );
  await assert.rejects(
    startHive(me, "n".repeat(61), "n".repeat(61)),
    /that hive name is too long/,
  );
  assert.deepEqual(await hivesOwnedBy(me), []);
});

test("a hive's name and its owner's name are stored trimmed, and keep a v at either end", async () => {
  const me = await hivePerson();
  const id = await startHive(
    me,
    `${ALL_SPACE}vessel of Liv${ALL_SPACE}`,
    `${ALL_SPACE}viv${ALL_SPACE}`,
  );
  assert.deepEqual(
    (await db.query(`select name from public.hives where id = $1`, [id])).rows,
    [{ name: "vessel of Liv" }],
  );
  assert.deepEqual(await hivesOwnedBy(me), [
    { name: "vessel of Liv", display_name: "viv" },
  ]);
  // White space inside a name is the person's own.
  const inner = await startHive(me, "  two  words  ", " A  B ");
  assert.deepEqual(
    (
      await db.query(
        `select h.name, m.display_name from public.hives h
           join public.members m on m.hive_id = h.id where h.id = $1`,
        [inner],
      )
    ).rows,
    [{ name: "two  words", display_name: "A  B" }],
  );
});

test("starting a hive makes its owner, a Main workspace and one audit entry", async () => {
  const me = await hivePerson();
  const mark = await lastAudit();
  const id = await startHive(me, "  Hive with a log  ", " Olga ");
  assert.match(id, UUID);

  const mine = await membershipsOf(me.sub);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].hive_id, id);
  assert.equal(mine[0].display_name, "Olga");
  assert.equal(mine[0].role, "owner");
  assert.deepEqual(mine[0].workspaces, ["Main"]);
  // The owner reads the new hive and its workspace as themselves.
  assert.deepEqual(
    await as(me, `select name from public.hives where id = $1`, [id]),
    [{ name: "Hive with a log" }],
  );
  assert.deepEqual(
    await as(me, `select name from public.workspaces where hive_id = $1`, [id]),
    [{ name: "Main" }],
  );

  const entries = async () =>
    (
      await db.query(
        `select hive_id, member_id, agent_id, action, note_id, detail
           from public.audit_log where id > $1 order by id`,
        [mark],
      )
    ).rows;
  const expected = [
    {
      hive_id: id,
      member_id: mine[0].id,
      agent_id: null,
      action: "hive.created",
      note_id: null,
      detail: { name: "Hive with a log" },
    },
  ];
  assert.deepEqual(await entries(), expected);

  // A refused hive leaves no entry.
  await assert.rejects(startHive(me, " "), /a hive needs a name/);
  assert.deepEqual(await entries(), expected);
});

test("a person owns at most 5 hives; hives they only belong to do not count", async () => {
  const me = await hivePerson();
  const other = await hivePerson();
  // A plain member of two hives somebody else owns.
  for (const n of [1, 2])
    await addMember(await startHive(other, `Cap theirs ${n}`), me.sub, "Guest");

  for (let n = 1; n <= 5; n++)
    assert.match(await startHive(me, `Cap mine ${n}`), UUID);
  const mark = await lastAudit();
  await assert.rejects(startHive(me, "Cap mine 6"), HIVE_CAP);
  await assert.rejects(startHive(me, "Cap mine 6"), HIVE_CAP);
  // A name that is wrong is said before the limit.
  await assert.rejects(startHive(me, " "), /a hive needs a name/);
  await assert.rejects(
    startHive(me, "Cap mine 6", " "),
    /you need a name in the hive/,
  );

  assert.deepEqual(
    (await hivesOwnedBy(me)).map((r) => r.name),
    [1, 2, 3, 4, 5].map((n) => `Cap mine ${n}`),
  );
  assert.equal((await membershipsOf(me.sub)).length, 7);
  assert.equal(
    (
      await db.query(
        `select count(*)::int as n from public.hives where name = 'Cap mine 6'`,
      )
    ).rows[0].n,
    0,
  );
  assert.equal(await lastAudit(), mark);

  // The limit is each person's own.
  assert.match(await startHive(other, "Cap theirs 3"), UUID);
});

test("only a signed-in person starts a hive: no agent, no app pass, no visitor", async () => {
  const count = async () =>
    (await db.query(`select count(*)::int as n from public.hives`)).rows[0].n;
  const before = await count();
  const call = `select public.create_hive('Not by a person', 'Nobody')`;
  const NOT_A_PERSON = /sign in as a person to create a hive/;

  for (const tier of ["vendor", "self_hosted"])
    await assert.rejects(as(await agentFor("sara", tier), call), NOT_A_PERSON);
  await assert.rejects(as(passOf(person("sara")), call), PASS_REFUSED);
  // Who is asking is settled before the names are looked at.
  const unnamed = `select public.create_hive('', '')`;
  await assert.rejects(as(passOf(person("sara")), unnamed), PASS_REFUSED);
  await assert.rejects(as(await agentFor("sara"), unnamed), NOT_A_PERSON);
  // A visitor may not call it at all.
  await assert.rejects(as(null, call), /permission denied/);
  // A signed-in token with nobody behind it.
  await assert.rejects(as({ role: "authenticated" }, call), NOT_A_PERSON);
  assert.equal(await count(), before);
});

// ---------------------------------------------------------------------------
// Deleting a hive (20261124091833_hive_deletion.sql). The owner marks it; for
// 7 days it can be read and not written, and the owner can cancel; then the
// server erases it and keeps a record.
// ---------------------------------------------------------------------------

const FROZEN = /^error: this hive is being deleted$/;
const HIVE_NOT_FOUND = /^error: hive not found$/;
const OWNER_ONLY = /^error: only the owner can delete a hive$/;
const PERSON_ONLY = /^error: only a person can delete a hive$/;
const WRONG_NAME = /^error: that is not the name of this hive$/;
const NOT_CLOSING = /^error: this hive is not being deleted$/;
const NOT_DUE = /^error: this hive is not due$/;
const DENIED = /permission denied/;
// Seven days as the database counts them, whatever its time zone.
const weekApart = async (h) =>
  (
    await db.query(
      `select delete_after = closing_at + interval '7 days' as week
         from public.hives where id = $1`,
      [h],
    )
  ).rows[0].week;

// As the server: the service role, which row-level security does not bind.
const asService = async (sql, params = []) => {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("set role service_role");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
};
const preview = (who, h) =>
  as(who, `select * from public.hive_deletion_preview($1)`, [h]).then(
    (r) => r[0],
  );
const requestDeletion = (who, h, name) =>
  as(who, `select public.request_hive_deletion($1, $2) as at`, [h, name]).then(
    (r) => r[0].at,
  );
const cancelDeletion = (who, h) =>
  as(who, `select public.cancel_hive_deletion($1)`, [h]);
const closingState = async (h) =>
  (
    await db.query(
      `select name, closing_at, delete_after, closing_by from public.hives where id = $1`,
      [h],
    )
  ).rows[0];
const ALREADY_ERASING = /^error: this hive is already being erased$/;
const STORED_REMAIN = /^error: stored objects remain$/;
const purgingAt = async (h) =>
  (await db.query(`select purging_at from public.hives where id = $1`, [h]))
    .rows[0].purging_at;
const hiveAudits = async (since, h) =>
  (await auditSince(since)).filter((r) => r.hive_id === h);

// A hive of its own with an owner, a member and a row in every table that
// holds hive data, so that "refused" and "erased" are never true by accident.
let hdCount = 0;
const hdHive = async () => {
  const tag = `hd${++hdCount}`;
  const mail = (who) => `${tag}-${who}@example.com`;
  const h = { tag, name: `Doomed ${tag}` };
  for (const who of ["owner", "member", "invited", "spare"]) {
    h[`${who}User`] = await addUser(mail(who));
    h[who] = asUser(h[`${who}User`]);
  }
  h.id = await startHive(h.owner, h.name);
  await addMember(h.id, h.memberUser, "Member");
  for (const who of ["owner", "member"]) {
    const row = (
      await db.query(
        `select m.id as member, w.id as space
           from public.members m join public.workspaces w on w.member_id = m.id
          where m.hive_id = $1 and m.user_id = $2`,
        [h.id, h[`${who}User`]],
      )
    ).rows[0];
    h[`${who}Member`] = row.member;
    h[`${who}Space`] = row.space;
  }
  h.spareSpace = (
    await as(
      h.owner,
      `insert into public.workspaces (hive_id, member_id, name)
       values ($1, $2, 'Spare') returning id`,
      [h.id, h.ownerMember],
    )
  )[0].id;
  h.folder = (
    await as(
      h.owner,
      `insert into public.folders (workspace_id, member_id, path, visibility)
       values ($1, $2, 'shared', 'group') returning id`,
      [h.ownerSpace, h.ownerMember],
    )
  )[0].id;
  const note = (who, path, claims = h[who]) =>
    as(
      claims,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
       values ($1, $2, $3, $4, $5, 'hd body') returning id`,
      [h.id, h[`${who}Member`], h[`${who}Space`], path, `${tag} ${path}`],
    ).then((r) => r[0].id);
  h.ownerNote = await note("owner", "shared/a.md");
  h.ownerNote2 = await note("owner", "shared/b.md");
  h.memberNote = await note("member", "a.md");
  h.memberNote2 = await note("member", "b.md");

  const agent = async (who, name, tier = "vendor") => {
    const made = (
      await as(
        h[who],
        `select * from public.create_agent($1, $2, 'other', $3)`,
        [h[`${who}Space`], name, tier],
      )
    )[0];
    const login = (
      await as(null, `select * from public.agent_login($1)`, [made.token])
    )[0];
    return { id: made.agent_id, token: made.token, claims: identityOf(login) };
  };
  const ownerAgent = await agent("owner", "Owner agent");
  h.ownerAgentId = ownerAgent.id;
  h.ownerAgent = ownerAgent.claims;
  const memberAgent = await agent("member", "Member agent");
  h.memberAgentId = memberAgent.id;
  h.memberToken = memberAgent.token;
  h.memberAgent = memberAgent.claims;
  h.heldAgent = (await agent("member", "Held agent", "self_hosted")).claims;
  h.agentNote = await note("member", "agent/a.md", h.memberAgent);
  h.heldNote = await note("member", "held/a.md", h.heldAgent);

  const link = (who, from, to) =>
    as(
      who,
      `insert into public.links (hive_id, from_note, to_note, tier, score)
       values ($1, $2, $3, 3, 0.5) returning id`,
      [h.id, from, to],
    ).then((r) => r[0].id);
  // Waiting for the owner; accepted at once (one owner); accepted by both.
  h.link = await link(h.member, h.memberNote, h.ownerNote);
  h.ownLink = await link(h.owner, h.ownerNote, h.ownerNote2);
  h.acceptedLink = await link(h.member, h.memberNote2, h.ownerNote2);
  assert.equal(await respond(h.owner, h.acceptedLink, true), "accepted");

  h.filePath = `${h.ownerMember}/${h.ownerSpace}/outputs/${tag}/a.pdf`;
  await upload(h.owner, h.filePath);
  h.file = (
    await as(
      h.owner,
      `insert into public.files (hive_id, member_id, workspace_id, note_id, storage_path, name)
       values ($1, $2, $3, $4, $5, 'a file') returning id`,
      [h.id, h.ownerMember, h.ownerSpace, h.ownerNote, h.filePath],
    )
  )[0].id;
  h.memberFilePath = `${h.memberMember}/${h.memberSpace}/outputs/${tag}/m.pdf`;
  await upload(h.member, h.memberFilePath);

  h.invitation = await invite(h.owner, mail("invited"), "Invited", h.id);

  // No person writes these tables yet; the rows are put there directly.
  await db.exec("reset role");
  const entity = async (name) =>
    (
      await db.query(
        `insert into public.entities (hive_id, type, canonical_name)
         values ($1, 'client', $2) returning id`,
        [h.id, name],
      )
    ).rows[0].id;
  h.entity = await entity(`${tag} Ltd`);
  h.entity2 = await entity(`${tag} Other Ltd`);
  await db.query(
    `insert into public.note_entities (note_id, entity_id) values ($1, $2)`,
    [h.ownerNote, h.entity],
  );
  await db.query(
    `insert into public.synthesis_pages (entity_id, hive_id) values ($1, $2)`,
    [h.entity, h.id],
  );
  h.notification = (
    await db.query(
      `insert into public.notifications (hive_id, member_id, kind)
       values ($1, $2, 'test') returning id`,
      [h.id, h.ownerMember],
    )
  ).rows[0].id;

  h.client = await addClient(`App ${tag}`, CLAUDE_URI);
  h.client2 = await addClient(`Other app ${tag}`, CLAUDE_URI);
  h.appAgent = await connectApp(h.owner, h.client, h.ownerSpace);
  await addConsent(h.ownerUser, h.client);
  h.pass = { ...h.owner, client_id: h.client };
  return h;
};

// Every row of a hive, read as the database owner. An agent's last-used stamp
// is left out: signing in is allowed to move it.
const HD_TABLES = {
  members: `hive_id = $1`,
  workspaces: `hive_id = $1`,
  agents: `member_id in (select id from public.members where hive_id = $1)`,
  folders: `workspace_id in (select id from public.workspaces where hive_id = $1)`,
  notes: `hive_id = $1`,
  note_versions: `note_id in (select id from public.notes where hive_id = $1)`,
  files: `hive_id = $1`,
  entities: `hive_id = $1`,
  note_entities: `note_id in (select id from public.notes where hive_id = $1)`,
  links: `hive_id = $1`,
  synthesis_pages: `hive_id = $1`,
  invitations: `hive_id = $1`,
};
// The tables that hold hive data and stay writable while a hive is closing,
// and the record that lives outside every hive.
const HD_OPEN = [
  "audit_log",
  "deleted_hives",
  "file_references", // rows go with their file or note; the insert trigger refuses a closing hive
  "gallery_folder_files", // rows go with their folder or file; the insert trigger refuses a closing hive
  "gallery_folders", // rows go with their member; the insert trigger refuses a closing hive
  "hives",
  "notifications",
  "sessions", // written only by the session functions, none of which writes a note into a closing hive
  "sync_keys", // made and revoked only by a person's own functions; goes with its workspace
  "sync_manifest", // the server's own: no API role has any right on it
  "sync_orphans", // the server's own: no API role has any right on it
  "sync_runs", // written only by the sync functions of a live key
];
const hdSnapshot = async (hiveId) => {
  await db.exec("reset role");
  const out = {};
  for (const [table, where] of Object.entries(HD_TABLES))
    out[table] = (
      await db.query(
        `select coalesce(jsonb_agg(r.j order by r.j::text), '[]'::jsonb) as rows
           from (select to_jsonb(x) - 'last_used_at' - 'search' as j
                   from public.${table} x where ${where}) r`,
        [hiveId],
      )
    ).rows[0].rows;
  out.stored = (
    await db.query(
      `select coalesce(jsonb_agg(o.name order by o.name), '[]'::jsonb) as names
         from storage.objects o
        where exists (select 1 from public.members m
                       where m.hive_id = $1 and o.name like m.id::text || '/%')`,
      [hiveId],
    )
  ).rows[0].names;
  return out;
};

// Every way to write into a hive, as [label, who, sql, params, expect, role].
// Each one succeeds on an open hive (run in a transaction that is rolled
// back) and is refused on a closing one. `expect` says how it is refused:
// "frozen" (the default) is the freeze's own message; "policy" is a stored
// object the insert policy refuses; "nothing" is a statement that finds no row
// it may touch. Role "none" is the database owner, whom row-level security
// does not bind: the trigger must.
const hdAttempts = (h) => {
  const list = [];
  const add = (label, who, sql, params = [], expect = "frozen", role) =>
    list.push({ label, who, sql, params, expect, role });
  const owner = (label, sql, params) =>
    add(label, null, sql, params, "frozen", "none");

  // The database owner, table by table: one insert, one update, one delete.
  const direct = {
    members: [
      [
        `insert into public.members (hive_id, user_id, display_name) values ($1, $2, 'New') returning 1`,
        [h.id, h.spareUser],
      ],
      [
        `update public.members set display_name = 'Renamed' where id = $1 returning 1`,
        [h.memberMember],
      ],
      [
        `delete from public.members where id = $1 returning 1`,
        [h.memberMember],
      ],
    ],
    workspaces: [
      [
        `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'New') returning 1`,
        [h.id, h.ownerMember],
      ],
      [
        `update public.workspaces set name = 'Renamed' where id = $1 returning 1`,
        [h.memberSpace],
      ],
      [
        `delete from public.workspaces where id = $1 returning 1`,
        [h.memberSpace],
      ],
    ],
    agents: [
      [
        `insert into public.agents (member_id, workspace_id, name, provider, token_hash)
         values ($1, $2, 'New', 'other', $3) returning 1`,
        [h.ownerMember, h.ownerSpace, `${h.tag}-hash`],
      ],
      [
        `update public.agents set name = 'Renamed' where id = $1 returning 1`,
        [h.ownerAgentId],
      ],
      [`delete from public.agents where id = $1 returning 1`, [h.ownerAgentId]],
    ],
    folders: [
      [
        `insert into public.folders (workspace_id, member_id, path) values ($1, $2, 'new') returning 1`,
        [h.ownerSpace, h.ownerMember],
      ],
      [
        `update public.folders set path = 'renamed' where id = $1 returning 1`,
        [h.folder],
      ],
      [`delete from public.folders where id = $1 returning 1`, [h.folder]],
    ],
    notes: [
      [
        `insert into public.notes (hive_id, member_id, workspace_id, path, title)
         values ($1, $2, $3, 'new.md', 'new') returning 1`,
        [h.id, h.ownerMember, h.ownerSpace],
      ],
      [
        `update public.notes set body = 'changed' where id = $1 returning 1`,
        [h.ownerNote],
      ],
      [`delete from public.notes where id = $1 returning 1`, [h.ownerNote]],
    ],
    note_versions: [
      [
        `insert into public.note_versions (note_id, version, title, body, frontmatter)
         values ($1, 99, 't', 'b', '{}') returning 1`,
        [h.ownerNote],
      ],
      [
        `update public.note_versions set body = 'changed' where note_id = $1 returning 1`,
        [h.ownerNote],
      ],
      [
        `delete from public.note_versions where note_id = $1 returning 1`,
        [h.ownerNote],
      ],
    ],
    files: [
      [
        `insert into public.files (hive_id, member_id, workspace_id, storage_path, name)
         values ($1, $2, $3, $4, 'f') returning 1`,
        [
          h.id,
          h.ownerMember,
          h.ownerSpace,
          `${h.ownerMember}/${h.ownerSpace}/outputs/new.pdf`,
        ],
      ],
      [
        `update public.files set name = 'renamed' where id = $1 returning 1`,
        [h.file],
      ],
      [`delete from public.files where id = $1 returning 1`, [h.file]],
    ],
    entities: [
      [
        `insert into public.entities (hive_id, type, canonical_name) values ($1, 'client', 'New Ltd') returning 1`,
        [h.id],
      ],
      [
        `update public.entities set canonical_name = 'Renamed' where id = $1 returning 1`,
        [h.entity],
      ],
      [`delete from public.entities where id = $1 returning 1`, [h.entity]],
    ],
    note_entities: [
      [
        `insert into public.note_entities (note_id, entity_id) values ($1, $2) returning 1`,
        [h.memberNote, h.entity],
      ],
      [
        `update public.note_entities set confidence = 0.5 where note_id = $1 returning 1`,
        [h.ownerNote],
      ],
      [
        `delete from public.note_entities where note_id = $1 returning 1`,
        [h.ownerNote],
      ],
    ],
    links: [
      [
        `insert into public.links (hive_id, from_note, to_note, tier, score)
         values ($1, $2, $3, 3, 0.5) returning 1`,
        [h.id, h.ownerNote, h.memberNote2],
      ],
      [`update public.links set tier = 1 where id = $1 returning 1`, [h.link]],
      [`delete from public.links where id = $1 returning 1`, [h.link]],
    ],
    synthesis_pages: [
      [
        `insert into public.synthesis_pages (entity_id, hive_id) values ($1, $2) returning 1`,
        [h.entity2, h.id],
      ],
      [
        `update public.synthesis_pages set body = 'changed' where entity_id = $1 returning 1`,
        [h.entity],
      ],
      [
        `delete from public.synthesis_pages where entity_id = $1 returning 1`,
        [h.entity],
      ],
    ],
    invitations: [
      [
        `insert into public.invitations (hive_id, email, display_name) values ($1, $2, 'New') returning 1`,
        [h.id, `${h.tag}-direct@example.com`],
      ],
      [
        `update public.invitations set display_name = 'Renamed' where id = $1 returning 1`,
        [h.invitation],
      ],
      [
        `delete from public.invitations where id = $1 returning 1`,
        [h.invitation],
      ],
    ],
  };
  for (const [table, three] of Object.entries(direct))
    three.forEach(([sql, params], i) =>
      owner(
        `${table} ${["insert", "update", "delete"][i]}, directly`,
        sql,
        params,
      ),
    );

  // People and agents, through the API.
  const newNote = `insert into public.notes (hive_id, member_id, workspace_id, path, title)
    values ($1, $2, $3, $4, 'new') returning 1`;
  const newLink = `insert into public.links (hive_id, from_note, to_note, tier, score)
    values ($1, $2, $3, 3, 0.5) returning 1`;
  const newFolder = `insert into public.folders (workspace_id, member_id, path, visibility)
    values ($1, $2, $3, $4) returning 1`;
  const newFile = `insert into public.files (hive_id, member_id, workspace_id, storage_path, name)
    values ($1, $2, $3, $4, 'f') returning 1`;
  const newObject = `insert into storage.objects (bucket_id, name) values ('files', $1) returning 1`;
  const ownerPath = (file) =>
    `${h.ownerMember}/${h.ownerSpace}/outputs/${file}`;
  const memberPath = (file) =>
    `${h.memberMember}/${h.memberSpace}/outputs/${file}`;

  add("the owner writes a note", h.owner, newNote, [
    h.id,
    h.ownerMember,
    h.ownerSpace,
    "o.md",
  ]);
  add(
    "the owner edits a note",
    h.owner,
    `update public.notes set body = 'changed' where id = $1 returning 1`,
    [h.ownerNote],
  );
  add(
    "the owner shares a note",
    h.owner,
    `update public.notes set visibility = 'members', shared_with = $2 where id = $1 returning 1`,
    [h.ownerNote2, [h.memberMember]],
  );
  add(
    "the owner moves a note",
    h.owner,
    `update public.notes set path = 'moved/a.md' where id = $1 returning 1`,
    [h.ownerNote],
  );
  add(
    "the owner deletes a note",
    h.owner,
    `delete from public.notes where id = $1 returning 1`,
    [h.ownerNote2],
  );
  add("the owner makes a folder rule", h.owner, newFolder, [
    h.ownerSpace,
    h.ownerMember,
    "fresh",
    "group",
  ]);
  add(
    "the owner changes a folder rule",
    h.owner,
    `update public.folders set visibility = 'private' where id = $1 returning 1`,
    [h.folder],
  );
  add(
    "the owner deletes a folder",
    h.owner,
    `delete from public.folders where id = $1 returning 1`,
    [h.folder],
  );
  add(
    "the owner makes a workspace",
    h.owner,
    `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'More') returning 1`,
    [h.id, h.ownerMember],
  );
  add(
    "the owner deletes a workspace",
    h.owner,
    `delete from public.workspaces where id = $1 returning 1`,
    [h.spareSpace],
  );
  add("the owner proposes a link", h.owner, newLink, [
    h.id,
    h.ownerNote,
    h.memberNote2,
  ]);
  add("the owner records a file", h.owner, newFile, [
    h.id,
    h.ownerMember,
    h.ownerSpace,
    ownerPath("o.pdf"),
  ]);
  add(
    "the owner removes a file's record",
    h.owner,
    `delete from public.files where id = $1 returning 1`,
    [h.file],
  );
  add(
    "the owner renames themself",
    h.owner,
    `update public.members set display_name = 'Renamed' where id = $1 returning 1`,
    [h.ownerMember],
  );
  add(
    "the owner changes their default",
    h.owner,
    `update public.members set default_visibility = 'group' where id = $1 returning 1`,
    [h.ownerMember],
  );
  add(
    "the owner adds an entity",
    h.owner,
    `insert into public.entities (hive_id, type, canonical_name) values ($1, 'client', 'More Ltd') returning 1`,
    [h.id],
  );
  add(
    "the owner renames an entity",
    h.owner,
    `update public.entities set canonical_name = 'Renamed' where id = $1 returning 1`,
    [h.entity],
  );
  add(
    "the owner deletes an entity",
    h.owner,
    `delete from public.entities where id = $1 returning 1`,
    [h.entity],
  );
  add(
    "the owner tags a note",
    h.owner,
    `insert into public.note_entities (note_id, entity_id) values ($1, $2) returning 1`,
    [h.ownerNote2, h.entity],
  );
  add(
    "the owner untags a note",
    h.owner,
    `delete from public.note_entities where note_id = $1 returning 1`,
    [h.ownerNote],
  );
  add(
    "the owner stores an object",
    h.owner,
    newObject,
    [ownerPath("o.pdf")],
    "policy",
  );
  add(
    "the owner removes a stored object",
    h.owner,
    `delete from storage.objects where name = $1 returning 1`,
    [h.filePath],
    "nothing",
  );

  add("a member writes a note", h.member, newNote, [
    h.id,
    h.memberMember,
    h.memberSpace,
    "m.md",
  ]);
  add(
    "a member edits a note",
    h.member,
    `update public.notes set title = 'changed' where id = $1 returning 1`,
    [h.memberNote],
  );
  add(
    "a member deletes a note",
    h.member,
    `delete from public.notes where id = $1 returning 1`,
    [h.memberNote],
  );
  add(
    "a member releases a held note",
    h.member,
    `update public.notes set quarantined = false where id = $1 returning 1`,
    [h.heldNote],
  );
  add("a member makes a folder", h.member, newFolder, [
    h.memberSpace,
    h.memberMember,
    "fresh",
    null,
  ]);
  add(
    "a member renames themself",
    h.member,
    `update public.members set display_name = 'Renamed' where id = $1 returning 1`,
    [h.memberMember],
  );
  add("a member proposes a link", h.member, newLink, [
    h.id,
    h.memberNote,
    h.ownerNote2,
  ]);
  add("a member records a file", h.member, newFile, [
    h.id,
    h.memberMember,
    h.memberSpace,
    memberPath("m2.pdf"),
  ]);
  add(
    "a member stores an object",
    h.member,
    newObject,
    [memberPath("m2.pdf")],
    "policy",
  );
  add(
    "a member removes a stored object",
    h.member,
    `delete from storage.objects where name = $1 returning 1`,
    [h.memberFilePath],
    "nothing",
  );

  add("an agent writes a note", h.memberAgent, newNote, [
    h.id,
    h.memberMember,
    h.memberSpace,
    "agent/new.md",
  ]);
  add(
    "an agent edits a note",
    h.memberAgent,
    `update public.notes set body = 'changed' where id = $1 returning 1`,
    [h.agentNote],
  );
  add("an agent proposes a link", h.memberAgent, newLink, [
    h.id,
    h.agentNote,
    h.ownerNote,
  ]);
  add("an agent makes a folder", h.memberAgent, newFolder, [
    h.memberSpace,
    h.memberMember,
    "agent-made",
    null,
  ]);
  add("an agent records a file", h.memberAgent, newFile, [
    h.id,
    h.memberMember,
    h.memberSpace,
    memberPath("agent.pdf"),
  ]);
  add(
    "an agent stores an object",
    h.memberAgent,
    newObject,
    [memberPath("agent.pdf")],
    "policy",
  );
  add("a self-hosted agent writes a note", h.heldAgent, newNote, [
    h.id,
    h.memberMember,
    h.memberSpace,
    "held/new.md",
  ]);

  // The functions that write as the database owner.
  add("invite_member", h.owner, `select public.invite_member($1, $2, 'New')`, [
    h.id,
    `${h.tag}-new@example.com`,
  ]);
  add("invitation_to_email", h.owner, `select public.invitation_to_email($1)`, [
    h.invitation,
  ]);
  add("revoke_invitation", h.owner, `select public.revoke_invitation($1)`, [
    h.invitation,
  ]);
  add("accept_invitation", h.invited, `select public.accept_invitation($1)`, [
    h.invitation,
  ]);
  add(
    "respond_to_link, accepting",
    h.owner,
    `select public.respond_to_link($1, true)`,
    [h.link],
  );
  add(
    "respond_to_link, declining",
    h.owner,
    `select public.respond_to_link($1, false)`,
    [h.link],
  );
  add("unlink, two owners", h.member, `select public.unlink($1)`, [
    h.acceptedLink,
  ]);
  add("unlink, one owner", h.owner, `select public.unlink($1)`, [h.ownLink]);
  add(
    "create_agent, the owner",
    h.owner,
    `select * from public.create_agent($1, 'New', 'other')`,
    [h.ownerSpace],
  );
  add(
    "create_agent, a member",
    h.member,
    `select * from public.create_agent($1, 'New', 'other')`,
    [h.memberSpace],
  );
  // revoke_agent is not here: an agent can be cut off in a closing hive (see
  // "a hive that is being deleted can still be read").
  add("connect_app, a new app", h.owner, `select public.connect_app($1, $2)`, [
    h.client2,
    h.ownerSpace,
  ]);
  add(
    "connect_app, the same app again",
    h.owner,
    `select public.connect_app($1, $2)`,
    [h.client, h.spareSpace],
  );
  return { list, tables: Object.keys(direct) };
};
const hdTry = (a) => trial(a.who, a.sql, a.params, a.role);

test("the freeze is on every table that holds hive data", async () => {
  const rows = (
    await db.query(
      `select c.relname as name,
              exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
                       where g.tgrelid = c.oid and not g.tgisinternal
                         and p.proname = 'hive_frozen'
                         and p.pronamespace = 'public'::regnamespace
                         and g.tgenabled = 'O'
                         -- for each row, before, insert and delete and update
                         and g.tgtype & 1 = 1 and g.tgtype & 2 = 2
                         and g.tgtype & 28 = 28) as frozen
         from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        order by 1`,
    )
  ).rows;
  // A table added later must either get the trigger or be named in HD_OPEN.
  assert.deepEqual(
    rows.filter((r) => !r.frozen).map((r) => r.name),
    HD_OPEN,
  );
  assert.deepEqual(
    rows.filter((r) => r.frozen).map((r) => r.name),
    Object.keys(HD_TABLES).sort(),
  );

  const acl = (
    await db.query(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('public', p.oid, 'execute') as everyone,
              has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
              has_function_privilege('service_role', p.oid, 'execute') as server
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('hive_frozen', 'hive_is_closing', 'hive_deletion_owner',
                            'hive_deletion_preview', 'request_hive_deletion',
                            'cancel_hive_deletion', 'hives_due_for_purge',
                            'purge_hive', 'can_write_file', 'can_delete_file',
                            'one_hive', 'begin_hive_purge', 'hive_object_paths')
        order by 1`,
    )
  ).rows;
  const who = (anon, everyone, signed_in, server) => ({
    anon,
    everyone,
    signed_in,
    server,
  });
  const people = who(false, false, true, true);
  const expected = {
    can_delete_file: people,
    // Replaced, and its rights are as they were since file storage shipped:
    // nobody took it from the public. It answers a visitor nothing (it rests
    // on my_member_ids, which a visitor may not call).
    can_write_file: who(true, true, true, true),
    cancel_hive_deletion: people,
    hive_deletion_preview: people,
    request_hive_deletion: people,
    // The database's own.
    hive_deletion_owner: who(false, false, false, true),
    hive_frozen: who(false, false, false, true),
    one_hive: who(false, false, false, true),
    begin_hive_purge: who(false, false, false, true),
    hive_object_paths: who(false, false, false, true),
    hive_is_closing: who(false, false, false, true),
    // The server's.
    hives_due_for_purge: who(false, false, false, true),
    purge_hive: who(false, false, false, true),
  };
  assert.deepEqual(
    acl.map((f) => f.name),
    Object.keys(expected).sort(),
  );
  for (const f of acl) {
    const { name, definer, config, ...rights } = f;
    assert.deepEqual(rights, expected[name], name);
    assert.equal(definer, true, name);
    assert.deepEqual(config, ['search_path=""'], name);
  }
});

test("only the owner, as a person, sees how much a hive holds, asks to delete it and cancels", async () => {
  const h = await hdHive();
  const other = await hdHive();
  const stranger = asUser(await addUser(`${h.tag}-stranger@example.com`));
  const before = await hdSnapshot(h.id);
  const mark = await lastAudit();

  assert.deepEqual(await preview(h.owner, h.id), {
    members: 2,
    notes: 6,
    files: 1,
  });
  // Another hive's numbers are its own.
  await as(
    other.owner,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     values ($1, $2, $3, 'extra.md', 'extra')`,
    [other.id, other.ownerMember, other.ownerSpace],
  );
  assert.deepEqual(await preview(other.owner, other.id), {
    members: 2,
    notes: 7,
    files: 1,
  });
  assert.deepEqual(await preview(h.owner, h.id), {
    members: 2,
    notes: 6,
    files: 1,
  });

  // Who is refused, and with what. A person who is not in the hive is told
  // exactly what they would be told about a hive that does not exist.
  const refused = [
    ["a member", h.member, OWNER_ONLY],
    ["a stranger", stranger, HIVE_NOT_FOUND],
    ["another hive's owner", other.owner, HIVE_NOT_FOUND],
    ["the owner's agent", h.ownerAgent, PERSON_ONLY],
    ["a member's agent", h.memberAgent, PERSON_ONLY],
    ["a self-hosted agent", h.heldAgent, PERSON_ONLY],
    [
      "a self-hosted claim",
      { ...h.owner, trust_tier: "self_hosted" },
      PERSON_ONLY,
    ],
    ["nobody signed in", { role: "authenticated" }, PERSON_ONLY],
    ["the owner's app pass", h.pass, APP_REFUSED],
    ["a pass of an unknown app", passOf(h.owner), APP_REFUSED],
    ["a token for another audience", { ...h.owner, aud: "other" }, APP_REFUSED],
    ["a visitor", null, DENIED],
  ];
  const everyoneRefused = async (when) => {
    for (const [label, who, message] of refused) {
      const what = `${label}, ${when}`;
      await assert.rejects(preview(who, h.id), message, `preview: ${what}`);
      await assert.rejects(
        requestDeletion(who, h.id, h.name),
        message,
        `request: ${what}`,
      );
      await assert.rejects(
        cancelDeletion(who, h.id),
        message,
        `cancel: ${what}`,
      );
    }
  };
  await everyoneRefused("on an open hive");
  for (const call of [preview, cancelDeletion])
    await assert.rejects(call(h.owner, NOBODY), HIVE_NOT_FOUND);
  await assert.rejects(
    requestDeletion(h.owner, NOBODY, h.name),
    HIVE_NOT_FOUND,
  );
  // The owner of this hive is not the owner of that one.
  await assert.rejects(
    requestDeletion(h.owner, other.id, other.name),
    HIVE_NOT_FOUND,
  );
  await assert.rejects(cancelDeletion(h.owner, h.id), NOT_CLOSING);

  // The name must be the hive's own, typed exactly.
  for (const name of [
    "",
    null,
    "Doomed",
    h.name.toLowerCase(),
    `${h.name}x`,
    other.name,
  ])
    await assert.rejects(requestDeletion(h.owner, h.id, name), WRONG_NAME);
  const untouched = {
    name: h.name,
    closing_at: null,
    delete_after: null,
    closing_by: null,
  };
  assert.deepEqual(await closingState(h.id), untouched);
  assert.deepEqual(await hiveAudits(mark, h.id), []);

  // White space around the typed name does not count.
  const at = await requestDeletion(
    h.owner,
    h.id,
    `${ALL_SPACE}${h.name}${ALL_SPACE}`,
  );
  let state = await closingState(h.id);
  assert.equal(at.getTime(), state.delete_after.getTime());
  assert.equal(await weekApart(h.id), true);
  assert.ok(Math.abs(state.closing_at - Date.now()) < 60_000);
  assert.equal(state.closing_by, h.ownerUser);
  let audits = await hiveAudits(mark, h.id);
  assert.equal(audits.length, 1);
  assert.deepEqual(
    { ...audits[0], id: null, detail: null },
    {
      id: null,
      hive_id: h.id,
      member_id: h.ownerMember,
      agent_id: null,
      action: "hive.deletion_requested",
      note_id: null,
      detail: null,
    },
  );
  assert.deepEqual(Object.keys(audits[0].detail), ["delete_after"]);
  assert.equal(new Date(audits[0].detail.delete_after).getTime(), at.getTime());

  // Asking again answers the same date, changes nothing and records nothing.
  const again = await requestDeletion(h.owner, h.id, h.name);
  assert.equal(again.getTime(), at.getTime());
  assert.deepEqual(await closingState(h.id), state);
  assert.equal((await hiveAudits(mark, h.id)).length, 1);
  await assert.rejects(requestDeletion(h.owner, h.id, "wrong"), WRONG_NAME);

  // The same people are refused while it is closing; nobody but the owner
  // cancels, and the owner still reads the numbers.
  await everyoneRefused("on a closing hive");
  assert.deepEqual(await closingState(h.id), state);
  assert.equal((await hiveAudits(mark, h.id)).length, 1);
  assert.deepEqual(await preview(h.owner, h.id), {
    members: 2,
    notes: 6,
    files: 1,
  });
  // Nobody sets or clears the dates by hand, not even the owner.
  for (const who of [h.owner, h.member, h.memberAgent])
    for (const sql of [
      `update public.hives set delete_after = null, closing_at = null where id = $1 returning 1`,
      `update public.hives set delete_after = now() where id = $1 returning 1`,
      `delete from public.hives where id = $1 returning 1`,
    ]) {
      const r = await trial(who, sql, [h.id]);
      assert.ok(r.error || r.rows.length === 0, sql);
    }
  assert.deepEqual(await closingState(h.id), state);
  // Every member reads that the hive is closing, and when it goes.
  for (const who of [h.owner, h.member, h.memberAgent]) {
    const seen = await as(
      who,
      `select name, delete_after from public.hives where id = $1`,
      [h.id],
    );
    assert.equal(seen[0].delete_after.getTime(), at.getTime());
  }
  assert.deepEqual(
    await as(stranger, `select 1 from public.hives where id = $1`, [h.id]),
    [],
  );

  await cancelDeletion(h.owner, h.id);
  assert.deepEqual(await closingState(h.id), untouched);
  audits = await hiveAudits(mark, h.id);
  assert.deepEqual(
    audits.map((a) => a.action),
    ["hive.deletion_requested", "hive.deletion_cancelled"],
  );
  assert.equal(audits[1].member_id, h.ownerMember);
  assert.equal(audits[1].agent_id, null);
  assert.deepEqual(Object.keys(audits[1].detail), ["delete_after"]);
  assert.equal(new Date(audits[1].detail.delete_after).getTime(), at.getTime());
  await assert.rejects(cancelDeletion(h.owner, h.id), NOT_CLOSING);
  assert.equal((await hiveAudits(mark, h.id)).length, 2);

  // Asked again after a cancel, the seven days start again.
  const second = await requestDeletion(h.owner, h.id, h.name);
  state = await closingState(h.id);
  assert.equal(second.getTime(), state.delete_after.getTime());
  assert.equal(await weekApart(h.id), true);
  assert.equal((await hiveAudits(mark, h.id)).length, 3);
  await cancelDeletion(h.owner, h.id);

  // None of it touched a row of the hive, and the other hive never closed.
  assert.deepEqual(await hdSnapshot(h.id), before);
  assert.equal((await closingState(other.id)).delete_after, null);
});

test("nothing is written into a hive that is being deleted, by anyone or by any function", async () => {
  const h = await hdHive();
  const { list, tables } = hdAttempts(h);
  assert.deepEqual(tables.sort(), Object.keys(HD_TABLES).sort());

  // On the open hive every attempt works, so none is refused below for a
  // reason of its own.
  const before = await hdSnapshot(h.id);
  for (const table of Object.keys(HD_TABLES))
    assert.ok(before[table].length > 0, `${table} is empty`);
  for (const a of list) {
    const r = await hdTry(a);
    assert.equal(r.error, undefined, `${a.label}: ${r.error?.message}`);
    assert.equal(r.rows.length, 1, a.label);
  }
  assert.deepEqual(await hdSnapshot(h.id), before);

  await requestDeletion(h.owner, h.id, h.name);
  const mark = await lastAudit();
  for (const a of list) {
    const r = await hdTry(a);
    if (a.expect === "nothing") {
      assert.equal(r.error, undefined, `${a.label}: ${r.error?.message}`);
      assert.deepEqual(r.rows, [], a.label);
    } else {
      assert.match(
        String(r.error ?? "(it worked)"),
        a.expect === "policy" ? /row-level security/ : FROZEN,
        a.label,
      );
    }
  }
  // The same again without the rollback, where a refusal has to hold alone.
  await assert.rejects(
    as(h.member, list.find((a) => a.label === "a member writes a note").sql, [
      h.id,
      h.memberMember,
      h.memberSpace,
      "m.md",
    ]),
    FROZEN,
  );
  await assert.rejects(accept(h.invited, h.invitation), FROZEN);
  await assert.rejects(release(h.member, h.heldNote), FROZEN);
  await assert.rejects(
    upload(h.owner, `${h.ownerMember}/${h.ownerSpace}/x.pdf`),
  );
  assert.deepEqual(
    await as(
      h.owner,
      `delete from storage.objects where name = $1 returning 1`,
      [h.filePath],
    ),
    [],
  );
  assert.deepEqual(await hdSnapshot(h.id), before);
  assert.deepEqual(await hiveAudits(mark, h.id), []);
  assert.deepEqual(await membershipsOf(h.invitedUser), []);
});

test("a row cannot be moved into or out of a hive that is being deleted", async () => {
  const h = await hdHive();
  const o = await hdHive();
  o.agentId = (
    await as(
      o.owner,
      `select * from public.create_agent($1, 'Mover', 'other')`,
      [o.ownerSpace],
    )
  )[0].agent_id;
  const before = [await hdSnapshot(h.id), await hdSnapshot(o.id)];
  await requestDeletion(h.owner, h.id, h.name);

  const direct = (sql, params) => asDbOwner(null, `${sql} returning 1`, params);
  const moves = [
    // members
    [
      `update public.members set hive_id = $1 where id = $2`,
      [o.id, h.memberMember],
    ],
    [
      `update public.members set hive_id = $1 where id = $2`,
      [h.id, o.memberMember],
    ],
    // workspaces: by the hive, and by the member alone
    [
      `update public.workspaces set hive_id = $1 where id = $2`,
      [o.id, h.spareSpace],
    ],
    [
      `update public.workspaces set hive_id = $1 where id = $2`,
      [h.id, o.spareSpace],
    ],
    [
      `update public.workspaces set member_id = $1 where id = $2`,
      [h.ownerMember, o.spareSpace],
    ],
    [
      `update public.workspaces set member_id = $1 where id = $2`,
      [o.ownerMember, h.spareSpace],
    ],
    // agents
    [
      `update public.agents set member_id = $1, workspace_id = $2 where id = $3`,
      [o.ownerMember, o.ownerSpace, h.ownerAgentId],
    ],
    [
      `update public.agents set member_id = $1, workspace_id = $2 where id = $3`,
      [h.ownerMember, h.ownerSpace, o.agentId],
    ],
    [
      `update public.agents set workspace_id = $1 where id = $2`,
      [h.ownerSpace, o.agentId],
    ],
    // files
    [`update public.files set hive_id = $1 where id = $2`, [o.id, h.file]],
    [`update public.files set hive_id = $1 where id = $2`, [h.id, o.file]],
    [
      `update public.files set workspace_id = $1 where id = $2`,
      [h.ownerSpace, o.file],
    ],
    [
      `update public.files set member_id = $1 where id = $2`,
      [h.ownerMember, o.file],
    ],
    // entities, synthesis pages, invitations, links
    [`update public.entities set hive_id = $1 where id = $2`, [o.id, h.entity]],
    [
      `update public.entities set hive_id = $1 where id = $2`,
      [h.id, o.entity2],
    ],
    [
      `update public.synthesis_pages set hive_id = $1 where entity_id = $2`,
      [o.id, h.entity],
    ],
    [
      `update public.synthesis_pages set hive_id = $1 where entity_id = $2`,
      [h.id, o.entity],
    ],
    [
      `update public.synthesis_pages set entity_id = $1 where entity_id = $2`,
      [h.entity2, o.entity],
    ],
    [
      `update public.invitations set hive_id = $1 where id = $2`,
      [o.id, h.invitation],
    ],
    [
      `update public.invitations set hive_id = $1 where id = $2`,
      [h.id, o.invitation],
    ],
    [`update public.links set hive_id = $1 where id = $2`, [o.id, h.link]],
    [`update public.links set hive_id = $1 where id = $2`, [h.id, o.link]],
    [
      `update public.links set to_note = $1 where id = $2`,
      [h.ownerNote, o.link],
    ],
    // note versions and tags, which reach their hive through the note
    [
      `update public.note_versions set note_id = $1, version = 77 where note_id = $2`,
      [o.ownerNote, h.ownerNote],
    ],
    [
      `update public.note_versions set note_id = $1, version = 78 where note_id = $2`,
      [h.ownerNote, o.ownerNote],
    ],
    [
      `update public.note_entities set note_id = $1 where note_id = $2`,
      [o.memberNote, h.ownerNote],
    ],
    [
      `update public.note_entities set note_id = $1 where note_id = $2`,
      [h.memberNote, o.ownerNote],
    ],
    [
      `update public.note_entities set entity_id = $1 where note_id = $2`,
      [h.entity2, o.ownerNote],
    ],
    // new rows that name the open hive but hang under the closing one
    [
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'Astray')`,
      [o.id, h.ownerMember],
    ],
    [
      `insert into public.notes (hive_id, member_id, workspace_id, path, title) values ($1, $2, $3, 'astray.md', 'astray')`,
      [o.id, h.ownerMember, h.ownerSpace],
    ],
    [
      `insert into public.files (hive_id, member_id, workspace_id, storage_path, name) values ($1, $2, $3, $4, 'f')`,
      [
        o.id,
        h.ownerMember,
        h.ownerSpace,
        `${h.ownerMember}/${h.ownerSpace}/astray.pdf`,
      ],
    ],
    [
      `insert into public.synthesis_pages (entity_id, hive_id) values ($1, $2)`,
      [h.entity2, o.id],
    ],
    [
      `insert into public.note_entities (note_id, entity_id) values ($1, $2)`,
      [o.memberNote, h.entity],
    ],
  ];
  for (const [sql, params] of moves)
    await assert.rejects(direct(sql, params), FROZEN, sql);
  // Notes and folders never move at all; their own triggers say so first or
  // the freeze does, and either way nothing moves.
  for (const [sql, params] of [
    [`update public.notes set hive_id = $1 where id = $2`, [o.id, h.ownerNote]],
    [
      `update public.notes set member_id = $1, workspace_id = $2 where id = $3`,
      [h.ownerMember, h.ownerSpace, o.ownerNote],
    ],
    [
      `update public.folders set member_id = $1, workspace_id = $2 where id = $3`,
      [h.ownerMember, h.ownerSpace, o.folder],
    ],
    [
      `update public.folders set member_id = $1, workspace_id = $2 where id = $3`,
      [o.ownerMember, o.ownerSpace, h.folder],
    ],
  ])
    await assert.rejects(direct(sql, params), sql);

  // A row that names no hive that exists is not let in by the freeze stepping
  // aside: the foreign keys and the tables' own triggers still refuse it.
  for (const [sql, params, why] of [
    [
      `insert into public.agents (member_id, workspace_id, name, provider, token_hash) values ($1, $1, 'x', 'other', 'hd-nowhere')`,
      [NOBODY],
      /foreign key/,
    ],
    [
      `insert into public.note_versions (note_id, version, title, body, frontmatter) values ($1, 1, 't', 'b', '{}')`,
      [NOBODY],
      /foreign key/,
    ],
    [
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $1, 'x')`,
      [NOBODY],
      /foreign key/,
    ],
    [
      `insert into public.members (hive_id, user_id, display_name) values ($1, $2, 'x')`,
      [NOBODY, h.spareUser],
      /foreign key/,
    ],
    [
      `insert into public.invitations (hive_id, email, display_name) values ($1, 'x@example.com', 'x')`,
      [NOBODY],
      /foreign key/,
    ],
    [
      `insert into public.notes (hive_id, member_id, workspace_id, path, title) values ($1, $1, $1, 'x.md', 'x')`,
      [NOBODY],
      /workspace does not belong/,
    ],
    [
      `insert into public.folders (workspace_id, member_id, path) values ($1, $1, 'x')`,
      [NOBODY],
      /workspace does not belong/,
    ],
    [
      `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $1, $2, 3, 0.5)`,
      [NOBODY, h.ownerNote],
      /both notes must exist/,
    ],
  ])
    await assert.rejects(direct(sql, params), why, sql);

  assert.deepEqual([await hdSnapshot(h.id), await hdSnapshot(o.id)], before);
});

test("a hive that is being deleted can still be read, and agents still sign in", async () => {
  const h = await hdHive();
  const second = await startHive(h.owner, `Second ${h.tag}`);
  const secondSpace = (
    await as(
      h.owner,
      `select w.id from public.workspaces w where w.hive_id = $1`,
      [second],
    )
  )[0].id;
  const secondMember = (
    await as(h.owner, `select id from public.members where hive_id = $1`, [
      second,
    ])
  )[0].id;

  // Everything a person or an agent reads, before and after.
  const reads = async () => {
    const out = {};
    for (const who of ["owner", "member", "memberAgent", "heldAgent"]) {
      const c = h[who];
      const q = (sql, params = [h.id]) => as(c, sql, params);
      const seen = {
        hive: (await q(`select name from public.hives where id = $1`)).length,
        notes: await q(
          `select id, title, body, version from public.notes where hive_id = $1 order by id`,
        ),
        versions: await q(
          `select v.note_id, v.version from public.note_versions v
             join public.notes n on n.id = v.note_id
            where n.hive_id = $1 order by 1, 2`,
        ),
        search: await q(
          `select id from public.search_notes('hd') order by id`,
          [],
        ),
        folders: await q(
          `select id, path, visibility from public.folders order by id`,
          [],
        ),
        files: await q(
          `select id, name from public.files where hive_id = $1 order by id`,
        ),
        stored: await q(
          `select name from storage.objects where bucket_id = 'files' order by name`,
          [],
        ),
        links: await q(
          `select id, status from public.links where hive_id = $1 order by id`,
        ),
        members: await q(
          `select id, display_name, role from public.members where hive_id = $1 order by id`,
        ),
        agents: await q(
          `select id, name, revoked_at from public.agents order by id`,
          [],
        ),
        entities: await q(
          `select id from public.entities where hive_id = $1 order by id`,
        ),
      };
      if (!c.agent_id)
        Object.assign(seen, {
          map: await map(c, h.id),
          inbox: await inbox(c, h.id),
          inboxCount: await inboxCount(c, h.id),
          noteLinks: await noteLinks(c, h.ownerNote2),
          invitations: await q(
            `select id from public.invitations where hive_id = $1 order by id`,
          ),
          notifications: await q(
            `select id from public.notifications where hive_id = $1 order by id`,
          ),
        });
      out[who] = seen;
    }
    return out;
  };
  const before = await reads();
  // Not empty: there is something to lose.
  assert.equal(before.owner.notes.length, 3);
  assert.equal(before.member.notes.length, 6);
  assert.equal(before.memberAgent.notes.length, 6);
  assert.equal(before.heldAgent.notes.length, 3);
  assert.equal(before.owner.map.nodes.length, 6);
  assert.equal(before.owner.inbox.links_total, 1);
  assert.equal(before.member.inbox.held_total, 1);
  assert.equal(before.owner.noteLinks.length, 2);
  assert.equal(before.owner.files.length, 1);
  assert.equal(before.owner.stored.length, 1);
  assert.equal(before.owner.invitations.length, 1);
  assert.equal(before.owner.search.length, 3);

  const snapshot = await hdSnapshot(h.id);
  await requestDeletion(h.owner, h.id, h.name);
  assert.deepEqual(await reads(), before);
  // The owner reads the audit log, where the request is.
  const audits = await as(
    h.owner,
    `select action from public.audit_log where hive_id = $1 and action like 'hive.%' order by id`,
    [h.id],
  );
  assert.deepEqual(
    audits.map((a) => a.action),
    ["hive.created", "hive.deletion_requested"],
  );

  // An agent signs in with its token: the last-used stamp moves and nothing
  // else does.
  await asDbOwner(
    null,
    `update public.agents set last_used_at = null where id = $1`,
    [h.memberAgentId],
  );
  const login = (
    await as(null, `select * from public.agent_login($1)`, [h.memberToken])
  )[0];
  assert.deepEqual(identityOf(login), h.memberAgent);
  assert.equal(login.hive_id, h.id);
  assert.ok((await agentRow(h.memberAgentId)).last_used_at);
  assert.equal(
    (await as(identityOf(login), `select id from public.notes`)).length,
    6,
  );
  await assert.rejects(
    as(
      identityOf(login),
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'agent/late.md', 'late')`,
      [h.id, h.memberMember, h.memberSpace],
    ),
    FROZEN,
  );

  // A connected app signs in: its stamp moves, and its trust tier still
  // follows the app's registration.
  let app = (await connectorLogin(h.pass))[0];
  assert.equal(app.agent_id, h.appAgent);
  assert.equal(app.hive_id, h.id);
  assert.equal(app.trust_tier, "vendor");
  assert.ok((await agentRow(h.appAgent)).last_used_at);
  await asDbOwner(
    null,
    `update auth.oauth_clients set redirect_uris = 'https://elsewhere.example/cb' where id = $1`,
    [h.client],
  );
  app = (await connectorLogin(h.pass))[0];
  assert.equal(app.trust_tier, "self_hosted");
  assert.equal((await agentRow(h.appAgent)).trust_tier, "self_hosted");
  // The identity it signs in with still reads.
  assert.equal(
    (await as(identityOf(app), `select id from public.notes`)).length,
    3,
  );
  await asDbOwner(
    null,
    `update auth.oauth_clients set redirect_uris = $2 where id = $1`,
    [h.client, CLAUDE_URI],
  );
  app = (await connectorLogin(h.pass))[0];
  assert.equal(app.trust_tier, "vendor");
  assert.equal((await agentRow(h.appAgent)).trust_tier, "vendor");
  assert.equal(
    (await as(identityOf(app), `select id from public.notes`)).length,
    3,
  );

  // Those two columns and nothing with them, and the tier only for an app:
  // a token agent's tier is what it signs in with.
  const direct = (sql, params) => asDbOwner(null, `${sql} returning 1`, params);
  for (const [sql, params] of [
    [
      `update public.agents set last_used_at = now(), revoked_at = now() where id = $1`,
      [h.memberAgentId],
    ],
    [
      `update public.agents set last_used_at = now(), name = 'Renamed' where id = $1`,
      [h.memberAgentId],
    ],
    [
      `update public.agents set last_used_at = now(), expires_at = now() where id = $1`,
      [h.appAgent],
    ],
    [
      `update public.agents set trust_tier = 'self_hosted' where id = $1`,
      [h.memberAgentId],
    ],
    [
      `update public.agents set trust_tier = 'self_hosted', workspace_id = $2 where id = $1`,
      [h.appAgent, h.spareSpace],
    ],
    [
      `update public.agents set oauth_client_id = $2, token_hash = null where id = $1`,
      [h.memberAgentId, h.client2],
    ],
  ])
    await assert.rejects(direct(sql, params), FROZEN, sql);

  // A notification can be marked read.
  assert.deepEqual(
    await as(
      h.owner,
      `update public.notifications set read_at = now() where id = $1 returning id`,
      [h.notification],
    ),
    [{ id: h.notification }],
  );
  assert.deepEqual(await hdSnapshot(h.id), snapshot);

  // The owner's other hive is as writable as ever.
  await as(
    h.owner,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     values ($1, $2, $3, 'alive.md', 'alive')`,
    [second, secondMember, secondSpace],
  );
  await upload(h.owner, `${secondMember}/${secondSpace}/outputs/alive.pdf`);
  await as(h.owner, `select * from public.create_agent($1, 'Alive', 'other')`, [
    secondSpace,
  ]);
  assert.match(
    await invite(h.owner, `${h.tag}-alive@example.com`, "Alive", second),
    UUID,
  );
  assert.match(await connectApp(h.owner, h.client2, secondSpace), UUID);
  assert.deepEqual(await hdSnapshot(h.id), snapshot);

  // What changed in the closing hive: which agents are revoked, and nothing
  // else on any row.
  const sinceSnapshot = async () => {
    const now = await hdSnapshot(h.id);
    const plain = (s) => ({
      ...s,
      agents: s.agents.map((a) => ({ ...a, revoked_at: null })),
    });
    assert.deepEqual(plain(now), plain(snapshot));
    return now.agents
      .filter((a) => a.revoked_at)
      .map((a) => a.id)
      .sort();
  };
  assert.deepEqual(await sinceSnapshot(), []);

  // A person has one live agent per app. Moving an app that is connected in
  // the closing hive to another hive ends its agent there: that is a revoke,
  // and a revoke passes. The app now answers for the other hive.
  const moved = await connectApp(h.owner, h.client, secondSpace);
  assert.match(moved, UUID);
  assert.notEqual(moved, h.appAgent);
  assert.deepEqual(await sinceSnapshot(), [h.appAgent]);
  app = (await connectorLogin(h.pass))[0];
  assert.equal(app.agent_id, moved);
  assert.equal(app.hive_id, second);

  // An agent can be cut off while its hive is closing: a token that leaked
  // must not stay good for seven days. By the person it belongs to only.
  const NOT_YOURS = /that agent is not yours/;
  await assert.rejects(
    as(h.member, `select public.revoke_agent($1)`, [h.ownerAgentId]),
    NOT_YOURS,
  );
  await assert.rejects(
    as(h.owner, `select public.revoke_agent($1)`, [h.memberAgentId]),
    NOT_YOURS,
  );
  await assert.rejects(
    as(h.memberAgent, `select public.revoke_agent($1)`, [h.memberAgentId]),
    /agents cannot revoke agents/,
  );
  assert.deepEqual(await sinceSnapshot(), [h.appAgent]);
  await as(h.owner, `select public.revoke_agent($1)`, [h.ownerAgentId]);
  await as(h.member, `select public.revoke_agent($1)`, [h.memberAgentId]);
  assert.deepEqual(
    await sinceSnapshot(),
    [h.appAgent, h.ownerAgentId, h.memberAgentId].sort(),
  );
  // It no longer signs in.
  await assert.rejects(
    as(null, `select * from public.agent_login($1)`, [h.memberToken]),
    /unknown, expired or revoked token/,
  );

  // Once, from empty to set, and nothing with it. Not taken back, not
  // stamped again, not together with another column.
  const heldAgentId = h.heldAgent.agent_id;
  const stamped = (await agentRow(h.memberAgentId)).revoked_at;
  await assert.rejects(
    as(h.member, `select public.revoke_agent($1)`, [h.memberAgentId]),
    FROZEN,
  );
  for (const [sql, params] of [
    [
      `update public.agents set revoked_at = null where id = $1`,
      [h.memberAgentId],
    ],
    [
      `update public.agents set revoked_at = now() + interval '1 hour' where id = $1`,
      [h.memberAgentId],
    ],
    [
      `update public.agents set revoked_at = null, last_used_at = now() where id = $1`,
      [h.appAgent],
    ],
    [
      `update public.agents set revoked_at = now(), last_used_at = now() where id = $1`,
      [heldAgentId],
    ],
    [
      `update public.agents set revoked_at = now(), name = 'Renamed' where id = $1`,
      [heldAgentId],
    ],
    [
      `update public.agents set revoked_at = now(), expires_at = now() where id = $1`,
      [heldAgentId],
    ],
    [
      `update public.agents set revoked_at = now(), trust_tier = 'vendor' where id = $1`,
      [heldAgentId],
    ],
    [
      `update public.agents set revoked_at = now(), workspace_id = $2 where id = $1`,
      [heldAgentId, h.spareSpace],
    ],
  ])
    await assert.rejects(direct(sql, params), FROZEN, sql);
  assert.equal(
    (await agentRow(h.memberAgentId)).revoked_at.getTime(),
    stamped.getTime(),
  );
  // Connecting the app again in the closing hive would lift the revoke.
  await assert.rejects(connectApp(h.owner, h.client, h.ownerSpace), FROZEN);
  assert.deepEqual(
    await sinceSnapshot(),
    [h.appAgent, h.ownerAgentId, h.memberAgentId].sort(),
  );
  // The agent that was left alone still signs in and reads.
  assert.equal(
    (await as(h.heldAgent, `select id from public.notes`)).length,
    3,
  );
});

test("cancelling lifts the freeze at once", async () => {
  const h = await hdHive();
  const before = await hdSnapshot(h.id);
  await requestDeletion(h.owner, h.id, h.name);
  const write = (who, member, space, path) =>
    as(
      who,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, $4, 'after') returning id`,
      [h.id, member, space, path],
    );
  await assert.rejects(
    write(h.owner, h.ownerMember, h.ownerSpace, "after.md"),
    FROZEN,
  );
  await cancelDeletion(h.owner, h.id);
  assert.deepEqual(await hdSnapshot(h.id), before);

  assert.equal(
    (await write(h.owner, h.ownerMember, h.ownerSpace, "after.md")).length,
    1,
  );
  assert.equal(
    (
      await write(
        h.memberAgent,
        h.memberMember,
        h.memberSpace,
        "agent/after.md",
      )
    ).length,
    1,
  );
  await as(h.member, `update public.notes set body = 'after' where id = $1`, [
    h.memberNote,
  ]);
  await release(h.member, h.heldNote);
  await upload(h.owner, `${h.ownerMember}/${h.ownerSpace}/outputs/after.pdf`);
  assert.equal(
    (
      await as(
        h.owner,
        `delete from storage.objects where name = $1 returning 1`,
        [h.filePath],
      )
    ).length,
    1,
  );
  assert.equal(await respond(h.owner, h.link, true), "accepted");
  assert.equal(await accept(h.invited, h.invitation), h.id);
  await as(h.owner, `select public.revoke_agent($1)`, [h.ownerAgentId]);
  assert.deepEqual(await preview(h.owner, h.id), {
    members: 3,
    notes: 8,
    files: 1,
  });
});

test("only the server erases a hive, only when its day has come, and keeps a record", async () => {
  const h = await hdHive();
  const o = await hdHive();
  const second = await startHive(h.owner, `Second ${h.tag}`);
  const others = async () => [
    await hdSnapshot(o.id),
    await hdSnapshot(second),
    await hdSnapshot(hive),
  ];
  const due = async () =>
    (await asService(`select id from public.hives_due_for_purge()`)).map(
      (r) => r.id,
    );

  // Not for people, agents, apps or visitors.
  for (const who of [h.owner, h.member, h.ownerAgent, h.pass, null])
    for (const sql of [
      `select public.begin_hive_purge($1)`,
      `select public.purge_hive($1)`,
      `select * from public.hive_object_paths($1, null, 10)`,
      `select * from public.hives_due_for_purge() where $1::uuid is not null`,
      `select * from public.deleted_hives where hive_id = $1`,
      `insert into public.deleted_hives (hive_id, name, members, notes, files) values ($1, 'x', 0, 0, 0)`,
      `delete from public.deleted_hives where hive_id <> $1`,
    ])
      await assert.rejects(as(who, sql, [h.id]), DENIED, sql);

  // The server is refused too, until the day has come: it can neither begin
  // nor take a step.
  const begin = (id) => asService(`select public.begin_hive_purge($1)`, [id]);
  const step = (id) =>
    asService(`select public.purge_hive($1) as done`, [id]).then(
      (r) => r[0].done,
    );
  const notYet = async (id, why) => {
    await assert.rejects(begin(id), why);
    await assert.rejects(step(id), why);
  };
  await notYet(NOBODY, HIVE_NOT_FOUND);
  await notYet(h.id, NOT_DUE);
  await requestDeletion(h.owner, h.id, h.name);
  await notYet(h.id, NOT_DUE);
  assert.ok(!(await due()).includes(h.id));
  // One second short of the day.
  await asDbOwner(
    null,
    `update public.hives set delete_after = now() + interval '1 second' where id = $1`,
    [h.id],
  );
  await notYet(h.id, NOT_DUE);
  assert.ok(!(await due()).includes(h.id));
  assert.equal((await closingState(h.id)).delete_after === null, false);
  assert.equal(await purgingAt(h.id), null);
  // Cancelled in time, it is not due however old the request.
  await requestDeletion(o.owner, o.id, o.name);
  await asDbOwner(
    null,
    `update public.hives set closing_at = now() - interval '8 days',
                             delete_after = now() - interval '1 day' where id = $1`,
    [o.id],
  );
  assert.ok((await due()).includes(o.id));
  await cancelDeletion(o.owner, o.id);
  assert.ok(!(await due()).includes(o.id));
  await notYet(o.id, NOT_DUE);

  // The day comes.
  await asDbOwner(
    null,
    `update public.hives set closing_at = now() - interval '7 days 1 hour',
                             delete_after = now() - interval '1 hour' where id = $1`,
    [h.id],
  );
  const state = await closingState(h.id);
  const full = await hdSnapshot(h.id);
  const ids = (table, key = "id") => full[table].map((r) => r[key]);
  const kept = await others();
  const erased = (
    await db.query(`select count(*)::int as n from public.deleted_hives`)
  ).rows[0].n;
  assert.deepEqual(await due(), [h.id]);
  // Still nobody else, now that it is due.
  for (const who of [h.owner, h.member, null])
    for (const call of ["begin_hive_purge", "purge_hive"])
      await assert.rejects(
        as(who, `select public.${call}($1)`, [h.id]),
        DENIED,
      );
  // No step before the erase has begun, and until then the owner can still
  // cancel (they do not: see "cancelling lifts the freeze").
  await assert.rejects(step(h.id), NOT_DUE);
  assert.deepEqual(await hdSnapshot(h.id), full);
  assert.deepEqual(
    await asService(`select * from public.deleted_hives where hive_id = $1`, [
      h.id,
    ]),
    [],
  );

  // The point of no return: the record is written with what the hive holds
  // now, and not yet with the day it was erased.
  await begin(h.id);
  const begun = await purgingAt(h.id);
  assert.ok(Math.abs(begun - Date.now()) < 60_000);
  const recordOf = async () =>
    asService(`select * from public.deleted_hives where hive_id = $1`, [h.id]);
  const atBegin = await recordOf();
  assert.equal(atBegin.length, 1);
  assert.deepEqual(
    { ...atBegin[0], requested_at: null },
    {
      hive_id: h.id,
      name: h.name,
      requested_by: h.ownerUser,
      requested_at: null,
      purged_at: null,
      members: 2,
      notes: 6,
      files: 1,
    },
  );
  assert.deepEqual(await hdSnapshot(h.id), full);
  // The owner can no longer cancel; asking again still answers the date.
  const mark = await lastAudit();
  await assert.rejects(cancelDeletion(h.owner, h.id), ALREADY_ERASING);
  await assert.rejects(cancelDeletion(h.member, h.id), OWNER_ONLY);
  assert.equal(
    (await requestDeletion(h.owner, h.id, h.name)).getTime(),
    state.delete_after.getTime(),
  );
  assert.deepEqual(await closingState(h.id), state);
  assert.equal((await purgingAt(h.id)).getTime(), begun.getTime());
  assert.deepEqual(await hiveAudits(mark, h.id), []);
  // Everyone still reads, and nobody writes: not a person, not an agent, not
  // an app, and deletes no more than anything else. Only the server's
  // deletes pass, and only its deletes.
  assert.equal((await as(h.member, `select id from public.notes`)).length, 6);
  for (const [who, sql, params] of [
    [
      h.owner,
      `delete from public.notes where id = $1 returning 1`,
      [h.ownerNote],
    ],
    [
      h.member,
      `delete from public.notes where id = $1 returning 1`,
      [h.memberNote],
    ],
    [
      h.owner,
      `delete from public.folders where id = $1 returning 1`,
      [h.folder],
    ],
    [h.owner, `delete from public.files where id = $1 returning 1`, [h.file]],
    [
      h.owner,
      `delete from public.workspaces where id = $1 returning 1`,
      [h.spareSpace],
    ],
    [
      h.owner,
      `update public.notes set body = 'late' where id = $1 returning 1`,
      [h.ownerNote],
    ],
    [
      h.memberAgent,
      `update public.notes set body = 'late' where id = $1 returning 1`,
      [h.agentNote],
    ],
    [h.owner, `select public.unlink($1)`, [h.ownLink]],
    [h.owner, `select public.revoke_invitation($1)`, [h.invitation]],
    // A token that says it is the server's, in a session that is not.
    [
      { ...h.owner, role: "service_role" },
      `delete from public.notes where id = $1 returning 1`,
      [h.ownerNote],
    ],
  ])
    await assert.rejects(as(who, sql, params), FROZEN, sql);
  for (const [sql, params] of [
    [`delete from public.notes where id = $1 returning 1`, [h.ownerNote]],
    [`delete from public.members where id = $1 returning 1`, [h.memberMember]],
  ])
    await assert.rejects(asDbOwner(null, sql, params), FROZEN, sql);
  for (const [sql, params] of [
    [`update public.notes set body = 'late' where id = $1`, [h.ownerNote]],
    [
      `insert into public.entities (hive_id, type, canonical_name) values ($1, 'client', 'Late Ltd')`,
      [h.id],
    ],
    [`update public.agents set name = 'Late' where id = $1`, [h.ownerAgentId]],
    // Nor a delete of the server's own making: only a step of the erase.
    [`delete from public.notes where id = $1`, [h.ownerNote]],
    [`delete from public.folders where id = $1`, [h.folder]],
    [`delete from public.members where id = $1`, [h.memberMember]],
  ])
    await assert.rejects(asService(sql, params), FROZEN, sql);
  assert.deepEqual(await hdSnapshot(h.id), full);
  // A hive that is closing and not being erased gives the server nothing.
  await requestDeletion(o.owner, o.id, o.name);
  await assert.rejects(
    asService(`delete from public.notes where id = $1`, [o.ownerNote]),
    FROZEN,
  );
  await cancelDeletion(o.owner, o.id);

  // Beginning again moves the stamp and writes no second record.
  await begin(h.id);
  assert.ok((await purgingAt(h.id)) > begun);
  assert.deepEqual(await recordOf(), atBegin);
  assert.deepEqual(await due(), [h.id]);

  // The hive's row is not deleted while a stored object is left under one of
  // its members: the step that would finish stops, and says so. What it had
  // already removed stays removed; the members and the hive stay.
  assert.equal(await step(h.id), false);
  const membersLeft = async () =>
    (
      await db.query(
        `select count(*)::int as n from public.members where hive_id = $1`,
        [h.id],
      )
    ).rows[0].n;
  for (let i = 0; i < 2; i++) {
    await assert.rejects(step(h.id), STORED_REMAIN);
    assert.equal(await membersLeft(), 2);
    assert.equal((await recordOf())[0].purged_at, null);
    assert.equal((await as(h.member, `select id from public.hives`)).length, 1);
  }
  // One object left is enough.
  await asService(`delete from storage.objects where name = $1`, [h.filePath]);
  await assert.rejects(step(h.id), STORED_REMAIN);
  assert.equal(await membersLeft(), 2);
  await asService(`delete from storage.objects where name = $1`, [
    h.memberFilePath,
  ]);
  assert.equal(await step(h.id), true);

  // Nothing of the hive is left in any table.
  const after = await hdSnapshot(h.id);
  for (const table of Object.keys(HD_TABLES))
    assert.deepEqual(after[table], [], table);
  const left = async (table, column, values) =>
    (
      await db.query(
        `select count(*)::int as n from public.${table} where ${column} = any ($1::uuid[])`,
        [values],
      )
    ).rows[0].n;
  for (const [table, column, values] of [
    ["hives", "id", [h.id]],
    ["members", "id", ids("members")],
    ["workspaces", "id", ids("workspaces")],
    ["agents", "id", ids("agents")],
    ["folders", "id", ids("folders")],
    ["notes", "id", ids("notes")],
    ["note_versions", "note_id", ids("notes")],
    ["files", "id", ids("files")],
    ["entities", "id", ids("entities")],
    ["note_entities", "note_id", ids("notes")],
    ["links", "id", ids("links")],
    ["synthesis_pages", "entity_id", ids("entities")],
    ["invitations", "id", ids("invitations")],
    ["notifications", "hive_id", [h.id]],
    ["audit_log", "hive_id", [h.id]],
  ]) {
    assert.ok(values.length > 0, `${table}: nothing to erase`);
    assert.equal(await left(table, column, values), 0, table);
  }
  // The people keep their accounts.
  assert.equal(
    (
      await db.query(
        `select count(*)::int as n from auth.users where id = any ($1::uuid[])`,
        [[h.ownerUser, h.memberUser]],
      )
    ).rows[0].n,
    2,
  );

  // The record: what it was, who asked and when, and how much it held.
  const record = await asService(
    `select * from public.deleted_hives where hive_id = $1`,
    [h.id],
  );
  assert.equal(record.length, 1);
  const { purged_at, requested_at, ...rest } = record[0];
  assert.deepEqual(rest, {
    hive_id: h.id,
    name: h.name,
    requested_by: h.ownerUser,
    members: 2,
    notes: 6,
    files: 1,
  });
  assert.equal(requested_at.getTime(), state.closing_at.getTime());
  assert.ok(Math.abs(purged_at - Date.now()) < 60_000);
  assert.equal(
    (await db.query(`select count(*)::int as n from public.deleted_hives`))
      .rows[0].n,
    erased + 1,
  );

  // Every other hive is whole, the owner's other one included.
  assert.deepEqual(await others(), kept);
  assert.deepEqual(await due(), []);
  await notYet(h.id, HIVE_NOT_FOUND);
  assert.deepEqual(
    (await as(h.owner, `select id from public.hives`)).map((r) => r.id),
    [second],
  );
  assert.equal((await as(h.member, `select id from public.hives`)).length, 0);
  // The record cannot be reached through the API, by the person it names
  // either.
  const table = (
    await db.query(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
              has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger') as anon,
              has_table_privilege('authenticated', c.oid, 'select, insert, update, delete, truncate, references, trigger') as signed_in
         from pg_class c where c.oid = 'public.deleted_hives'::regclass`,
    )
  ).rows[0];
  assert.deepEqual(table, {
    rls: true,
    // Only the restrictive wall that keeps the sync identity off every table.
    policies: 1,
    anon: false,
    signed_in: false,
  });
  await assert.rejects(
    as(h.owner, `select * from public.deleted_hives`),
    DENIED,
  );
});

test("the hives due to be erased are listed oldest first, 20 at a time", async () => {
  await db.exec("reset role");
  const make = async (name, after) =>
    (
      await db.query(
        `insert into public.hives (name, closing_at, delete_after)
         values ($1, now() + $2::interval - interval '7 days', now() + $2::interval)
         returning id`,
        [name, after],
      )
    ).rows[0].id;
  const made = [];
  try {
    // Made out of order: 23 that are due, by 1 to 23 hours.
    const hours = [...Array(23).keys()].map((i) => ((i * 7) % 23) + 1);
    const dueIds = {};
    for (const n of hours) {
      dueIds[n] = await make(`Due ${n}`, `-${n} hours`);
      made.push(dueIds[n]);
    }
    made.push(await make("Not yet", "1 hour"));
    made.push(
      (
        await db.query(
          `insert into public.hives (name) values ('Not closing') returning id`,
        )
      ).rows[0].id,
    );
    const listed = await asService(
      `select * from public.hives_due_for_purge()`,
    );
    assert.deepEqual(Object.keys(listed[0]), ["id"]);
    assert.deepEqual(
      listed.map((r) => r.id),
      [...Array(20).keys()].map((i) => dueIds[23 - i]),
    );
    const dueNow = async () =>
      (await asService(`select * from public.hives_due_for_purge()`)).map(
        (r) => r.id,
      );
    const begin = (id) => asService(`select public.begin_hive_purge($1)`, [id]);
    // A hive whose erase was begun and not finished goes behind every hive
    // that was never tried, so one that keeps failing does not hold the
    // queue: the two oldest are tried, and the list starts at the third.
    await begin(dueIds[23]);
    await begin(dueIds[22]);
    assert.deepEqual(
      await dueNow(),
      [...Array(20).keys()].map((i) => dueIds[21 - i]),
    );
    // Among the hives already tried, the one tried longest ago comes first.
    await begin(dueIds[23]);
    for (let n = 21; n >= 6; n--)
      await db.query(`delete from public.hives where id = $1`, [dueIds[n]]);
    assert.deepEqual(await dueNow(), [
      ...[5, 4, 3, 2, 1].map((n) => dueIds[n]),
      dueIds[22],
      dueIds[23],
    ]);
    // Erasing one takes it off the list.
    assert.deepEqual(
      await asService(`select public.purge_hive($1) as done`, [dueIds[23]]),
      [{ done: true }],
    );
    assert.deepEqual(await dueNow(), [
      ...[5, 4, 3, 2, 1].map((n) => dueIds[n]),
      dueIds[22],
    ]);
    const record = (
      await db.query(`select * from public.deleted_hives where hive_id = $1`, [
        dueIds[23],
      ])
    ).rows[0];
    assert.equal(record.name, "Due 23");
    assert.equal(record.requested_by, null);
    assert.deepEqual([record.members, record.notes, record.files], [0, 0, 0]);
  } finally {
    await db.exec("reset role");
    await db.query(`delete from public.hives where id = any ($1::uuid[])`, [
      made,
    ]);
  }
  assert.deepEqual(
    await asService(`select * from public.hives_due_for_purge()`),
    [],
  );
});

// A closing hive whose day has come, as the database owner would see it.
const hdMakeDue = (id) =>
  asDbOwner(
    null,
    `update public.hives set closing_at = now() - interval '7 days 1 hour',
                             delete_after = now() - interval '1 hour' where id = $1`,
    [id],
  );
const hdBegin = (id) => asService(`select public.begin_hive_purge($1)`, [id]);
const hdStep = (id) =>
  asService(`select public.purge_hive($1) as done`, [id]).then(
    (r) => r[0].done,
  );
const hdRecord = async (id) =>
  (
    await db.query(`select * from public.deleted_hives where hive_id = $1`, [
      id,
    ])
  ).rows[0];

// What the purge function does between the first step and the last: lists
// the hive's stored objects and removes them, as the server.
const hdRemoveObjects = async (id) => {
  for (;;) {
    const names = (
      await asService(
        `select * from public.hive_object_paths($1, null, 1000)`,
        [id],
      )
    ).map((r) => r.name);
    if (names.length === 0) return;
    await asService(
      `delete from storage.objects where bucket_id = 'files' and name = any ($1::text[])`,
      [names],
    );
  }
};
// One statement in a transaction that is rolled back, with the erase's marker
// set by hand, in a session of the given role ("none" is the database owner).
// The API offers no way to do this; a session that can run SQL can.
const withMarker = async (marker, role, sql, params = []) => {
  await db.exec("reset role");
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claims', '{}', true)`);
    await db.query(`select set_config('hive.purging', $1, true)`, [marker]);
    await db.exec(`set local role ${role}`);
    return { rows: (await db.query(sql, params)).rows };
  } catch (error) {
    return { error };
  } finally {
    await db.exec("rollback");
  }
};

test("a large hive is erased over several calls, each within a budget of rows", async () => {
  const BUDGET = 2000;
  const h = await hdHive();
  const o = await hdHive();
  // 1,200 notes with four versions each, 5,000 folders, 3,000 audit rows, 150
  // workspaces and 60 notifications: what a member could pile up.
  await asDbOwner(
    null,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
     select $1, $2, $3, 'shared/bulk/' || i || '.md', 'bulk ' || i, 'bulk'
       from generate_series(1, 1194) i`,
    [h.id, h.ownerMember, h.ownerSpace],
  );
  for (const n of [2, 3, 4])
    await asDbOwner(
      null,
      `update public.notes set body = 'bulk v' || $2 where hive_id = $1`,
      [h.id, n],
    );
  await asDbOwner(
    null,
    `insert into public.folders (workspace_id, member_id, path)
     select $1, $2, 'bulk/' || i from generate_series(1, 5000) i`,
    [h.memberSpace, h.memberMember],
  );
  await asDbOwner(
    null,
    `insert into public.audit_log (hive_id, member_id, action)
     select $1, $2, 'test.bulk' from generate_series(1, 3000) i`,
    [h.id, h.memberMember],
  );
  // More than a member may have today (20261124110155_workspace_cap.sql):
  // rows from before the limit, put there with its trigger switched off.
  await db.exec(
    `alter table public.workspaces disable trigger zzzz_workspace_cap`,
  );
  try {
    await asDbOwner(
      null,
      `insert into public.workspaces (hive_id, member_id, name)
       select $1, $2, 'bulk ' || i from generate_series(1, 150) i`,
      [h.id, h.memberMember],
    );
  } finally {
    await db.exec(
      `alter table public.workspaces enable trigger zzzz_workspace_cap`,
    );
  }
  await asDbOwner(
    null,
    `insert into public.notifications (hive_id, member_id, kind)
     select $1, $2, 'test' from generate_series(1, 60) i`,
    [h.id, h.memberMember],
  );
  // Every row of the hive, table by table.
  const WHERE = {
    ...HD_TABLES,
    notifications: `hive_id = $1`,
    audit_log: `hive_id = $1`,
  };
  const counts = async () => {
    const out = {};
    for (const [table, where] of Object.entries(WHERE))
      out[table] = (
        await db.query(
          `select count(*)::int as n from public.${table} where ${where}`,
          [h.id],
        )
      ).rows[0].n;
    return out;
  };
  const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);
  const start = await counts();
  assert.equal(start.notes, 1200);
  assert.equal(start.note_versions, 4800);
  assert.equal(start.folders, 5001);
  assert.ok(start.audit_log >= 3000);
  assert.equal(start.workspaces, 153);
  for (const [table, n] of Object.entries(start))
    assert.ok(n > 0, `${table} is empty`);

  await requestDeletion(h.owner, h.id, h.name);
  await hdMakeDue(h.id);
  const other = await hdSnapshot(o.id);
  await hdBegin(h.id);
  const record = await hdRecord(h.id);
  assert.deepEqual(
    [record.members, record.notes, record.files, record.purged_at],
    [2, 1200, 1, null],
  );
  await hdRemoveObjects(h.id);

  // After each unfinished call: nothing left hanging, the people in it still
  // read, nobody writes, the record is as it was, the other hive is whole.
  const between = async (now) => {
    for (const [table, column, parent] of [
      ["note_versions", "note_id", "notes"],
      ["note_entities", "note_id", "notes"],
      ["note_entities", "entity_id", "entities"],
      ["links", "from_note", "notes"],
      ["links", "to_note", "notes"],
      ["files", "note_id", "notes"],
      ["notes", "folder_id", "folders"],
      ["notes", "workspace_id", "workspaces"],
      ["folders", "workspace_id", "workspaces"],
      ["agents", "member_id", "members"],
      ["workspaces", "member_id", "members"],
    ])
      assert.equal(
        (
          await db.query(
            `select count(*)::int as n from public.${table} x
              where x.${column} is not null
                and not exists (select 1 from public.${parent} p where p.id = x.${column})`,
          )
        ).rows[0].n,
        0,
        `${table}.${column}`,
      );
    assert.deepEqual(await hdRecord(h.id), record);
    assert.deepEqual(await hdSnapshot(o.id), other);
    // The members go last, a few in a call; once one has gone nothing else
    // of the hive is left for the others to read.
    if (now.members < 2) {
      for (const table of Object.keys(WHERE))
        if (table !== "members") assert.equal(now[table], 0, table);
      return;
    }
    const seen = new Set();
    for (const who of [h.owner, h.member])
      for (const r of await as(
        who,
        `select id from public.notes where hive_id = $1`,
        [h.id],
      ))
        seen.add(r.id);
    assert.equal(seen.size, now.notes);
    assert.equal((await map(h.owner, h.id)).members.length, 2);
    assert.equal(typeof (await inboxCount(h.owner, h.id)), "number");
    assert.equal(
      (await as(h.member, `select delete_after from public.hives`)).length,
      1,
    );
    await assert.rejects(
      as(
        h.member,
        `update public.members set display_name = 'Late' where id = $1 returning 1`,
        [h.memberMember],
      ),
      FROZEN,
    );
    await assert.rejects(cancelDeletion(h.owner, h.id), ALREADY_ERASING);
  };

  let before = await counts();
  let calls = 0;
  let slowest = 0;
  for (;;) {
    assert.ok(++calls <= 40, "the erase does not end");
    const began = performance.now();
    const done = await hdStep(h.id);
    slowest = Math.max(slowest, performance.now() - began);
    const now = await counts();
    const removed = total(before) - total(now);
    assert.ok(removed <= BUDGET, `call ${calls} removed ${removed} rows`);
    // No table grows, and none is touched before the ones under it are empty.
    for (const table of Object.keys(WHERE))
      assert.ok(now[table] <= before[table], `${table} grew`);
    if (now.notes < before.notes)
      for (const table of ["note_versions", "note_entities", "links", "files"])
        assert.equal(now[table], 0, `notes before ${table}`);
    if (now.folders < before.folders) assert.equal(now.notes, 0);
    if (now.workspaces < before.workspaces)
      for (const table of ["folders", "agents", "notes", "files"])
        assert.equal(now[table], 0, `workspaces before ${table}`);
    if (now.members < before.members)
      for (const table of Object.keys(WHERE))
        if (table !== "members")
          assert.equal(now[table], 0, `members before ${table}`);
    if (done) {
      assert.equal(total(now), 0);
      break;
    }
    assert.ok(removed > 0, `call ${calls} removed nothing`);
    await between(now);
    before = now;
  }
  // Too much for one call or two, and each call well inside the 8 seconds
  // the API gives a statement.
  assert.ok(calls >= 8, `${calls} calls`);
  assert.ok(slowest < 8000, `the slowest call took ${Math.round(slowest)} ms`);
  console.log(
    `erased ${total(start)} rows in ${calls} calls, the slowest ${Math.round(slowest)} ms`,
  );

  assert.equal(
    (await db.query(`select 1 from public.hives where id = $1`, [h.id])).rows
      .length,
    0,
  );
  const done = await hdRecord(h.id);
  assert.ok(Math.abs(done.purged_at - Date.now()) < 60_000);
  assert.deepEqual({ ...done, purged_at: null }, record);
  assert.deepEqual(await hdSnapshot(o.id), other);
  await assert.rejects(hdStep(h.id), HIVE_NOT_FOUND);
});

test("the server's deletes pass only inside a step of the erase, and only for that hive", async () => {
  const a = await hdHive();
  const b = await hdHive();
  for (const h of [a, b]) {
    await requestDeletion(h.owner, h.id, h.name);
    await hdMakeDue(h.id);
    await hdBegin(h.id);
  }
  const before = [await hdSnapshot(a.id), await hdSnapshot(b.id)];
  const gone = `delete from public.notes where id = $1 returning 1`;
  // The service role by itself, outside purge_hive: refused, on every table.
  for (const [sql, params] of [
    [gone, [a.ownerNote]],
    [`delete from public.note_versions where note_id = $1`, [a.ownerNote]],
    [`delete from public.folders where id = $1`, [a.folder]],
    [`delete from public.files where id = $1`, [a.file]],
    [`delete from public.agents where id = $1`, [a.ownerAgentId]],
    [`delete from public.workspaces where id = $1`, [a.spareSpace]],
    [`delete from public.members where id = $1`, [a.memberMember]],
  ])
    await assert.rejects(asService(sql, params), FROZEN, sql);
  const refused = async (marker, role, sql, params) => {
    const r = await withMarker(marker, role, sql, params);
    assert.match(String(r.error ?? "(it worked)"), FROZEN, `${marker} ${role}`);
  };
  // The marker of one erase opens nothing in another hive's.
  await refused(a.id, "service_role", gone, [b.ownerNote]);
  await refused(b.id, "service_role", gone, [a.ownerNote]);
  // Nor does a marker that names no hive, or a hive that is not being erased.
  for (const marker of ["", "x", NOBODY, hive])
    await refused(marker, "service_role", gone, [a.ownerNote]);
  // The marker without the server's role opens nothing either.
  await refused(a.id, "none", gone, [a.ownerNote]);
  // Both together are what purge_hive has, and they open deletes only.
  const inside = await withMarker(a.id, "service_role", gone, [a.ownerNote]);
  assert.equal(inside.error, undefined, inside.error?.message);
  assert.equal(inside.rows.length, 1);
  await refused(
    a.id,
    "service_role",
    `update public.notes set body = 'late' where id = $1`,
    [a.ownerNote],
  );
  await refused(
    a.id,
    "service_role",
    `insert into public.entities (hive_id, type, canonical_name) values ($1, 'client', 'Late Ltd')`,
    [a.id],
  );
  assert.deepEqual([await hdSnapshot(a.id), await hdSnapshot(b.id)], before);

  // Erasing a leaves b as it was, and the marker does not outlive the call.
  await hdRemoveObjects(a.id);
  assert.equal(await hdStep(a.id), true);
  assert.deepEqual(await hdSnapshot(b.id), before[1]);
  await assert.rejects(asService(gone, [b.ownerNote]), FROZEN);
  const marker = (
    await asService(`select current_setting('hive.purging', true) as m`)
  )[0].m;
  assert.ok([null, ""].includes(marker), `the marker is still ${marker}`);
  await hdRemoveObjects(b.id);
  assert.equal(await hdStep(b.id), true);
});

test("who wrote a note is the database's to say", async () => {
  const h = await hdHive();
  const o = await hdHive();
  const wrote = async (id) =>
    (
      await db.query(
        `select written_by_agent as agent, version from public.notes where id = $1`,
        [id],
      )
    ).rows[0];
  const set = (who, id, agent, more = "") =>
    as(
      who,
      `update public.notes set written_by_agent = $2${more} where id = $1 returning 1`,
      [id, agent],
    );
  const heldAgentId = h.heldAgent.agent_id;
  assert.deepEqual(await wrote(h.agentNote), {
    agent: h.memberAgentId,
    version: 1,
  });
  assert.deepEqual(await wrote(h.memberNote), { agent: null, version: 1 });

  // A person cannot put another agent's name on a note, take the name off,
  // or put one on a note they wrote themself: without a change of content
  // the column stays as it is. Not an agent of theirs, not a colleague's,
  // not one of another hive.
  for (const agent of [heldAgentId, h.ownerAgentId, o.ownerAgentId, null]) {
    assert.equal((await set(h.member, h.agentNote, agent)).length, 1);
    assert.equal((await wrote(h.agentNote)).agent, h.memberAgentId);
  }
  for (const agent of [h.memberAgentId, h.ownerAgentId, o.ownerAgentId]) {
    assert.equal((await set(h.member, h.memberNote, agent)).length, 1);
    assert.equal((await wrote(h.memberNote)).agent, null);
  }
  // Nor an agent, and nor the database owner by a plain update.
  assert.equal(
    (await set(h.memberAgent, h.memberNote2, heldAgentId)).length,
    1,
  );
  assert.equal((await wrote(h.memberNote2)).agent, null);
  await asDbOwner(
    null,
    `update public.notes set written_by_agent = $2 where id = $1`,
    [h.memberNote, o.ownerAgentId],
  );
  assert.equal((await wrote(h.memberNote)).agent, null);
  // The rest of such an update is applied as before.
  await set(h.member, h.agentNote, null, `, visibility = 'group'`);
  assert.equal((await wrote(h.agentNote)).agent, h.memberAgentId);
  assert.equal(
    (
      await db.query(`select visibility from public.notes where id = $1`, [
        h.agentNote,
      ])
    ).rows[0].visibility,
    "group",
  );
  // A new note says who wrote it whatever the row claims.
  const forged = (
    await as(
      h.member,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title, written_by_agent)
       values ($1, $2, $3, 'forged.md', 'forged', $4) returning id`,
      [h.id, h.memberMember, h.memberSpace, h.ownerAgentId],
    )
  )[0].id;
  assert.equal((await wrote(forged)).agent, null);

  // What sets it, as before: a change of content, by whoever makes it.
  await as(
    h.memberAgent,
    `update public.notes set body = 'agent' where id = $1`,
    [h.memberNote],
  );
  assert.deepEqual(await wrote(h.memberNote), {
    agent: h.memberAgentId,
    version: 2,
  });
  await set(h.member, h.memberNote, heldAgentId, `, body = 'person'`);
  assert.deepEqual(await wrote(h.memberNote), { agent: null, version: 3 });
  // A held note released by its owner keeps the agent that wrote it.
  await release(h.member, h.heldNote);
  assert.equal((await wrote(h.heldNote)).agent, heldAgentId);
  // And when an agent is deleted, the notes it wrote lose the name, as the
  // foreign key says.
  await asDbOwner(null, `delete from public.agents where id = $1`, [
    heldAgentId,
  ]);
  assert.equal((await wrote(h.heldNote)).agent, null);
  assert.equal((await wrote(h.agentNote)).agent, h.memberAgentId);
});

test("the server lists a hive's stored objects, a page at a time, only once its erase has begun", async () => {
  const h = await hdHive();
  const o = await hdHive();
  const paths = (id, after, limit) =>
    asService(`select * from public.hive_object_paths($1, $2, $3)`, [
      id,
      after,
      limit,
    ]).then((rows) => rows.map((r) => r.name));
  // Put there as the database owner: objects with no files row, one outside
  // any workspace, and names that only look like the hive's.
  await db.exec("reset role");
  await db.query(
    `insert into storage.buckets (id, name) values ('other', 'other')
     on conflict (id) do nothing`,
  );
  const put = (name, bucket = "files") =>
    db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [
      bucket,
      name,
    ]);
  const mine = [
    h.filePath,
    h.memberFilePath,
    `${h.ownerMember}/${h.ownerSpace}/outputs/z.pdf`,
    `${h.ownerMember}/${h.ownerSpace}/Outputs/A.pdf`,
    `${h.ownerMember}/${h.spareSpace}/outputs/s.pdf`,
    `${h.memberMember}/loose.bin`,
    `${h.memberMember}/~last`,
  ];
  for (const name of mine.slice(2)) await put(name);
  const notMine = [
    `${h.ownerMember}`,
    `${h.ownerMember}0/after.pdf`,
    `${h.ownerMember}./before.pdf`,
    `x${h.ownerMember}/prefixed.pdf`,
    `${h.id}/by-hive.pdf`,
  ];
  for (const name of notMine) await put(name);
  await put(`${h.ownerMember}/${h.ownerSpace}/elsewhere.pdf`, "other");
  // Bytewise order, as the function sorts.
  const expected = [...mine].sort((a, b) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  );

  // Not before the erase has begun: an open hive, a closing one, a due one.
  await assert.rejects(paths(NOBODY, null, 10), HIVE_NOT_FOUND);
  await assert.rejects(paths(h.id, null, 10), NOT_DUE);
  await requestDeletion(h.owner, h.id, h.name);
  await assert.rejects(paths(h.id, null, 10), NOT_DUE);
  await hdMakeDue(h.id);
  await assert.rejects(paths(h.id, null, 10), NOT_DUE);
  for (const who of [h.owner, h.member, h.memberAgent, h.pass, null])
    await assert.rejects(
      as(who, `select * from public.hive_object_paths($1, null, 10)`, [h.id]),
      DENIED,
    );

  await hdBegin(h.id);
  // Null or empty starts from the beginning; each row is a name and nothing
  // else.
  assert.deepEqual(await paths(h.id, null, 1000), expected);
  assert.deepEqual(await paths(h.id, "", 1000), expected);
  assert.deepEqual(
    await asService(`select * from public.hive_object_paths($1, null, 1)`, [
      h.id,
    ]),
    [{ name: expected[0] }],
  );
  // Byte by byte: a capital letter sorts before a small one.
  assert.ok(
    expected.indexOf(`${h.ownerMember}/${h.ownerSpace}/Outputs/A.pdf`) <
      expected.indexOf(h.filePath),
  );
  // Page by page, each one starting after the last name of the one before.
  const paged = [];
  let after = null;
  for (;;) {
    const page = await paths(h.id, after, 3);
    assert.ok(page.length <= 3);
    if (page.length === 0) break;
    paged.push(...page);
    after = page.at(-1);
  }
  assert.deepEqual(paged, expected);
  assert.deepEqual(await paths(h.id, expected.at(-1), 10), []);
  assert.deepEqual(await paths(h.id, expected[2], 2), expected.slice(3, 5));
  // The limit is at least 1 and at most 1,000.
  assert.deepEqual(await paths(h.id, null, 0), expected.slice(0, 1));
  assert.deepEqual(await paths(h.id, null, -5), expected.slice(0, 1));
  await db.query(
    `insert into storage.objects (bucket_id, name)
     select 'files', $1 || '/bulk/' || lpad(i::text, 4, '0') from generate_series(1, 1000) i`,
    [h.memberMember],
  );
  assert.equal((await paths(h.id, null, 5000)).length, 1000);
  assert.equal((await paths(h.id, null, 1000)).length, 1000);

  // Another hive's objects are never in the list, and its own list is not
  // given: its erase has not begun.
  const all = [];
  after = null;
  for (;;) {
    const page = await paths(h.id, after, 1000);
    if (page.length === 0) break;
    all.push(...page);
    after = page.at(-1);
  }
  assert.equal(all.length, mine.length + 1000);
  for (const name of [...notMine, o.filePath, o.memberFilePath])
    assert.ok(!all.includes(name), name);
  assert.ok(
    all.every(
      (name) =>
        name.startsWith(`${h.ownerMember}/`) ||
        name.startsWith(`${h.memberMember}/`),
    ),
  );
  await assert.rejects(paths(o.id, null, 10), NOT_DUE);

  // Listing removes nothing: the erase does not finish while they are there.
  assert.equal(await hdStep(h.id), false);
  await assert.rejects(hdStep(h.id), STORED_REMAIN);
  assert.equal((await paths(h.id, null, 1000)).length, 1000);
  // Removed the way the purge function does it, the list ends with the hive.
  await hdRemoveObjects(h.id);
  assert.deepEqual(await paths(h.id, null, 1000), []);
  assert.equal(await hdStep(h.id), true);
  await assert.rejects(paths(h.id, null, 10), HIVE_NOT_FOUND);
  // The names that only looked like the hive's are still there.
  assert.equal(
    (
      await db.query(
        `select count(*)::int as n from storage.objects where name = any ($1::text[])`,
        [[...notMine, o.filePath, o.memberFilePath]],
      )
    ).rows[0].n,
    notMine.length + 2,
  );
});

test("a row names one hive only, and a row left across two cannot stop an erase", async () => {
  const v = await hdHive();
  const t = await hdHive();
  // One person in both hives: a member of v, and now of t.
  const both = v.member;
  const inT = await addMember(t.id, v.memberUser, "Both");
  const spaceInT = (
    await db.query(`select id from public.workspaces where member_id = $1`, [
      inT,
    ])
  ).rows[0].id;
  const noteInT = (
    await as(
      both,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'both.md', 'both') returning id`,
      [t.id, inT, spaceInT],
    )
  )[0].id;
  const folderInV = (
    await as(
      both,
      `insert into public.folders (workspace_id, member_id, path)
       values ($1, $2, 'mine') returning id`,
      [v.memberSpace, v.memberMember],
    )
  )[0].id;
  const folderInT = (
    await as(
      both,
      `insert into public.folders (workspace_id, member_id, path)
       values ($1, $2, 'mine') returning id`,
      [spaceInT, inT],
    )
  )[0].id;
  const before = [await hdSnapshot(v.id), await hdSnapshot(t.id)];

  const SPACE = /^error: a workspace belongs to its member's hive$/;
  const TAG = /^error: a note and an entity must be in the same hive$/;
  const CONFIRMED =
    /^error: a tag is confirmed by a member of the note's hive$/;
  const FOLDER = /^error: a note's folder must be in the note's own workspace$/;
  const PAGE = /^error: a synthesis page belongs to its entity's hive$/;
  const AGENT = /^error: workspace does not belong to this member$/;
  // Through the API, as the person who is in both.
  for (const [sql, params, why] of [
    [
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'Astride')`,
      [v.id, inT],
      SPACE,
    ],
    [
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'Astride')`,
      [t.id, v.memberMember],
      SPACE,
    ],
    [
      `insert into public.note_entities (note_id, entity_id) values ($1, $2)`,
      [noteInT, v.entity],
      TAG,
    ],
    [
      `insert into public.note_entities (note_id, entity_id) values ($1, $2)`,
      [v.memberNote, t.entity],
      TAG,
    ],
    [
      `insert into public.note_entities (note_id, entity_id, confirmed_by) values ($1, $2, $3)`,
      [noteInT, t.entity, v.memberMember],
      CONFIRMED,
    ],
    [
      `update public.notes set folder_id = $2 where id = $1`,
      [noteInT, folderInV],
      FOLDER,
    ],
    [
      `insert into public.notes (hive_id, member_id, workspace_id, folder_id, path, title) values ($1, $2, $3, $4, 'astride.md', 'astride')`,
      [t.id, inT, spaceInT, folderInV],
      FOLDER,
    ],
  ])
    await assert.rejects(as(both, sql, params), why, sql);
  // And for the database owner, whom no policy binds.
  for (const [sql, params, why] of [
    [
      `update public.workspaces set hive_id = $1 where id = $2`,
      [t.id, v.spareSpace],
      SPACE,
    ],
    [
      `update public.workspaces set member_id = $1 where id = $2`,
      [inT, v.spareSpace],
      SPACE,
    ],
    [
      `update public.note_entities set entity_id = $1 where note_id = $2`,
      [t.entity, v.ownerNote],
      TAG,
    ],
    [
      `update public.note_entities set note_id = $1 where note_id = $2`,
      [noteInT, v.ownerNote],
      TAG,
    ],
    [
      `update public.note_entities set confirmed_by = $1 where note_id = $2`,
      [inT, v.ownerNote],
      CONFIRMED,
    ],
    [
      `update public.synthesis_pages set hive_id = $1 where entity_id = $2`,
      [t.id, v.entity],
      PAGE,
    ],
    [
      `insert into public.synthesis_pages (entity_id, hive_id) values ($1, $2)`,
      [v.entity2, t.id],
      PAGE,
    ],
    [
      `update public.agents set workspace_id = $1 where id = $2`,
      [v.ownerSpace, v.memberAgentId],
      AGENT,
    ],
    [
      `insert into public.agents (member_id, workspace_id, name, provider, token_hash) values ($1, $2, 'x', 'other', 'hd-astride')`,
      [inT, v.memberSpace],
      AGENT,
    ],
    [
      `update public.notes set folder_id = $2 where id = $1`,
      [v.memberNote, v.folder],
      FOLDER,
    ],
  ])
    await assert.rejects(asDbOwner(null, sql, params), why, sql);
  // An entity stays in its hive, for the owner of two hives too: moving it
  // would take its tags across.
  const ENTITY = /^error: an entity stays in its hive$/;
  const ownersOther = await startHive(v.owner, `Other ${v.tag}`);
  const move = `update public.entities set hive_id = $1 where id = $2 returning 1`;
  await assert.rejects(as(v.owner, move, [ownersOther, v.entity]), ENTITY);
  await assert.rejects(as(v.owner, move, [ownersOther, v.entity2]), ENTITY);
  await assert.rejects(asDbOwner(null, move, [t.id, v.entity]), ENTITY);
  // Anything else about it is the owner's to change, as before.
  assert.equal(
    (
      await as(
        v.owner,
        `update public.entities set canonical_name = 'Renamed', hive_id = $1 where id = $2 returning 1`,
        [v.id, v.entity2],
      )
    ).length,
    1,
  );
  await as(
    v.owner,
    `update public.entities set canonical_name = $1 where id = $2`,
    [`${v.tag} Other Ltd`, v.entity2],
  );
  assert.deepEqual([await hdSnapshot(v.id), await hdSnapshot(t.id)], before);
  // Rows of one hive are written as before.
  await as(
    both,
    `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'Second')`,
    [t.id, inT],
  );
  await as(
    both,
    `insert into public.note_entities (note_id, entity_id, confirmed_by) values ($1, $2, $3)`,
    [noteInT, t.entity, inT],
  );
  await as(both, `update public.notes set folder_id = $2 where id = $1`, [
    noteInT,
    folderInT,
  ]);

  // Rows from before the rule, put there with the check switched off: a
  // workspace in v under a member of t with a note in it, a note of t tagged
  // with an entity of v, a tag in t confirmed by a member of v, and a note of
  // t in a folder of v.
  const unchecked = async (table, sql, params) => {
    await db.exec("reset role");
    await db.exec(`alter table public.${table} disable trigger zzz_one_hive`);
    try {
      return (await db.query(sql, params)).rows;
    } finally {
      await db.exec(`alter table public.${table} enable trigger zzz_one_hive`);
    }
  };
  const astride = (
    await unchecked(
      "workspaces",
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'Astride') returning id`,
      [v.id, inT],
    )
  )[0].id;
  const astrideNote = (
    await asDbOwner(
      null,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'astride.md', 'astride') returning id, hive_id`,
      [v.id, inT, astride],
    )
  )[0];
  assert.equal(astrideNote.hive_id, v.id);
  await unchecked(
    "note_entities",
    `insert into public.note_entities (note_id, entity_id) values ($1, $2)`,
    [noteInT, v.entity2],
  );
  await unchecked(
    "note_entities",
    `update public.note_entities set confirmed_by = $1 where note_id = $2 and entity_id = $3`,
    [v.ownerMember, noteInT, t.entity],
  );
  await unchecked(
    "notes",
    `update public.notes set folder_id = $1 where id = $2`,
    [v.folder, noteInT],
  );

  // t is closing and stays so; v's day has come.
  await requestDeletion(t.owner, t.id, t.name);
  await requestDeletion(v.owner, v.id, v.name);
  await hdMakeDue(v.id);
  const tBefore = await hdSnapshot(t.id);
  await hdBegin(v.id);
  await hdRemoveObjects(v.id);
  assert.equal(await hdStep(v.id), true);

  // v is gone, with the rows that hung across.
  const gone = await hdSnapshot(v.id);
  for (const table of Object.keys(HD_TABLES))
    assert.deepEqual(gone[table], [], table);
  for (const [table, id] of [
    ["hives", v.id],
    ["workspaces", astride],
    ["notes", astrideNote.id],
  ])
    assert.equal(
      (
        await db.query(
          `select count(*)::int as n from public.${table} where id = $1`,
          [id],
        )
      ).rows[0].n,
      0,
      table,
    );
  assert.ok((await hdRecord(v.id)).purged_at);
  // t lost only what pointed into v: the tag with v's entity, and the two
  // references the foreign keys emptied.
  const tAfter = await hdSnapshot(t.id);
  assert.deepEqual(tAfter, {
    ...tBefore,
    notes: tBefore.notes.map((n) =>
      n.id === noteInT ? { ...n, folder_id: null } : n,
    ),
    note_entities: tBefore.note_entities
      .filter((r) => r.entity_id !== v.entity2)
      .map((r) => (r.note_id === noteInT ? { ...r, confirmed_by: null } : r)),
  });
  assert.equal(tBefore.note_entities.length, tAfter.note_entities.length + 1);

  // And t is as frozen as it was: none of this lets a delete of its own
  // through, not of a note, not of a member, and not of the account of a
  // person who is in it.
  await assert.rejects(
    as(both, `delete from public.notes where id = $1 returning 1`, [noteInT]),
    FROZEN,
  );
  for (const [sql, params] of [
    [`delete from public.members where id = $1`, [inT]],
    [`delete from auth.users where id = $1`, [v.memberUser]],
    [`delete from auth.users where id = $1`, [t.memberUser]],
    [`delete from public.workspaces where id = $1`, [spaceInT]],
    [`delete from public.entities where id = $1`, [t.entity]],
    [`update public.notes set folder_id = null where id = $1`, [noteInT]],
    [`update public.files set note_id = null where id = $1`, [t.file]],
    [
      `update public.invitations set invited_by = null where id = $1`,
      [t.invitation],
    ],
  ])
    await assert.rejects(asDbOwner(null, sql, params), FROZEN, sql);
  assert.deepEqual(await hdSnapshot(t.id), tAfter);
  assert.equal(
    (
      await db.query(
        `select count(*)::int as n from auth.users where id = any ($1::uuid[])`,
        [[v.memberUser, t.memberUser]],
      )
    ).rows[0].n,
    2,
  );
});

test("nobody truncates a hive's tables through the API", async () => {
  const h = await hdHive();
  const before = await hdSnapshot(h.id);
  for (const table of [...Object.keys(HD_TABLES), ...HD_OPEN]) {
    const rights = (
      await db.query(
        `select has_table_privilege('anon', $1, 'truncate') as anon,
                has_table_privilege('authenticated', $1, 'truncate') as signed_in`,
        [`public.${table}`],
      )
    ).rows[0];
    assert.deepEqual(rights, { anon: false, signed_in: false }, table);
    for (const who of [h.owner, h.member, h.memberAgent, h.pass, null])
      for (const sql of [
        `truncate public.${table}`,
        `truncate public.${table} cascade`,
      ]) {
        const r = await trial(who, sql);
        assert.match(r.error?.message ?? "(it worked)", DENIED, sql);
      }
  }
  assert.deepEqual(await hdSnapshot(h.id), before);
});

// ---------------------------------------------------------------------------
// Workspaces: a name of 1 to 60 characters and at most 20 for one member
// (20261124110155_workspace_cap.sql). The app makes a workspace when a person
// imports a folder of notes.
// ---------------------------------------------------------------------------
const WS_NO_NAME = /a workspace needs a name/;
const WS_LONG_NAME = /that workspace name is too long/;
const WS_CAP = /you already have 20 workspaces/;
const WS_POLICY = /row-level security/;
// A person with a hive of their own: one member, one workspace ("Main").
let wsPeople = 0;
const wsPerson = async () => {
  const who = await hivePerson();
  const hiveId = await startHive(who, `Workspaces ${++wsPeople}`);
  const [mine] = await membershipsOf(who.sub);
  return { who, hive: hiveId, member: mine.id };
};
const addSpace = (p, name, who = p.who) =>
  as(
    who,
    `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, $3) returning id, name`,
    [p.hive, p.member, name],
  ).then((r) => r[0]);
const spacesOf = async (member) =>
  (
    await db.query(
      `select name from public.workspaces where member_id = $1 order by name`,
      [member],
    )
  ).rows.map((r) => r.name);
const fillSpaces = async (p) => {
  for (let n = 2; n <= 20; n++) await addSpace(p, `Space ${n}`);
};
const notTheLimit = (e) => {
  assert.doesNotMatch(String(e), WS_CAP);
  return true;
};

test("a workspace needs a name of 1 to 60 characters, stored trimmed", async () => {
  const p = await wsPerson();
  for (const name of ["", "   ", ALL_SPACE, null])
    await assert.rejects(addSpace(p, name), WS_NO_NAME, JSON.stringify(name));
  await assert.rejects(addSpace(p, "x".repeat(61)), WS_LONG_NAME);
  // Counted in characters, after trimming.
  const sixty = "é".repeat(60);
  assert.equal((await addSpace(p, ` ${sixty}\t`)).name, sixty);
  assert.equal(
    (await addSpace(p, `${ALL_SPACE}Research notes${ALL_SPACE}`)).name,
    "Research notes",
  );
  // Only white space is trimmed: a v at either end stays, and so does the
  // white space inside.
  assert.equal((await addSpace(p, "vault  v")).name, "vault  v");
  assert.deepEqual(
    await spacesOf(p.member),
    ["Main", "Research notes", "vault  v", sixty].sort(),
  );

  // A name that differs only by the white space around it is the same name.
  await assert.rejects(addSpace(p, " Research notes "), /unique|duplicate/);

  // A new name is held to the same rules, whoever gives it. A person cannot
  // rename a workspace at all: there is no update policy.
  const rename = (to, from) =>
    asDbOwner(
      null,
      `update public.workspaces set name = $1 where member_id = $2 and name = $3 returning name`,
      [to, p.member, from],
    );
  assert.deepEqual(await rename("  Renamed ", "Research notes"), [
    { name: "Renamed" },
  ]);
  await assert.rejects(rename(" \n ", "Renamed"), WS_NO_NAME);
  await assert.rejects(rename("y".repeat(61), "Renamed"), WS_LONG_NAME);
  assert.deepEqual(
    await as(
      p.who,
      `update public.workspaces set name = 'Mine now' where member_id = $1 returning name`,
      [p.member],
    ),
    [],
  );
  assert.deepEqual(
    await spacesOf(p.member),
    ["Main", "Renamed", "vault  v", sixty].sort(),
  );
});

test("a member has at most 20 workspaces; other members are not affected", async () => {
  const p = await wsPerson();
  await fillSpaces(p);
  assert.equal((await spacesOf(p.member)).length, 20);

  await assert.rejects(addSpace(p, "One too many"), WS_CAP);
  await assert.rejects(addSpace(p, "One too many"), WS_CAP);
  // The trigger binds the database's owner as well.
  await assert.rejects(
    asDbOwner(
      null,
      `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, 'One too many')`,
      [p.hive, p.member],
    ),
    WS_CAP,
  );
  // A name that is wrong is said before the limit.
  await assert.rejects(addSpace(p, " "), WS_NO_NAME);
  await assert.rejects(addSpace(p, "x".repeat(61)), WS_LONG_NAME);
  assert.equal((await spacesOf(p.member)).length, 20);

  // Another member of the same hive still makes theirs.
  const guest = await hivePerson();
  const guestMember = await addMember(p.hive, guest.sub, "Guest");
  const g = { who: guest, hive: p.hive, member: guestMember };
  assert.equal((await addSpace(g, "Guest notes")).name, "Guest notes");
  // And so does the same person as a member of another hive: the limit is a
  // member's, not a person's.
  const second = await startHive(p.who, `Workspaces ${wsPeople} again`);
  const elsewhere = (await membershipsOf(p.who.sub)).find(
    (m) => m.hive_id === second,
  );
  assert.deepEqual(elsewhere.workspaces, ["Main"]);
  assert.equal(
    (await addSpace({ ...p, hive: second, member: elsewhere.id }, "Second"))
      .name,
    "Second",
  );

  // A name can still change at the limit, and a deleted workspace makes room
  // for one.
  await asDbOwner(
    null,
    `update public.workspaces set name = 'Space two' where member_id = $1 and name = 'Space 2'`,
    [p.member],
  );
  await as(
    p.who,
    `delete from public.workspaces where member_id = $1 and name = 'Space 3'`,
    [p.member],
  );
  assert.equal((await addSpace(p, "Room again")).name, "Room again");
  await assert.rejects(addSpace(p, "One too many"), WS_CAP);
  const names = await spacesOf(p.member);
  assert.equal(names.length, 20);
  assert.ok(names.includes("Space two") && !names.includes("Space 3"));
});

test("nobody learns from the limit how many workspaces somebody else has", async () => {
  const p = await wsPerson();
  await fillSpaces(p);
  const guest = await hivePerson();
  await addMember(p.hive, guest.sub, "Guest");
  const other = await wsPerson();
  // A colleague and a stranger naming the member who is at the limit get the
  // policy's answer, the one they get for a member who is not.
  for (const who of [guest, other.who])
    await assert.rejects(addSpace(p, "Not mine", who), WS_POLICY);
  await assert.rejects(addSpace(other, "Not mine", guest), WS_POLICY);
  // A visitor and a signed-in token with nobody behind it are not told either.
  await assert.rejects(addSpace(p, "Not mine", null), notTheLimit);
  await assert.rejects(
    addSpace(p, "Not mine", { role: "authenticated" }),
    notTheLimit,
  );
  assert.equal((await spacesOf(p.member)).length, 20);
});

test("an agent and an app pass still cannot make a workspace", async () => {
  const count = async () =>
    (await db.query(`select count(*)::int as n from public.workspaces`)).rows[0]
      .n;
  const before = await count();
  const mine = { hive, member: members.sara };
  for (const tier of ["vendor", "self_hosted"])
    await assert.rejects(
      addSpace(mine, "By an agent", await agentFor("sara", tier)),
      WS_POLICY,
    );
  await assert.rejects(
    addSpace(mine, "By an app", passOf(person("sara"))),
    WS_POLICY,
  );
  await assert.rejects(
    addSpace(mine, "By a visitor", null),
    /row-level security|permission denied/,
  );
  assert.equal(await count(), before);
  // The person themselves still can.
  const made = await addSpace(mine, "By Sara", person("sara"));
  assert.equal(made.name, "By Sara");
  await as(person("sara"), `delete from public.workspaces where id = $1`, [
    made.id,
  ]);
});

test("a hive that is being deleted, and a workspace across two hives, answer as before", async () => {
  const h = await hdHive();
  const o = await hdHive();
  const owner = { who: h.owner, hive: h.id, member: h.ownerMember };
  // The owner has "Main" and "Spare": 18 more makes 20.
  for (let n = 3; n <= 20; n++) await addSpace(owner, `Space ${n}`);
  await assert.rejects(addSpace(owner, "One too many"), WS_CAP);

  // Across two hives: the member's hive is not the row's. Said before the
  // name and before the limit.
  for (const name of ["Astride", "", "x".repeat(61)])
    await assert.rejects(
      asDbOwner(
        null,
        `insert into public.workspaces (hive_id, member_id, name) values ($1, $2, $3)`,
        [o.id, h.ownerMember, name],
      ),
      /a workspace belongs to its member's hive/,
      JSON.stringify(name),
    );

  await requestDeletion(h.owner, h.id, h.name);
  // Closing: the freeze answers, whatever the name and at the limit.
  for (const name of ["One too many", "", "x".repeat(61)])
    await assert.rejects(addSpace(owner, name), FROZEN, JSON.stringify(name));
  await assert.rejects(
    asDbOwner(null, `update public.workspaces set name = '' where id = $1`, [
      h.spareSpace,
    ]),
    FROZEN,
  );
  await assert.rejects(
    addSpace({ who: h.member, hive: h.id, member: h.memberMember }, "New"),
    FROZEN,
  );
  assert.equal((await spacesOf(h.ownerMember)).length, 20);

  // Cancelled: the workspace's own rules answer again.
  await cancelDeletion(h.owner, h.id);
  await assert.rejects(addSpace(owner, "One too many"), WS_CAP);
  await assert.rejects(addSpace(owner, ""), WS_NO_NAME);
});

// ------------------------------------------------------------ a note's dates
// created_at is when a note was written, updated_at when it last changed. Only
// a person sets them (an import does, for a note written long ago); for an
// agent or a connected app they are the real moment. notes_before_write
// decides, so these tests read the stored row.

const ND_WRITTEN = "2024-03-14T12:00:00.000Z";
const ND_CHANGED = "2024-06-01T09:30:00.000Z";
// No date a person sets is before this.
const ND_FLOOR = "1990-01-01T00:00:00.000Z";
const ndRow = async (id) => {
  const r = (
    await db.query(
      `select created_at, updated_at, version, written_by_agent as agent
         from public.notes where id = $1`,
      [id],
    )
  ).rows[0];
  return {
    created: r.created_at.toISOString(),
    updated: r.updated_at.toISOString(),
    version: r.version,
    agent: r.agent,
  };
};
// Within a minute of this moment: the dates in these tests are months off.
const ndIsNow = (iso) => Math.abs(Date.now() - Date.parse(iso)) < 60_000;
const ndFromNow = (ms) => new Date(Date.now() + ms).toISOString();
const ND_DAY = 86_400_000;
// A note of `name`'s, written by `who` (or by the database's owner: `run`),
// with the given columns beside the usual ones.
const ndAdd = (who, name, path, cols = {}, run = as) => {
  const keys = Object.keys(cols);
  return run(
    who,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body${keys
      .map((k) => `, ${k}`)
      .join("")})
     values ($1, $2, $3, $4, $5, 'body'${keys
       .map((_, i) => `, $${i + 6}`)
       .join("")}) returning id`,
    [
      hive,
      members[name],
      ws[name],
      `nd/${path}`,
      `nd ${path}`,
      ...Object.values(cols),
    ],
  ).then((r) => r[0].id);
};
// `set` is the text after "set"; its parameters start at $2.
const ndSet = (who, id, set, params = [], run = as) =>
  run(who, `update public.notes set ${set} where id = $1 returning id`, [
    id,
    ...params,
  ]);
const ndVersions = async (id) =>
  (
    await db.query(
      `select count(*)::int as n from public.note_versions where note_id = $1`,
      [id],
    )
  ).rows[0].n;

test("a person gives a note the dates it was written and last changed", async () => {
  const id = await ndAdd(person("dani"), "dani", "kept.md", {
    created_at: ND_WRITTEN,
    updated_at: ND_CHANGED,
  });
  const row = await ndRow(id);
  assert.equal(row.created, ND_WRITTEN);
  assert.equal(row.updated, ND_CHANGED);
  assert.equal(row.version, 1);

  // Only the written date: the note last changed now.
  const half = await ndRow(
    await ndAdd(person("dani"), "dani", "written-only.md", {
      created_at: ND_WRITTEN,
    }),
  );
  assert.equal(half.created, ND_WRITTEN);
  assert.ok(ndIsNow(half.updated));

  // No date at all: both are now, as before.
  const plain = await ndRow(await ndAdd(person("dani"), "dani", "plain.md"));
  assert.ok(ndIsNow(plain.created));
  assert.ok(ndIsNow(plain.updated));
});

test("a date in the future is cut back to now", async () => {
  const id = await ndAdd(person("dani"), "dani", "future.md", {
    created_at: ndFromNow(ND_DAY),
    updated_at: ndFromNow(2 * ND_DAY),
  });
  let row = await ndRow(id);
  assert.ok(ndIsNow(row.created), row.created);
  assert.ok(ndIsNow(row.updated), row.updated);

  // A past written date with a future change: only the change is cut back.
  const mixed = await ndRow(
    await ndAdd(person("dani"), "dani", "future-change.md", {
      created_at: ND_WRITTEN,
      updated_at: ndFromNow(ND_DAY),
    }),
  );
  assert.equal(mixed.created, ND_WRITTEN);
  assert.ok(ndIsNow(mixed.updated), mixed.updated);

  // The same when the dates are changed afterwards.
  await ndSet(person("dani"), id, "created_at = $2, updated_at = $2", [
    ND_WRITTEN,
  ]);
  await ndSet(person("dani"), id, "created_at = $2, updated_at = $3", [
    ndFromNow(ND_DAY),
    ndFromNow(2 * ND_DAY),
  ]);
  row = await ndRow(id);
  assert.ok(ndIsNow(row.created), row.created);
  assert.ok(ndIsNow(row.updated), row.updated);
  assert.equal(row.version, 1);
});

test("a note never changed before it was written", async () => {
  const id = await ndAdd(person("dani"), "dani", "order.md", {
    created_at: ND_CHANGED,
    updated_at: ND_WRITTEN,
  });
  let row = await ndRow(id);
  assert.equal(row.created, ND_CHANGED);
  assert.equal(row.updated, ND_CHANGED);

  // By an update of the change alone, and of the written date alone.
  await ndSet(person("dani"), id, "updated_at = $2", [ND_WRITTEN]);
  row = await ndRow(id);
  assert.equal(row.created, ND_CHANGED);
  assert.equal(row.updated, ND_CHANGED);
  await ndSet(person("dani"), id, "created_at = $2, updated_at = $2", [
    ND_WRITTEN,
  ]);
  await ndSet(person("dani"), id, "created_at = $2", [ND_CHANGED]);
  row = await ndRow(id);
  assert.equal(row.created, ND_CHANGED);
  assert.equal(row.updated, ND_CHANGED);
});

test("an agent's and an app's dates are the real moment, whatever they send", async () => {
  const sent = { created_at: ND_WRITTEN, updated_at: ND_CHANGED };
  const check = async (id, what) => {
    const row = await ndRow(id);
    assert.ok(ndIsNow(row.created), `${what}: created ${row.created}`);
    assert.ok(ndIsNow(row.updated), `${what}: updated ${row.updated}`);
  };
  const agent = await agentFor("dani");
  await check(await ndAdd(agent, "dani", "by-agent.md", sent), "an agent");
  const held = await agentFor("dani", "self_hosted");
  await check(
    await ndAdd(held, "dani", "by-held-agent.md", sent),
    "a self-hosted agent",
  );

  // An app pass writes no note at all (notes_no_app).
  const pass = passOf(person("dani"));
  await assert.rejects(
    ndAdd(pass, "dani", "by-app.md", sent),
    /row-level security/,
  );
  // The rule is the trigger's own and does not lean on that policy: with
  // row-level security out of the way the dates are still the real moment.
  // The same for a self-hosted claim that names no agent.
  await check(
    await ndAdd(pass, "dani", "by-app-owner.md", sent, asDbOwner),
    "an app pass",
  );
  await check(
    await ndAdd(
      { ...person("dani"), aud: "another-audience" },
      "dani",
      "by-audience.md",
      sent,
      asDbOwner,
    ),
    "a token for another audience",
  );
  await check(
    await ndAdd(
      selfHosted("dani"),
      "dani",
      "by-self-hosted.md",
      sent,
      asDbOwner,
    ),
    "a self-hosted claim",
  );
  await asDbOwner(null, `select 1`);
});

test("a person corrects only the dates: no new version, the same writer", async () => {
  const agent = await agentFor("dani");
  const id = await ndAdd(agent, "dani", "corrected.md");
  const before = await ndRow(id);
  assert.equal(before.agent, agent.agent_id);

  const done = await ndSet(
    person("dani"),
    id,
    "created_at = $2, updated_at = $3",
    [ND_WRITTEN, ND_CHANGED],
  );
  assert.equal(done.length, 1);
  assert.deepEqual(await ndRow(id), {
    created: ND_WRITTEN,
    updated: ND_CHANGED,
    version: 1,
    agent: agent.agent_id,
  });
  assert.equal(await ndVersions(id), 1);

  // Nobody else's note: a colleague's update reaches no row.
  await as(
    person("dani"),
    `update public.notes set visibility = 'group' where id = $1`,
    [id],
  );
  const other = await ndSet(person("ahmed"), id, "created_at = $2", [
    "2020-01-01T00:00:00.000Z",
  ]);
  assert.equal(other.length, 0);
  assert.equal((await ndRow(id)).created, ND_WRITTEN);
});

test("an agent or an app cannot change when a note was written", async () => {
  const agent = await agentFor("dani");
  const id = await ndAdd(person("dani"), "dani", "fixed.md", {
    created_at: ND_WRITTEN,
    updated_at: ND_CHANGED,
  });
  const kept = {
    created: ND_WRITTEN,
    updated: ND_CHANGED,
    version: 1,
    agent: null,
  };
  const other = "2020-01-01T00:00:00.000Z";
  const pass = passOf(person("dani"));

  // Unchanged content: both dates keep their old values.
  for (const set of [
    "created_at = $2",
    "updated_at = $2",
    "created_at = $2, updated_at = $2",
    "created_at = $2, body = body",
  ]) {
    assert.equal((await ndSet(agent, id, set, [other])).length, 1, set);
    assert.deepEqual(await ndRow(id), kept, set);
    await ndSet(pass, id, set, [other], asDbOwner);
    assert.deepEqual(await ndRow(id), kept, `an app pass: ${set}`);
    await ndSet(selfHosted("dani"), id, set, [other], asDbOwner);
    assert.deepEqual(await ndRow(id), kept, `a self-hosted claim: ${set}`);
  }
  // Through the API an app pass reaches no row.
  assert.equal((await ndSet(pass, id, "created_at = $2", [other])).length, 0);
  assert.deepEqual(await ndRow(id), kept);

  // With a change of content: the written date still stays, the change is
  // now, whatever was sent.
  await ndSet(
    agent,
    id,
    "body = 'by the agent', created_at = $2, updated_at = $2",
    [other],
  );
  const row = await ndRow(id);
  assert.equal(row.created, ND_WRITTEN);
  assert.ok(ndIsNow(row.updated), row.updated);
  assert.equal(row.version, 2);
  assert.equal(row.agent, agent.agent_id);
  await asDbOwner(null, `select 1`);
});

test("a person's date is never before 1990", async () => {
  const tooOld = "1975-01-01T00:00:00.000Z";
  const id = await ndAdd(person("dani"), "dani", "too-old.md", {
    created_at: tooOld,
    updated_at: tooOld,
  });
  let row = await ndRow(id);
  assert.equal(row.created, ND_FLOOR);
  assert.equal(row.updated, ND_FLOOR);

  // The same when the dates are changed afterwards, one at a time.
  const later = await ndAdd(person("dani"), "dani", "too-old-later.md", {
    created_at: ND_WRITTEN,
    updated_at: ND_CHANGED,
  });
  await ndSet(person("dani"), later, "created_at = $2", [tooOld]);
  row = await ndRow(later);
  assert.equal(row.created, ND_FLOOR);
  assert.equal(row.updated, ND_CHANGED);
  await ndSet(person("dani"), later, "updated_at = $2", [tooOld]);
  row = await ndRow(later);
  assert.equal(row.created, ND_FLOOR);
  assert.equal(row.updated, ND_FLOOR);
  assert.equal(row.version, 1);

  // And when they come with a change of content.
  const edited = await ndAdd(person("dani"), "dani", "too-old-edited.md", {
    created_at: ND_WRITTEN,
    updated_at: ND_CHANGED,
  });
  await ndSet(
    person("dani"),
    edited,
    "body = 'edited', created_at = $2, updated_at = $2",
    [tooOld],
  );
  row = await ndRow(edited);
  assert.equal(row.created, ND_FLOOR);
  assert.equal(row.updated, ND_FLOOR);
  assert.equal(row.version, 2);

  // The first moment allowed is kept as it is.
  const first = await ndRow(
    await ndAdd(person("dani"), "dani", "first-day.md", {
      created_at: ND_FLOOR,
      updated_at: ND_FLOOR,
    }),
  );
  assert.equal(first.created, ND_FLOOR);
  assert.equal(first.updated, ND_FLOOR);
});

test("an agent's change of content is stamped now, whatever date is sent", async () => {
  const agent = await agentFor("dani");
  const id = await ndAdd(person("dani"), "dani", "edited-by-agent.md", {
    created_at: ND_WRITTEN,
    updated_at: ND_CHANGED,
  });
  const sent = "2024-07-01T00:00:00.000Z";
  const check = async (version, by, what) => {
    const row = await ndRow(id);
    assert.equal(row.created, ND_WRITTEN, what);
    assert.ok(ndIsNow(row.updated), `${what}: ${row.updated}`);
    assert.equal(row.version, version, what);
    assert.equal(row.agent, by, what);
  };
  const back = () =>
    asDbOwner(null, `update public.notes set updated_at = $2 where id = $1`, [
      id,
      ND_CHANGED,
    ]);

  await ndSet(agent, id, "body = 'one', updated_at = $2", [sent]);
  await check(2, agent.agent_id, "an agent, a past date");
  await back();
  await ndSet(agent, id, "body = 'two', updated_at = $2", [ndFromNow(ND_DAY)]);
  await check(3, agent.agent_id, "an agent, a future date");
  await back();
  await ndSet(agent, id, "body = 'three'");
  await check(4, agent.agent_id, "an agent, no date");

  // The same for an app pass, a self-hosted claim and the server with no
  // person behind the call, with row-level security out of the way.
  await back();
  await ndSet(
    passOf(person("dani")),
    id,
    "body = 'four', updated_at = $2",
    [sent],
    asDbOwner,
  );
  await check(5, null, "an app pass");
  await back();
  await ndSet(
    selfHosted("dani"),
    id,
    "body = 'five', updated_at = $2",
    [sent],
    asDbOwner,
  );
  await check(6, null, "a self-hosted claim");
  await back();
  await ndSet(null, id, "body = 'six', updated_at = $2", [sent], asDbOwner);
  await check(7, null, "the server");
  await asDbOwner(null, `select 1`);
});

test("a person's change of content is stamped now, or with the past date they send", async () => {
  const id = await ndAdd(person("dani"), "dani", "edited.md", {
    created_at: ND_WRITTEN,
    updated_at: ND_CHANGED,
  });
  const sent = "2024-07-01T00:00:00.000Z";

  // No date sent: now.
  await ndSet(person("dani"), id, "body = 'edited'");
  let row = await ndRow(id);
  assert.equal(row.created, ND_WRITTEN);
  assert.ok(ndIsNow(row.updated), row.updated);
  assert.equal(row.version, 2);
  assert.equal(await ndVersions(id), 2);

  // A date other than the old one: it is kept. The change is still a new
  // version, and the person is its writer.
  await ndSet(person("dani"), id, "body = 'from a file', updated_at = $2", [
    sent,
  ]);
  row = await ndRow(id);
  assert.equal(row.created, ND_WRITTEN);
  assert.equal(row.updated, sent);
  assert.equal(row.version, 3);
  assert.equal(row.agent, null);
  assert.equal(await ndVersions(id), 3);

  // The old date sent again, or null: now.
  await ndSet(person("dani"), id, "body = 'same date', updated_at = $2", [
    sent,
  ]);
  row = await ndRow(id);
  assert.ok(ndIsNow(row.updated), row.updated);
  assert.equal(row.version, 4);
  await ndSet(person("dani"), id, "updated_at = $2", [sent]);
  await ndSet(person("dani"), id, "body = 'no date', updated_at = null");
  row = await ndRow(id);
  assert.ok(ndIsNow(row.updated), row.updated);
  assert.equal(row.version, 5);

  // A future one is cut back to now.
  await ndSet(person("dani"), id, "updated_at = $2", [sent]);
  await ndSet(person("dani"), id, "body = 'future', updated_at = $2", [
    ndFromNow(ND_DAY),
  ]);
  row = await ndRow(id);
  assert.ok(ndIsNow(row.updated), row.updated);
  assert.equal(row.version, 6);

  // One before the note was written is raised to the written date, the new
  // one when both are sent.
  await ndSet(person("dani"), id, "body = 'too early', updated_at = $2", [
    "2024-01-01T00:00:00.000Z",
  ]);
  row = await ndRow(id);
  assert.equal(row.created, ND_WRITTEN);
  assert.equal(row.updated, ND_WRITTEN);
  await ndSet(
    person("dani"),
    id,
    "body = 'both', created_at = $2, updated_at = $3",
    [ND_CHANGED, "2024-05-01T00:00:00.000Z"],
  );
  row = await ndRow(id);
  assert.equal(row.created, ND_CHANGED);
  assert.equal(row.updated, ND_CHANGED);
  assert.equal(row.version, 8);

  // A person may send the written date alone with the new text; a future one
  // is cut back as ever.
  await ndSet(person("dani"), id, "body = 'again', created_at = $2", [
    ND_WRITTEN,
  ]);
  row = await ndRow(id);
  assert.equal(row.created, ND_WRITTEN);
  assert.ok(ndIsNow(row.updated), row.updated);
  assert.equal(row.version, 9);
  await ndSet(person("dani"), id, "title = 'a third', created_at = $2", [
    ndFromNow(ND_DAY),
  ]);
  row = await ndRow(id);
  assert.ok(ndIsNow(row.created), row.created);
  assert.ok(ndIsNow(row.updated), row.updated);
  assert.ok(row.updated >= row.created);
  assert.equal(row.version, 10);
});

test("importing an edited file again finds it unchanged", async () => {
  // The import sends the new text and the file's last-modified time in one
  // update. The stored date is then the file's, so the next run sees no
  // difference.
  const id = await ndAdd(person("dani"), "dani", "imported.md", {
    created_at: ND_WRITTEN,
    updated_at: ND_WRITTEN,
  });
  await ndSet(person("dani"), id, "body = 'edited file', updated_at = $2", [
    ND_CHANGED,
  ]);
  const row = await ndRow(id);
  assert.equal(row.created, ND_WRITTEN);
  assert.equal(row.updated, ND_CHANGED);
  assert.equal(row.version, 2);
});

// A file has one date, created_at, and the map shows it. Nobody sets it
// through the API: files_keep_date makes it the real moment.
const ndFile = (who, name, file, made, run = as) =>
  run(
    who,
    `insert into public.files (hive_id, member_id, workspace_id, storage_path, name, created_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [hive, members[name], ws[name], filePath(name, file), file, made],
  ).then((r) => r[0].id);
const ndFileMade = async (id) =>
  (
    await db.query(`select created_at from public.files where id = $1`, [id])
  ).rows[0].created_at.toISOString();

test("nobody sets a file's date through the API", async () => {
  const old = "2013-01-01T00:00:00.000Z";
  const agent = await agentFor("dani");
  const callers = [
    ["a person", person("dani"), as],
    ["an agent", agent, as],
    ["an app pass", passOf(person("dani")), asDbOwner],
    [
      "a token for another audience",
      { ...person("dani"), aud: "another-audience" },
      asDbOwner,
    ],
  ];
  const ids = {};
  for (const [what, who, run] of callers) {
    const file = `nd-dated-${what.replaceAll(" ", "-")}.pdf`;
    for (const sent of [old, ndFromNow(ND_DAY)]) {
      const id = await ndFile(
        who,
        "dani",
        `${sent.slice(0, 4)}-${file}`,
        sent,
        run,
      );
      const made = await ndFileMade(id);
      assert.ok(ndIsNow(made), `${what}, sent ${sent}: ${made}`);
      ids[what] = id;
    }
  }
  // Through the API an app pass writes no file at all (files_no_app).
  await assert.rejects(
    ndFile(passOf(person("dani")), "dani", "nd-dated-by-app.pdf", old),
    /row-level security/,
  );

  // An update cannot change it. Through the API no update reaches a file
  // (there is no update policy); with row-level security out of the way the
  // date still keeps its old value.
  const id = ids["a person"];
  const made = await ndFileMade(id);
  const set = `update public.files set created_at = $2 where id = $1 returning id`;
  for (const who of [person("dani"), agent]) {
    assert.equal((await as(who, set, [id, old])).length, 0);
    assert.equal(await ndFileMade(id), made);
  }
  for (const [what, who] of [
    ...callers.map(([w, c]) => [w, c]),
    ["a self-hosted claim", selfHosted("dani")],
  ]) {
    for (const sent of [old, ndFromNow(ND_DAY)]) {
      assert.equal((await asDbOwner(who, set, [id, sent])).length, 1, what);
      assert.equal(await ndFileMade(id), made, `${what}, sent ${sent}`);
    }
    await asDbOwner(
      who,
      `update public.files set name = 'renamed', created_at = null where id = $1`,
      [id],
    );
    assert.equal(await ndFileMade(id), made, `${what}, null`);
  }

  // The server with no person behind the call is not checked, as for notes.
  const served = await ndFile(
    null,
    "dani",
    "nd-dated-server.pdf",
    old,
    asDbOwner,
  );
  assert.equal(await ndFileMade(served), old);
  await asDbOwner(null, set, [served, ND_WRITTEN]);
  assert.equal(await ndFileMade(served), ND_WRITTEN);
  await asDbOwner(null, `select 1`);
});

test("an update that sends no date changes no date", async () => {
  const id = await ndAdd(person("dani"), "dani", "shared-later.md", {
    created_at: ND_WRITTEN,
    updated_at: ND_CHANGED,
  });
  await ndSet(person("dani"), id, "visibility = 'group'");
  await ndSet(person("dani"), id, "path = 'nd/moved.md'");
  assert.deepEqual(await ndRow(id), {
    created: ND_WRITTEN,
    updated: ND_CHANGED,
    version: 1,
    agent: null,
  });

  // The server, with no person behind the call (the database's owner, the
  // service key), is not checked: it writes the dates it sends, as before.
  const old = "2000-01-01T00:00:00.000Z";
  const served = await ndAdd(
    null,
    "dani",
    "by-server.md",
    { updated_at: old },
    asDbOwner,
  );
  let row = await ndRow(served);
  assert.ok(ndIsNow(row.created), row.created);
  assert.equal(row.updated, old);
  // A person sharing that note sends no date, so none changes.
  await ndSet(person("dani"), served, "visibility = 'group'");
  row = await ndRow(served);
  assert.ok(ndIsNow(row.created), row.created);
  assert.equal(row.updated, old);
  await asDbOwner(null, `select 1`);
});

test("the map gives each note and file the date it was made", async () => {
  const note = await ndAdd(person("dani"), "dani", "on-the-map.md", {
    created_at: ND_WRITTEN,
  });
  const file = await addFile(person("dani"), "dani", "nd-on-the-map.pdf", note);
  const fileMade = (
    await db.query(`select created_at from public.files where id = $1`, [file])
  ).rows[0].created_at.toISOString();
  const iso = (v) => new Date(Date.parse(v)).toISOString();

  // The owner, and a colleague for whom both are locked.
  for (const who of ["dani", "ahmed"]) {
    const m = await map(person(who));
    const n = nodeOf(m, note);
    assert.equal(n.locked, who === "ahmed", who);
    assert.equal(iso(n.created_at), ND_WRITTEN, who);
    assert.ok(ndIsNow(n.updated_at), who);
    const f = nodeOf(m, file);
    assert.equal(f.locked, who === "ahmed", who);
    assert.equal(iso(f.created_at), fileMade, who);
    assert.equal(iso(f.updated_at), fileMade, who);
  }
  // Every item carries it, and the order is still by last change.
  const m = await map(person("dani"));
  for (const n of m.nodes) assert.ok(n.created_at, n.id);
  const times = m.nodes.map((n) => Date.parse(n.updated_at));
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i]);
});

// ---------------------------------------------------------------- deleting a workspace
// 20261124160731_workspace_delete.sql. Who may delete a workspace is the
// workspaces_delete policy's answer, as before; these cover what the delete
// must not break and the record it leaves.

const WS_LAST = /^error: you need at least one workspace$/;
const WS_AGENT = /^error: this workspace still has an agent in use$/;
const WS_FILES = /^error: this workspace still holds files$/;

const dropSpace = (who, id) =>
  as(who, `delete from public.workspaces where id = $1 returning id`, [id]);
const spaceThere = async (id) =>
  (await db.query(`select 1 from public.workspaces where id = $1`, [id])).rows
    .length === 1;
const noteIn = async (p, space, path) =>
  (
    await as(
      p.who,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
       values ($1, $2, $3, $4, $4, 'text') returning id`,
      [p.hive, p.member, space, path],
    )
  )[0].id;
const notesIn = async (space) =>
  (
    await db.query(
      `select count(*)::int as n from public.notes where workspace_id = $1`,
      [space],
    )
  ).rows[0].n;
const spaceAudits = async (since) =>
  (await auditSince(since)).filter((r) => r.action === "workspace.deleted");

test("a person deletes a workspace of their own, with its folders, notes and links", async () => {
  const p = await wsPerson();
  const [main] = await as(
    p.who,
    `select id from public.workspaces where member_id = $1`,
    [p.member],
  );
  const old = await addSpace(p, "Old import");
  await as(
    p.who,
    `insert into public.folders (workspace_id, member_id, path) values ($1, $2, 'a')`,
    [old.id, p.member],
  );
  const kept = await noteIn(p, main.id, "kept.md");
  const one = await noteIn(p, old.id, "a/one.md");
  const two = await noteIn(p, old.id, "a/two.md");
  await as(
    p.who,
    `insert into public.links (hive_id, from_note, to_note, tier, score)
     values ($1, $2, $3, 2, 0.8), ($1, $2, $4, 2, 0.8)`,
    [p.hive, one, two, kept],
  );
  const mark = await lastAudit();

  assert.deepEqual(await dropSpace(p.who, old.id), [{ id: old.id }]);

  assert.equal(await spaceThere(old.id), false);
  assert.equal(await notesIn(old.id), 0);
  assert.equal(await notesIn(main.id), 1);
  const left = await db.query(
    `select
       (select count(*)::int from public.folders where workspace_id = $1) as folders,
       (select count(*)::int from public.links where from_note = $2 or to_note = $2
                                                  or from_note = $3 or to_note = $3) as links,
       (select count(*)::int from public.note_versions where note_id in ($2, $3)) as versions`,
    [old.id, one, two],
  );
  assert.deepEqual(left.rows[0], { folders: 0, links: 0, versions: 0 });
  assert.deepEqual(await spacesOf(p.member), ["Main"]);

  // One row for the workspace, with counts and nothing that names it.
  const rows = await spaceAudits(mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hive_id, p.hive);
  assert.equal(rows[0].member_id, p.member);
  assert.equal(rows[0].agent_id, null);
  assert.equal(rows[0].note_id, null);
  assert.deepEqual(rows[0].detail, { notes: 2, folders: 1 });
  // Each note still leaves its own row.
  assert.equal(
    (await auditSince(mark)).filter((r) => r.action === "note.deleted").length,
    2,
  );
});

test("a member keeps at least one workspace", async () => {
  const p = await wsPerson();
  const [main] = await as(
    p.who,
    `select id from public.workspaces where member_id = $1`,
    [p.member],
  );
  const mark = await lastAudit();
  await assert.rejects(dropSpace(p.who, main.id), WS_LAST);
  assert.equal(await spaceThere(main.id), true);
  assert.deepEqual(await spaceAudits(mark), []);

  // "Main" is a workspace like any other: with a second one, it may go.
  const other = await addSpace(p, "Second");
  assert.deepEqual(await dropSpace(p.who, main.id), [{ id: main.id }]);
  await assert.rejects(dropSpace(p.who, other.id), WS_LAST);
  assert.deepEqual(await spacesOf(p.member), ["Second"]);

  // Both of two in one statement: neither goes.
  const third = await addSpace(p, "Third");
  await assert.rejects(
    as(p.who, `delete from public.workspaces where member_id = $1`, [p.member]),
    WS_LAST,
  );
  assert.deepEqual(await spacesOf(p.member), ["Second", "Third"]);
  assert.equal(await spaceThere(third.id), true);
});

test("a workspace with an agent in use, or with files, is not deleted", async () => {
  const p = await wsPerson();
  const space = await addSpace(p, "Busy");
  const made = (
    await as(
      p.who,
      `select * from public.create_agent($1, 'Busy agent', 'other', 'vendor')`,
      [space.id],
    )
  )[0];
  await assert.rejects(dropSpace(p.who, space.id), WS_AGENT);
  assert.equal(await spaceThere(space.id), true);

  await as(p.who, `select public.revoke_agent($1)`, [made.agent_id]);
  const path = `${p.member}/${space.id}/report.pdf`;
  const [file] = await as(
    p.who,
    `insert into public.files (hive_id, member_id, workspace_id, storage_path, name)
     values ($1, $2, $3, $4, 'a file') returning id`,
    [p.hive, p.member, space.id, path],
  );
  await assert.rejects(dropSpace(p.who, space.id), WS_FILES);
  assert.equal(await spaceThere(space.id), true);

  await as(p.who, `delete from public.files where id = $1`, [file.id]);
  // A revoked agent does not hold the workspace: it goes with it.
  assert.deepEqual(await dropSpace(p.who, space.id), [{ id: space.id }]);
  assert.equal(
    (
      await db.query(`select 1 from public.agents where id = $1`, [
        made.agent_id,
      ])
    ).rows.length,
    0,
  );
});

test("only its owner, as a person, deletes a workspace", async () => {
  const made = await addSpace(
    { hive, member: members.sara },
    "Sara's second",
    person("sara"),
  );
  const mark = await lastAudit();
  // Somebody else's workspace is not theirs to see: no row, no refusal that
  // says anything about it.
  for (const who of [person("dani"), person("ahmed"), person("outsider")])
    assert.deepEqual(await dropSpace(who, made.id), []);
  for (const tier of ["vendor", "self_hosted"])
    assert.deepEqual(
      await dropSpace(await agentFor("sara", tier), made.id),
      [],
    );
  assert.deepEqual(await dropSpace(passOf(person("sara")), made.id), []);
  // A visitor is refused outright or finds no row, by the grants.
  const visitor = await dropSpace(null, made.id).catch((e) => e);
  assert.ok(
    Array.isArray(visitor)
      ? visitor.length === 0
      : /row-level security|permission denied/.test(String(visitor)),
  );
  assert.equal(await spaceThere(made.id), true);
  assert.deepEqual(await spaceAudits(mark), []);

  assert.deepEqual(await dropSpace(person("sara"), made.id), [{ id: made.id }]);
});

test("a workspace in a hive that is being deleted stays", async () => {
  const p = await wsPerson();
  const space = await addSpace(p, "Frozen");
  const name = (
    await db.query(`select name from public.hives where id = $1`, [p.hive])
  ).rows[0].name;
  await as(p.who, `select public.request_hive_deletion($1, $2)`, [
    p.hive,
    name,
  ]);
  await assert.rejects(dropSpace(p.who, space.id), FROZEN);
  assert.equal(await spaceThere(space.id), true);
});

test("the last workspace still goes with its member, and the database's owner is not held", async () => {
  const p = await wsPerson();
  const mark = await lastAudit();
  // The database's owner, outside the API: the rules are the app's, not its.
  const extra = await addSpace(p, "Extra");
  await as(
    p.who,
    `select * from public.create_agent($1, 'Extra agent', 'other', 'vendor')`,
    [extra.id],
  );
  await asDbOwner(null, `delete from public.workspaces where id = $1`, [
    extra.id,
  ]);
  assert.equal(await spaceThere(extra.id), false);

  await asDbOwner(null, `delete from public.members where id = $1`, [p.member]);
  assert.deepEqual(await spacesOf(p.member), []);
  // Nobody was signed in: no record.
  assert.deepEqual(await spaceAudits(mark), []);
});

// ---------------------------------------------------------------- topics
// <stamp>_topics.sql. A topic is a row of public.entities; a note is attached
// to it by a row of public.note_entities.

const TP_POLICY = /row-level security/;
const addTopic = (who, hiveId, kind, name, aliases = []) =>
  as(
    who,
    `insert into public.entities (hive_id, type, canonical_name, aliases)
     values ($1, $2, $3, $4) returning id, canonical_name, aliases`,
    [hiveId, kind, name, aliases],
  ).then((r) => r[0]);
const tpNote = (name, path) =>
  as(
    person(name),
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
     values ($1, $2, $3, $4, $4, 'text') returning id`,
    [hive, members[name], ws[name], path],
  ).then((r) => r[0].id);
const attachTopic = (who, note, topic, confidence = 0.9) =>
  as(
    who,
    `insert into public.note_entities (note_id, entity_id, confidence)
     values ($1, $2, $3) returning note_id`,
    [note, topic, confidence],
  );
const detachTopic = (who, note, topic, at = "2026-11-24T12:00:00Z") =>
  as(
    who,
    `update public.note_entities set detached_at = $3
      where note_id = $1 and entity_id = $2 returning note_id`,
    [note, topic, at],
  );
const pairsOf = (who, note) =>
  as(
    who,
    `select entity_id, detached_at is not null as detached
       from public.note_entities where note_id = $1`,
    [note],
  );
// Refused outright or answered with no row, by the grants and the policies.
const nothingDone = async (run) => {
  const out = await run.catch((e) => e);
  assert.ok(
    Array.isArray(out)
      ? out.length === 0
      : /row-level security|permission denied/.test(String(out)),
    String(out),
  );
};

test("only the hive's owner, as a person, makes a topic; a vendor and a subject are kinds", async () => {
  const vendor = await addTopic(
    person("dani"),
    hive,
    "vendor",
    "tp Terra Drone",
  );
  const subject = await addTopic(
    person("dani"),
    hive,
    "subject",
    "tp Flare inspection",
  );
  assert.ok(vendor.id && subject.id);

  await assert.rejects(
    addTopic(person("ahmed"), hive, "vendor", "tp By Ahmed"),
    TP_POLICY,
  );
  await assert.rejects(
    addTopic(await agentFor("dani"), hive, "vendor", "tp By an agent"),
    TP_POLICY,
  );
  await assert.rejects(
    addTopic(passOf(person("dani")), hive, "vendor", "tp By an app"),
    TP_POLICY,
  );

  // Every member of the hive reads the list; nobody outside it does.
  const seen = async (who) =>
    (
      await as(who, `select id from public.entities where id = any($1)`, [
        [vendor.id, subject.id],
      ])
    ).length;
  assert.equal(await seen(person("ahmed")), 2);
  assert.equal(await seen(person("outsider")), 0);
});

test("a topic's name and aliases are trimmed and bounded", async () => {
  const dani = person("dani");
  for (const name of ["", "   ", null])
    await assert.rejects(
      addTopic(dani, hive, "client", name),
      /a topic needs a name/,
    );
  await assert.rejects(
    addTopic(dani, hive, "client", "x".repeat(81)),
    /that topic name is too long/,
  );
  const made = await addTopic(dani, hive, "client", "  tp Zain \t", [
    " ZainTech ",
    "",
    "ZainTech",
    "Zain KSA",
  ]);
  assert.equal(made.canonical_name, "tp Zain");
  assert.deepEqual(made.aliases, ["ZainTech", "Zain KSA"]);

  await assert.rejects(
    addTopic(dani, hive, "client", "tp Long alias", ["y".repeat(81)]),
    /that topic alias is too long/,
  );
  await assert.rejects(
    addTopic(
      dani,
      hive,
      "client",
      "tp Many aliases",
      Array.from({ length: 21 }, (_, i) => `alias ${i}`),
    ),
    /a topic has at most 20 aliases/,
  );
  // The same name of the same kind, once trimmed, is the same topic.
  await assert.rejects(
    addTopic(dani, hive, "client", " tp Zain "),
    /unique|duplicate/,
  );
});

test("a hive has at most 2000 topics, and nobody outside learns how many it has", async () => {
  const who = await hivePerson();
  const full = await startHive(who, `Topics cap ${Date.now()}`);
  await asDbOwner(
    null,
    `insert into public.entities (hive_id, type, canonical_name)
     select $1, 'subject', 'cap ' || g from generate_series(1, 2000) g`,
    [full],
  );
  await assert.rejects(
    addTopic(who, full, "subject", "One too many"),
    /this hive already has 2000 topics/,
  );
  // The trigger binds the database's owner as well.
  await assert.rejects(
    asDbOwner(
      null,
      `insert into public.entities (hive_id, type, canonical_name) values ($1, 'subject', 'Also too many')`,
      [full],
    ),
    /this hive already has 2000 topics/,
  );
  // Somebody who does not own the hive gets the policy's answer, not the count.
  const stranger = await addTopic(
    person("ahmed"),
    full,
    "subject",
    "Probe",
  ).catch((e) => e);
  assert.match(String(stranger), TP_POLICY);
  assert.doesNotMatch(String(stranger), /2000/);
});

test("a person attaches their own notes; a colleague reads a note's topics only with the note", async () => {
  const topic = await addTopic(
    person("dani"),
    hive,
    "client",
    "tp Attach client",
  );
  const note = await tpNote("ahmed", "tp/attach.md");

  await assert.rejects(attachTopic(person("dani"), note, topic.id), TP_POLICY);
  assert.equal((await attachTopic(person("ahmed"), note, topic.id)).length, 1);
  assert.deepEqual(await pairsOf(person("ahmed"), note), [
    { entity_id: topic.id, detached: false },
  ]);

  // The note is private: Sara reads neither it nor what it is attached to.
  assert.deepEqual(await pairsOf(person("sara"), note), []);
  // Shared with the hive's group, the way the sharing tests above this one do it. If this
  // statement is refused, copy the share from "every sharing change leaves one audit row".
  await as(
    person("ahmed"),
    `update public.notes set visibility = 'group' where id = $1`,
    [note],
  );
  assert.deepEqual(await pairsOf(person("sara"), note), [
    { entity_id: topic.id, detached: false },
  ]);
});

test("only the note's owner, as a person, detaches and re-attaches; nothing else of the pair changes", async () => {
  const topic = await addTopic(
    person("dani"),
    hive,
    "client",
    "tp Detach client",
  );
  const note = await tpNote("ahmed", "tp/detach.md");
  await attachTopic(person("ahmed"), note, topic.id);
  // Shared with the group, so the others read the pair: what stops them is the
  // update policy's ownership check, not the select policy.
  await as(
    person("ahmed"),
    `update public.notes set visibility = 'group' where id = $1`,
    [note],
  );
  assert.deepEqual(await pairsOf(person("sara"), note), [
    { entity_id: topic.id, detached: false },
  ]);

  await nothingDone(detachTopic(person("dani"), note, topic.id));
  await nothingDone(detachTopic(person("sara"), note, topic.id));
  await nothingDone(detachTopic(await agentFor("ahmed"), note, topic.id));
  await nothingDone(detachTopic(passOf(person("ahmed")), note, topic.id));
  assert.deepEqual(await pairsOf(person("ahmed"), note), [
    { entity_id: topic.id, detached: false },
  ]);

  assert.equal((await detachTopic(person("ahmed"), note, topic.id)).length, 1);
  assert.deepEqual(await pairsOf(person("ahmed"), note), [
    { entity_id: topic.id, detached: true },
  ]);
  // A detached pair is still a pair: a second insert cannot bring it back.
  await assert.rejects(
    attachTopic(person("ahmed"), note, topic.id),
    /unique|duplicate/,
  );
  // Only detached_at may be written.
  await assert.rejects(
    as(
      person("ahmed"),
      `update public.note_entities set confidence = 0.1 where note_id = $1 and entity_id = $2`,
      [note, topic.id],
    ),
    /permission denied/,
  );
  // Clearing it attaches the note again.
  assert.equal(
    (await detachTopic(person("ahmed"), note, topic.id, null)).length,
    1,
  );
  assert.deepEqual(await pairsOf(person("ahmed"), note), [
    { entity_id: topic.id, detached: false },
  ]);
});

test("a note and its topic are in one hive, and a hive that is being deleted takes neither", async () => {
  const other = (
    await db.query(
      `select h.id from public.hives h join public.members m on m.hive_id = h.id
        where m.user_id = $1 and h.name = 'Other hive'`,
      [users.outsider],
    )
  ).rows[0].id;
  const foreign = await addTopic(
    person("outsider"),
    other,
    "client",
    "tp Foreign",
  );
  const note = await tpNote("dani", "tp/one-hive.md");
  await assert.rejects(attachTopic(person("dani"), note, foreign.id));

  const who = await hivePerson();
  const name = `Topics frozen ${Date.now()}`;
  const closing = await startHive(who, name);
  const kept = await addTopic(who, closing, "client", "Before closing");
  await as(who, `select public.request_hive_deletion($1, $2)`, [closing, name]);
  await assert.rejects(
    addTopic(who, closing, "client", "After closing"),
    FROZEN,
  );
  await assert.rejects(
    as(who, `delete from public.entities where id = $1 returning id`, [
      kept.id,
    ]),
    FROZEN,
  );
});

test("an agent never removes a note from a topic: only the note's owner, as a person, deletes a pair", async () => {
  const topic = await addTopic(
    person("dani"),
    hive,
    "client",
    "tp Delete client",
  );
  const note = await tpNote("ahmed", "tp/delete.md");
  await attachTopic(person("ahmed"), note, topic.id);
  // Shared with the group, so a colleague reads the pair: the delete policy is what stops them.
  await as(
    person("ahmed"),
    `update public.notes set visibility = 'group' where id = $1`,
    [note],
  );
  // The owner said no: the pair is detached, and it has to stay to say so.
  await detachTopic(person("ahmed"), note, topic.id);
  const removeTopic = (who) =>
    as(
      who,
      `delete from public.note_entities where note_id = $1 and entity_id = $2 returning note_id`,
      [note, topic.id],
    );

  await nothingDone(removeTopic(await agentFor("ahmed")));
  await nothingDone(removeTopic(passOf(person("ahmed"))));
  await nothingDone(removeTopic(person("sara")));
  await nothingDone(removeTopic(person("dani")));
  assert.deepEqual(await pairsOf(person("ahmed"), note), [
    { entity_id: topic.id, detached: true },
  ]);

  assert.equal((await removeTopic(person("ahmed"))).length, 1);
  assert.deepEqual(await pairsOf(person("ahmed"), note), []);
});

// ---------------------------------------------------------------- topics on the map
// <stamp>_topics_view.sql. Two more kinds, and map_graph carries each
// readable note's topics and the hive's topic list.

const TV_KINDS = [
  "client",
  "partner",
  "project",
  "vendor",
  "product",
  "solution",
  "person",
  "subject",
];

test("a partner and a solution are kinds, and they order as the app does", async () => {
  const partner = await addTopic(person("dani"), hive, "partner", "tv Partner");
  const solution = await addTopic(
    person("dani"),
    hive,
    "solution",
    "tv Solution",
  );
  assert.ok(partner.id && solution.id);

  const ranks = (
    await db.query(
      `select k, public.topic_rank(k::public.entity_type) as r
         from unnest($1::text[]) with ordinality as t(k, i) order by i`,
      [TV_KINDS],
    )
  ).rows.map((r) => r.r);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("the map gives a readable note its topics, strongest first, at most five, and none that were detached", async () => {
  const dani = person("dani");
  const note = await tpNote("dani", "tv/seven.md");
  const mk = (kind, name) => addTopic(dani, hive, kind, name);
  const top = await mk("subject", "tv Zeta top");
  const vendor = await mk("vendor", "tv Same conf vendor");
  const partner = await mk("partner", "tv Same conf partner");
  const alpha = await mk("client", "tv Alpha");
  const beta = await mk("client", "tv Beta");
  const cut = await mk("project", "tv Sixth");
  const gone = await mk("product", "tv Detached");
  await attachTopic(dani, note, top.id, 0.95);
  await attachTopic(dani, note, vendor.id, 0.8);
  await attachTopic(dani, note, partner.id, 0.8);
  await attachTopic(dani, note, beta.id, 0.7);
  await attachTopic(dani, note, alpha.id, 0.7);
  await attachTopic(dani, note, cut.id, 0.5);
  await attachTopic(dani, note, gone.id, 0.99);
  await detachTopic(dani, note, gone.id);

  assert.deepEqual(nodeOf(await map(dani), note).topics, [
    top.id,
    partner.id,
    vendor.id,
    alpha.id,
    beta.id,
  ]);
});

test("the map gives a note the viewer cannot read no topic", async () => {
  const topic = await addTopic(person("dani"), hive, "client", "tv Private");
  const note = await tpNote("ahmed", "tv/private.md");
  await attachTopic(person("ahmed"), note, topic.id);

  const locked = nodeOf(await map(person("dani")), note);
  assert.equal(locked.locked, true);
  assert.deepEqual(locked.topics, []);
  assert.deepEqual(nodeOf(await map(person("ahmed")), note).topics, [topic.id]);

  await as(
    person("ahmed"),
    `update public.notes set visibility = 'group' where id = $1`,
    [note],
  );
  const seen = nodeOf(await map(person("sara")), note);
  assert.equal(seen.locked, false);
  assert.deepEqual(seen.topics, [topic.id]);
});

test("the map lists the hive's topics by kind, then name, and nobody else's", async () => {
  const other = (
    await as(
      person("outsider"),
      `select hive_id from public.members where user_id = $1`,
      [users.outsider],
    )
  )[0].hive_id;
  const theirs = await addTopic(
    person("outsider"),
    other,
    "client",
    "tv Outsider only",
  );

  const expected = (
    await db.query(
      `select id, canonical_name as name, type::text as kind
         from public.entities where hive_id = $1
        order by public.topic_rank(type), canonical_name, id`,
      [hive],
    )
  ).rows;
  assert.ok(expected.length > 5);
  const got = (await map(person("dani"))).topics;
  assert.deepEqual(got, expected);
  assert.ok(!JSON.stringify(got).includes(theirs.id));
  const theirMap = (await map(person("outsider"), other)).topics.map(
    (t) => t.id,
  );
  assert.ok(theirMap.includes(theirs.id));
  for (const t of got) assert.ok(!theirMap.includes(t.id), t.id);
});

test("a file's node carries no topic", async () => {
  const note = await tpNote("dani", "tv/with-file.md");
  await addFile(person("dani"), "dani", "tv-with-file.pdf", note);
  const m = await map(person("dani"));
  const files = m.nodes.filter((n) => n.kind === "file");
  assert.ok(files.length > 0);
  for (const f of files) assert.deepEqual(f.topics, [], f.id);
  for (const n of m.nodes) assert.ok(Array.isArray(n.topics), n.id);
});

test("an agent and an app pass are still refused the map", async () => {
  await assert.rejects(map(await agentFor("dani")), /map_graph is for people/);
  await assert.rejects(
    map(await agentFor("ahmed", "self_hosted")),
    /map_graph is for people/,
  );
  await assert.rejects(
    map(passOf(person("dani"))),
    /an app pass cannot do this/,
  );
  await assert.rejects(map(person("outsider")), /not a member of this hive/);
});

// ------------------------------------------------------------ vault_index
// The vault's note index for one of the caller's own workspaces in one call:
// the same answers as the per-row columns the vault used to ask for
// (note_visibility, note_shared_with, note_rule_folder, note_access and the
// note's attached topics), and nothing at all for anyone who is not that
// workspace's owner signed in as a person.

// What the vault read before vault_index, column for column: the computed
// columns on each note row and the note's attached topics, by entity id.
const indexByColumns = (who, workspace) =>
  as(
    who,
    `select n.id, n.workspace_id, n.member_id, n.path, n.title, n.updated_at,
            n.written_by_agent, n.visibility, n.shared_with, n.quarantined,
            public.note_visibility(n) as effective,
            public.note_shared_with(n) as effective_with,
            public.note_rule_folder(n) as rule_folder,
            public.note_access(n) as access,
            coalesce((select jsonb_agg(jsonb_build_object(
                        'entity_id', e.entity_id, 'confidence', e.confidence)
                        order by e.entity_id)
                        from public.note_entities e
                       where e.note_id = n.id and e.detached_at is null),
                     '[]'::jsonb) as topics
       from public.notes n
      where n.workspace_id = $1
      order by n.path`,
    [workspace],
  );
const vaultIndex = (who, workspace) =>
  as(who, `select * from public.vault_index($1)`, [workspace]);
const byId = (rows) =>
  [...rows]
    .map((r) => ({
      ...r,
      topics: [...r.topics].sort((a, b) =>
        a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0,
      ),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

let vi;
const viFixture = async () => {
  if (vi) return vi;
  const owner = asUser(await addUser("vi-owner@example.com"));
  const hiveId = (
    await as(owner, `select public.create_hive('VI hive', 'Vi') as id`)
  )[0].id;
  const colleagueUser = await addUser("vi-colleague@example.com");
  const colleague = asUser(colleagueUser);
  const colleagueMember = await addMember(hiveId, colleagueUser, "Col");
  const me = (
    await as(owner, `select id from public.members where hive_id = $1`, [
      hiveId,
    ])
  ).find(Boolean).id;
  const workspace = (
    await as(owner, `select id from public.workspaces where member_id = $1`, [
      me,
    ])
  )[0].id;
  // The owner's default: a note with no setting and no rule is the group's.
  await as(
    owner,
    `update public.members set default_visibility = 'group' where id = $1`,
    [me],
  );
  await as(
    owner,
    `insert into public.folders (workspace_id, member_id, path, visibility, shared_with)
     values ($1, $2, 'x', 'members', $3), ($1, $2, 'x/y', 'group', '{}')`,
    [workspace, me, [colleagueMember]],
  );
  const note = async (path, visibility = null, shared = []) =>
    (
      await as(
        owner,
        `insert into public.notes (hive_id, member_id, workspace_id, path, title, body, visibility, shared_with)
         values ($1, $2, $3, $4, $4, 'text', $5, $6) returning id`,
        [hiveId, me, workspace, path, visibility, shared],
      )
    )[0].id;
  const a = await note("a.md");
  const b = await note("x/b.md");
  const c = await note("x/y/c.md");
  const d = await note("z/d.md");
  const kept = await note("x/kept.md", "private");
  const named = await note("z/named.md", "members", [colleagueMember]);
  // Held for review: still the owner's, still in the index.
  await db.exec("reset role");
  await db.query(`update public.notes set quarantined = true where id = $1`, [
    d,
  ]);
  // Written by the owner's agent.
  const made = (
    await as(
      owner,
      `select * from public.create_agent($1, 'VI agent', 'other', 'vendor')`,
      [workspace],
    )
  )[0];
  const login = (
    await as(null, `select * from public.agent_login($1)`, [made.token])
  )[0];
  const agent = {
    sub: login.user_id,
    role: "authenticated",
    agent_id: login.agent_id,
    workspace_id: login.workspace_id,
    trust_tier: login.trust_tier,
  };
  await as(
    agent,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
     values ($1, $2, $3, 'x/y/by-agent.md', 'by agent', 'text')`,
    [hiveId, me, workspace],
  );
  // Two topics on one note, one of them detached.
  const t1 = await addTopic(owner, hiveId, "client", "vi Client");
  const t2 = await addTopic(owner, hiveId, "client", "vi Other");
  await attachTopic(owner, b, t1.id, 0.8);
  await attachTopic(owner, b, t2.id, 0.4);
  await attachTopic(owner, c, t2.id, 0.7);
  await detachTopic(owner, c, t2.id);
  vi = {
    owner,
    colleague,
    hiveId,
    me,
    workspace,
    agent,
    notes: { a, b, c, d, kept, named },
    topics: { t1: t1.id, t2: t2.id },
  };
  return vi;
};

test("vault_index answers the owner's workspace exactly as the per-row columns do", async () => {
  const f = await viFixture();
  const got = await vaultIndex(f.owner, f.workspace);
  const want = await indexByColumns(f.owner, f.workspace);
  assert.equal(got.length, 7);
  assert.deepEqual(byId(got), byId(want));
  // Ordered by path.
  assert.deepEqual(
    got.map((r) => r.path),
    want.map((r) => r.path),
  );
  // The fixture covers each answer the columns give.
  const at = Object.fromEntries(got.map((r) => [r.path, r]));
  assert.equal(at["a.md"].effective, "group");
  assert.equal(at["a.md"].rule_folder, null);
  assert.equal(at["x/b.md"].effective, "members");
  assert.equal(at["x/b.md"].rule_folder, "x");
  assert.equal(at["x/y/c.md"].effective, "group");
  assert.equal(at["x/y/c.md"].rule_folder, "x/y");
  assert.equal(at["x/kept.md"].effective, "private");
  assert.equal(at["x/kept.md"].rule_folder, "x");
  assert.deepEqual(at["x/kept.md"].effective_with, []);
  assert.equal(at["z/named.md"].effective, "members");
  assert.equal(at["z/d.md"].quarantined, true);
  assert.ok(at["x/y/by-agent.md"].written_by_agent);
  for (const r of got) assert.equal(r.access, "own");
  // Attached topics only: the detached pair is left out, and none is [].
  assert.deepEqual(
    byId([at["x/b.md"]])[0].topics,
    [
      { entity_id: f.topics.t1, confidence: 0.8 },
      { entity_id: f.topics.t2, confidence: 0.4 },
    ].sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1)),
  );
  assert.deepEqual(at["x/y/c.md"].topics, []);
  assert.deepEqual(at["a.md"].topics, []);
});

test("vault_index matches the per-row columns on a long-used workspace too", async () => {
  // Dani's workspace holds what every test above wrote into it: links,
  // folder rules, files, held notes, topics.
  const got = await vaultIndex(person("dani"), ws.dani);
  assert.ok(got.length > 10);
  assert.deepEqual(
    byId(got),
    byId(await indexByColumns(person("dani"), ws.dani)),
  );
});

test("vault_index answers nobody but the workspace's owner, as a person", async () => {
  const f = await viFixture();
  // A colleague in the same hive, with the owner's workspace id.
  assert.deepEqual(await vaultIndex(f.colleague, f.workspace), []);
  // Someone in another hive, and a workspace id nobody has.
  assert.deepEqual(await vaultIndex(person("outsider"), f.workspace), []);
  assert.deepEqual(
    await vaultIndex(f.owner, "6f1d1c3e-0000-4000-8000-000000000001"),
    [],
  );
  // The owner's own workspace id, from Dani in another hive.
  assert.deepEqual(await vaultIndex(person("dani"), f.workspace), []);
  // The owner's agent, with its token for this very workspace.
  assert.deepEqual(await vaultIndex(f.agent, f.workspace), []);
  // A self-hosted claim on the owner's own session.
  assert.deepEqual(
    await vaultIndex({ ...f.owner, trust_tier: "self_hosted" }, f.workspace),
    [],
  );
  // A connected app's pass, approved by the owner.
  const client = await addClient("VI app", "https://vi.example.com/cb");
  await addConsent(f.owner.sub, client);
  assert.deepEqual(
    await vaultIndex({ ...f.owner, client_id: client }, f.workspace),
    [],
  );
  assert.deepEqual(await vaultIndex(passOf(f.owner), f.workspace), []);
  // A token made for another audience.
  assert.deepEqual(
    await vaultIndex({ ...f.owner, aud: "elsewhere" }, f.workspace),
    [],
  );
  // The public cannot call it at all.
  await assert.rejects(vaultIndex(null, f.workspace), /permission denied/);
});

test("erasing a hive takes its gallery folders and their memberships with it", async () => {
  const h = await hdHive();
  const file = (
    await db.query(`select id from public.files where hive_id = $1 limit 1`, [
      h.id,
    ])
  ).rows[0].id;
  for (const who of ["owner", "member"]) {
    const top = (
      await as(
        h[who],
        `insert into public.gallery_folders (member_id, name) values ($1, 'Gone') returning id`,
        [h[`${who}Member`]],
      )
    )[0].id;
    const sub = (
      await as(
        h[who],
        `insert into public.gallery_folders (member_id, parent_id, name) values ($1, $2, 'Gone too') returning id`,
        [h[`${who}Member`], top],
      )
    )[0].id;
    if (who === "owner")
      await as(
        h[who],
        `insert into public.gallery_folder_files (folder_id, file_id) values ($1, $2)`,
        [sub, file],
      );
  }
  const left = async () =>
    (
      await db.query(
        `select (select count(*) from public.gallery_folders g
                  where g.member_id in (select id from public.members where hive_id = $1))::int as folders,
                (select count(*) from public.gallery_folder_files)::int as memberships`,
        [h.id],
      )
    ).rows[0];
  await db.exec("reset role");
  assert.deepEqual(await left(), { folders: 4, memberships: 1 });
  await requestDeletion(h.owner, h.id, h.name);
  await hdMakeDue(h.id);
  await hdBegin(h.id);
  await hdRemoveObjects(h.id);
  let done = false;
  for (let i = 0; i < 50 && !done; i++) done = await hdStep(h.id);
  assert.equal(done, true);
  await db.exec("reset role");
  assert.deepEqual(await left(), { folders: 0, memberships: 0 });
  assert.notEqual((await hdRecord(h.id)).purged_at, null);
});
