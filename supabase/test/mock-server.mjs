// A small stand-in for Supabase (the GoTrue and PostgREST calls DopaDam makes), backed by the real
// migration running in PGlite, so the app's sync code can be tested end to end without a project.
// Usage: node supabase/test/mock-server.mjs [port]   → prints "listening <port>"
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TABLES = new Set(["devices", "tag_rules", "settings", "intercept_events", "usage_daily", "study_rules", "study_sessions"]);

// bigint (int8) as plain numbers, like PostgREST's JSON.
const db = new PGlite({ parsers: { 20: (v) => Number(v) } });
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`);
for (const file of readdirSync(join(here, "..", "migrations")).sort()) {
  await db.exec(readFileSync(join(here, "..", "migrations", file), "utf8"));
}

const users = new Map(); // email -> { id, password }
const tokens = new Map(); // access token -> user id
const refreshTokens = new Map(); // refresh token -> user id

function session(userId, email) {
  const access = `at-${randomUUID()}`;
  const refresh = `rt-${randomUUID().slice(0, 12)}`;
  tokens.set(access, userId);
  refreshTokens.set(refresh, userId);
  return { access_token: access, refresh_token: refresh, token_type: "bearer", expires_in: 3600, user: { id: userId, email } };
}

let queue = Promise.resolve();
/** Runs SQL as the signed-in user, one statement batch at a time (PGlite is single-connection). */
function asUser(userId, fn) {
  const run = queue.then(async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

const quote = (c) => `"${c.replace(/"/g, '""')}"`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (!req.headers.apikey) return send(res, 401, { message: "No API key found in request" });

    if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
      const { email, password } = await readJson(req);
      if (users.has(email)) return send(res, 422, { code: 422, msg: "User already registered" });
      if (!password || password.length < 6) return send(res, 422, { code: 422, msg: "Password should be at least 6 characters." });
      const id = randomUUID();
      users.set(email, { id, password });
      await db.query("insert into auth.users (id) values ($1)", [id]);
      return send(res, 200, session(id, email));
    }
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const body = await readJson(req);
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const user = users.get(body.email);
        if (!user || user.password !== body.password) {
          return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials" });
        }
        return send(res, 200, session(user.id, body.email));
      }
      if (grant === "refresh_token") {
        const id = refreshTokens.get(body.refresh_token);
        if (!id) return send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
        refreshTokens.delete(body.refresh_token);
        const email = [...users.entries()].find(([, u]) => u.id === id)?.[0];
        return send(res, 200, session(id, email));
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }

    const auth = req.headers.authorization?.replace(/^Bearer /, "");
    const userId = auth && tokens.get(auth);
    if (!userId) return send(res, 401, { code: "PGRST301", message: "JWT expired" });

    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc && req.method === "POST") {
      await asUser(userId, () => db.query(`select public.${rpc[1]}()`));
      return send(res, 200, null);
    }

    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (!table || !TABLES.has(table)) return send(res, 404, { message: "relation does not exist" });

    if (req.method === "POST") {
      const rows = await readJson(req);
      const prefer = req.headers.prefer ?? "";
      if (url.searchParams.get("on_conflict") !== "user_id,id") return send(res, 400, { message: "on_conflict must be user_id,id" });
      await asUser(userId, async () => {
        for (const row of rows) {
          const cols = Object.keys(row);
          const values = cols.map((c) => (row[c] !== null && typeof row[c] === "object" ? JSON.stringify(row[c]) : row[c]));
          const conflict = prefer.includes("resolution=ignore-duplicates")
            ? "do nothing"
            : `do update set ${cols.filter((c) => c !== "id").map((c) => `${quote(c)} = excluded.${quote(c)}`).join(", ")}`;
          await db.query(
            `insert into public.${table} (${cols.map(quote).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
             on conflict (user_id, id) ${conflict}`,
            values,
          );
        }
      });
      return send(res, 201);
    }

    if (req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      const since = url.searchParams.get("server_updated_at")?.replace(/^gt\./, "");
      const rows = await asUser(userId, async () =>
        (
          await db.query(
            `select *, to_char(server_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') as server_updated_at_text
             from public.${table} ${since ? "where server_updated_at > $1::timestamptz" : ""}
             order by server_updated_at asc limit ${limit}`,
            since ? [since] : [],
          )
        ).rows,
      );
      return send(
        res,
        200,
        rows.map(({ server_updated_at_text, ...r }) => ({ ...r, server_updated_at: server_updated_at_text })),
      );
    }
    return send(res, 405, { message: "method not allowed" });
  } catch (err) {
    return send(res, 400, { message: String(err?.message ?? err) });
  }
});

server.listen(Number(process.argv[2] ?? 0), "127.0.0.1", () => console.log(`listening ${server.address().port}`));
