import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHive } from "./helpers/hive.mjs";
import { syncFor, markSynced } from "./helpers/sync.mjs";

test("a person makes a sync key for an own workspace; it is shown once", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  assert.match(s.key, /^hsync_[0-9a-f]{64}$/);
  const rows = await t.as(
    t.person("dani"),
    `select id, revoked_at from public.sync_keys`,
  );
  assert.equal(rows.length, 1);
  await assert.rejects(
    t.as(t.person("dani"), `select key_hash from public.sync_keys`),
    /permission denied/,
  );
});

test("only a person makes a key, and only for their own workspace", async () => {
  const t = await setupHive();
  const agent = await t.agentFor("dani");
  await assert.rejects(
    t.as(agent, `select * from public.create_sync_key($1)`, [t.ws.dani]),
    /only a person makes a sync key/,
  );
  await assert.rejects(
    t.as(t.person("ahmed"), `select * from public.create_sync_key($1)`, [
      t.ws.dani,
    ]),
    /that workspace is not yours/,
  );
  const s = await syncFor(t, "dani");
  await assert.rejects(
    t.as(s.claims, `select * from public.create_sync_key($1)`, [t.ws.dani]),
    /only a person makes a sync key/,
  );
});

test("a new key revokes the old one; a revoked key does not sign in", async () => {
  const t = await setupHive();
  const first = await syncFor(t, "dani");
  await syncFor(t, "dani");
  await assert.rejects(
    t.as(null, `select * from public.sync_login($1)`, [first.key]),
    /unknown or revoked sync key/,
  );
  const second = await syncFor(t, "dani");
  await t.as(t.person("dani"), `select public.revoke_sync_key($1)`, [
    second.keyId,
  ]);
  await assert.rejects(
    t.as(null, `select * from public.sync_login($1)`, [second.key]),
    /unknown or revoked sync key/,
  );
  await assert.rejects(
    t.as(t.person("ahmed"), `select public.revoke_sync_key($1)`, [first.keyId]),
    /that sync key is not yours/,
  );
});

test("a sync key is not an agent token", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  await assert.rejects(
    t.as(null, `select * from public.agent_login($1)`, [s.key]),
    /unknown, expired or revoked token/,
  );
});

