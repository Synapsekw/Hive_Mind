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
  await assert.rejects(t.as(s.claims, `select public.create_hive('x', 'x')`));
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
