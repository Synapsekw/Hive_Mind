// Runs the real migrations in an in-process Postgres (PGlite) and checks the
// sharing rules as three different people and two kinds of agent.
// Supabase's auth schema and roles are stubbed in scripts/local-db.mjs;
// everything else is the SQL that ships. Run with: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../scripts/local-db.mjs";

const { db, as, addUser } = await openDb();
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
  await as(
    person("dani"),
    `select public.add_member($1, 'ahmed@example.com', 'Ahmed')`,
    [hive],
  );
  await as(
    person("dani"),
    `select public.add_member($1, 'sara@example.com', 'Sara')`,
    [hive],
  );
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
  "id",
  "kind",
  "locked",
  "member_id",
  "note_id",
  "path",
  "title",
  "topic",
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
  for (const who of [
    person("ahmed"),
    person("sara"),
    person("outsider"),
    await agentFor("dani"),
  ])
    assert.deepEqual(await as(who, `select id from public.audit_log`), []);
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

  // Deleting a workspace takes its folders and notes with it, unaudited.
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
  assert.deepEqual(await auditSince(mark), []);

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

// ---------------------------------------------------------------- settings
// What the settings screen leans on: `add_member`, `create_agent` and
// `revoke_agent` refuse on their own, whatever the app sends.

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

test("only the hive owner adds a member", async () => {
  const before = await memberCount();
  await assert.rejects(
    as(
      person("ahmed"),
      `select public.add_member($1, 'outsider@example.com', 'Outsider')`,
      [hive],
    ),
    /only the hive owner/,
  );
  // Someone from another hive cannot add themselves either.
  await assert.rejects(
    as(
      person("outsider"),
      `select public.add_member($1, 'outsider@example.com', 'Outsider')`,
      [hive],
    ),
    /only the hive owner/,
  );
  assert.equal(await memberCount(), before);
});

test("a member cannot be added by an email nobody signed up with", async () => {
  const before = await memberCount();
  await assert.rejects(
    as(
      person("dani"),
      `select public.add_member($1, 'nobody@example.com', 'Nobody')`,
      [hive],
    ),
    /no user with that email/,
  );
  assert.equal(await memberCount(), before);
});

test("the same person cannot be added twice", async () => {
  const before = await memberCount();
  const spaces = async () =>
    (
      await as(
        person("ahmed"),
        `select count(*)::int as n from public.workspaces where member_id = $1`,
        [members.ahmed],
      )
    )[0].n;
  const spacesBefore = await spaces();
  await assert.rejects(
    as(
      person("dani"),
      `select public.add_member($1, 'ahmed@example.com', 'Ahmed again')`,
      [hive],
    ),
    (e) => e.code === "23505",
  );
  // The address is matched whatever its case.
  await assert.rejects(
    as(
      person("dani"),
      `select public.add_member($1, 'AHMED@Example.com', 'Ahmed again')`,
      [hive],
    ),
    (e) => e.code === "23505",
  );
  assert.equal(await memberCount(), before);
  assert.equal(await spaces(), spacesBefore);
});

test("an agent cannot add a member, create an agent or revoke one", async () => {
  // The owner's own agent: refused for being an agent, not for whose it is.
  const agent = await agentFor("dani");
  const before = await memberCount();
  const agentsBefore = await agentsOf("dani");

  await assert.rejects(
    as(
      agent,
      `select public.add_member($1, 'outsider@example.com', 'Outsider')`,
      [hive],
    ),
    /only the hive owner/,
  );
  assert.equal(await memberCount(), before);

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
// The owner invites by email. A person with a confirmed account is added at
// once; anyone else joins when they first sign in with that address, and only
// once the address is confirmed. Fresh `invite-…` users in every test.

const invite = (who, email, name, h = hive) =>
  as(who, `select public.invite_member($1, $2, $3) as r`, [h, email, name]);
const claim = (who) => as(who, `select public.claim_invitations() as n`);
const revokeInvitation = (who, id) =>
  as(who, `select public.revoke_invitation($1)`, [id]);
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
const selfHosted = (name) => ({ ...person(name), trust_tier: "self_hosted" });

test("the owner invites an email nobody signed up with", async () => {
  const before = await inviteState();
  const r = await invite(
    person("dani"),
    "  Invite-Unknown@Example.com ",
    " Una ",
  );
  assert.equal(r[0].r, "invited");

  assert.deepEqual(await invitationsFor("Invite-Unknown@Example.com"), []);
  const rows = await invitationsFor("invite-unknown@example.com");
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.hive_id, hive);
  assert.equal(row.display_name, "Una");
  assert.equal(row.invited_by, members.dani);
  assert.equal(row.accepted_at, null);
  assert.equal(row.accepted_member, null);
  assert.equal(row.revoked_at, null);
  const days = (row.expires_at - row.created_at) / 86_400_000;
  assert.ok(Math.abs(days - 14) < 0.01, `expires in ${days} days`);

  const after = await inviteState();
  assert.equal(after.members, before.members);
  assert.equal(after.workspaces, before.workspaces);
});

test("the owner invites a confirmed account and it is added at once", async () => {
  const id = await addUser("Invite-Known@example.com");
  const r = await invite(person("dani"), "invite-known@EXAMPLE.com", "Known");
  assert.equal(r[0].r, "added");

  const ms = await membershipsOf(id);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].hive_id, hive);
  assert.equal(ms[0].display_name, "Known");
  assert.equal(ms[0].role, "member");
  assert.deepEqual(ms[0].workspaces, ["Main"]);
  assert.deepEqual(await invitationsFor("invite-known@example.com"), []);
  // They are in: they read the member list, and have nothing left to claim.
  assert.ok(
    (
      await as(asUser(id), `select id from public.members where hive_id = $1`, [
        hive,
      ])
    ).length > 1,
  );
  assert.equal((await claim(asUser(id)))[0].n, 0);
  assert.equal((await membershipsOf(id)).length, 1);
});

