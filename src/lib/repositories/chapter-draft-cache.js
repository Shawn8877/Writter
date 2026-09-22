// Recovery data is local to the signed-in account and one document lifecycle.
// A copied browser tab gets a new writer, even if sessionStorage was copied.
const PREFIX = "novelai-studio:chapter-draft:v2:";
const WRITER_KEY = "novelai-studio:draft-writer:v2";
const FIELDS = ["title", "outline", "body", "summary"];
let writerId;
let previousWriterId;
const handledScopes = new Set();

function writer() {
  if (!writerId) {
    writerId = crypto.randomUUID();
    try {
      previousWriterId = window.sessionStorage.getItem(WRITER_KEY);
      window.sessionStorage.setItem(WRITER_KEY, writerId);
    } catch {
      // localStorage still provides explicit recovery if sessionStorage is off.
    }
  }
  return writerId;
}

function prefix(userId, novelId, chapterId) {
  if (!userId || !novelId || !chapterId) throw new Error("草稿缺少账号或章节信息。");
  return `${PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(novelId)}:${encodeURIComponent(chapterId)}:`;
}

function key(userId, novelId, chapterId) {
  return `${prefix(userId, novelId, chapterId)}${writer()}`;
}

function validContent(value) {
  return value && FIELDS.every((field) => typeof value[field] === "string");
}

function parse(raw, userId, novelId, chapterId) {
  try {
    const entry = JSON.parse(raw);
    return entry?.schema === 2 &&
      entry.userId === userId && entry.novelId === novelId &&
      entry.chapterId === chapterId && validContent(entry.content) &&
      typeof entry.snapshotId === "string" &&
      Number.isSafeInteger(entry.baseRevision) && entry.baseRevision >= 0
      ? entry : null;
  } catch {
    return null;
  }
}

export const chapterDraftCache = {
  read(userId, novelId, chapterId) {
    try {
      const own = parse(window.localStorage.getItem(key(userId, novelId, chapterId)), userId, novelId, chapterId);
      if (own) return own;
      const scope = prefix(userId, novelId, chapterId);
      if (handledScopes.has(scope)) return null;
      handledScopes.add(scope);
      // The previous document writer is only used for same-tab refresh recovery.
      if (previousWriterId) {
        return parse(window.localStorage.getItem(`${prefix(userId, novelId, chapterId)}${previousWriterId}`), userId, novelId, chapterId);
      }
    } catch { /* The editor reports write failures without dropping input. */ }
    return null;
  },

  write(userId, novelId, chapterId, content, baseRevision) {
    const entry = {
      schema: 2, userId, novelId, chapterId, writerId: writer(),
      snapshotId: crypto.randomUUID(), baseRevision,
      content: { ...content }, updatedAt: new Date().toISOString(),
    };
    try {
      if (!validContent(content) || !Number.isSafeInteger(baseRevision)) return null;
      window.localStorage.setItem(key(userId, novelId, chapterId), JSON.stringify(entry));
      handledScopes.add(prefix(userId, novelId, chapterId));
      return entry;
    } catch { return null; }
  },

  acknowledge(userId, novelId, chapterId, snapshotId, oldRevision, nextRevision) {
    try {
      const cacheKey = key(userId, novelId, chapterId);
      const current = parse(window.localStorage.getItem(cacheKey), userId, novelId, chapterId);
      if (!current) return;
      if (current.snapshotId === snapshotId) {
        window.localStorage.removeItem(cacheKey);
      } else if (current.baseRevision === oldRevision) {
        // A later keystroke must survive an earlier network response.
        window.localStorage.setItem(cacheKey, JSON.stringify({ ...current, baseRevision: nextRevision }));
      }
    } catch { /* A successful cloud save remains successful. */ }
  },

  remove(userId, novelId, chapterId) {
    try {
      handledScopes.add(prefix(userId, novelId, chapterId));
      window.localStorage.removeItem(key(userId, novelId, chapterId));
    }
    catch { /* Never clear another account's or another tab's recovery data. */ }
  },

  list(userId, novelId, chapterId) {
    try {
      const scope = prefix(userId, novelId, chapterId);
      const ownKey = key(userId, novelId, chapterId);
      const entries = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const cacheKey = window.localStorage.key(index);
        if (!cacheKey?.startsWith(scope) || cacheKey === ownKey) continue;
        const entry = parse(window.localStorage.getItem(cacheKey), userId, novelId, chapterId);
        if (entry) entries.push(entry);
      }
      return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch { return []; }
  },

  hasLegacy(novelId, chapterId) {
    try { return !!window.sessionStorage.getItem(`novelai-studio:chapter-draft:v1:${novelId}:${chapterId}`); }
    catch { return false; }
  },

  // Legacy records have no owner. Call only after the user explicitly imports.
  readLegacy(novelId, chapterId) {
    try {
      const content = JSON.parse(window.sessionStorage.getItem(`novelai-studio:chapter-draft:v1:${novelId}:${chapterId}`));
      return validContent(content) ? content : null;
    } catch { return null; }
  },
};
