import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHive } from "./helpers/hive.mjs";

const h = await setupHive();
const KEY = (k) => ({ "x-hive-session": k });
const dani = () => h.person("dani");

test("an agent's first write opens a session and tags the note", async () => {
  const agent = await h.agentFor("dani");
  const n = await h.addNote("dani", "s1 note", {
    as: agent,
    headers: KEY("p1"),
  });
  assert.ok(n.session_id);
  const [s] = await h.as(
    dani(),
    `select agent_name, ended_at from public.sessions where id = $1`,
    [n.session_id],
  );
  assert.equal(s.agent_name, "Test agent");
  assert.equal(s.ended_at, null);
});

test("writes with the same key share a session; another key opens another", async () => {
  const agent = await h.agentFor("dani");
  const a = await h.addNote("dani", "s2 a", { as: agent, headers: KEY("p2") });
  const b = await h.addNote("dani", "s2 b", { as: agent, headers: KEY("p2") });
  const c = await h.addNote("dani", "s2 c", { as: agent, headers: KEY("p3") });
  assert.equal(a.session_id, b.session_id);
  assert.notEqual(a.session_id, c.session_id);
});

test("no header gives the key 'default'; a malformed header too", async () => {
  const agent = await h.agentFor("dani");
  const a = await h.addNote("dani", "s3 a", { as: agent });
  const b = await h.addNote("dani", "s3 b", {
    as: agent,
    headers: KEY("bad key; drop"),
  });
  assert.equal(a.session_id, b.session_id);
});

