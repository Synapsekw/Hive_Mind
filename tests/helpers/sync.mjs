// A sync key for one member's first workspace, signed in the way sync-session signs it.
export async function syncFor(t, name) {
  const made = (
    await t.as(t.person(name), `select * from public.create_sync_key($1)`, [
      t.ws[name],
    ])
  )[0];
  const login = (
    await t.as(null, `select * from public.sync_login($1)`, [made.key])
  )[0];
  return {
    keyId: made.key_id,
    key: made.key,
    claims: {
      sub: login.user_id,
      role: "authenticated",
      agent_id: login.agent_id,
      workspace_id: login.workspace_id,
      trust_tier: login.trust_tier,
      sync_key_id: login.sync_key_id,
    },
  };
}

// Marks a row as kept by a key, as the service would: no signed-in caller.
export async function markSynced(t, table, id, keyId, sha = null) {
  await t.db.query(
    `update public.${table} set synced_by = $2, sync_sha256 = $3 where id = $1`,
    [id, keyId, sha],
  );
}
