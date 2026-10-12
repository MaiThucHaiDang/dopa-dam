// Runs the migration in PGlite (Postgres in WebAssembly) with a stand-in for Supabase's auth schema,
// then checks Row Level Security, "newest wins" and append-only events as the app relies on them.
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, "..", "migrations");
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

// What Supabase provides before our migration runs.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ('${A}'), ('${B}');
`;

let db;

/** Runs SQL as a signed-in user (or anon), the way PostgREST does. */
async function as(user, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  await db.exec(user ? "set role authenticated" : "set role anon");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(migrations).sort()) {
    await db.exec(readFileSync(join(migrations, file), "utf8"));
  }
});

describe("row level security", () => {
  it("lets a user write and read only their own rows", async () => {
    await as(A, `insert into public.tag_rules (id, kind, pattern, tag, updated_at) values ('app:yt', 'app', 'com.google.android.youtube', 'entertainment', 100)`);
    await as(B, `insert into public.tag_rules (id, kind, pattern, tag, updated_at) values ('app:yt', 'app', 'com.google.android.youtube', 'study', 100)`);
    assert.deepEqual(await as(A, "select tag from public.tag_rules"), [{ tag: "entertainment" }]);
    assert.deepEqual(await as(B, "select tag from public.tag_rules"), [{ tag: "study" }]);
  });

  it("refuses rows written for another user", async () => {
    await assert.rejects(
      as(B, `insert into public.tag_rules (user_id, id, kind, pattern, tag, updated_at) values ('${A}', 'exe:x', 'exe', 'x.exe', 'game', 1)`),
      /row-level security/,
    );
  });

  it("gives anonymous callers nothing", async () => {
    await assert.rejects(as(null, "select * from public.tag_rules"), /permission denied/);
  });
});

describe("newest wins", () => {
  const upsert = (updatedAt, tag) => `
    insert into public.tag_rules (id, kind, pattern, tag, updated_at) values ('domain:yt', 'domain', 'youtube.com', '${tag}', ${updatedAt})
    on conflict (user_id, id) do update set tag = excluded.tag, updated_at = excluded.updated_at`;

  it("keeps the newer row and stamps the server time", async () => {
    await as(A, upsert(200, "entertainment"));
    const [first] = await as(A, "select server_updated_at from public.tag_rules where id = 'domain:yt'");
    await as(A, upsert(100, "study")); // older: ignored
    assert.deepEqual(await as(A, "select tag, updated_at from public.tag_rules where id = 'domain:yt'"), [
      { tag: "entertainment", updated_at: 200 },
    ]);
    await as(A, upsert(300, "game")); // newer: applied
    const [after] = await as(A, "select tag, server_updated_at from public.tag_rules where id = 'domain:yt'");
    assert.equal(after.tag, "game");
    assert.ok(after.server_updated_at > first.server_updated_at);
  });
});

describe("events", () => {
  it("are append only", async () => {
    const insert = (decision) => `
      insert into public.intercept_events (id, device_id, object, tag, level, lock_seconds, n, shown_at, decision)
      values ('e1', 'd1', 'youtube.com', 'entertainment', 0, 5, 0, 1000, '${decision}')
      on conflict (user_id, id) do nothing`;
    await as(A, insert("exit"));
    await as(A, insert("enter"));
    await as(A, "update public.intercept_events set decision = 'enter' where id = 'e1'");
    assert.deepEqual(await as(A, "select decision from public.intercept_events"), [{ decision: "exit" }]);
  });
});

describe("delete_my_data", () => {
  it("removes only the caller's rows", async () => {
    await as(A, "select public.delete_my_data()");
    assert.equal((await as(A, "select count(*)::int as n from public.tag_rules"))[0].n, 0);
    assert.equal((await as(B, "select count(*)::int as n from public.tag_rules"))[0].n, 1);
  });
});
