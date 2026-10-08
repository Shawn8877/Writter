import "server-only";
import { validateNovelInput } from "@/lib/domain/novel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const novelStatuses = { planning: "构思中", writing: "创作中", completed: "已完结", archived: "已归档" };
const chapterStatuses = { planned: "待创作", draft: "草稿", generated: "已生成", reviewed: "已校对", final: "已定稿" };
const worldCategories = { history: "时代背景", rule: "核心规则", organization: "组织势力", other: "其他" };
const memoryGroups = { locations: "location", items: "item", abilities: "ability", foreshadowing: "foreshadowing" };
const foreshadowingStatuses = { active: "未回收", resolved: "已回收", obsolete: "已失效" };
const reverse = (map, value, fallback) => Object.keys(map).find((key) => map[key] === value) || (Object.hasOwn(map, value) ? value : fallback);
const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
const stamps = (row) => ({ createdAt: row.created_at, updatedAt: row.updated_at });
const pick = (object, keys) => Object.fromEntries(keys.filter((key) => object[key] !== undefined).map((key) => [key, object[key]]));

export class RepositoryError extends Error {
  constructor(message, status = 400, code = "INVALID_INPUT") { super(message); this.status = status; this.code = code; }
}
export function assertUuid(value) {
  if (!UUID.test(value || "")) throw new RepositoryError("记录不存在或无权访问。", 404, "NOT_FOUND");
}
export function assertRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RepositoryError("缺少有效版本号，请刷新后重试。");
}
function fail(error) {
  if (!error) return;
  if (error.code === "PT409" || error.code === "40001") throw new RepositoryError("内容已被其他标签页或设备修改，请保留草稿并刷新。", 409, "CONFLICT");
  if (error.code === "P0002" || error.code === "42501") throw new RepositoryError("记录不存在或无权访问。", 404, "NOT_FOUND");
  if (error.code === "23503") throw new RepositoryError("这条资料仍被来源记录引用，请先调整相关记忆。", 409, "SOURCE_IN_USE");
  if (["23514", "23502", "22P02", "22023"].includes(error.code)) throw new RepositoryError("数据格式不正确，或来源不属于当前小说。", 400);
  throw new RepositoryError("数据库操作失败，请检查迁移是否已执行后重试。", 503, "DATABASE_ERROR");
}
export function apiError(error) {
  return Response.json({ error: error instanceof RepositoryError ? error.message : "请求失败，请稍后重试。", code: error.code || "REQUEST_FAILED" }, { status: error.status || 500, headers: { "Cache-Control": "no-store" } });
}
export async function readJson(request, maxBytes = 20000000) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next's development URL normalizes loopback hosts to localhost. Host keeps
  // the actual public request authority used by the browser's Origin header.
  const authority = request.headers.get("host") || url.host;
  if ((origin && origin !== `${url.protocol}//${authority}`) || request.headers.get("sec-fetch-site") === "cross-site") throw new RepositoryError("请求来源不受信任。", 403, "INVALID_ORIGIN");
  if (!request.headers.get("content-type")?.includes("application/json")) throw new RepositoryError("请使用 JSON 格式提交。", 415);
  if (Number(request.headers.get("content-length")) > maxBytes) throw new RepositoryError("内容过大，请分章节保存。", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new RepositoryError("内容过大，请分章节保存。", 413);
  try { const value = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new RepositoryError("请求内容格式不正确。"); }
}

