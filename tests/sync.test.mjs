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
