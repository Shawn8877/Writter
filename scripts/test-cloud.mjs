// Real hosted Supabase only. Requires two existing, disposable test accounts.
// This suite proves SDK/database behavior; it does not claim browser acceptance.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

const root = fileURLToPath(new URL("../", import.meta.url));
const file = (path) => new URL(`../${path}`, import.meta.url);
const children = ["volumes", "chapters", "characters", "world_entries", "timeline_events", "novel_bible", "chapter_summaries", "memory_items"];
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
const report = { runId, scope: "real Supabase SDK and database; browser tests excluded", status: "blocked", checks: [], novels: {} };
let reportFile;
const clients = [];
let stage = "configuration";

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
async function persist() {
  if (reportFile) await writeFile(reportFile, JSON.stringify(report, null, 2));
}
async function check(name, action) {
  stage = name;
  await action();
  report.checks.push(name);
  await persist();
  console.log(`PASS: ${name}`);
}
async function ok(query) {
  const { data, error } = await query;
  if (error) {
    const failure = new Error(`Supabase request failed (${error.code || error.status || "network"})`);
    failure.code = error.code || "NETWORK_ERROR";
    failure.status = error.status;
    throw failure;
  }
  return data;
}
async function rejected(query, codes) {
  const { error } = await query;
  ensure(error && codes.includes(error.code), "Expected database rejection was not returned");
}
async function unchanged(query) {
  const { data, error } = await query;
  if (error) ensure(error.code === "42501", "Unexpected error cannot prove RLS protection");
  else assert.deepEqual(data, [], "Cross-account write affected records");
}

