import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupHive } from "./helpers/hive.mjs";

const h = await setupHive();
const dani = () => h.person("dani");
const CASES = JSON.parse(
  readFileSync(new URL("./fixtures/kind-cases.json", import.meta.url)),
);

test("file_kind agrees with every case in the shared table", async () => {
  for (const c of CASES) {
    const [r] = await h.as(dani(), `select public.file_kind($1, $2) as k`, [
      c.name,
      c.mime,
    ]);
    assert.equal(r.k, c.kind, `${c.name} ${c.mime}`);
  }
});

test("a new file gets its kind on insert, whatever the client sent", async () => {
  const agent = await h.agentFor("dani");
  const f = await h.saveFile(agent, "dani", "k1.pdf");
  const [r] = await h.as(
    dani(),
    `select kind from public.files where id = $1`,
    [f.id],
  );
  assert.equal(r.kind, "pdf");
});

test("a reference gives no access to the file", async () => {
  const agent = await h.agentFor("dani");
  const home = await h.addNote("dani", "r1 home"); // private
  const f = await h.saveFile(agent, "dani", "r1.pdf", { note_id: home.id });
  const shared = await h.addNote("dani", "r1 shared", { visibility: "group" });
  await h.as(
    dani(),
    `insert into public.file_references (file_id, note_id) values ($1, $2)`,
    [f.id, shared.id],
  );
  const files = await h.as(
    h.person("ahmed"),
    `select id from public.files where id = $1`,
    [f.id],
  );
  assert.equal(files.length, 0);
  const refs = await h.as(
    h.person("ahmed"),
    `select file_id from public.file_references where file_id = $1`,
    [f.id],
  );
  assert.equal(refs.length, 0); // hidden: ahmed cannot read the file
  const own = await h.as(
    dani(),
    `select file_id from public.file_references where file_id = $1`,
    [f.id],
  );
  assert.equal(own.length, 1);
});

test("a reference shows to someone who can read both sides", async () => {
  const home = await h.addNote("dani", "r2 home", { visibility: "group" });
  const agent = await h.agentFor("dani");
  const f = await h.saveFile(agent, "dani", "r2.pdf", { note_id: home.id });
  const ahmedNote = await h.addNote("ahmed", "r2 ahmed", {
    visibility: "group",
  });
  await h.as(
    h.person("ahmed"),
    `insert into public.file_references (file_id, note_id) values ($1, $2)`,
    [f.id, ahmedNote.id],
  );
  const refs = await h.as(
    h.person("sara"),
    `select note_id from public.file_references where file_id = $1`,
    [f.id],
  );
  assert.deepEqual(
    refs.map((r) => r.note_id),
    [ahmedNote.id],
  );
});

test("references need your own note and a file you can read", async () => {
  const agent = await h.agentFor("dani");
  const secret = await h.saveFile(agent, "dani", "r3.pdf");
  const ahmedNote = await h.addNote("ahmed", "r3 ahmed");
  await assert.rejects(
    h.as(
      h.person("ahmed"),
      `insert into public.file_references (file_id, note_id) values ($1, $2)`,
      [secret.id, ahmedNote.id],
    ),
    /row-level security/,
  );
  const daniNote = await h.addNote("dani", "r3 dani");
  await assert.rejects(
    h.as(
      h.person("ahmed"),
      `insert into public.file_references (file_id, note_id) values ($1, $2)`,
      [secret.id, daniNote.id],
    ),
    /row-level security/,
  );
});

test("an agent may add a reference from its own note, never remove one", async () => {
  const agent = await h.agentFor("dani");
  const f = await h.saveFile(agent, "dani", "r4.pdf");
  const n = await h.addNote("dani", "r4 note", { as: agent });
  const [row] = await h.as(
    agent,
    `insert into public.file_references (file_id, note_id) values ($1, $2) returning created_by_agent`,
    [f.id, n.id],
  );
  assert.equal(row.created_by_agent, agent.agent_id);
  const gone = await h.as(
    agent,
    `delete from public.file_references where file_id = $1 returning file_id`,
    [f.id],
  );
  assert.equal(gone.length, 0);
  const mine = await h.as(
    dani(),
    `delete from public.file_references where file_id = $1 returning file_id`,
    [f.id],
  );
  assert.equal(mine.length, 1);
});

