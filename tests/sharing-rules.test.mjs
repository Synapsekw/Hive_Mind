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
  const f = await as(
    person("ahmed"),
    `insert into public.folders (workspace_id, member_id, path, visibility) values ($1, $2, 'clients', 'group') returning id`,
    [ws.ahmed, members.ahmed],
  );
  await as(
    person("ahmed"),
    `insert into public.notes (hive_id, member_id, workspace_id, folder_id, path, title)
     values ($1, $2, $3, $4, 'clients/a.md', 'ahmed in shared folder')`,
    [hive, members.ahmed, ws.ahmed, f[0].id],
  );
  assert.ok((await titles(person("sara"))).includes("ahmed in shared folder"));
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
});

test("the map is capped at 5,000 items, newest first", async () => {
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
});
