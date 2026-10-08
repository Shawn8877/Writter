import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Load the actual server adapter without Next's server-only bundler guard.
const domainText = await readFile(new URL("../src/lib/domain/novel.js", import.meta.url), "utf8");
const domainUrl = `data:text/javascript;base64,${Buffer.from(domainText).toString("base64")}`;
const source = (await readFile(new URL("../src/lib/server/supabase-repository.js", import.meta.url), "utf8"))
  .replace('import "server-only";', "")
  .replace('"@/lib/domain/novel"', JSON.stringify(domainUrl));
const { createSupabaseNovelRepository, readJson } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const db = new PGlite();
const user = { id: "33333333-3333-4333-8333-333333333333" };
const rpcParameters = {
  studio_create_novel: ["p_input"], studio_get_novel: ["p_novel_id"],
  studio_patch_novel: ["p_novel_id", "p_expected_revision", "p_patch", "p_collections"],
  studio_save_chapter: ["p_novel_id", "p_chapter_id", "p_expected_revision", "p_values", "p_create_version"],
  studio_delete_novel: ["p_novel_id", "p_expected_revision"],
};
const supabase = {
  async rpc(name, input) {
    const keys = rpcParameters[name];
    assert.ok(keys, "RPC must be known");
    try {
      const result = await db.query(`select public.${name}(${keys.map((_, i) => `$${i + 1}`).join(",")}) as data`, keys.map((key) => typeof input[key] === "object" ? JSON.stringify(input[key]) : input[key]));
      return { data: result.rows[0].data, error: null };
    } catch (error) { return { data: null, error }; }
  },
  from(table) {
    assert.ok(["novels", "chapters", "chapter_versions"].includes(table));
    const filters = [];
    let range = "";
    let order = "";
    let single = false;
    const builder = {
      select() { return builder; },
      eq(key, value) {
        if (key === "novels.user_id") return builder; // All DB queries still run as authenticated + actual RLS.
        assert.match(key, /^[a-z_]+$/); filters.push([key, value]); return builder;
      },
      order(key, options) { assert.match(key, /^[a-z_]+$/); order = ` order by ${key} ${options?.ascending === false ? "desc" : "asc"}`; return builder; },
      range(start, end) { range = ` limit ${end - start + 1} offset ${start}`; return builder; },
      maybeSingle() { single = true; return builder; },
      async then(resolve) {
        try {
          const result = await db.query(`select * from public.${table}${filters.length ? ` where ${filters.map(([key], i) => `${key}=$${i + 1}`).join(" and ")}` : ""}${order}${range}`, filters.map(([, value]) => value));
          resolve({ data: single ? result.rows[0] || null : result.rows, error: null });
        } catch (error) { resolve({ data: null, error }); }
      },
    };
    return builder;
  },
};
try {
  const requestBody = { idea: "守护者" };
  const jsonRequest = (headers) => new Request("http://localhost:43000/api/novels", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(requestBody),
  });
  // Next dev can normalize request.url while preserving the browser's Host.
  assert.deepEqual(await readJson(jsonRequest({ Host: "127.0.0.1:43000", Origin: "http://127.0.0.1:43000", "Sec-Fetch-Site": "same-origin" })), requestBody);
  assert.deepEqual(await readJson(jsonRequest({ Origin: "http://localhost:43000" })), requestBody);
  for (const origin of ["http://attacker.example", "http://localhost:43000", "http://127.0.0.1:43001", "https://127.0.0.1:43000"]) {
    await assert.rejects(readJson(jsonRequest({ Host: "127.0.0.1:43000", Origin: origin, "Sec-Fetch-Site": "same-origin" })), (error) => error.status === 403 && error.code === "INVALID_ORIGIN");
  }
  await assert.rejects(readJson(jsonRequest({ Host: "127.0.0.1:43000", Origin: "http://127.0.0.1:43000", "Sec-Fetch-Site": "cross-site" })), (error) => error.status === 403 && error.code === "INVALID_ORIGIN");
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  await db.query("insert into auth.users(id,email) values($1,'mapper@example.invalid')", [user.id]);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user.id]);
  const repository = createSupabaseNovelRepository(supabase, user);
  let novel = await repository.create({ genre: "玄幻", style: "细腻沉浸", idea: "一个数据库守护者", protagonist: "守护者", targetWords: 100000, targetChapters: 50, wordsPerChapter: 2000 });
  assert.equal(novel.chapters.length, 1);
  assert.equal(novel.outline.volumes.length, 1);
  assert.ok(novel.bible.id);
  assert.equal(novel.chapters[0].revision, 1);
  const characterId = crypto.randomUUID();
  novel = await repository.update(novel.id, novel.revision, { ...novel,
    bible: { ...novel.bible, worldRules: [{ rule: "守恒" }], synopsis: "简介" },
    characters: [{ id: characterId, name: "守护者", role: "主角", state: "待命", relationships: [{ person: "友人" }], currentState: { energy: 42 }, sourceChapterId: novel.chapters[0].id }],
    world: [{ id: crypto.randomUUID(), title: "世界法则", body: "记录不会消失", category: "核心规则", metadata: { provenance: "manual" } }],
    timeline: [{ id: crypto.randomUUID(), title: "开始", time: "第一日", kind: "计划事件", description: "故事开始" }],
  });
  assert.equal(novel.characters[0].state, "待命");
  assert.equal(novel.characters[0].currentState.energy, 42);
  assert.equal(novel.world[0].metadata.provenance, "manual");
  assert.equal(novel.timeline[0].time, "第一日");
  novel = await repository.update(novel.id, novel.revision, { ...novel, bible: { synopsis: "新简介", conflict: "冲突", storyline: "主线", antagonist: "反派", romance: "感情" } });
  assert.deepEqual(novel.bible.worldRules, [{ rule: "守恒" }]);
  const memoryId = crypto.randomUUID();
  novel = await repository.update(novel.id, novel.revision, { ...novel, memory: { ...novel.memory, entries: [{ id: memoryId, type: "location", title: "档案馆", content: "旧城", importance: 4, status: "active", sourceType: "chapter", sourceId: novel.chapters[0].id }] } });
  assert.equal(novel.memory.locations[0].id, memoryId);
  assert.equal(novel.memory.locations[0].sourceChapterId, novel.chapters[0].id);
  novel = await repository.update(novel.id, novel.revision, { ...novel, memory: { ...novel.memory, locations: novel.memory.locations.map((entry) => ({ ...entry, name: "新档案馆", description: "新城" })) } });
  assert.equal(novel.memory.entries.length, 1);
  assert.equal(novel.memory.entries[0].title, "新档案馆");
  assert.equal(novel.memory.entries[0].content, "新城");
  const obsoleteHintId = crypto.randomUUID();
  const resolvedHintId = crypto.randomUUID();
  const newHintId = crypto.randomUUID();
  novel = await repository.update(novel.id, novel.revision, { ...novel, memory: { ...novel.memory, entries: [
    ...novel.memory.entries,
    { id: obsoleteHintId, type: "foreshadowing", title: "已放弃的旧线索", content: "此线索不再采用", status: "obsolete", sourceType: "manual" },
    { id: resolvedHintId, type: "foreshadowing", title: "已经揭晓的线索", content: "此前已完成回收", status: "resolved", sourceType: "manual" },
  ] } });
  assert.equal(novel.memory.foreshadowing.find((entry) => entry.id === obsoleteHintId).status, "已失效");
  // Adding an unrelated hint through the world view must not reactivate old hints.
  novel = await repository.update(novel.id, novel.revision, { ...novel, memory: { ...novel.memory, foreshadowing: [
    ...novel.memory.foreshadowing,
    { id: newHintId, name: "新的线索", description: "等待后续回收", status: "未回收" },
  ] } });
  assert.equal(novel.memory.entries.find((entry) => entry.id === obsoleteHintId).status, "obsolete");
  assert.equal(novel.memory.entries.find((entry) => entry.id === resolvedHintId).status, "resolved");
  assert.equal(novel.memory.entries.find((entry) => entry.id === newHintId).status, "active");
  novel = await repository.update(novel.id, novel.revision, { ...novel, memory: { ...novel.memory, foreshadowing: novel.memory.foreshadowing.map((entry) => entry.id === obsoleteHintId ? { ...entry, name: "旧线索的补充说明" } : entry) } });
  assert.equal(novel.memory.entries.find((entry) => entry.id === obsoleteHintId).status, "obsolete");
  assert.equal(novel.memory.entries.find((entry) => entry.id === obsoleteHintId).title, "旧线索的补充说明");
  // Explicit status changes in the world view must remain available and round-trip.
  novel = await repository.update(novel.id, novel.revision, { ...novel, memory: { ...novel.memory, foreshadowing: novel.memory.foreshadowing.map((entry) => entry.id === obsoleteHintId ? { ...entry, status: "未回收" } : entry.id === newHintId ? { ...entry, status: "已失效" } : entry) } });
  assert.equal(novel.memory.entries.find((entry) => entry.id === obsoleteHintId).status, "active");
  assert.equal(novel.memory.entries.find((entry) => entry.id === newHintId).status, "obsolete");
  assert.equal(novel.memory.foreshadowing.find((entry) => entry.id === newHintId).status, "已失效");
  const chapter = novel.chapters[0];
  novel = await repository.update(novel.id, novel.revision, { ...novel, title: "资料已变，章节独立保存" });
  const saved = await repository.saveChapter(novel.id, chapter.id, { title: "第一章", outline: "大纲", body: "正文 甲乙", summary: "章摘要" }, chapter.revision, false);
  assert.equal(saved.chapter.revision, chapter.revision + 1);
  assert.equal(saved.chapter.wordCount, 4);
  assert.equal((await repository.versions(novel.id, chapter.id)).length, 0);
  await assert.rejects(repository.saveChapter(novel.id, chapter.id, { title: "覆盖", outline: "", body: "危险", summary: "" }, chapter.revision, false), (error) => error.status === 409);
  await repository.saveChapter(novel.id, chapter.id, { title: "第一章", outline: "大纲", body: "版本正文", summary: "章摘要" }, saved.chapter.revision, true);
  const versions = await repository.versions(novel.id, chapter.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].wordCount, 4);
  assert.ok(versions[0].createdAt);
  novel = await repository.get(novel.id);
  assert.equal(novel.stats.wordCount, 4);
  assert.equal(novel.memory.chapterSummaries[0].summary, "章摘要");
  assert.equal((await repository.list()).length, 1);
  await repository.remove(novel.id, novel.revision);
  await assert.rejects(repository.get(novel.id), (error) => error.status === 404);
  console.log("PASS: request origin validation + actual server adapter + PostgreSQL integration: create/get/list, metadata CRUD, hidden JSON preservation, shared memory projections and lossless foreshadowing statuses, chapter CAS/versions/summary/stats, delete.");
} finally { await db.close(); }
