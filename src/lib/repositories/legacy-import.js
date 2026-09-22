// Phase 1 remains read-only here. Import is explicit and never clears the original.
const KEY = "novelai-studio:novels:v1";
export function readLegacyNovels() {
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.novels)) throw new Error("旧版本地数据格式无法读取，原始数据已保留。");
  return data.novels;
}

export function prepareLegacyImport(source, created) {
  const ids = new Map();
  const remap = (id) => { if (!id) return null; if (!ids.has(id)) ids.set(id, crypto.randomUUID()); return ids.get(id); };
  const volumes = (source.outline?.volumes || []).map((volume) => ({ ...volume, id: remap(volume.id) }));
  const chapters = (source.chapters || []).map((chapter, index) => ({ ...chapter, id: remap(chapter.id), volumeId: remap(chapter.volumeId), number: index + 1 }));
  const characters = (source.characters || []).map((person) => ({ ...person, id: remap(person.id), sourceChapterId: remap(person.sourceChapterId) }));
  const world = (source.world || []).map((entry) => ({ ...entry, id: remap(entry.id), sourceChapterId: remap(entry.sourceChapterId) }));
  const timeline = (source.timeline || []).map((entry) => ({ ...entry, id: remap(entry.id), sourceChapterId: remap(entry.sourceChapterId) }));
  const memory = { ...created.memory };
  for (const name of ["locations", "items", "abilities", "foreshadowing"]) memory[name] = (source.memory?.[name] || []).map((entry) => ({ ...entry, id: remap(entry.id), sourceChapterId: remap(entry.sourceChapterId) }));
  return { ...created, title: source.title || created.title, idea: source.idea, protagonist: source.protagonist || "", genre: source.genre, style: source.style, bible: { ...created.bible, ...source.bible, id: created.bible.id }, outline: { master: source.outline?.master || "", volumes }, chapters, characters, world, timeline, memory };
}