test("an unconfirmed account is invited, not added", async () => {
  const id = await addUser("invite-unconfirmed@example.com", {
    confirmed: false,
  });
  const r = await invite(
    person("dani"),
    "invite-unconfirmed@example.com",
    "Unconfirmed",
  );
  assert.equal(r[0].r, "invited");
  assert.deepEqual(await membershipsOf(id), []);
  assert.equal(
    (await invitationsFor("invite-unconfirmed@example.com")).length,
    1,
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
  assert.equal(
    (await invite(person("dani"), "invite-twice@example.com", "Twice"))[0].r,
    "invited",
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
  // One of these has an account, so the "added" path is checked as well.
  const known = await addUser("invite-shape@example.com");
  const before = await inviteState();
  const bad = [
    ["invite-shape@example.com", ""],
    ["invite-shape@example.com", "   "],
    ["invite-shape@example.com", null],
    ["invite-shape@example.com", "x".repeat(61)],
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
  assert.equal(
    (
      await invite(
        person("dani"),
        "invite-shape-new@example.com",
        "x".repeat(60),
      )
    )[0].r,
    "invited",
  );
});

test("the invited person joins at sign-in, once", async () => {
  await invite(person("dani"), "invite-join@example.com", "Joiner");
  // The account appears later, as it does at a first sign-in.
  const id = await addUser("Invite-Join@Example.com");
  assert.deepEqual(await membershipsOf(id), []);

  assert.equal((await claim(asUser(id)))[0].n, 1);
  const ms = await membershipsOf(id);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].hive_id, hive);
  assert.equal(ms[0].display_name, "Joiner");
  assert.equal(ms[0].role, "member");
  assert.deepEqual(ms[0].workspaces, ["Main"]);
  const [inv] = await invitationsFor("invite-join@example.com");
  assert.ok(inv.accepted_at);
  assert.equal(inv.accepted_member, ms[0].id);
  assert.equal(inv.revoked_at, null);

  const after = await inviteState();
  assert.equal((await claim(asUser(id)))[0].n, 0);
  await unchanged(after);
  assert.deepEqual(await membershipsOf(id), ms);
  // Joined: the owner can no longer invite or revoke that invitation.
  await assert.rejects(
    invite(person("dani"), "invite-join@example.com", "Joiner"),
    /that person is already a member/,
  );
  await assert.rejects(
    revokeInvitation(person("dani"), inv.id),
    /invitation not found/,
  );
  await unchanged(after);
});

test("nobody joins without the invited, confirmed email address", async () => {
  // An account with the invited address that never proved it.
  await invite(person("dani"), "invite-proof@example.com", "Proof");
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
  await invite(person("dani"), "invite-gone@example.com", "Gone");
  const gone = await addUser("invite-gone@example.com");
  const [goneInv] = await invitationsFor("invite-gone@example.com");
  await revokeInvitation(person("dani"), goneInv.id);
  await invite(person("dani"), "invite-late@example.com", "Late");
  const late = await addUser("invite-late@example.com");
  await db.query(
    `update public.invitations set expires_at = now() - interval '1 second'
      where email = 'invite-late@example.com'`,
  );

  const before = await inviteState();
  for (const id of [unproved, ...others, gone, late, users.ahmed]) {
    assert.equal((await claim(asUser(id)))[0].n, 0);
    await unchanged(before);
  }
  for (const id of [unproved, ...others, gone, late])
    assert.deepEqual(await membershipsOf(id), []);

  // Once the address is proved, the same person does join.
  await db.query(
    `update auth.users set email_confirmed_at = now() where id = $1`,
    [unproved],
  );
  assert.equal((await claim(asUser(unproved)))[0].n, 1);
  assert.equal((await membershipsOf(unproved))[0].display_name, "Proof");
});

test("an agent or an anonymous caller cannot claim", async () => {
  // The agent of a person who does have an invitation waiting (stored by
  // hand: inviting a confirmed account adds it at once).
  const other = await otherHive();
  await db.query(
    `insert into public.invitations (hive_id, email, display_name)
     values ($1, 'ahmed@example.com', 'Ahmed there')`,
    [other],
  );
  const before = await inviteState();
  for (const who of [
    await agentFor("ahmed"),
    await agentFor("ahmed", "self_hosted"),
    selfHosted("ahmed"),
    { role: "authenticated" },
    { role: "authenticated", sub: "" },
  ]) {
    await assert.rejects(claim(who), /sign in as a person/);
    await unchanged(before);
  }
  await assert.rejects(claim(null), /permission denied/);
  await unchanged(before);
  assert.equal((await membershipsOf(users.ahmed)).length, 1);
  // Left pending for nobody: the outsider takes it back.
  const [inv] = (await invitationsFor("ahmed@example.com")).filter(
    (i) => i.hive_id === other,
  );
  await revokeInvitation(person("outsider"), inv.id);
});

test("an expired invitation can be made again", async () => {
  await invite(person("dani"), "invite-again@example.com", "First");
  await db.query(
    `update public.invitations set expires_at = now() - interval '1 second'
      where email = 'invite-again@example.com'`,
  );
  const r = await invite(person("dani"), "invite-again@example.com", "Second");
  assert.equal(r[0].r, "invited");

  const rows = await invitationsFor("invite-again@example.com");
  assert.equal(rows.length, 2);
  const pending = rows.filter((i) => !i.accepted_at && !i.revoked_at);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].display_name, "Second");
  assert.ok(pending[0].expires_at > new Date());
  // The new one is the one honoured.
  const id = await addUser("invite-again@example.com");
  assert.equal((await claim(asUser(id)))[0].n, 1);
  assert.equal((await membershipsOf(id))[0].display_name, "Second");
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
  assert.equal(
    (
      await invite(
        person("outsider"),
        "invite-single@example.com",
        "Single there",
        other,
      )
    )[0].r,
    "invited",
  );
  // A revoked one does not block a new one.
  const [mine] = (await invitationsFor("invite-single@example.com")).filter(
    (i) => i.hive_id === hive,
  );
  await revokeInvitation(person("dani"), mine.id);
  assert.equal(
    (await invite(person("dani"), "invite-single@example.com", "Single"))[0].r,
    "invited",
  );
  const pending = (await invitationsFor("invite-single@example.com")).filter(
    (i) => !i.accepted_at && !i.revoked_at,
  );
  assert.deepEqual(pending.map((i) => i.hive_id).sort(), [hive, other].sort());
});

