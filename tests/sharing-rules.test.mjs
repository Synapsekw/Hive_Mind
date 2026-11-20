// Runs the real migrations in an in-process Postgres (PGlite) and checks the
// sharing rules as three different people and two kinds of agent.
// Supabase's auth schema and roles are stubbed below; everything else is the
// SQL that ships. Run with: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const db = new PGlite();
const users = {};
const members = {};
const ws = {};
let hive;

// Run SQL as a signed-in person or agent.
async function as(claims, sql, params = []) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims ?? {})]);
  await db.exec(`set role ${claims ? 'authenticated' : 'anon'}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const person = (name) => ({ sub: users[name], role: 'authenticated' });
const titles = async (claims) =>
  (await as(claims, 'select title from public.notes order by title')).map((r) => r.title);

before(async () => {
  await db.exec(STUB);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));

  for (const name of ['dani', 'ahmed', 'sara', 'outsider']) {
    const r = await db.query(`insert into auth.users (email) values ($1) returning id`, [`${name}@example.com`]);
    users[name] = r.rows[0].id;
  }
  hive = (await as(person('dani'), `select public.create_hive('Test hive', 'Dani') as id`))[0].id;
  await as(person('dani'), `select public.add_member($1, 'ahmed@example.com', 'Ahmed')`, [hive]);
  await as(person('dani'), `select public.add_member($1, 'sara@example.com', 'Sara')`, [hive]);
  await as(person('outsider'), `select public.create_hive('Other hive', 'Outsider')`);
  for (const name of ['dani', 'ahmed', 'sara']) {
    const m = await as(person(name), `select id from public.members where user_id = $1 and hive_id = $2`, [users[name], hive]);
    members[name] = m[0].id;
    const w = await as(person(name), `select id from public.workspaces where member_id = $1`, [members[name]]);
    ws[name] = w[0].id;
  }
});

const addNote = (name, title, extra = {}) =>
  as(person(name),
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body, visibility, shared_with)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [hive, members[name], ws[name], `${title}.md`, title, extra.body ?? 'body',
     extra.visibility ?? null, extra.shared_with ?? []]);

test('a note is private until its owner shares it', async () => {
  await addNote('dani', 'dani private');
  await addNote('dani', 'dani group', { visibility: 'group' });
  await addNote('dani', 'dani for ahmed', { visibility: 'members', shared_with: [members.ahmed] });

  assert.deepEqual(await titles(person('dani')), ['dani for ahmed', 'dani group', 'dani private']);
  assert.deepEqual(await titles(person('ahmed')), ['dani for ahmed', 'dani group']);
  assert.deepEqual(await titles(person('sara')), ['dani group']);
});

test('another hive and the public see nothing', async () => {
  assert.deepEqual(await titles(person('outsider')), []);
  assert.deepEqual(await titles(null), []);
});

test('a folder rule shares every note inside it', async () => {
  const f = await as(person('ahmed'),
    `insert into public.folders (workspace_id, member_id, path, visibility) values ($1, $2, 'clients', 'group') returning id`,
    [ws.ahmed, members.ahmed]);
  await as(person('ahmed'),
    `insert into public.notes (hive_id, member_id, workspace_id, folder_id, path, title)
     values ($1, $2, $3, $4, 'clients/a.md', 'ahmed in shared folder')`,
    [hive, members.ahmed, ws.ahmed, f[0].id]);
  assert.ok((await titles(person('sara'))).includes('ahmed in shared folder'));
});

test('nobody can write into someone else\'s space', async () => {
  await assert.rejects(as(person('ahmed'),
    `insert into public.notes (hive_id, member_id, workspace_id, path, title) values ($1, $2, $3, 'x.md', 'forged')`,
    [hive, members.dani, ws.dani]));
  const changed = await as(person('ahmed'), `update public.notes set body = 'hacked' where title = 'dani group' returning id`);
  assert.equal(changed.length, 0);
});

test('a link opens two private notes only after both owners accept', async () => {
  const a = (await addNote('dani', 'dani kestrel'))[0].id;
  const b = (await addNote('sara', 'sara kestrel'))[0].id;
  const link = (await as(person('dani'),
    `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $2, $3, 1, 1) returning id, status`,
    [hive, a, b]))[0];
  assert.equal(link.status, 'proposed');
  assert.ok(!(await titles(person('dani'))).includes('sara kestrel'));
  assert.ok(!(await titles(person('sara'))).includes('dani kestrel'));

  const status = await as(person('sara'), `select public.respond_to_link($1, true) as s`, [link.id]);
  assert.equal(status[0].s, 'accepted');
  assert.ok((await titles(person('dani'))).includes('sara kestrel'));
  assert.ok((await titles(person('sara'))).includes('dani kestrel'));
  assert.ok(!(await titles(person('ahmed'))).includes('sara kestrel'));
});

test('a declined link shares nothing', async () => {
  const a = (await addNote('dani', 'dani adnoc'))[0].id;
  const b = (await addNote('ahmed', 'ahmed adnoc'))[0].id;
  const link = (await as(person('dani'),
    `insert into public.links (hive_id, from_note, to_note, tier, score) values ($1, $2, $3, 1, 1) returning id`,
    [hive, a, b]))[0];
  await as(person('ahmed'), `select public.respond_to_link($1, false)`, [link.id]);
  assert.ok(!(await titles(person('dani'))).includes('ahmed adnoc'));
  await assert.rejects(as(person('ahmed'), `select public.respond_to_link($1, true)`, [link.id]));
});

test('an agent writes only in its own workspace and never changes sharing', async () => {
  const made = (await as(person('dani'),
    `select * from public.create_agent($1, 'Claude desktop', 'claude')`, [ws.dani]))[0];
  const login = (await as(null, `select * from public.agent_login($1)`, [made.token]))[0];
  assert.equal(login.workspace_id, ws.dani);
  const agent = { sub: login.user_id, role: 'authenticated', agent_id: login.agent_id,
                  workspace_id: login.workspace_id, trust_tier: login.trust_tier };

  const n = (await as(agent,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
     values ($1, $2, $3, 'agent.md', 'written by agent', 'v1') returning id, quarantined, written_by_agent`,
    [hive, members.dani, ws.dani]))[0];
  assert.equal(n.quarantined, false);
  assert.equal(n.written_by_agent, login.agent_id);

  await as(agent, `update public.notes set body = 'v2' where id = $1`, [n.id]);
  const versions = await as(person('dani'), `select version from public.note_versions where note_id = $1 order by version`, [n.id]);
  assert.deepEqual(versions.map((v) => v.version), [1, 2]);

  await assert.rejects(as(agent, `update public.notes set visibility = 'group' where id = $1`, [n.id]));
  await assert.rejects(as(agent,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, visibility)
     values ($1, $2, $3, 'pub.md', 'agent tries to publish', 'group')`,
    [hive, members.dani, ws.dani]));
  const deleted = await as(agent, `delete from public.notes where id = $1 returning id`, [n.id]);
  assert.equal(deleted.length, 0);
  await assert.rejects(as(agent, `select public.respond_to_link(gen_random_uuid(), true)`));

  await as(person('dani'), `select public.revoke_agent($1)`, [login.agent_id]);
  await assert.rejects(as(null, `select * from public.agent_login($1)`, [made.token]));
});

test('a self-hosted agent is quarantined and sees only shared notes', async () => {
  const made = (await as(person('sara'),
    `select * from public.create_agent($1, 'Local agent', 'other', 'self_hosted')`, [ws.sara]))[0];
  const login = (await as(null, `select * from public.agent_login($1)`, [made.token]))[0];
  const agent = { sub: login.user_id, role: 'authenticated', agent_id: login.agent_id,
                  workspace_id: login.workspace_id, trust_tier: login.trust_tier };

  const n = (await as(agent,
    `insert into public.notes (hive_id, member_id, workspace_id, path, title)
     values ($1, $2, $3, 'held.md', 'held for review') returning quarantined`,
    [hive, members.sara, ws.sara]))[0];
  assert.equal(n.quarantined, true);

  const seen = await titles(agent);
  assert.ok(seen.includes('held for review'));
  assert.ok(seen.includes('dani group'));
  assert.ok(!seen.includes('sara kestrel'), 'must not read the member\'s private notes');
  assert.ok(!(await titles(person('dani'))).includes('held for review'));
  assert.ok((await titles(person('sara'))).includes('held for review'));
});

test('token hashes are never readable', async () => {
  await assert.rejects(as(person('dani'), `select token_hash from public.agents`));
  const rows = await as(person('ahmed'), `select id from public.agents`);
  assert.equal(rows.length, 0);
});

test('search returns only what the caller may read', async () => {
  const mine = await as(person('dani'), `select title from public.search_notes('kestrel')`);
  assert.deepEqual(mine.map((r) => r.title).sort(), ['dani kestrel', 'sara kestrel']);
  const ahmed = await as(person('ahmed'), `select title from public.search_notes('kestrel')`);
  assert.equal(ahmed.length, 0);
});
