/**
 * TEST ONLY. Loopback Auth/PostgREST protocol fixture backed by real PostgreSQL (PGlite).
 * It does not emulate Supabase email delivery, GoTrue security, TLS, or hosted PostgREST.
 * Production code has no fixture switch and uses the ordinary SDK + SSR + API + SQL path.
 */
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const rpcParameters = {
  studio_create_novel: ["p_input"], studio_get_novel: ["p_novel_id"],
  studio_patch_novel: ["p_novel_id", "p_expected_revision", "p_patch", "p_collections"],
  studio_save_chapter: ["p_novel_id", "p_chapter_id", "p_expected_revision", "p_values", "p_create_version"],
  studio_delete_novel: ["p_novel_id", "p_expected_revision"],
  studio_begin_ai_generation: ["p_request_id", "p_lease_token", "p_input_hash", "p_model", "p_schema_version"],
  studio_finish_ai_generation: ["p_generation_id", "p_lease_token", "p_status", "p_model", "p_input_tokens", "p_output_tokens", "p_latency_ms", "p_provider_request_id", "p_error_type"],
  create_ai_novel_bundle: ["p_generation_id", "p_input_hash", "p_bundle"],
  studio_begin_chapter_generation: ["p_request_id", "p_lease_token", "p_input_hash", "p_model", "p_novel_id", "p_chapter_id", "p_novel_revision", "p_chapter_revision"],
  studio_finish_chapter_generation: ["p_generation_id", "p_lease_token", "p_status", "p_model", "p_input_tokens", "p_output_tokens", "p_latency_ms", "p_provider_request_id", "p_error_type", "p_content"],
  studio_confirm_chapter_generation: ["p_generation_id"],
};
const tableNames = new Set(["profiles", "novels", "volumes", "chapters", "chapter_versions", "characters", "world_entries", "timeline_events", "novel_bible", "chapter_summaries", "memory_items"]);
const encode = (data) => Buffer.from(JSON.stringify(data)).toString("base64url");
const errorResult = (code, message) => ({ code, error_code: code, message, msg: message });