test("claiming changes nothing for someone who is already a member", async () => {
  // Invited, then added another way before signing in.
  await invite(person("dani"), "invite-already@example.com", "Invited name");
  const id = await addUser("invite-already@example.com");
  await as(
    person("dani"),
    `select public.add_member($1, 'invite-already@example.com', 'Added name')`,
    [hive],
  );
  const ms = await membershipsOf(id);
  const audits = (await inviteState()).audits;

  assert.equal((await claim(asUser(id)))[0].n, 0);
  assert.deepEqual(await membershipsOf(id), ms);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].display_name, "Added name");
  assert.deepEqual(ms[0].workspaces, ["Main"]);
  assert.equal((await inviteState()).audits, audits);
  const [inv] = await invitationsFor("invite-already@example.com");
  assert.ok(inv.accepted_at);
  assert.equal(inv.accepted_member, ms[0].id);

  // An owner invited to their own hive stays the owner, under their own name.
  const mark = await inviteState();
  await db.query(
    `insert into public.invitations (hive_id, email, display_name) values ($1, 'dani@example.com', 'Demoted')`,
    [hive],
  );
  assert.equal((await claim(person("dani")))[0].n, 0);
  const dani = (await membershipsOf(users.dani)).filter(
    (m) => m.hive_id === hive,
  );
  assert.equal(dani.length, 1);
  assert.equal(dani[0].role, "owner");
  assert.equal(dani[0].display_name, "Dani");
  assert.equal((await inviteState()).members, mark.members);

  // A waiting invitation is closed when the owner invites the same person
  // again after they got an account.
  await invite(person("dani"), "invite-later@example.com", "Later");
  const later = await addUser("invite-later@example.com");
  assert.equal(
    (await invite(person("dani"), "invite-later@example.com", "Later now"))[0]
      .r,
    "added",
  );
  const [closed] = await invitationsFor("invite-later@example.com");
  assert.ok(closed.accepted_at);
  assert.equal((await claim(asUser(later)))[0].n, 0);
  const lm = await membershipsOf(later);
  assert.equal(lm.length, 1);
  assert.equal(lm[0].display_name, "Later now");
  assert.equal(closed.accepted_member, lm[0].id);
});