export function chapterFromRow(row) {
  return { id: row.id, number: row.sort_order, volumeId: row.volume_id, title: row.title, outline: row.outline, body: row.content, summary: row.summary, wordCount: row.word_count, revision: row.revision, status: chapterStatuses[row.status] || row.status, ...stamps(row) };
}
function memoryFromRow(row) {
  return { id: row.id, type: row.memory_type, memoryType: row.memory_type, title: row.title, content: row.content, importance: row.importance, status: row.status, sourceType: row.source_type, sourceId: row.source_id, chapterId: row.chapter_id, sourceChapterId: row.chapter_id, metadata: row.metadata, ...stamps(row) };
}
function modelFromRows(data) {
  const row = data.novel;
  const bible = data.novel_bible || {};
  const entries = data.memory_items.map(memoryFromRow);
  const memory = { entries, chapterSummaries: data.chapter_summaries.map((item) => ({ id: item.id, chapterId: item.chapter_id, sourceChapterId: item.chapter_id, summary: item.summary, keyEvents: item.key_events, characterChanges: item.character_changes, newInformation: item.new_information, foreshadowingAdded: item.foreshadowing_added, foreshadowingResolved: item.foreshadowing_resolved, ...stamps(item) })) };
  for (const [key, type] of Object.entries(memoryGroups)) memory[key] = entries.filter((entry) => entry.type === type).map((entry) => ({ ...entry, name: entry.title, description: entry.content, resolution: entry.metadata?.resolution || "", status: type === "foreshadowing" ? (foreshadowingStatuses[entry.status] || entry.status) : entry.status }));
  const chapters = data.chapters.map(chapterFromRow);
  return {
    id: row.id, userId: row.user_id, title: row.title, description: row.description, genre: row.genre, style: row.style, idea: row.premise, protagonist: row.protagonist,
    targetWords: row.target_word_count, targetChapters: row.target_chapter_count, wordsPerChapter: row.chapter_word_target, status: novelStatuses[row.status], statusCode: row.status,
    cover: row.cover_theme, coverUrl: row.cover_url, revision: row.revision, isDemo: false, ...stamps(row),
    stats: { chapterCount: chapters.length, wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) },
    bible: { id: bible.id, synopsis: bible.synopsis || "", conflict: bible.main_conflict || "", storyline: bible.storyline || "", antagonist: bible.antagonist || "", romance: bible.romance_direction || "", corePremise: bible.core_premise || "", worldRules: bible.world_rules || [], storyTone: bible.story_tone || "", writingStyle: bible.writing_style || "", protagonistArc: bible.protagonist_arc || "", powerSystem: bible.power_system || "", endingDirection: bible.ending_direction || "", forbiddenChanges: bible.forbidden_changes || [] },
    outline: { master: row.master_outline, volumes: data.volumes.map((item) => ({ id: item.id, title: item.title, summary: item.summary, range: item.chapter_range, beats: item.beats, status: item.status, ...stamps(item) })) },
    chapters,
    characters: data.characters.map((item) => ({ id: item.id, name: item.name, aliases: item.aliases, role: item.role, gender: item.gender, age: item.age, description: item.description, personality: item.personality, appearance: item.appearance, background: item.background, motivation: item.goals, relationships: item.relationships, abilities: item.abilities, currentState: item.current_state, state: typeof item.current_state === "string" ? item.current_state : item.current_state?.description || "", traits: item.traits, color: item.color, initials: item.name.slice(-1), sourceChapterId: item.first_appearance_chapter_id, isAlive: item.is_alive, ...stamps(item) })),
    world: data.world_entries.map((item) => ({ id: item.id, title: item.name, body: item.content, category: item.metadata?.categoryLabel || worldCategories[item.category] || item.category, categoryCode: item.category, metadata: item.metadata, sourceChapterId: item.chapter_id, ...stamps(item) })),
    timeline: data.timeline_events.map((item) => ({ id: item.id, time: item.event_time, title: item.title, description: item.description, kind: item.kind, characters: item.characters, importance: item.importance, sourceChapterId: item.chapter_id, ...stamps(item) })),
    memory,
  };
}

function diffRecords(before, after, encode) {
  if (!Array.isArray(after)) throw new RepositoryError("资料列表格式不正确。");
  if (after.length > 10000) throw new RepositoryError("资料条目过多。", 413);
  const old = new Map(before.map((item) => [item.id, item]));
  const ids = new Set();
  const upsert = [];
  after.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new RepositoryError("资料条目格式不正确。");
    assertUuid(item.id);
    if (ids.has(item.id)) throw new RepositoryError("列表包含重复记录。");
    ids.add(item.id);
    const previous = old.get(item.id);
    const merged = { ...previous, ...item };
    const row = encode(merged, index, previous);
    if (!previous || changed(encode(previous, before.indexOf(previous), previous), row)) upsert.push({ id: item.id, ...row });
  });
  return { upsert, delete: before.filter((item) => !ids.has(item.id)).map((item) => item.id) };
}

