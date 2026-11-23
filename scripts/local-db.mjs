// An in-process Postgres (PGlite) with the real migrations applied.
// Supabase's auth schema and roles are stubbed; everything else is the SQL
// that ships. Used by the tests and by `pnpm demo`. No Docker needed.
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  -- email_confirmed_at is null until the person has proved the address, as in
  -- Supabase, so a user inserted by hand is unconfirmed (fails closed); the
  -- invitation functions let nobody join a hive without it.
  create table auth.users (
    id uuid primary key default gen_random_uuid(), email text,
    email_confirmed_at timestamptz);
  -- The apps registered at Supabase's sign-in server and what each person
  -- approved. Only the columns the migrations read are stubbed; nobody but the
  -- database owner can read them, as in Supabase. The real redirect_uris is
  -- text too (several addresses in one value).
  create table auth.oauth_clients (
    id uuid primary key default gen_random_uuid(),
    client_name text, redirect_uris text, deleted_at timestamptz);
  create table auth.oauth_consents (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users on delete cascade,
    client_id uuid not null references auth.oauth_clients on delete cascade,
    scopes text, granted_at timestamptz default now(), revoked_at timestamptz,
    unique (user_id, client_id));
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  -- Supabase Storage keeps one row per stored file in storage.objects, guarded
  -- by row-level security. Only the columns the migrations use are stubbed, so
  -- the policies are tested here; the Storage API itself is tested by test:live.
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets, name text,
    created_at timestamptz default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
`;

export async function openDb() {
  const db = new PGlite();
  await db.exec(STUB);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  for (const f of readdirSync(dir).sort())
    await db.exec(readFileSync(new URL(f, dir), "utf8"));

  // Run SQL as a signed-in person or agent (claims), or as nobody (null).
  async function as(claims, sql, params = []) {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify(claims ?? {}),
    ]);
    await db.exec(`set role ${claims ? "authenticated" : "anon"}`);
    try {
      return (await db.query(sql, params)).rows;
    } finally {
      await db.exec("reset role");
    }
  }

  // A person with an account. `confirmed: false` is one who never proved the
  // email address (Supabase leaves email_confirmed_at null until they do).
  async function addUser(email, { confirmed = true } = {}) {
    const r = await db.query(
      `insert into auth.users (email, email_confirmed_at)
       values ($1, case when $2::boolean then now() end) returning id`,
      [email, confirmed],
    );
    return r.rows[0].id;
  }

  // Put a person into a hive with their own Main workspace, as the database
  // owner. People join by accepting an invitation (accept_invitation); this is
  // for tests and the demo, where a hive with members is only the setting.
  // Returns the member's id.
  async function addMember(hiveId, userId, displayName) {
    await db.exec("reset role");
    const r = await db.query(
      `insert into public.members (hive_id, user_id, display_name)
       values ($1, $2, $3) returning id`,
      [hiveId, userId, displayName],
    );
    await db.query(
      `insert into public.workspaces (hive_id, member_id, name)
       values ($1, $2, 'Main')`,
      [hiveId, r.rows[0].id],
    );
    return r.rows[0].id;
  }

  // An app registered at the sign-in server. `uris` is the text stored in
  // redirect_uris, exactly as given. Returns the client's id.
  async function addClient(name, uris, { deleted = false } = {}) {
    await db.exec("reset role");
    const r = await db.query(
      `insert into auth.oauth_clients (client_name, redirect_uris, deleted_at)
       values ($1, $2, case when $3::boolean then now() end) returning id`,
      [name, uris, deleted],
    );
    return r.rows[0].id;
  }

  // The sign-in server's record that a person approved an app. Approving
  // again lifts an earlier revoke, as the server does.
  async function addConsent(userId, clientId, { revoked = false } = {}) {
    await db.exec("reset role");
    await db.query(
      `insert into auth.oauth_consents (user_id, client_id, scopes, revoked_at)
       values ($1, $2, 'openid', case when $3::boolean then now() end)
       on conflict (user_id, client_id)
       do update set revoked_at = excluded.revoked_at, granted_at = now()`,
      [userId, clientId, revoked],
    );
  }

  return { db, as, addUser, addMember, addClient, addConsent };
}