export async function startSupabaseFixture({ port = 43001, appPort = 43000, quiet = false } = {}) {
  const db = new PGlite();
  const users = new Map();
  const tokens = new Map();
  const refreshTokens = new Map();
  const secret = randomUUID();
  const faults = [];
  const requests = [];
  let queue = Promise.resolve();
  const serial = (work) => {
    const operation = queue.then(work);
    queue = operation.catch(() => {});
    return operation;
  };
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
  `);
  let migrations = new URL("../../supabase/migrations/", import.meta.url);
  let migrationNames;
  try { migrationNames = await readdir(migrations); }
  catch { migrations = new URL("../../../supabase/migrations/", import.meta.url); migrationNames = await readdir(migrations); }
  for (const name of migrationNames.filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
  }

  function session(account) {
    const now = Math.floor(Date.now() / 1000);
    const payload = encode({ iss: `http://127.0.0.1:${port}/auth/v1`, sub: account.user.id, aud: "authenticated", role: "authenticated", email: account.user.email, iat: now, exp: now + 3600, session_id: randomUUID(), aal: "aal1", amr: [{ method: "password", timestamp: now }] });
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${payload}`;
    const accessToken = `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
    const refreshToken = randomUUID();
    tokens.set(accessToken, account);
    refreshTokens.set(refreshToken, account);
    return { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refreshToken, user: account.user };
  }
  const currentAccount = (request) => tokens.get((request.headers.authorization || "").replace(/^Bearer /i, ""));
  async function authenticatedQuery(account, work) {
    return serial(async () => {
      await db.exec("begin; set local role authenticated;");
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [account.user.id]);
        const result = await work();
        await db.exec("commit");
        return result;
      } catch (error) { await db.exec("rollback"); throw error; }
    });
  }
  async function readBody(request) {
    let input = "";
    for await (const chunk of request) { input += chunk; if (input.length > 22000000) throw new Error("Fixture payload too large"); }
    return input ? JSON.parse(input) : {};
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const pathname = url.pathname;
    const origin = request.headers.origin;
    if (origin && [`http://127.0.0.1:${appPort}`, `http://localhost:${appPort}`].includes(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", request.headers["access-control-request-headers"] || "authorization,apikey,content-type,x-client-info,x-supabase-api-version,range,prefer,accept-profile,content-profile");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.setHeader("Access-Control-Expose-Headers", "Content-Range,Range-Unit");
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("X-Supabase-Api-Version", "2024-01-01");
    response.setHeader("Cache-Control", "no-store");
    const send = (status, body) => { response.statusCode = status; if (body === undefined) return response.end(); response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
    if (request.method === "OPTIONS") return send(204);
    requests.push({ method: request.method, pathname, at: new Date().toISOString() });
    const fault = faults.find((item) => item.path === pathname && item.remaining > 0);
    if (fault) { fault.remaining--; return send(fault.status, errorResult("FIXTURE_FAILURE", "Injected test failure")); }
    try {
      if (pathname === "/__fixture/health") return send(200, { testOnly: true, database: "PGlite", users: users.size });
      if (pathname === "/__fixture/fail-next" && request.method === "POST") {
        const body = await readBody(request);
        faults.push({ path: body.path, remaining: body.count || 1, status: body.status || 503 });
        return send(200, { queued: true });
      }
      if (pathname === "/__fixture/state") {
        const state = await serial(async () => ({
          users: [...users.values()].map((account) => ({ id: account.user.id, email: account.user.email })),
          novels: (await db.query("select id,user_id,title,revision from public.novels")).rows,
          chapters: (await db.query("select id,novel_id,title,revision,word_count from public.chapters")).rows,
          requests: requests.slice(-500),
        }));
        return send(200, state);
      }
      if (pathname === "/auth/v1/signup" && request.method === "POST") {
        const body = await readBody(request);
        const email = String(body.email || "").toLowerCase();
        if (!email.includes("@") || String(body.password || "").length < 8) return send(400, errorResult("weak_password", "Invalid fixture credentials"));
        if (users.has(email)) return send(422, errorResult("user_already_exists", "User already registered"));
        const id = randomUUID();
        const now = new Date().toISOString();
        const user = { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: now, confirmed_at: now, created_at: now, updated_at: now, last_sign_in_at: now, app_metadata: { provider: "email", providers: ["email"] }, user_metadata: body.data || {}, identities: [{ identity_id: id, id, user_id: id, provider: "email", identity_data: { email, sub: id }, created_at: now, updated_at: now }], is_anonymous: false };
        const account = { user, password: body.password };
        await serial(() => db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [id, email, JSON.stringify(body.data || {})]));
        users.set(email, account);
        return send(200, session(account));
      }
      if (pathname === "/auth/v1/token" && request.method === "POST") {
        const body = await readBody(request);
        const grant = url.searchParams.get("grant_type");
        if (grant === "refresh_token") {
          const account = refreshTokens.get(body.refresh_token);
          if (!account) return send(400, errorResult("refresh_token_not_found", "Refresh token not found"));
          return send(200, session(account));
        }
        const account = users.get(String(body.email || "").toLowerCase());
        if (grant !== "password" || !account || account.password !== body.password) return send(400, errorResult("invalid_credentials", "Invalid login credentials"));
        return send(200, session(account));
      }
      if (pathname === "/auth/v1/user") {
        const account = currentAccount(request);
        if (!account) return send(401, errorResult("bad_jwt", "Invalid test session"));
        return send(200, account.user);
      }
      if (pathname === "/auth/v1/logout" && request.method === "POST") {
        const account = currentAccount(request);
        tokens.delete((request.headers.authorization || "").replace(/^Bearer /i, ""));
        if (account) for (const [key, value] of refreshTokens) if (value === account) refreshTokens.delete(key);
        return send(204);
      }
      if (pathname === "/auth/v1/.well-known/jwks.json") return send(200, { keys: [] });
      if (!pathname.startsWith("/rest/v1/")) return send(404, errorResult("FIXTURE_NOT_IMPLEMENTED", pathname));
      const account = currentAccount(request);
      if (!account) return send(401, errorResult("42501", "Authenticated test session required"));
      if (pathname.startsWith("/rest/v1/rpc/") && request.method === "POST") {
        const name = pathname.split("/").pop();
        const keys = rpcParameters[name];
        if (!keys) return send(404, errorResult("PGRST202", "Unknown RPC"));
        const body = await readBody(request);
        const result = await authenticatedQuery(account, () => db.query(`select public.${name}(${keys.map((_, i) => `$${i + 1}`).join(",")}) as result`, keys.map((key) => body[key] !== null && typeof body[key] === "object" ? JSON.stringify(body[key]) : body[key] ?? null)));
        return send(200, result.rows[0].result);
      }
      const table = pathname.split("/").pop();
      if (!tableNames.has(table) || request.method !== "GET") return send(404, errorResult("FIXTURE_NOT_IMPLEMENTED", "This fixture supports selected GET and real application RPCs only"));
      const filters = [];
      const values = [];
      for (const [key, value] of url.searchParams) {
        if (["select", "order", "offset", "limit"].includes(key)) continue;
        if (!/^[a-z_]+$/.test(key) && key !== "novels.user_id") throw new Error("Unsupported fixture filter key");
        if (value.startsWith("in.(") && value.endsWith(")")) {
          const items = value.slice(4, -1).split(",");
          filters.push(`t.${key} in (${items.map((item) => { values.push(item); return `$${values.length}`; }).join(",")})`);
          continue;
        }
        if (!value.startsWith("eq.") && !value.startsWith("lt.")) throw new Error("Unsupported fixture filter operator");
        values.push(value.slice(3));
        if (key === "novels.user_id") filters.push(`exists(select 1 from public.novels n where n.id=t.novel_id and n.user_id=$${values.length})`);
        else filters.push(`t.${key}${value.startsWith("lt.") ? "<" : "="}$${values.length}`);
      }
      let order = "";
      const sort = url.searchParams.get("order");
      if (sort) {
        order = ` order by ${sort.split(",").map((part) => {
          const [column, direction] = part.split(".");
          if (!/^[a-z_]+$/.test(column) || !["asc", "desc"].includes(direction)) throw new Error("Unsupported fixture order");
          return `t.${column} ${direction}`;
        }).join(",")}`;
      }
      const headerRange = request.headers.range?.match(/(\d+)-(\d+)/);
      const offset = Math.max(0, Number(url.searchParams.get("offset") || headerRange?.[1] || 0));
      const limit = Math.min(10000, Math.max(1, Number(url.searchParams.get("limit") || (headerRange ? Number(headerRange[2]) - Number(headerRange[1]) + 1 : 1000))));
      if (!Number.isInteger(offset) || !Number.isInteger(limit)) throw new Error("Unsupported fixture range");
      const result = await authenticatedQuery(account, () => db.query(`select t.* from public.${table} t${filters.length ? ` where ${filters.join(" and ")}` : ""}${order} limit ${limit} offset ${offset}`, values));
      response.setHeader("Content-Range", `${offset}-${Math.max(offset, offset + result.rows.length - 1)}/*`);
      if (request.headers.accept?.includes("application/vnd.pgrst.object+json")) {
        if (result.rows.length !== 1) return send(406, { code: "PGRST116", details: `The result contains ${result.rows.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" });
        return send(200, result.rows[0]);
      }
      return send(200, result.rows);
    } catch (error) {
      if (!quiet) console.error(`[TEST FIXTURE] ${request.method} ${pathname}: ${error.code || "ERROR"} ${error.message}`);
      return send(error.code === "42501" ? 403 : 400, { code: error.code || "FIXTURE_ERROR", message: error.message, details: null, hint: null });
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const close = async () => { await new Promise((resolve) => server.close(resolve)); await queue; await db.close(); };
  if (!quiet) console.log(`TEST ONLY Supabase protocol fixture ready on http://127.0.0.1:${port}; Auth/PostgREST simulated, SQL/RLS real PGlite.`);
  return { server, db, close };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fixture = await startSupabaseFixture({ port: Number(process.env.FIXTURE_PORT || 43001), appPort: Number(process.env.FIXTURE_APP_PORT || 43000) });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await fixture.close(); process.exit(0); });
}