// Existing world tabs and the memory center are two projections of the same rows.
function reconcileMemory(current, next) {
  if (next.entries && changed(current.entries, next.entries)) return next.entries;
  let entries = [...current.entries];
  for (const [key, type] of Object.entries(memoryGroups)) {
    if (!next[key] || !changed(current[key], next[key])) continue;
    const group = next[key].map((item) => ({ ...current.entries.find((entry) => entry.id === item.id), ...item, type, title: item.name, content: item.description, status: type === "foreshadowing" ? reverse(foreshadowingStatuses, item.status, "active") : item.status || "active", metadata: { ...item.metadata, resolution: item.resolution || "" } }));
    entries = [...entries.filter((entry) => entry.type !== type), ...group];
  }
  return entries;
}

function patches(current, next) {
  const patch = {};
  const fields = { title: "title", description: "description", genre: "genre", style: "style", idea: "premise", protagonist: "protagonist", targetWords: "target_word_count", targetChapters: "target_chapter_count", wordsPerChapter: "chapter_word_target", cover: "cover_theme", coverUrl: "cover_url" };
  for (const [key, column] of Object.entries(fields)) if (next[key] !== undefined && changed(current[key], next[key])) patch[column] = next[key];
  if (next.status && current.status !== next.status) patch.status = reverse(novelStatuses, next.status, "planning");
  if (next.outline?.master !== undefined && current.outline.master !== next.outline.master) patch.master_outline = next.outline.master;
  const collections = {};
  if (next.bible) {
    const map = { synopsis: "synopsis", conflict: "main_conflict", storyline: "storyline", antagonist: "antagonist", romance: "romance_direction", corePremise: "core_premise", worldRules: "world_rules", storyTone: "story_tone", writingStyle: "writing_style", protagonistArc: "protagonist_arc", powerSystem: "power_system", endingDirection: "ending_direction", forbiddenChanges: "forbidden_changes" };
    const fields = {};
    for (const [key, column] of Object.entries(map)) if (next.bible[key] !== undefined && changed(current.bible[key], next.bible[key])) fields[column] = next.bible[key];
    if (Object.keys(fields).length) collections.novel_bible = { upsert: [{ id: current.bible.id || crypto.randomUUID(), ...fields }] };
  }
  if (next.outline?.volumes) collections.volumes = diffRecords(current.outline.volumes, next.outline.volumes, (item, index) => ({ title: item.title, summary: item.summary || "", sort_order: index + 1, chapter_range: item.range || "", status: item.status || "规划中", beats: item.beats || [] }));
  if (next.chapters) collections.chapters = diffRecords(current.chapters, next.chapters, (item, index) => ({ volume_id: item.volumeId || null, title: item.title, content: item.body || "", outline: item.outline || "", summary: item.summary || "", status: reverse(chapterStatuses, item.status, item.body ? "draft" : "planned"), sort_order: item.number || index + 1 }));
  if (next.characters) collections.characters = diffRecords(current.characters, next.characters, (item, index, previous) => ({ name: item.name, aliases: item.aliases || [], role: item.role || "重要配角", gender: item.gender || "", age: item.age || "", description: item.description || "", personality: item.personality || "", appearance: item.appearance || "", background: item.background || "", goals: item.motivation || "", relationships: item.relationships || [], abilities: item.abilities || [], current_state: !previous || item.state !== previous.state ? { ...(typeof item.currentState === "object" ? item.currentState : {}), description: item.state || "" } : item.currentState, traits: item.traits || [], color: item.color || "gold", first_appearance_chapter_id: item.sourceChapterId || null, is_alive: item.isAlive ?? true }));
  if (next.world) collections.world_entries = diffRecords(current.world, next.world, (item) => ({ category: reverse(worldCategories, item.category, item.categoryCode || "other"), name: item.title, content: item.body || "", metadata: { ...item.metadata, categoryLabel: item.category || "其他" }, chapter_id: item.sourceChapterId || null }));
  if (next.timeline) collections.timeline_events = diffRecords(current.timeline, next.timeline, (item, index) => ({ chapter_id: item.sourceChapterId || null, event_time: item.time || "", title: item.title, description: item.description || "", kind: item.kind || "计划事件", characters: item.characters || [], importance: item.importance || 3, sort_order: index + 1 }));
  if (next.memory) collections.memory_items = diffRecords(current.memory.entries, reconcileMemory(current.memory, next.memory), (item) => ({ chapter_id: item.chapterId || item.sourceChapterId || null, memory_type: item.type || item.memoryType || "other", title: item.title || "未命名记忆", content: item.content || "", importance: Number(item.importance) || 3, status: item.status || "active", source_type: item.sourceType || (item.sourceChapterId ? "chapter" : "manual"), source_id: item.sourceId || (item.sourceChapterId ? item.sourceChapterId : null), metadata: item.metadata || {} }));
  return { patch, collections };
}