try {
  ensure(process.argv.includes("--allow-cloud-test-writes"), "BLOCKED: pass --allow-cloud-test-writes for an independent disposable test project.");
  nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
  const configSource = await readFile(file("src/lib/supabase/config.js"), "utf8");
  const { getSupabaseConfig } = await import(`data:text/javascript;base64,${Buffer.from(configSource).toString("base64")}`);
  const config = getSupabaseConfig();
  ensure(config, "BLOCKED: real public Supabase configuration is missing or invalid.");
  const settings = await readFile(file(".tools/cloud-test-accounts.json"), "utf8").then(JSON.parse).catch(() => null);
  ensure(settings?.disposableTestProject === true, "BLOCKED: .tools/cloud-test-accounts.json must explicitly identify a disposable test project.");
  ensure(/^[a-z0-9]{20}$/.test(settings.projectRef), "BLOCKED: invalid test project reference.");
  ensure(config.url === `https://${settings.projectRef}.supabase.co`, "BLOCKED: the configured URL does not match the approved test project.");
  for (const name of ["a", "b"]) ensure(settings[name]?.email && settings[name]?.password, "BLOCKED: two test accounts are required.");
  ensure(settings.a.email.toLowerCase() !== settings.b.email.toLowerCase(), "BLOCKED: test accounts must be distinct.");
  report.projectRef = settings.projectRef;
  report.status = "running";
  await mkdir(file("artifacts/phase2.5/"), { recursive: true });
  reportFile = file(`artifacts/phase2.5/cloud-${runId}.json`);
  await persist();

  // Use the same adapter as the application's API, without the bundler-only guard.
  const domainText = await readFile(file("src/lib/domain/novel.js"), "utf8");
  const domainUrl = `data:text/javascript;base64,${Buffer.from(domainText).toString("base64")}`;
  const adapter = (await readFile(file("src/lib/server/supabase-repository.js"), "utf8"))
    .replace('import "server-only";', "").replace('"@/lib/domain/novel"', JSON.stringify(domainUrl));
  const { createSupabaseNovelRepository } = await import(`data:text/javascript;base64,${Buffer.from(adapter).toString("base64")}`);
  function client() {
    const value = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) },
    });
    clients.push(value);
    return value;
  }
  async function login(credentials) {
    const supabase = client();
    const { user, session } = await ok(supabase.auth.signInWithPassword(credentials));
    ensure(user && session, "No authenticated user session");
    const verified = await ok(supabase.auth.getUser());
    assert.equal(verified.user.id, user.id);
    return { supabase, user, repository: createSupabaseNovelRepository(supabase, user) };
  }
  let a, b;
  await check("two independent real users authenticate and have profiles", async () => {
    a = await login(settings.a);
    b = await login(settings.b);
    assert.notEqual(a.user.id, b.user.id);
    for (const actor of [a, b]) {
      const rows = await ok(actor.supabase.from("profiles").select("id").eq("id", actor.user.id));
      assert.equal(rows.length, 1);
    }
  });

  async function seed(actor, label) {
    const repo = actor.repository;
    let novel = await repo.create({ title: `云端验收 ${label} ${runId}`, genre: "科幻", style: "细腻沉浸", idea: "守塔人在失去时间的城市中找回被遗忘的记忆。", protagonist: "林舟，守塔人。", targetWords: 100000, targetChapters: 50, wordsPerChapter: 2000 });
    report.novels[label] = { id: novel.id, status: "created" };
    await persist();
    assert.equal(novel.chapters.length, 1);
    assert.equal(novel.outline.volumes.length, 1);
    ensure(novel.bible.id, "Creation did not include a Novel Bible");
    const first = novel.chapters[0];
    novel = await repo.update(novel.id, novel.revision, {
      bible: { synopsis: "林舟调查钟楼，逐步找回城市失落的历史。", worldRules: ["时间与记忆守恒"] },
      chapters: [...novel.chapters, ...[2, 3].map((number) => ({ id: crypto.randomUUID(), number, volumeId: first.volumeId, title: `第${number}章`, body: "", outline: "调查旧城", summary: "" }))],
      characters: ["林舟", "沈月", "周远"].map((name) => ({ id: crypto.randomUUID(), name, state: "抵达钟楼", sourceChapterId: first.id })),
      world: ["钟楼", "失时法则", "档案馆"].map((title) => ({ id: crypto.randomUUID(), title, body: "城市中的关键设定", category: "核心规则", sourceChapterId: first.id })),
      timeline: [1, 2, 3].map((day) => ({ id: crypto.randomUUID(), title: `第${day}次钟响`, time: `第${day}日`, description: "守塔人记录城市的变化", sourceChapterId: first.id })),
      memory: { entries: ["location", "item", "foreshadowing"].map((type) => ({ id: crypto.randomUUID(), type, title: `${type}线索`, content: "钟楼中留下的记录", importance: 4, status: "active", sourceType: "chapter", sourceId: first.id })) },
    });
    const body = "风穿过钟楼，林舟在旧钟上找到自己的名字。他翻开档案，发现每一次钟声都对应着一段失去的记忆。沈月站在门外，手中的地图指向无人居住的旧城。他们约定天亮出发，并把发现完整记入日志。\n".repeat(12);
    ensure((body.match(/\p{Script=Han}/gu) || []).length >= 800, "The fixture body must contain at least 800 Chinese characters");
    let saved = await repo.saveChapter(novel.id, first.id, { title: first.title, outline: "寻找失落的城市", body, summary: "林舟找到名字与地图。" }, first.revision, true);
    saved = await repo.saveChapter(novel.id, first.id, { title: first.title, outline: "寻找失落的城市", body: `${body}天亮时，两人终于抵达旧城。`, summary: "林舟与沈月抵达旧城。" }, saved.chapter.revision, true);
    report.novels[label] = { id: novel.id, chapterId: first.id, characterId: novel.characters[0].id, memoryId: novel.memory.entries[0].id, chineseCharacters: (body.match(/\p{Script=Han}/gu) || []).length, status: "seeded" };
    await persist();
    return repo.get(novel.id);
  }
  let novelA, novelB;
  await check("A and B persist complete novels with 800+ Chinese characters and two versions", async () => {
    novelA = await seed(a, "A");
    novelB = await seed(b, "B");
    for (const [actor, novel] of [[a, novelA], [b, novelB]]) {
      for (const key of ["chapters", "characters", "world", "timeline"]) assert.equal(novel[key].length, 3);
      assert.equal(novel.memory.entries.length, 3);
      const versions = await actor.repository.versions(novel.id, novel.chapters[0].id);
      assert.equal(versions.length, 2);
      const rows = await ok(actor.supabase.from("chapter_versions").select("*").eq("chapter_id", novel.chapters[0].id));
      for (const row of rows) {
        assert.equal(row.word_count, row.content.replace(/\s/g, "").length);
        assert.equal(row.source, "manual");
        ensure(Number.isFinite(Date.parse(row.created_at)), "Missing version timestamp");
      }
    }
  });
  await check("session refresh and fresh SDK login preserve all cloud data", async () => {
    const refreshed = await ok(a.supabase.auth.refreshSession());
    assert.equal(refreshed.user.id, a.user.id);
    await ok(a.supabase.auth.signOut({ scope: "local" }));
    const reopened = await login(settings.a);
    assert.deepEqual(await reopened.repository.get(novelA.id), novelA);
    a = reopened;
  });

  function tableQuery(actor, table, owner, novel) {
    const query = actor.supabase.from(table).select("*");
    if (table === "profiles") return query.eq("id", owner.user.id);
    if (table === "novels") return query.eq("id", novel.id);
    if (table === "chapter_versions") return query.in("chapter_id", novel.chapters.map((chapter) => chapter.id));
    return query.eq("novel_id", novel.id);
  }
  async function snapshot(owner, novel) {
    const value = {};
    for (const table of ["profiles", "novels", ...children, "chapter_versions"]) {
      value[table] = (await ok(tableQuery(owner, table, owner, novel))).sort((x, y) => x.id.localeCompare(y.id));
      ensure(value[table].length > 0, `Owner baseline for ${table} must not be empty`);
    }
    return value;
  }
  for (const direction of ["B cannot access A", "A cannot access B"]) {
    await check(`direct database RLS: ${direction}`, async () => {
      const [owner, attacker, novel] = direction.startsWith("B") ? [a, b, novelA] : [b, a, novelB];
      const baseline = await snapshot(owner, novel);
      for (const table of Object.keys(baseline)) {
        assert.deepEqual(await ok(tableQuery(attacker, table, owner, novel)), []);
        report.checks.push(`${direction}: SELECT ${table} returns no rows`);
      }
      await assert.rejects(attacker.repository.get(novel.id), (error) => error.status === 404);
      const list = await attacker.repository.list();
      ensure(!list.some((item) => item.id === novel.id), "Dashboard repository leaked another user's novel");
      const db = attacker.supabase;
      const chapter = novel.chapters[0];
      const attacks = [
        ["UPDATE novels", () => unchanged(db.from("novels").update({ title: "越权覆盖" }).eq("id", novel.id).select())],
        ["DELETE novels", () => unchanged(db.from("novels").delete().eq("id", novel.id).select())],
        ["UPDATE chapters", () => unchanged(db.from("chapters").update({ content: "越权正文" }).eq("id", chapter.id).select())],
        ["DELETE chapters", () => unchanged(db.from("chapters").delete().eq("id", chapter.id).select())],
        ["INSERT characters", () => rejected(db.from("characters").insert({ novel_id: novel.id, name: "越权人物" }), ["42501"])],
        ["INSERT world_entries", () => rejected(db.from("world_entries").insert({ novel_id: novel.id, name: "越权世界资料" }), ["42501"])],
        ["INSERT timeline_events", () => rejected(db.from("timeline_events").insert({ novel_id: novel.id, title: "越权时间线" }), ["42501"])],
        ["INSERT memory_items", () => rejected(db.from("memory_items").insert({ novel_id: novel.id, title: "越权记忆", source_type: "manual" }), ["42501"])],
        ["INSERT chapter_versions", () => rejected(db.from("chapter_versions").insert({ chapter_id: chapter.id, content: "越权版本" }), ["42501"])],
        ["UPDATE novel_bible", () => unchanged(db.from("novel_bible").update({ synopsis: "越权设定" }).eq("novel_id", novel.id).select())],
        ["UPDATE chapter_summaries", () => unchanged(db.from("chapter_summaries").update({ summary: "越权摘要" }).eq("chapter_id", chapter.id).select())],
      ];
      for (const [name, action] of attacks) {
        await action();
        report.checks.push(`${direction}: ${name} blocked`);
      }
      assert.deepEqual(await snapshot(owner, novel), baseline, "Cross-account attacks changed owner data");
    });
  }

  await check("stale chapter revision is rejected without overwriting saved content", async () => {
    const old = novelA.chapters[0];
    const values = { title: old.title, outline: old.outline, body: `${old.body}\n最新云端记录。`, summary: old.summary };
    const saved = await a.repository.saveChapter(novelA.id, old.id, values, old.revision, false);
    await assert.rejects(a.repository.saveChapter(novelA.id, old.id, { ...values, body: "旧窗口正文" }, old.revision, false), (error) => error.status === 409);
    const latest = (await a.repository.get(novelA.id)).chapters.find((chapter) => chapter.id === old.id);
    assert.equal(latest.body, values.body);
    assert.equal(latest.revision, saved.chapter.revision);
  });
  await check("hosted PostgREST returns PT409 for chapter, metadata and delete conflicts without retries", async () => {
    const latest = await a.repository.get(novelA.id);
    const chapter = latest.chapters[0];
    const requests = [
      ["studio_save_chapter", { p_novel_id: latest.id, p_chapter_id: chapter.id, p_expected_revision: chapter.revision - 1, p_values: { title: chapter.title, outline: chapter.outline, body: "must not save", summary: chapter.summary }, p_create_version: false }],
      ["studio_patch_novel", { p_novel_id: latest.id, p_expected_revision: latest.revision - 1, p_patch: { title: "must not rename" } }],
      ["studio_delete_novel", { p_novel_id: latest.id, p_expected_revision: latest.revision - 1 }],
    ];
    for (const [name, values] of requests) {
      const result = await a.supabase.rpc(name, values);
      assert.equal(result.status, 409);
      assert.equal(result.error?.code, "PT409");
      report.checks.push(`${name}: HTTP 409 / PT409`);
    }
    assert.deepEqual(await a.repository.get(novelA.id), latest);
  });
  await check("Novel Bible uniqueness, summary CRUD, memory CRUD and source integrity", async () => {
    const db = a.supabase;
    const chapter = novelA.chapters[0];
    await rejected(db.from("novel_bible").insert({ novel_id: novelA.id }), ["23505"]);
    const memory = await ok(db.from("memory_items").insert({ novel_id: novelA.id, memory_type: "location", title: "测试地点", content: "旧城", importance: 4, status: "active", source_type: "chapter", source_id: chapter.id }).select().single());
    assert.equal(memory.chapter_id, chapter.id);
    const updated = await ok(db.from("memory_items").update({ title: "更新地点", content: "新城", importance: 5, status: "resolved" }).eq("id", memory.id).select().single());
    assert.equal(updated.title, "更新地点");
    assert.equal(updated.source_id, chapter.id);
    assert.equal(updated.status, "resolved");
    await ok(db.from("memory_items").delete().eq("id", memory.id));
    assert.deepEqual(await ok(db.from("memory_items").select("id").eq("id", memory.id)), []);
    await rejected(db.from("memory_items").insert({ novel_id: novelA.id, title: "错误来源", source_type: "chapter", source_id: novelB.chapters[0].id }), ["23514"]);
    const summary = await ok(db.from("chapter_summaries").select("*").eq("chapter_id", chapter.id).single());
    await ok(db.from("chapter_summaries").delete().eq("id", summary.id));
    assert.deepEqual(await ok(db.from("chapter_summaries").select("id").eq("id", summary.id)), []);
    const created = await ok(db.from("chapter_summaries").insert({ novel_id: novelA.id, chapter_id: chapter.id, summary: "手工摘要" }).select().single());
    const changed = await ok(db.from("chapter_summaries").update({ summary: summary.summary, key_events: ["抵达旧城"] }).eq("id", created.id).select().single());
    assert.equal(changed.summary, summary.summary);
    assert.deepEqual(changed.key_events, ["抵达旧城"]);
  });
  await check("disposable chapter, volume and complete novel deletion leave no orphan rows", async () => {
    let disposable = await seed(a, "cascade-only");
    const db = a.supabase;
    const first = disposable.chapters[0];
    await rejected(db.from("chapters").delete().eq("id", first.id), ["23503"]);
    await ok(db.from("volumes").delete().eq("id", disposable.outline.volumes[0].id));
    const chapters = await ok(db.from("chapters").select("id,volume_id").eq("novel_id", disposable.id));
    assert.equal(chapters.length, 3);
    ensure(chapters.every((row) => row.volume_id === null), "Deleting a volume must preserve chapters");
    await ok(db.from("memory_items").delete().eq("novel_id", disposable.id).eq("source_id", first.id));
    await ok(db.from("chapters").delete().eq("id", first.id));
    for (const table of ["chapter_versions", "chapter_summaries"]) assert.deepEqual(await ok(db.from(table).select("id").eq("chapter_id", first.id)), []);
    disposable = await a.repository.get(disposable.id);
    // Repopulate dependencies so every table has rows before the final cascade.
    disposable = await a.repository.update(disposable.id, disposable.revision, {
      outline: { volumes: [{ id: crypto.randomUUID(), title: "级联测试卷" }] },
      memory: { entries: [{ id: crypto.randomUUID(), title: "级联测试记忆", type: "plot", sourceType: "chapter", sourceId: disposable.chapters[0].id }] },
    });
    await a.repository.saveChapter(disposable.id, disposable.chapters[0].id, { title: "待删除章节", outline: "", body: "待删除版本", summary: "待删除摘要" }, disposable.chapters[0].revision, true);
    disposable = await a.repository.get(disposable.id);
    const baseline = await snapshot(a, disposable);
    await a.repository.remove(disposable.id, disposable.revision);
    for (const table of Object.keys(baseline).filter((name) => name !== "profiles")) assert.deepEqual(await ok(tableQuery(a, table, a, disposable)), []);
    report.novels["cascade-only"].status = "deleted-and-verified";
    ensure(await a.repository.get(novelA.id), "Cascade affected an unrelated novel");
  });
  report.status = "passed-sdk-database-only";
  report.browserAcceptance = "pending: registration UI, cookie refresh/reopen, clean browser session, autosave debounce, offline drafts, conflict UI, console and routes";
  await persist();
  console.log(`Cloud SDK checks complete. Evidence: artifacts/phase2.5/cloud-${runId}.json`);
} catch (error) {
  report.status = reportFile ? "failed" : "blocked";
  report.failedStage = stage;
  report.failure = { name: error.name, code: error.code, status: error.status };
  // Do not serialize raw SDK errors, requests, tokens, passwords or account emails.
  await persist();
  console.error(stage === "configuration" ? error.message : `FAIL: ${stage} (${error.name}, ${error.code || "no code"}, status ${error.status || "unknown"}). Cloud acceptance remains incomplete.`);
  process.exitCode = 1;
} finally {
  for (const value of clients) await value.auth.signOut({ scope: "local" }).catch(() => {});
}