test("an agent cannot tag a write with a session it chose", async () => {
  const other = await h.agentFor("dani");
  const mine = await h.addNote("dani", "s4 other", {
    as: other,
    headers: KEY("x"),
  });
  const agent = await h.agentFor("dani");
  const [row] = await h.as(
    agent,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, session_id)
     values ($1, $2, $3, 's4.md', 's4', $4) returning session_id`,
    [h.hive, h.members.dani, h.ws.dani, mine.session_id],
  );
  assert.notEqual(row.session_id, mine.session_id);
});

test("a person's own writes carry no session", async () => {
  const n = await h.addNote("dani", "s5 person");
  assert.equal(n.session_id, null);
});

test("an open session is owner-only; colleagues see it once its note is shared", async () => {
  const agent = await h.agentFor("dani");
  const n = await h.addNote("dani", "s6", { as: agent, headers: KEY("p6") });
  const seen = (who) =>
    h.as(h.person(who), `select id from public.sessions where id = $1`, [
      n.session_id,
    ]);
  assert.equal((await seen("dani")).length, 1);
  assert.equal((await seen("ahmed")).length, 0);
  const [end] = await h.as(
    agent,
    `select public.session_end('Shared run', 'did things') as r`,
    [],
    {
      headers: KEY("p6"),
    },
  );
  assert.equal((await seen("ahmed")).length, 0); // the session note is private by default
  await h.as(
    dani(),
    `update public.notes set visibility = 'group' where id = $1`,
    [end.r.note_id],
  );
  assert.equal((await seen("ahmed")).length, 1);
  assert.equal((await seen("outsider")).length, 0);
});

test("session_end writes the session note, homes homeless files, and closes", async () => {
  const agent = await h.agentFor("dani");
  const f1 = await h.saveFile(agent, "dani", "s7-a.pdf", {
    headers: KEY("p7"),
  });
  const homed = await h.addNote("dani", "s7 home", {
    as: agent,
    headers: KEY("p7"),
  });
  const f2 = await h.saveFile(agent, "dani", "s7-b.pdf", {
    headers: KEY("p7"),
    note_id: homed.id,
  });
  const [{ r }] = await h.as(
    agent,
    `select public.session_end('Acme Q4', 'Drafted deck') as r`,
    [],
    {
      headers: KEY("p7"),
    },
  );
  assert.match(r.note_path, /^Sessions\/\d{4}-\d{2}-\d{2} Acme Q4\.md$/);
  const [note] = await h.as(
    dani(),
    `select title, body, visibility, session_id from public.notes where id = $1`,
    [r.note_id],
  );
  assert.equal(note.title, "Acme Q4");
  assert.equal(note.visibility, null);
  assert.equal(note.session_id, r.session_id);
  assert.match(note.body, /Drafted deck/);
  assert.match(note.body, /1 note, 2 files/);
  assert.doesNotMatch(note.body, /s7-a\.pdf|s7-b\.pdf|s7 home/); // counts only: names may be private
  assert.doesNotMatch(note.body, /\[\[/); // no wiki links: they would propose links
  const homes = await h.as(
    dani(),
    `select id, note_id from public.files where id = any($1) order by name`,
    [[f1.id, f2.id]],
  );
  assert.equal(homes.find((x) => x.id === f1.id).note_id, r.note_id);
  assert.equal(homes.find((x) => x.id === f2.id).note_id, homed.id);
  const [s] = await h.as(
    dani(),
    `select title, summary, ended_at from public.sessions where id = $1`,
    [r.session_id],
  );
  assert.equal(s.title, "Acme Q4");
  assert.ok(s.ended_at);
  // A later write with the same key opens a new session.
  const later = await h.addNote("dani", "s7 later", {
    as: agent,
    headers: KEY("p7"),
  });
  assert.notEqual(later.session_id, r.session_id);
});

test("a second session with the same title and day gets a distinct note path", async () => {
  const agent = await h.agentFor("dani");
  await h.addNote("dani", "s8 a", { as: agent, headers: KEY("p8") });
  const [{ r: one }] = await h.as(
    agent,
    `select public.session_end('Same', 'x') as r`,
    [],
    { headers: KEY("p8") },
  );
  await h.addNote("dani", "s8 b", { as: agent, headers: KEY("p8") });
  const [{ r: two }] = await h.as(
    agent,
    `select public.session_end('Same', 'y') as r`,
    [],
    { headers: KEY("p8") },
  );
  assert.notEqual(one.note_path, two.note_path);
  assert.match(two.note_path, / \(2\)\.md$/);
});

test("session_end refuses without an open session, a person, and bad titles", async () => {
  const agent = await h.agentFor("dani");
  await assert.rejects(
    h.as(agent, `select public.session_end('t', 's')`, [], {
      headers: KEY("never"),
    }),
    /no open session/,
  );
  await assert.rejects(
    h.as(dani(), `select public.session_end('t', 's')`),
    /only an agent/,
  );
  await h.addNote("dani", "s9", { as: agent, headers: KEY("p9") });
  await assert.rejects(
    h.as(agent, `select public.session_end('', 's')`, [], {
      headers: KEY("p9"),
    }),
    /title/,
  );
  await assert.rejects(
    h.as(agent, `select public.session_end($1, 's')`, ["x".repeat(121)], {
      headers: KEY("p9"),
    }),
    /title/,
  );
});

test("an idle session is closed by the next write and by the sweep", async () => {
  const agent = await h.agentFor("dani");
  const a = await h.addNote("dani", "s10 a", {
    as: agent,
    headers: KEY("p10"),
  });
  await h.db.exec("reset role");
  await h.db.query(
    `update public.sessions set last_active_at = now() - interval '3 hours' where id = $1`,
    [a.session_id],
  );
  const b = await h.addNote("dani", "s10 b", {
    as: agent,
    headers: KEY("p10"),
  });
  assert.notEqual(a.session_id, b.session_id);
  const [old] = await h.as(
    dani(),
    `select ended_at, note_id, summary from public.sessions where id = $1`,
    [a.session_id],
  );
  assert.ok(old.ended_at && old.note_id);
  assert.equal(old.summary, "Closed automatically.");

  await h.db.query(
    `update public.sessions set last_active_at = now() - interval '3 hours' where id = $1`,
    [b.session_id],
  );
  const [{ n }] = (await h.db.query(`select public.close_idle_sessions() as n`))
    .rows;
  assert.ok(n >= 1);
  const [closed] = await h.as(
    dani(),
    `select ended_at from public.sessions where id = $1`,
    [b.session_id],
  );
  assert.ok(closed.ended_at);
});

test("the sweep titles a session after its most frequent output folder", async () => {
  const agent = await h.agentFor("dani");
  const f = await h.saveFile(agent, "dani", "s11.pdf", { headers: KEY("p11") });
  await h.db.exec("reset role");
  await h.db.query(
    `update public.sessions set last_active_at = now() - interval '3 hours' where id = $1`,
    [f.session_id],
  );
  await h.db.query(`select public.close_idle_sessions()`);
  const [s] = await h.as(
    dani(),
    `select title from public.sessions where id = $1`,
    [f.session_id],
  );
  assert.equal(s.title, "proposal / acme");
});

test("nobody but the database owner may run the sweep", async () => {
  await assert.rejects(
    h.as(dani(), `select public.close_idle_sessions()`),
    /permission denied/,
  );
  const agent = await h.agentFor("dani");
  await assert.rejects(
    h.as(agent, `select public.close_idle_sessions()`),
    /permission denied/,
  );
});

test("nobody writes sessions directly", async () => {
  await assert.rejects(
    h.as(
      dani(),
      `insert into public.sessions (hive_id, member_id, workspace_id, agent_name, client_key)
                  values ($1, $2, $3, 'x', 'y')`,
      [h.hive, h.members.dani, h.ws.dani],
    ),
    /row-level security|permission denied/,
  );
  const agent = await h.agentFor("dani");
  const n = await h.addNote("dani", "s12", { as: agent, headers: KEY("p12") });
  const upd = await h.as(
    agent,
    `update public.sessions set title = 'x' where id = $1 returning id`,
    [n.session_id],
  );
  assert.equal(upd.length, 0);
});

test("a person opens and ends an upload session; files join it with the chosen home", async () => {
  const uploads = await h.addNote("dani", "Uploads", {
    visibility: "private",
    path: "Uploads.md",
  });
  const [{ id: sid }] = await h.as(
    dani(),
    `select public.upload_session_open($1) as id`,
    [h.ws.dani],
  );
  const path = `${h.members.dani}/${h.ws.dani}/uploads/${sid}/u.pdf`;
  await h.as(
    dani(),
    `insert into storage.objects (bucket_id, name) values ('files', $1)`,
    [path],
  );
  const [f] = await h.as(
    dani(),
    `insert into public.files (hive_id, member_id, workspace_id, note_id, storage_path, name, mime, size_bytes, session_id)
     values ($1, $2, $3, $4, $5, 'u.pdf', 'application/pdf', 10, $6) returning session_id`,
    [h.hive, h.members.dani, h.ws.dani, uploads.id, path, sid],
  );
  assert.equal(f.session_id, sid);
  await h.as(dani(), `select public.upload_session_end($1, $2)`, [
    sid,
    uploads.id,
  ]);
  const [s] = await h.as(
    dani(),
    `select agent_id, agent_name, title, note_id, ended_at from public.sessions where id = $1`,
    [sid],
  );
  assert.equal(s.agent_id, null);
  assert.equal(s.agent_name, "Browser upload");
  assert.match(s.title, /^Upload · \d{4}-\d{2}-\d{2}$/);
  assert.equal(s.note_id, uploads.id);
  assert.ok(s.ended_at);
});

test("upload sessions refuse agents, other people's workspaces and foreign sessions", async () => {
  const agent = await h.agentFor("dani");
  await assert.rejects(
    h.as(agent, `select public.upload_session_open($1)`, [h.ws.dani]),
    /only a person/,
  );
  await assert.rejects(
    h.as(h.person("ahmed"), `select public.upload_session_open($1)`, [
      h.ws.dani,
    ]),
    /not your workspace/,
  );
  const [{ id: sid }] = await h.as(
    dani(),
    `select public.upload_session_open($1) as id`,
    [h.ws.dani],
  );
  const path = `${h.members.ahmed}/${h.ws.ahmed}/uploads/x/u.pdf`;
  await h.as(
    h.person("ahmed"),
    `insert into storage.objects (bucket_id, name) values ('files', $1)`,
    [path],
  );
  await assert.rejects(
    h.as(
      h.person("ahmed"),
      `insert into public.files (hive_id, member_id, workspace_id, storage_path, name, mime, size_bytes, session_id)
       values ($1, $2, $3, $4, 'u.pdf', 'application/pdf', 10, $5)`,
      [h.hive, h.members.ahmed, h.ws.ahmed, path, sid],
    ),
    /not your upload session/,
  );
});

test("a person retitles their own session only", async () => {
  const agent = await h.agentFor("dani");
  const n = await h.addNote("dani", "s13", { as: agent, headers: KEY("p13") });
  await h.as(dani(), `select public.session_retitle($1, 'Better title')`, [
    n.session_id,
  ]);
  const [s] = await h.as(
    dani(),
    `select title from public.sessions where id = $1`,
    [n.session_id],
  );
  assert.equal(s.title, "Better title");
  await assert.rejects(
    h.as(h.person("ahmed"), `select public.session_retitle($1, 'x')`, [
      n.session_id,
    ]),
    /not your session/,
  );
  await assert.rejects(
    h.as(agent, `select public.session_retitle($1, 'x')`, [n.session_id]),
    /only a person/,
  );
});

test("a self-hosted agent's notes are tagged too", async () => {
  const agent = await h.agentFor("sara", "self_hosted");
  const n = await h.addNote("sara", "s14", { as: agent, headers: KEY("p14") });
  assert.ok(n.session_id);
});

test("hive_append-style updates bump the session but keep the note's first session", async () => {
  const agent = await h.agentFor("dani");
  const n = await h.addNote("dani", "s15", { as: agent, headers: KEY("p15a") });
  const [u] = await h.as(
    agent,
    `update public.notes set body = 'more' where id = $1 returning session_id`,
    [n.id],
    {
      headers: KEY("p15b"),
    },
  );
  assert.equal(u.session_id, n.session_id);
  const open = await h.as(
    dani(),
    `select id from public.sessions where client_key like '%:p15b' and ended_at is null`,
  );
  assert.equal(open.length, 1);
});

// The deletion of a hive (20261124091833_hive_deletion.sql) and sessions.
test("a closing hive's idle session does not stop the sweep; the erase removes sessions", async () => {
  const g = await setupHive(); // a hive of its own, so closing it hurts no other test
  const agent = await g.agentFor("dani");
  const n = await g.addNote("dani", "g1", { as: agent, headers: KEY("g1") });
  await g.as(
    g.person("dani"),
    `select public.request_hive_deletion($1, 'Test hive')`,
    [g.hive],
  );
  await g.db.exec("reset role");
  await g.db.query(
    `update public.sessions set last_active_at = now() - interval '3 hours' where id = $1`,
    [n.session_id],
  );
  const [{ c }] = (await g.db.query(`select public.close_idle_sessions() as c`))
    .rows;
  assert.equal(c, 0);
  const open = await g.db.query(
    `select ended_at from public.sessions where id = $1`,
    [n.session_id],
  );
  assert.equal(open.rows[0].ended_at, null);
  // A closing hive opens no upload session either.
  await assert.rejects(
    g.as(g.person("dani"), `select public.upload_session_open($1)`, [
      g.ws.dani,
    ]),
    /being deleted/,
  );

  // The erase, as the server: the session goes with the hive.
  await g.db.query(
    `update public.hives set closing_at = now() - interval '7 days 1 hour',
                             delete_after = now() - interval '1 hour' where id = $1`,
    [g.hive],
  );
  const service = async (sql, params = []) => {
    await g.db.exec("reset role");
    await g.db.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ role: "service_role" }),
    ]);
    await g.db.exec("set role service_role");
    try {
      return (await g.db.query(sql, params)).rows;
    } finally {
      await g.db.exec("reset role");
    }
  };
  await service(`select public.begin_hive_purge($1)`, [g.hive]);
  for (;;) {
    const names = (
      await service(`select * from public.hive_object_paths($1, null, 1000)`, [
        g.hive,
      ])
    ).map((r) => r.name);
    if (names.length === 0) break;
    await service(
      `delete from storage.objects where bucket_id = 'files' and name = any ($1::text[])`,
      [names],
    );
  }
  const [{ done }] = await service(`select public.purge_hive($1) as done`, [
    g.hive,
  ]);
  assert.equal(done, true);
  const left = await g.db.query(
    `select count(*)::int as n from public.sessions where hive_id = $1`,
    [g.hive],
  );
  assert.equal(left.rows[0].n, 0);
});

test("an app pass cannot end a session", async () => {
  // The full proof is in sharing-rules.test.mjs; here the refusal's words.
  await assert.rejects(
    h.as(
      { ...dani(), client_id: "app-x" },
      `select public.session_end('t', 's')`,
    ),
    /an app pass cannot do this/,
  );
});

test("deleting a session empties the references of its notes and files", async () => {
  const agent = await h.agentFor("dani");
  const n = await h.addNote("dani", "d1", { as: agent, headers: KEY("d1") });
  const f = await h.saveFile(agent, "dani", "d1.pdf", { headers: KEY("d1") });
  assert.ok(n.session_id && f.session_id === n.session_id);
  await h.db.exec("reset role");
  await h.db.query(`delete from public.sessions where id = $1`, [n.session_id]);
  const [note] = (
    await h.db.query(`select session_id from public.notes where id = $1`, [
      n.id,
    ])
  ).rows;
  const [file] = (
    await h.db.query(`select session_id from public.files where id = $1`, [
      f.id,
    ])
  ).rows;
  assert.equal(note.session_id, null);
  assert.equal(file.session_id, null);
});

test("a person cannot tag a write with an agent's session or another workspace's upload session", async () => {
  const agent = await h.agentFor("dani");
  const a = await h.addNote("dani", "t1", { as: agent, headers: KEY("t1") });
  const tag = (sid, ws = h.ws.dani) =>
    h.as(
      dani(),
      `insert into public.notes (hive_id, member_id, workspace_id, path, title, session_id)
       values ($1, $2, $3, $4, 't', $5)`,
      [h.hive, h.members.dani, ws, `tag-${Math.random()}.md`, sid],
    );
  await assert.rejects(tag(a.session_id), /not your upload session/);
  // A second workspace of dani's, in the same hive.
  const [{ id: w2 }] = await h.as(
    dani(),
    `insert into public.workspaces (hive_id, member_id, name)
     values ($1, $2, 'Second') returning id`,
    [h.hive, h.members.dani],
  );
  const [{ id: sid }] = await h.as(
    dani(),
    `select public.upload_session_open($1) as id`,
    [w2],
  );
  await assert.rejects(tag(sid), /not your upload session/); // in ws.dani
  await tag(sid, w2); // its own workspace works
});

test("an upload session ends only on a note of its own workspace, not of another hive", async () => {
  const [{ id: hive2 }] = await h.as(
    dani(),
    `select public.create_hive('Second hive', 'Dani two') as id`,
  );
  const [other] = await h.as(
    dani(),
    `select m.id as member, w.id as ws from public.members m
       join public.workspaces w on w.member_id = m.id
      where m.hive_id = $1 limit 1`,
    [hive2],
  );
  const [foreign] = await h.as(
    dani(),
    `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     values ($1, $2, $3, 'f.md', 'f') returning id`,
    [hive2, other.member, other.ws],
  );
  const [{ id: sid }] = await h.as(
    dani(),
    `select public.upload_session_open($1) as id`,
    [h.ws.dani],
  );
  await assert.rejects(
    h.as(dani(), `select public.upload_session_end($1, $2)`, [sid, foreign.id]),
    /not your note/,
  );
  const [s] = await h.as(
    dani(),
    `select ended_at, note_id from public.sessions where id = $1`,
    [sid],
  );
  assert.equal(s.ended_at, null);
  assert.equal(s.note_id, null);
});
