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

  async function addUser(email) {
    const r = await db.query(
      `insert into auth.users (email) values ($1) returning id`,
      [email],
    );
    return r.rows[0].id;
  }

  return { db, as, addUser };
}