test("the sync identity cannot touch a table directly", async () => {
  const t = await setupHive();
  await t.addNote("dani", "Mine");
  const s = await syncFor(t, "dani");
  assert.equal((await t.as(s.claims, `select id from public.notes`)).length, 0);
  assert.equal(
    (await t.as(s.claims, `select id from public.sync_keys`)).length,
    0,
  );
  await assert.rejects(
    t.as(
      s.claims,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'x.md', 'x')`,
      [t.hive, t.members.dani, t.ws.dani],
    ),
    /row-level security/,
  );
});

test("the sync identity is refused every person-only function", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  await assert.rejects(
    t.as(s.claims, `select public.create_hive('x', 'x')`),
    /sign in as a person to create a hive/,
  );
  await assert.rejects(
    t.as(s.claims, `select * from public.create_agent($1, 'a', 'other')`, [
      t.ws.dani,
    ]),
    /agents cannot create agents/,
  );
});

test("the sync identity may upload only under its own workspace", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  await t.as(
    s.claims,
    `insert into storage.objects (bucket_id, name) values ('files', $1)`,
    [`${t.members.dani}/${t.ws.dani}/vault/aa/x.pdf`],
  );
  await assert.rejects(
    t.as(
      s.claims,
      `insert into storage.objects (bucket_id, name) values ('files', $1)`,
      [`${t.members.ahmed}/${t.ws.ahmed}/vault/aa/x.pdf`],
    ),
    /row-level security/,
  );
});

test("a synced note is read-only to the person and their agents", async () => {
  const t = await setupHive();
  const n = await t.addNote("dani", "Kept");
  const s = await syncFor(t, "dani");
  await markSynced(t, "notes", n.id, s.keyId);
  await assert.rejects(
    t.as(t.person("dani"), `update public.notes set body = 'x' where id = $1`, [
      n.id,
    ]),
    /this note is kept by your vault: edit it in your vault/,
  );
  await assert.rejects(
    t.as(
      t.person("dani"),
      `update public.notes set path = 'moved.md' where id = $1`,
      [n.id],
    ),
    /this note is kept by your vault/,
  );
  const agent = await t.agentFor("dani");
  await assert.rejects(
    t.as(agent, `update public.notes set body = 'x' where id = $1`, [n.id]),
    /this note is kept by your vault/,
  );
  // Sharing stays the person's, and so does deleting.
  await t.as(
    t.person("dani"),
    `update public.notes set visibility = 'members' where id = $1`,
    [n.id],
  );
  await t.as(t.person("dani"), `delete from public.notes where id = $1`, [
    n.id,
  ]);
});

test("nobody but the sync marks a note or a file as kept", async () => {
  const t = await setupHive();
  const n = await t.addNote("dani", "Mine");
  const s = await syncFor(t, "dani");
  await assert.rejects(
    t.as(
      t.person("dani"),
      `update public.notes set synced_by = $2 where id = $1`,
      [n.id, s.keyId],
    ),
    /only the sync marks a note as kept by your vault/,
  );
  const f = await t.saveFile(t.person("dani"), "dani", "a.pdf");
  const row = (
    await t.db.query(
      `select vault_path, synced_by from public.files where id = $1`,
      [f.id],
    )
  ).rows[0];
  assert.equal(row.vault_path, null);
  assert.equal(row.synced_by, null);
});

test("an app pass cannot make a sync key", async () => {
  const t = await setupHive();
  await assert.rejects(
    t.as(
      { sub: t.users.dani, role: "authenticated", client_id: "some-app" },
      `select * from public.create_sync_key($1)`,
      [t.ws.dani],
    ),
    /only a person makes a sync key/,
  );
});

// Stand-ins for the security-definer sync_* functions of a later task: they run one
// statement as the definer, so the triggers see the sync identity as they will there.
async function standIn(t, name, args, sql) {
  await t.db.exec("reset role");
  await t.db.query(
    `create function public.${name}(${args}) returns void
       language sql security definer set search_path = '' as $$ ${sql} $$`,
  );
  await t.db.query(
    `grant execute on function public.${name}(${args}) to authenticated`,
  );
}

const KEEPS = /the sync only changes the notes it keeps/;
const KEEPS_FILES = /the sync only changes the files it keeps/;
const OWN_WS = /the sync writes only in its own workspace/;

test("the sync adopts only an unsynced note of its own workspace", async () => {
  const t = await setupHive();
  const theirs = await t.addNote("ahmed", "Theirs");
  const mine = await t.addNote("dani", "Mine");
  const s = await syncFor(t, "dani");
  await standIn(
    t,
    "zz_adopt",
    "p uuid, k uuid",
    `update public.notes set synced_by = k where id = p`,
  );
  await assert.rejects(
    t.as(s.claims, `select public.zz_adopt($1, $2)`, [theirs.id, s.keyId]),
    KEEPS,
  );
  await t.as(s.claims, `select public.zz_adopt($1, $2)`, [mine.id, s.keyId]);
  const row = (
    await t.db.query(`select synced_by from public.notes where id = $1`, [
      mine.id,
    ])
  ).rows[0];
  assert.equal(row.synced_by, s.keyId);
});

test("the sync cannot edit a note another member's key keeps, or clear its mark", async () => {
  const t = await setupHive();
  const theirs = await t.addNote("ahmed", "Theirs");
  const mine = await t.addNote("dani", "Mine");
  const other = await syncFor(t, "ahmed");
  const s = await syncFor(t, "dani");
  await markSynced(t, "notes", theirs.id, other.keyId);
  await markSynced(t, "notes", mine.id, s.keyId);
  await standIn(
    t,
    "zz_edit",
    "p uuid",
    `update public.notes set body = 'changed' where id = p`,
  );
  await standIn(
    t,
    "zz_clear",
    "p uuid",
    `update public.notes set synced_by = null where id = p`,
  );
  await assert.rejects(
    t.as(s.claims, `select public.zz_edit($1)`, [theirs.id]),
    KEEPS,
  );
  await assert.rejects(
    t.as(s.claims, `select public.zz_clear($1)`, [mine.id]),
    KEEPS,
  );
  await t.as(s.claims, `select public.zz_edit($1)`, [mine.id]);
});

test("the sync inserts notes and files only in its own workspace", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  await standIn(
    t,
    "zz_note",
    "m uuid, w uuid",
    `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     values ('00000000-0000-0000-0000-000000000000', m, w, 'x.md', 'x')`,
  );
  await assert.rejects(
    t.as(s.claims, `select public.zz_note($1, $2)`, [
      t.members.ahmed,
      t.ws.ahmed,
    ]),
    OWN_WS,
  );
  await t.as(s.claims, `select public.zz_note($1, $2)`, [
    t.members.dani,
    t.ws.dani,
  ]);
  await standIn(
    t,
    "zz_file",
    "m uuid, w uuid, sp text",
    `insert into public.files (hive_id, member_id, workspace_id, storage_path, name, size_bytes)
     select h.hive_id, m, w, m || '/' || w || '/' || sp, 'a.pdf', 1 from public.members h where h.id = m`,
  );
  await assert.rejects(
    t.as(s.claims, `select public.zz_file($1, $2, 'p1')`, [
      t.members.ahmed,
      t.ws.ahmed,
    ]),
    OWN_WS,
  );
  await t.as(s.claims, `select public.zz_file($1, $2, 'p2')`, [
    t.members.dani,
    t.ws.dani,
  ]);
  const row = (
    await t.db.query(
      `select synced_by from public.files where storage_path like '%/p2'`,
    )
  ).rows[0];
  assert.equal(row.synced_by, s.keyId);
});

test("the sync changes only the files its key keeps", async () => {
  const t = await setupHive();
  const theirs = await t.saveFile(t.person("ahmed"), "ahmed", "t.pdf");
  const mine = await t.saveFile(t.person("dani"), "dani", "m.pdf");
  const unkept = await t.saveFile(t.person("dani"), "dani", "u.pdf");
  const other = await syncFor(t, "ahmed");
  const s = await syncFor(t, "dani");
  await markSynced(t, "files", theirs.id, other.keyId);
  await markSynced(t, "files", mine.id, s.keyId);
  await standIn(
    t,
    "zz_vpath",
    "p uuid, v text",
    `update public.files set vault_path = v where id = p`,
  );
  await standIn(
    t,
    "zz_fclear",
    "p uuid",
    `update public.files set synced_by = null where id = p`,
  );
  await assert.rejects(
    t.as(s.claims, `select public.zz_vpath($1, 'a')`, [theirs.id]),
    KEEPS_FILES,
  );
  await assert.rejects(
    t.as(s.claims, `select public.zz_vpath($1, 'a')`, [unkept.id]),
    KEEPS_FILES,
  );
  await assert.rejects(
    t.as(s.claims, `select public.zz_fclear($1)`, [mine.id]),
    KEEPS_FILES,
  );
  await t.as(s.claims, `select public.zz_vpath($1, 'a')`, [mine.id]);
});

const sha = (c) => c.repeat(64);
const openRun = async (t, s, confirm = false) =>
  (await t.as(s.claims, `select public.sync_open_run($1) as r`, [confirm]))[0]
    .r;
const plan = async (t, s, run, entries) =>
  (
    await t.as(s.claims, `select public.sync_plan($1, $2, true) as p`, [
      run,
      JSON.stringify(entries),
    ])
  )[0].p;
const putNotes = async (t, s, run, notes) =>
  (
    await t.as(s.claims, `select public.sync_put_notes($1, $2) as r`, [
      run,
      JSON.stringify(notes),
    ])
  )[0].r;
const note = (path, c, extra = {}) => ({
  path,
  title: path.replace(/\.md$/, ""),
  body: `body ${c}`,
  frontmatter: {},
  sha256: sha(c),
  ...extra,
});

test("a run opens only with a live key, and names its storage folder", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  assert.equal(r.storage_prefix, `${t.members.dani}/${t.ws.dani}/vault/`);
  await t.as(t.person("dani"), `select public.revoke_sync_key($1)`, [s.keyId]);
  await assert.rejects(openRun(t, s), /this sync key is not live/);
});

test("the plan lists new, changed, moved and gone, and adopts imported notes", async () => {
  const t = await setupHive();
  await t.addNote("dani", "Imported", { path: "a/Imported.md" });
  await t.addNote("dani", "Uploads", { path: "Uploads.md" });
  const s = await syncFor(t, "dani");
  let run = (await openRun(t, s)).run_id;
  let p = await plan(t, s, run, [
    { path: "a/Imported.md", sha256: sha("1"), size: 4 },
    { path: "b/New.md", sha256: sha("2"), size: 4 },
  ]);
  // The imported note is adopted with no fingerprint yet, so it is "changed".
  assert.deepEqual(p.new, ["b/New.md"]);
  assert.deepEqual(p.changed, ["a/Imported.md"]);
  assert.deepEqual(p.gone, []);
  await putNotes(t, s, run, [
    note("a/Imported.md", "1"),
    note("b/New.md", "2"),
  ]);

  run = (await openRun(t, s)).run_id;
  p = await plan(t, s, run, [
    { path: "a/Imported.md", sha256: sha("1"), size: 4 },
    { path: "c/New.md", sha256: sha("2"), size: 4 },
  ]);
  assert.deepEqual(p.moved, [{ from: "b/New.md", to: "c/New.md" }]);
  assert.deepEqual(p.new, []);
  assert.deepEqual(p.changed, []);
  // Uploads.md was never synced: it is not gone.
  assert.deepEqual(p.gone, []);
  assert.equal(p.kept, 2);
});

test("two new paths with the moved content are not a move", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let run = (await openRun(t, s)).run_id;
  await plan(t, s, run, [{ path: "x.md", sha256: sha("3"), size: 1 }]);
  await putNotes(t, s, run, [note("x.md", "3")]);
  run = (await openRun(t, s)).run_id;
  const p = await plan(t, s, run, [
    { path: "y.md", sha256: sha("3"), size: 1 },
    { path: "z.md", sha256: sha("3"), size: 1 },
  ]);
  assert.deepEqual(p.moved, []);
  assert.deepEqual(p.gone, ["x.md"]);
  assert.deepEqual(p.new, ["y.md", "z.md"]);
});

test("pages are refused when malformed or too long", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const run = (await openRun(t, s)).run_id;
  await assert.rejects(
    plan(t, s, run, [{ path: "../x.md", sha256: sha("1"), size: 1 }]),
    /a manifest entry is not usable/,
  );
  await assert.rejects(
    plan(t, s, run, [{ path: "x.md", sha256: "nope", size: 1 }]),
    /a manifest entry is not usable/,
  );
  await assert.rejects(
    plan(t, s, run, [{ path: "x.md", sha256: sha("1") }]),
    /a manifest entry is not usable/,
  );
  const many = Array.from({ length: 2001 }, (_, i) => ({
    path: `n${i}.md`,
    sha256: sha("1"),
    size: 1,
  }));
  await assert.rejects(plan(t, s, run, many), /a page holds at most 2000/);
});

test("another member's run cannot be used", async () => {
  const t = await setupHive();
  const a = await syncFor(t, "dani");
  const b = await syncFor(t, "ahmed");
  const run = (await openRun(t, a)).run_id;
  await assert.rejects(plan(t, b, run, []), /no such run/);
});

test("synced notes: a move keeps the note, dates come from the vault, no session", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let run = (await openRun(t, s)).run_id;
  const r = await putNotes(t, s, run, [
    note("old/A.md", "4", { created_at: "2024-03-01T12:00:00Z" }),
  ]);
  const id = r.written[0].id;
  run = (await openRun(t, s)).run_id;
  await putNotes(t, s, run, [note("new/A.md", "4", { from: "old/A.md" })]);
  const row = (
    await t.db.query(
      `select n.path, n.created_at, n.session_id, n.visibility, n.synced_by,
              f.path as folder
         from public.notes n left join public.folders f on f.id = n.folder_id
        where n.id = $1`,
      [id],
    )
  ).rows[0];
  assert.equal(row.path, "new/A.md");
  assert.equal(row.folder, "new");
  assert.equal(row.session_id, null);
  assert.equal(row.visibility, null);
  assert.equal(row.synced_by, s.keyId);
  assert.equal(
    new Date(row.created_at).toISOString(),
    "2024-03-01T12:00:00.000Z",
  );
  const audit = await t.db.query(
    `select detail from public.audit_log where action = 'note.moved'`,
  );
  assert.equal(audit.rows[0].detail.sync_key_id, s.keyId);
});

test("a move from a note the sync does not keep writes a new note instead", async () => {
  const t = await setupHive();
  await t.addNote("dani", "Mine", { path: "Mine.md" });
  const s = await syncFor(t, "dani");
  const run = (await openRun(t, s)).run_id;
  const r = await putNotes(t, s, run, [
    note("Elsewhere.md", "5", { from: "Mine.md" }),
  ]);
  assert.equal(r.written.length, 1);
  const still = await t.db.query(
    `select count(*)::int as n from public.notes
      where path = 'Mine.md' and synced_by is null`,
  );
  assert.equal(still.rows[0].n, 1);
});

test("a new key keeps what the old key synced", async () => {
  const t = await setupHive();
  const first = await syncFor(t, "dani");
  let run = (await openRun(t, first)).run_id;
  await putNotes(t, first, run, [note("K.md", "a")]);
  const second = await syncFor(t, "dani");
  run = (await openRun(t, second)).run_id;
  const p = await plan(t, second, run, [
    { path: "K.md", sha256: sha("a"), size: 1 },
  ]);
  assert.deepEqual(p.new, []);
  assert.deepEqual(p.changed, []);
});

test("a batch over 50 notes or 1 MB of text is refused whole", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const run = (await openRun(t, s)).run_id;
  const many = Array.from({ length: 51 }, (_, i) => note(`n${i}.md`, "6"));
  await assert.rejects(
    putNotes(t, s, run, many),
    /a batch holds at most 50 notes/,
  );
  const big = note("big.md", "7", { body: "x".repeat(1_000_001) });
  await assert.rejects(
    putNotes(t, s, run, [big]),
    /a batch holds at most 1 MB/,
  );
});

test("wiki links between synced notes are made and accepted at once", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const run = (await openRun(t, s)).run_id;
  await putNotes(t, s, run, [note("A.md", "8"), note("B.md", "9")]);
  const made = (
    await t.as(s.claims, `select public.sync_link_notes($1, $2) as n`, [
      run,
      JSON.stringify([
        { from: "A.md", to: "B.md" },
        { from: "B.md", to: "A.md" },
      ]),
    ])
  )[0].n;
  assert.equal(made, 1);
  const l = await t.db.query(`select status from public.links`);
  assert.equal(l.rows[0].status, "accepted");
});

test("a link never reaches another member's note of the same path", async () => {
  const t = await setupHive();
  await t.addNote("ahmed", "B", { path: "B.md" });
  const s = await syncFor(t, "dani");
  const run = (await openRun(t, s)).run_id;
  await putNotes(t, s, run, [note("A.md", "8")]);
  const made = (
    await t.as(s.claims, `select public.sync_link_notes($1, $2) as n`, [
      run,
      JSON.stringify([{ from: "A.md", to: "B.md" }]),
    ])
  )[0].n;
  assert.equal(made, 0);
  const l = await t.db.query(`select count(*)::int as n from public.links`);
  assert.equal(l.rows[0].n, 0);
});

test("a move from a note another member's key keeps writes a new note", async () => {
  const t = await setupHive();
  const a = await syncFor(t, "ahmed");
  const s = await syncFor(t, "dani");
  let run = (await openRun(t, a)).run_id;
  await putNotes(t, a, run, [note("X.md", "a")]);
  run = (await openRun(t, s)).run_id;
  const r = await putNotes(t, s, run, [note("Y.md", "b", { from: "X.md" })]);
  assert.equal(r.written.length, 1);
  assert.equal(r.failed.length, 0);
  const theirs = (
    await t.db.query(
      `select path, body, synced_by from public.notes where workspace_id = $1`,
      [t.ws.ahmed],
    )
  ).rows;
  assert.deepEqual(theirs, [
    { path: "X.md", body: "body a", synced_by: a.keyId },
  ]);
  const mine = (
    await t.db.query(
      `select path, synced_by from public.notes where workspace_id = $1`,
      [t.ws.dani],
    )
  ).rows;
  assert.deepEqual(mine, [{ path: "Y.md", synced_by: s.keyId }]);
});

test("a refused note is reported by code alone and the others are written", async () => {
  const t = await setupHive();
  await t.addNote("dani", "Held", { path: "Held.md" });
  const s = await syncFor(t, "dani");
  let run = (await openRun(t, s)).run_id;
  await putNotes(t, s, run, [note("X.md", "1")]);
  run = (await openRun(t, s)).run_id;
  const r = await putNotes(t, s, run, [
    note("Held.md", "2", { from: "X.md" }),
    note("Fine.md", "3"),
  ]);
  assert.equal(r.failed.length, 1);
  assert.deepEqual(Object.keys(r.failed[0]).sort(), ["code", "path"]);
  assert.equal(r.failed[0].path, "Held.md");
  assert.match(r.failed[0].code, /^[0-9A-Z]{5}$/);
  assert.deepEqual(
    r.written.map((w) => w.path),
    ["Fine.md"],
  );
});

test("the plan never adopts another member's unsynced note", async () => {
  const t = await setupHive();
  await t.addNote("ahmed", "Shared", { path: "a/Shared.md" });
  const s = await syncFor(t, "dani");
  const run = (await openRun(t, s)).run_id;
  const p = await plan(t, s, run, [
    { path: "a/Shared.md", sha256: sha("1"), size: 1 },
  ]);
  assert.deepEqual(p.new, ["a/Shared.md"]);
  assert.deepEqual(p.changed, []);
  const row = await t.db.query(
    `select synced_by from public.notes where workspace_id = $1`,
    [t.ws.ahmed],
  );
  assert.equal(row.rows[0].synced_by, null);
});

test("a plan over two pages lists both, and a moved attachment is rehomed", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let run = (await openRun(t, s)).run_id;
  const put = await putNotes(t, s, run, [note("Home.md", "1")]);
  const noteId = put.written[0].id;
  await t.db.query(
    `insert into public.files (hive_id, member_id, workspace_id, note_id, storage_path,
                               name, size_bytes, vault_path, synced_by, sync_sha256)
     values ($1, $2, $3, $4, $5, 'p.png', 1, 'img/p.png', $6, $7)`,
    [
      t.hive,
      t.members.dani,
      t.ws.dani,
      noteId,
      `${t.members.dani}/${t.ws.dani}/vault/img/p.png`,
      s.keyId,
      sha("f"),
    ],
  );
  run = (await openRun(t, s)).run_id;
  const first = await t.as(
    s.claims,
    `select public.sync_plan($1, $2, false) as p`,
    [
      run,
      JSON.stringify([
        { path: "Home.md", sha256: sha("1"), size: 1 },
        { path: "One.md", sha256: sha("2"), size: 1 },
      ]),
    ],
  );
  assert.deepEqual(first[0].p, { received: 2 });
  const p = await plan(t, s, run, [
    { path: "Two.md", sha256: sha("3"), size: 1 },
    { path: "img/p.png", sha256: sha("f"), size: 1, home: "Other.md" },
  ]);
  assert.deepEqual(p.new, ["One.md", "Two.md"]);
  assert.deepEqual(p.changed, []);
  assert.deepEqual(p.gone, []);
  assert.deepEqual(p.rehome, [{ path: "img/p.png", home: "Other.md" }]);
});

const putFiles = async (t, s, run, files) =>
  (
    await t.as(s.claims, `select public.sync_put_files($1, $2) as r`, [
      run,
      JSON.stringify(files),
    ])
  )[0].r;
const store = async (t, s, prefix, key, name) => {
  const path = `${prefix}${key}/${name}`;
  await t.as(
    s.claims,
    `insert into storage.objects (bucket_id, name) values ('files', $1)`,
    [path],
  );
  return path;
};
const del = async (t, s, run, paths) =>
  (
    await t.as(s.claims, `select public.sync_delete($1, $2) as r`, [run, paths])
  )[0].r;

test("a synced file lives in the note that links it, else in Vault files", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  await putNotes(t, s, r.run_id, [note("deck/Notes.md", "b")]);
  const a = await store(t, s, r.storage_prefix, "a".repeat(32), "deck.html");
  const b = await store(t, s, r.storage_prefix, "b".repeat(32), "loose.pdf");
  const out = await putFiles(t, s, r.run_id, [
    {
      path: "deck/deck.html",
      name: "deck.html",
      size: 10,
      sha256: sha("c"),
      mime: "text/html",
      home: "deck/Notes.md",
      storage_path: a,
    },
    {
      path: "deck/loose.pdf",
      name: "loose.pdf",
      size: 10,
      sha256: sha("d"),
      mime: "application/pdf",
      home: "deck/Vault files.md",
      storage_path: b,
    },
  ]);
  assert.equal(out.written.length, 2);
  const rows = (
    await t.db.query(
      `select f.vault_path, f.mime, f.synced_by, n.path as home, n.sync_generated,
              n.synced_by as home_synced_by
         from public.files f join public.notes n on n.id = f.note_id
        order by f.vault_path`,
    )
  ).rows;
  assert.equal(rows[0].home, "deck/Notes.md");
  // A page type is never declared, whatever the job sends.
  assert.equal(rows[0].mime, "application/octet-stream");
  assert.equal(rows[0].synced_by, s.keyId);
  assert.equal(rows[1].home, "deck/Vault files.md");
  assert.equal(rows[1].sync_generated, true);
  // The generated note is kept by the key, so the cleanup and the delete rules see it.
  assert.equal(rows[1].home_synced_by, s.keyId);
});

test("a file field of the wrong JSON type is refused", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  const good = {
    path: "x.pdf",
    name: "x.pdf",
    size: 1,
    sha256: sha("e"),
    mime: "application/pdf",
    home: "Vault files.md",
  };
  for (const bad of [
    { name: 5 },
    { mime: 7 },
    { home: 3 },
    { from: 4 },
    { path: 9 },
    { size: "1" },
    { storage_path: 8 },
  ]) {
    await assert.rejects(
      putFiles(t, s, r.run_id, [{ ...good, ...bad }]),
      /a file is not usable/,
    );
  }
});

test("a file record needs its stored object under the run's folder", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  const out = await putFiles(t, s, r.run_id, [
    {
      path: "x.pdf",
      name: "x.pdf",
      size: 1,
      sha256: sha("e"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: `${r.storage_prefix}${"e".repeat(32)}/x.pdf`,
    },
  ]);
  assert.equal(out.written.length, 0);
  assert.equal(out.failed.length, 1);
});

test("a changed file's old object becomes an orphan", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let r = await openRun(t, s);
  const one = await store(t, s, r.storage_prefix, "1".repeat(32), "a.pdf");
  await putFiles(t, s, r.run_id, [
    {
      path: "a.pdf",
      name: "a.pdf",
      size: 1,
      sha256: sha("1"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: one,
    },
  ]);
  r = await openRun(t, s);
  const two = await store(t, s, r.storage_prefix, "2".repeat(32), "a.pdf");
  await putFiles(t, s, r.run_id, [
    {
      path: "a.pdf",
      name: "a.pdf",
      size: 2,
      sha256: sha("2"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: two,
    },
  ]);
  const o = await t.db.query(`select storage_path from public.sync_orphans`);
  assert.deepEqual(
    o.rows.map((x) => x.storage_path),
    [one],
  );
  const f = await t.db.query(`select kind, size_bytes from public.files`);
  assert.equal(f.rows[0].kind, "pdf");
  assert.equal(Number(f.rows[0].size_bytes), 2);
});

test("a move or rehome without a new object keeps the stored file", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let r = await openRun(t, s);
  const one = await store(t, s, r.storage_prefix, "1".repeat(32), "a.pdf");
  await putFiles(t, s, r.run_id, [
    {
      path: "a.pdf",
      name: "a.pdf",
      size: 1,
      sha256: sha("1"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: one,
    },
  ]);
  r = await openRun(t, s);
  const out = await putFiles(t, s, r.run_id, [
    {
      path: "docs/b.pdf",
      from: "a.pdf",
      name: "b.pdf",
      size: 1,
      sha256: sha("1"),
      mime: "application/pdf",
      home: "docs/Vault files.md",
    },
  ]);
  assert.equal(out.written.length, 1);
  const f = await t.db.query(
    `select f.vault_path, f.storage_path, f.name, f.kind, n.path as home from public.files f
       join public.notes n on n.id = f.note_id`,
  );
  assert.deepEqual(f.rows, [
    {
      vault_path: "docs/b.pdf",
      storage_path: one,
      name: "b.pdf",
      kind: "pdf",
      home: "docs/Vault files.md",
    },
  ]);
  const o = await t.db.query(
    `select count(*)::int as n from public.sync_orphans`,
  );
  assert.equal(o.rows[0].n, 0);
  const a = await t.db.query(
    `select count(*)::int as n from public.audit_log where action = 'file.moved'`,
  );
  assert.equal(a.rows[0].n, 1);
});

test("the person cannot change a synced file's home note", async () => {
  const t = await setupHive();
  const mine = await t.addNote("dani", "Other");
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  const p = await store(t, s, r.storage_prefix, "f".repeat(32), "f.pdf");
  const out = await putFiles(t, s, r.run_id, [
    {
      path: "f.pdf",
      name: "f.pdf",
      size: 1,
      sha256: sha("f"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: p,
    },
  ]);
  await assert.rejects(
    t.as(t.person("dani"), `select public.file_set_home($1, $2)`, [
      out.written[0].id,
      mine.id,
    ]),
    /your vault sets where this file lives/,
  );
});

test("deletes: a few go through, a mass delete is refused until confirmed once", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let r = await openRun(t, s);
  const notes = Array.from({ length: 30 }, (_, i) => note(`d/${i}.md`, "9"));
  await putNotes(t, s, r.run_id, notes);
  r = await openRun(t, s);
  assert.deepEqual(await del(t, s, r.run_id, ["d/0.md"]), {
    deleted: 1,
    refused: 0,
  });
  const many = notes.slice(1).map((n) => n.path);
  assert.deepEqual(await del(t, s, r.run_id, many), {
    deleted: 0,
    refused: 29,
  });
  // The confirm lets exactly that list through, on the next run only.
  r = await openRun(t, s, true);
  assert.deepEqual(await del(t, s, r.run_id, [...many, "x.md"]), {
    deleted: 0,
    refused: 30,
  });
  r = await openRun(t, s, true);
  assert.deepEqual(await del(t, s, r.run_id, many), {
    deleted: 29,
    refused: 0,
  });
  const audit = await t.db.query(
    `select count(*)::int as n from public.audit_log where action = 'note.deleted'`,
  );
  assert.equal(audit.rows[0].n, 30);
});

test("deleting a synced file queues its object as an orphan", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let r = await openRun(t, s);
  const p = await store(t, s, r.storage_prefix, "7".repeat(32), "g.pdf");
  await putFiles(t, s, r.run_id, [
    {
      path: "g.pdf",
      name: "g.pdf",
      size: 1,
      sha256: sha("7"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: p,
    },
  ]);
  r = await openRun(t, s);
  assert.deepEqual(await del(t, s, r.run_id, ["g.pdf"]), {
    deleted: 1,
    refused: 0,
  });
  const o = await t.db.query(`select storage_path from public.sync_orphans`);
  assert.deepEqual(
    o.rows.map((x) => x.storage_path),
    [p],
  );
});

test("the sync deletes only what it keeps", async () => {
  const t = await setupHive();
  await t.addNote("dani", "Uploads", { path: "Uploads.md" });
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  assert.deepEqual(await del(t, s, r.run_id, ["Uploads.md"]), {
    deleted: 0,
    refused: 0,
  });
  const n = await t.db.query(`select count(*)::int as n from public.notes`);
  assert.equal(n.rows[0].n, 1);
});

test("a run's record: counts, too-big files, readable only by its member", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  await t.as(s.claims, `select public.sync_finish($1, $2, $3, $4)`, [
    r.run_id,
    JSON.stringify({
      added: 3,
      changed: 1,
      moved: 0,
      deleted: 0,
      skipped: 2,
      too_big: 1,
    }),
    ["big.mov"],
    null,
  ]);
  const mine = await t.as(t.person("dani"), `select * from public.sync_runs`);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].added, 3);
  assert.deepEqual(mine[0].too_big_paths, ["big.mov"]);
  assert.equal(
    (await t.as(t.person("ahmed"), `select * from public.sync_runs`)).length,
    0,
  );
  const m = await t.db.query(
    `select count(*)::int as n from public.sync_manifest`,
  );
  assert.equal(m.rows[0].n, 0);
  await assert.rejects(
    t.as(s.claims, `select public.sync_finish($1, '{}', '{}', null)`, [
      r.run_id,
    ]),
    /no such run/,
  );
});

test("runs are trimmed to the last 200 of a key", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  for (let i = 0; i < 201; i++) {
    const r = await openRun(t, s);
    await t.as(s.claims, `select public.sync_finish($1, '{}', '{}', null)`, [
      r.run_id,
    ]);
  }
  const n = await t.db.query(`select count(*)::int as n from public.sync_runs`);
  assert.equal(n.rows[0].n, 200);
});

test("finishing a run removes a generated note no file lives in", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let r = await openRun(t, s);
  const p = await store(t, s, r.storage_prefix, "8".repeat(32), "h.pdf");
  await putFiles(t, s, r.run_id, [
    {
      path: "h.pdf",
      name: "h.pdf",
      size: 1,
      sha256: sha("8"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: p,
    },
  ]);
  await t.as(s.claims, `select public.sync_finish($1, '{}', '{}', null)`, [
    r.run_id,
  ]);
  const count = async () =>
    (await t.db.query(`select count(*)::int as n from public.notes`)).rows[0].n;
  assert.equal(await count(), 1);
  r = await openRun(t, s);
  await del(t, s, r.run_id, ["h.pdf"]);
  await t.as(s.claims, `select public.sync_finish($1, '{}', '{}', null)`, [
    r.run_id,
  ]);
  assert.equal(await count(), 0);
});

test("purging a hive removes its sync keys, runs, orphans, notes and files", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let r = await openRun(t, s);
  await putNotes(t, s, r.run_id, [note("n.md", "a")]);
  const p = await store(t, s, r.storage_prefix, "9".repeat(32), "p.pdf");
  const q = await store(t, s, r.storage_prefix, "6".repeat(32), "q.pdf");
  const put = await putFiles(t, s, r.run_id, [
    {
      path: "p.pdf",
      name: "p.pdf",
      size: 1,
      sha256: sha("9"),
      mime: "application/pdf",
      home: "n.md",
      storage_path: p,
    },
  ]);
  await t.as(s.claims, `select public.sync_finish($1, '{}', '{}', null)`, [
    r.run_id,
  ]);
  assert.equal(put.written.length, 1);
  // An orphan, as a changed file leaves one.
  await t.db.query(
    `insert into public.sync_orphans (storage_path, hive_id) values ($1, $2)`,
    [q, t.hive],
  );
  await t.as(
    t.person("dani"),
    `select public.request_hive_deletion($1, 'Test hive')`,
    [t.hive],
  );
  await t.db.exec("reset role");
  await t.db.query(
    `update public.hives set closing_at = now() - interval '7 days 1 hour',
                             delete_after = now() - interval '1 hour' where id = $1`,
    [t.hive],
  );
  const service = async (sql, params = []) => {
    await t.db.exec("reset role");
    await t.db.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ role: "service_role" }),
    ]);
    await t.db.exec("set role service_role");
    try {
      return (await t.db.query(sql, params)).rows;
    } finally {
      await t.db.exec("reset role");
    }
  };
  await service(`select public.begin_hive_purge($1)`, [t.hive]);
  for (;;) {
    const names = (
      await service(`select * from public.hive_object_paths($1, null, 1000)`, [
        t.hive,
      ])
    ).map((x) => x.name);
    if (names.length === 0) break;
    await service(
      `delete from storage.objects where bucket_id = 'files' and name = any ($1::text[])`,
      [names],
    );
  }
  const [{ done }] = await service(`select public.purge_hive($1) as done`, [
    t.hive,
  ]);
  assert.equal(done, true);
  for (const table of [
    "sync_keys",
    "sync_runs",
    "sync_orphans",
    "notes",
    "files",
  ]) {
    const n = await t.db.query(
      `select count(*)::int as n from public.${table}`,
    );
    assert.equal(n.rows[0].n, 0, table);
  }
});

const countNotes = async (t, s, n) => {
  const r = await openRun(t, s);
  await putNotes(
    t,
    s,
    r.run_id,
    Array.from({ length: n }, (_, i) => note(`g/${i}.md`, "5")),
  );
  return openRun(t, s);
};

test("the 2% arm: with 30 kept, deleting 2 is refused", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await countNotes(t, s, 30);
  assert.deepEqual(await del(t, s, r.run_id, ["g/0.md", "g/1.md"]), {
    deleted: 0,
    refused: 2,
  });
  const n = await t.db.query(`select count(*)::int as n from public.notes`);
  assert.equal(n.rows[0].n, 30);
});

test("the 2% arm: with 30 kept, deleting 1 is allowed", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await countNotes(t, s, 30);
  assert.deepEqual(await del(t, s, r.run_id, ["g/0.md"]), {
    deleted: 1,
    refused: 0,
  });
});

test("the 2% arm: with 120 kept, deleting 2 is allowed", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  for (let i = 0; i < 120; i += 40) {
    await putNotes(
      t,
      s,
      r.run_id,
      Array.from({ length: 40 }, (_, j) => note(`g/${i + j}.md`, "5")),
    );
  }
  const r2 = await openRun(t, s);
  assert.deepEqual(await del(t, s, r2.run_id, ["g/0.md", "g/1.md"]), {
    deleted: 2,
    refused: 0,
  });
});

test("finishing a run keeps the manifest pages of another open run", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const first = await putNotes(t, s, (await openRun(t, s)).run_id, [
    note("A.md", "1"),
    note("B.md", "2"),
  ]);
  assert.equal(first.written.length, 2);
  const a = (await openRun(t, s)).run_id;
  const b = (await openRun(t, s)).run_id;
  await t.as(s.claims, `select public.sync_plan($1, $2, false)`, [
    b,
    JSON.stringify([
      { path: "A.md", sha256: sha("1"), size: 1 },
      { path: "B.md", sha256: sha("2"), size: 1 },
    ]),
  ]);
  await t.as(s.claims, `select public.sync_finish($1, '{}', '{}', null)`, [a]);
  const p = await plan(t, s, b, [{ path: "C.md", sha256: sha("3"), size: 1 }]);
  assert.deepEqual(p.gone, []);
  assert.deepEqual(p.new, ["C.md"]);
});

test("a storage path under another member's or workspace's prefix is refused whole", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  const file = (storage_path) => ({
    path: "z.pdf",
    name: "z.pdf",
    size: 1,
    sha256: sha("e"),
    mime: "application/pdf",
    home: "Vault files.md",
    storage_path,
  });
  const tail = `${"e".repeat(32)}/z.pdf`;
  for (const prefix of [
    `${t.members.ahmed}/${t.ws.ahmed}/vault/`,
    `${t.members.dani}/${t.ws.ahmed}/vault/`,
    `${t.members.ahmed}/${t.ws.dani}/vault/`,
  ]) {
    await assert.rejects(
      putFiles(t, s, r.run_id, [file(prefix + tail)]),
      /a file is not usable/,
    );
  }
});