test("only the hive owner revokes an invitation", async () => {
  await invite(person("dani"), "invite-revoke@example.com", "Revoke");
  const invited = await addUser("invite-revoke@example.com");
  const [inv] = await invitationsFor("invite-revoke@example.com");
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
    revokeInvitation(person("dani"), "00000000-0000-0000-0000-000000000000"),
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
  // A revoked invitation lets nobody in.
  assert.equal((await claim(asUser(invited)))[0].n, 0);
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
            accepted_at, revoked_at
       from public.invitations where id = $1`,
    [inv.id],
  );
  assert.equal(mine.length, 1);
  assert.equal(mine[0].email, "invite-read@example.com");
  // The owner sees their own hive's only.
  const other = await otherHive();
  await invite(person("outsider"), "invite-read-there@example.com", "T", other);
  const seen = await as(
    person("dani"),
    `select distinct hive_id from public.invitations`,
  );
  assert.deepEqual(seen, [{ hive_id: hive }]);
  assert.ok(!(await read(person("outsider"))).some((r) => r.id === inv.id));

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
  await invite(person("dani"), "invite-audit-join@example.com", "Join");
  const joiner = await addUser("invite-audit-join@example.com");
  await claim(asUser(joiner));
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
      "member.added",
      "member.invited",
      "member.joined",
      "member.invited",
      "member.invitation_revoked",
    ],
  );
  for (const r of rows) {
    assert.equal(r.hive_id, hive);
    assert.equal(r.agent_id, null);
  }
  const [added, invited, join, , revoked] = rows;
  assert.equal(added.member_id, members.dani);
  assert.equal(added.detail.email, "invite-audit-known@example.com");
  assert.ok(added.detail.member);
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

test("a person invited to two hives joins both with one claim", async () => {
  const other = await otherHive();
  await invite(person("dani"), "invite-two@example.com", "Two here");
  await invite(
    person("outsider"),
    "INVITE-TWO@example.com",
    "Two there",
    other,
  );
  // A third hive that did not invite them.
  const third = (
    await as(
      asUser(await addUser("invite-third-owner@example.com")),
      `select public.create_hive('Third hive', 'Third') as id`,
    )
  )[0].id;
  const id = await addUser("invite-two@example.com");

  assert.equal((await claim(asUser(id)))[0].n, 2);
  const ms = await membershipsOf(id);
  assert.deepEqual(
    Object.fromEntries(ms.map((m) => [m.hive_id, m.display_name])),
    { [hive]: "Two here", [other]: "Two there" },
  );
  for (const m of ms) {
    assert.equal(m.role, "member");
    assert.deepEqual(m.workspaces, ["Main"]);
  }
  assert.ok(!ms.some((m) => m.hive_id === third));
  assert.equal((await claim(asUser(id)))[0].n, 0);
  assert.equal((await membershipsOf(id)).length, 2);
});

test("an account with no email address joins nothing", async () => {
  await invite(person("dani"), "invite-noemail@example.com", "No Email");
  const before = await inviteState();
  for (const email of [null, ""]) {
    const id = (
      await db.query(
        `insert into auth.users (email, email_confirmed_at)
         values ($1, now()) returning id`,
        [email],
      )
    ).rows[0].id;
    assert.equal((await claim(asUser(id)))[0].n, 0);
    assert.deepEqual(await membershipsOf(id), []);
  }
  await unchanged(before);
});

test("adding a person closes the invitation that was waiting for them", async () => {
  await invite(person("dani"), "invite-lapsed@example.com", "Late");
  await db.query(
    `update public.invitations set expires_at = now() - interval '1 second'
      where email = 'invite-lapsed@example.com'`,
  );
  const id = await addUser("invite-lapsed@example.com");
  const r = await invite(person("dani"), "invite-lapsed@example.com", "Late");
  assert.equal(r[0].r, "added");

  const rows = await invitationsFor("invite-lapsed@example.com");
  assert.equal(rows.length, 1);
  assert.equal(rows.filter((i) => !i.accepted_at && !i.revoked_at).length, 0);
  // One membership, and a later claim finds nothing left to join.
  assert.equal((await membershipsOf(id)).length, 1);
  assert.equal((await claim(asUser(id)))[0].n, 0);
  assert.equal((await membershipsOf(id)).length, 1);
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
  const spaceFile = filePath("dani", "dn-space.pdf", space);
  await upload(person("dani"), spaceFile);
  await fileRow(person("dani"), "dani", spaceFile, {
    note: two,
    workspace: space,
  });
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
    await as(person("dani"), `select public.add_member($1, $2, $3)`, [
      hive,
      email,
      `Leaver ${tag}`,
    ]);
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
