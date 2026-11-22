// Runs the real migrations in an in-process Postgres (PGlite) and checks the
// sharing rules as three different people and two kinds of agent.
// Supabase's auth schema and roles are stubbed in scripts/local-db.mjs;
// everything else is the SQL that ships. Run with: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../scripts/local-db.mjs";

const { db, as } = await openDb();
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
  const nothing = { v: "private", sw: [], c: false };
  assert.deepEqual(await ask(person("ahmed"), forged), nothing);
  assert.deepEqual(await ask(person("sara"), forged), nothing);
  assert.deepEqual(await ask(person("outsider"), forged), nothing);
  assert.deepEqual(await ask(await agentFor("ahmed"), forged), nothing);
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
