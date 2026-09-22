import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/001_initial_schema.sql", import.meta.url), "utf8"));
  const results = await db.exec(await readFile(new URL("../supabase/tests/rls.sql", import.meta.url), "utf8"));
  for (const result of results) for (const row of result.rows || []) if (row.result) console.log(row.result);
  console.log("Local PostgreSQL engine validation passed. Supabase Auth/network deployment still requires live-project testing.");
} finally { await db.close(); }