test("only the owner, as a person, changes a file's home; it is audited", async () => {
  const agent = await h.agentFor("dani");
  const a = await h.addNote("dani", "h1 a");
  const b = await h.addNote("dani", "h1 b", { visibility: "group" });
  const f = await h.saveFile(agent, "dani", "h1.pdf", { note_id: a.id });
  await assert.rejects(
    h.as(agent, `select public.file_set_home($1, $2)`, [f.id, b.id]),
    /only a person/,
  );
  await assert.rejects(
    h.as(h.person("ahmed"), `select public.file_set_home($1, $2)`, [
      f.id,
      b.id,
    ]),
    /no such file/,
  );
  const ahmedNote = await h.addNote("ahmed", "h1 ahmed", {
    visibility: "group",
  });
  await assert.rejects(
    h.as(dani(), `select public.file_set_home($1, $2)`, [f.id, ahmedNote.id]),
    /your own note/,
  );
  await h.as(dani(), `select public.file_set_home($1, $2)`, [f.id, b.id]);
  assert.equal(
    (
      await h.as(
        h.person("ahmed"),
        `select id from public.files where id = $1`,
        [f.id],
      )
    ).length,
    1,
  );
  await h.as(dani(), `select public.file_set_home($1, null)`, [f.id]);
  assert.equal(
    (
      await h.as(
        h.person("ahmed"),
        `select id from public.files where id = $1`,
        [f.id],
      )
    ).length,
    0,
  );
  await h.db.exec("reset role");
  const log = (
    await h.db.query(
      `select detail from public.audit_log where action = 'file.home_changed' and detail ->> 'file_id' = $1 order by id`,
      [f.id],
    )
  ).rows;
  assert.equal(log.length, 2);
  assert.deepEqual(log[0].detail, { file_id: f.id, from: a.id, to: b.id });
  assert.equal(log[1].detail.to, null);
});

test("files cannot be updated directly", async () => {
  const agent = await h.agentFor("dani");
  const f = await h.saveFile(agent, "dani", "h2.pdf");
  const b = await h.addNote("dani", "h2 b");
  const r = await h.as(
    dani(),
    `update public.files set note_id = $2 where id = $1 returning id`,
    [f.id, b.id],
  );
  assert.equal(r.length, 0);
});

test("deleting a file writes an audit row with its id only", async () => {
  const agent = await h.agentFor("dani");
  const f = await h.saveFile(agent, "dani", "d1.pdf");
  await h.as(dani(), `delete from public.files where id = $1`, [f.id]);
  await h.db.exec("reset role");
  const log = (
    await h.db.query(
      `select member_id, detail from public.audit_log where action = 'file.deleted' and detail ->> 'file_id' = $1`,
      [f.id],
    )
  ).rows;
  assert.equal(log.length, 1);
  assert.equal(log[0].member_id, h.members.dani);
  assert.deepEqual(Object.keys(log[0].detail), ["file_id"]);
});

test("kind is the database's to set, and a closing hive's files have it", async () => {
  const closer = (
    await h.db.query(
      `insert into auth.users (email) values ('closer@example.com') returning id`,
    )
  ).rows[0].id;
  const who = { sub: closer, role: "authenticated" };
  const hiveC = (
    await h.as(who, `select public.create_hive('Closing', 'Closer') as id`)
  )[0].id;
  const [m] = await h.as(
    who,
    `select m.id, w.id as ws from public.members m
       join public.workspaces w on w.member_id = m.id where m.hive_id = $1`,
    [hiveC],
  );
  const path = `${m.id}/${m.ws}/outputs/k/deck.pptx`;
  await h.as(
    who,
    `insert into storage.objects (bucket_id, name) values ('files', $1)`,
    [path],
  );
  // A kind the client sends is overwritten.
  await h.as(
    who,
    `insert into public.files (hive_id, member_id, workspace_id, storage_path, name, mime, size_bytes, kind)
     values ($1, $2, $3, $4, 'deck.pptx', null, 1, 'image')`,
    [hiveC, m.id, m.ws, path],
  );
  await h.as(who, `select public.request_hive_deletion($1, 'Closing')`, [
    hiveC,
  ]);
  await h.db.exec("reset role");
  const r = await h.db.query(
    `select kind from public.files where hive_id = $1`,
    [hiveC],
  );
  assert.deepEqual(
    r.rows.map((x) => x.kind),
    ["slides"],
  );
});

test("a reference stays inside one hive, even for a person in two", async () => {
  const agent = await h.agentFor("dani");
  const home = await h.addNote("dani", "x1 home", { visibility: "group" });
  const f = await h.saveFile(agent, "dani", "x1.pdf", { note_id: home.id });
  // The outsider joins dani's hive as well: a member of two hives.
  await h.addMember(h.hive, h.users.outsider, "Outsider too");
  const mine = await h.as(
    h.person("outsider"),
    `select m.id, w.id as ws, m.hive_id from public.members m
       join public.workspaces w on w.member_id = m.id
      where m.user_id = $1 and m.hive_id <> $2`,
    [h.users.outsider, h.hive],
  );
  assert.equal(mine.length, 1);
  const [note] = await h.as(
    h.person("outsider"),
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
     values ($1, $2, $3, 'x1.md', 'x1 other hive', 'b') returning id`,
    [mine[0].hive_id, mine[0].id, mine[0].ws],
  );
  // They can read the file (member of its hive) but not reference it from
  // a note of their other hive.
  assert.equal(
    (
      await h.as(
        h.person("outsider"),
        `select id from public.files where id = $1`,
        [f.id],
      )
    ).length,
    1,
  );
  await assert.rejects(
    h.as(
      h.person("outsider"),
      `insert into public.file_references (file_id, note_id) values ($1, $2)`,
      [f.id, note.id],
    ),
    /row-level security/,
  );
});
