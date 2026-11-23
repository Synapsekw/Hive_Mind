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

  return { db, as, addUser };
}