export function createSupabaseNovelRepository(supabase, user) {
  async function get(id) {
    assertUuid(id);
    const { data: owned, error: ownershipError } = await supabase.from("novels").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
    fail(ownershipError);
    if (!owned) throw new RepositoryError("记录不存在或无权访问。", 404, "NOT_FOUND");
    const { data, error } = await supabase.rpc("studio_get_novel", { p_novel_id: id });
    fail(error);
    if (!data) throw new RepositoryError("记录不存在或无权访问。", 404, "NOT_FOUND");
    return modelFromRows(data);
  }
  return {
    get,
    async list() {
      const result = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("novels").select("id").eq("user_id", user.id).order("updated_at", { ascending: false }).range(offset, offset + 499);
        fail(error);
        for (let i = 0; i < data.length; i += 10) result.push(...await Promise.all(data.slice(i, i + 10).map((item) => get(item.id))));
        if (data.length < 500) return result;
      }
    },
    async create(input) {
      if (typeof input.idea !== "string" || typeof input.genre !== "string" || typeof input.style !== "string") throw new RepositoryError("请完整填写题材、创意和写作风格。");
      const errors = validateNovelInput(input);
      if (Object.keys(errors).length) throw new RepositoryError(Object.values(errors)[0]);
      if (typeof input.protagonist !== "string" || input.protagonist.length > 10000) throw new RepositoryError("主角描述格式不正确。");
      const { data, error } = await supabase.rpc("studio_create_novel", { p_input: pick(input, ["title", "genre", "style", "idea", "protagonist", "targetWords", "targetChapters", "wordsPerChapter"]) });
      fail(error); return get(data);
    },
    async update(id, expectedRevision, next) {
      assertRevision(expectedRevision);
      if (!next || typeof next !== "object" || Array.isArray(next)) throw new RepositoryError("小说数据格式不正确。");
      const current = await get(id);
      if (current.revision !== expectedRevision) throw new RepositoryError("内容已被其他标签页或设备修改，请保留草稿并刷新。", 409, "CONFLICT");
      const { patch, collections } = patches(current, next);
      const { error } = await supabase.rpc("studio_patch_novel", { p_novel_id: id, p_expected_revision: expectedRevision, p_patch: patch, p_collections: collections });
      fail(error); return get(id);
    },
    async remove(id, revision) {
      assertUuid(id); assertRevision(revision);
      const { error } = await supabase.rpc("studio_delete_novel", { p_novel_id: id, p_expected_revision: revision }); fail(error);
    },
    async saveChapter(novelId, chapterId, values, expectedRevision, createVersion) {
      assertUuid(novelId); assertUuid(chapterId); assertRevision(expectedRevision);
      for (const key of ["title", "outline", "body", "summary"]) if (typeof values?.[key] !== "string" || values[key].length > (key === "body" ? 1000000 : 100000)) throw new RepositoryError("章节内容格式或长度不正确。");
      if (!values.title.trim()) throw new RepositoryError("请填写章节名称。");
      const { data, error } = await supabase.rpc("studio_save_chapter", { p_novel_id: novelId, p_chapter_id: chapterId, p_expected_revision: expectedRevision, p_values: pick(values, ["title", "outline", "body", "summary"]), p_create_version: createVersion === true });
      fail(error); return { chapter: chapterFromRow(data.chapter), novelRevision: data.novelRevision };
    },
    async versions(novelId, chapterId) {
      assertUuid(novelId); assertUuid(chapterId);
      const { data: chapter, error: chapterError } = await supabase.from("chapters").select("id,novels!inner(user_id)").eq("id", chapterId).eq("novel_id", novelId).eq("novels.user_id", user.id).maybeSingle();
      fail(chapterError);
      if (!chapter) throw new RepositoryError("记录不存在或无权访问。", 404, "NOT_FOUND");
      const records = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("chapter_versions").select("id,content,word_count,source,created_at").eq("chapter_id", chapterId).order("created_at", { ascending: false }).range(offset, offset + 499);
        fail(error);
        records.push(...data.map((item) => ({ id: item.id, content: item.content, wordCount: item.word_count, source: item.source, createdAt: item.created_at })));
        if (data.length < 500) return records;
      }
    },
  };
}
