"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { X, CheckCircle2, Info } from "lucide-react";
import { authRepository } from "@/lib/repositories/auth-repository";
import { cloudNovelRepository } from "@/lib/repositories/cloud-novel-repository";

const StudioContext = createContext(null);

export function StudioProvider({ children }) {
  const [novels, setNovels] = useState([]);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(null);
  const [toast, setToast] = useState(null);
  const currentNovels = useRef([]);
  const identity = useRef(null);
  const epoch = useRef(0);
  const timer = useRef(null);
  const notify = useCallback((message, type = "info") => {
    clearTimeout(timer.current);
    setToast({ message, type });
    timer.current = setTimeout(() => setToast(null), 6500);
  }, []);
  const publish = useCallback((next) => { currentNovels.current = next; setNovels(next); }, []);
  const mergeNovel = useCallback((novel) => {
    if (!identity.current || novel.userId !== identity.current) return;
    const existing = currentNovels.current.find((item) => item.id === novel.id);
    if (existing && existing.revision > novel.revision) return;
    publish(existing ? currentNovels.current.map((item) => item.id === novel.id ? novel : item) : [novel, ...currentNovels.current]);
  }, [publish]);
  const refreshNovels = useCallback(async () => {
    const account = identity.current;
    const generation = epoch.current;
    if (!account) return [];
    const records = await cloudNovelRepository.list();
    if (generation !== epoch.current || account !== identity.current) return [];
    publish(records.map((record) => {
      const local = currentNovels.current.find((item) => item.id === record.id);
      return local && local.revision > record.revision ? local : record;
    }));
    setStorageError(null);
    return records;
  }, [publish]);
  useEffect(() => {
    let alive = true;
    let initialized = false;
    let authEvent = 0;
    async function sync(nextUser) {
      if (!alive) return;
      if (initialized && identity.current === (nextUser?.id || null)) { setUser(nextUser); return; }
      initialized = true;
      epoch.current += 1;
      identity.current = nextUser?.id || null;
      setUser(nextUser); publish([]); setStorageError(null); setReady(!nextUser);
      if (!nextUser) return;
      const generation = epoch.current;
      try { await refreshNovels(); }
      catch (error) { if (alive && generation === epoch.current) setStorageError(error.message); }
      finally { if (alive && generation === epoch.current) setReady(true); }
    }
    const unsubscribe = authRepository.subscribe((nextUser) => {
      authEvent += 1;
      queueMicrotask(() => { void sync(nextUser); });
    });
    const initialEvent = authEvent;
    authRepository.getUser().then((nextUser) => { if (authEvent === initialEvent) void sync(nextUser); }).catch((error) => {
      if (alive && authEvent === initialEvent) { setStorageError(error.message); setReady(true); }
    });
    return () => { alive = false; epoch.current += 1; unsubscribe(); clearTimeout(timer.current); };
  }, [publish, refreshNovels]);

  const checkAccount = useCallback((account) => {
    if (!account || identity.current !== account) throw new Error("账号状态已变化，请重新登录后再保存。");
  }, []);
  const addNovel = useCallback(async (draft) => {
    const account = identity.current; checkAccount(account);
    const novel = await cloudNovelRepository.create(draft);
    checkAccount(account); mergeNovel(novel); return novel;
  }, [checkAccount, mergeNovel]);
  const updateNovel = useCallback(async (id, updater) => {
    const account = identity.current; checkAccount(account);
    const previous = currentNovels.current.find((novel) => novel.id === id);
    if (!previous) throw new Error("小说尚未加载，请刷新后重试。");
    const next = await cloudNovelRepository.update(previous, updater(previous));
    checkAccount(account); mergeNovel(next); return next;
  }, [checkAccount, mergeNovel]);
  const removeNovel = useCallback(async (id) => {
    const account = identity.current; checkAccount(account);
    const current = currentNovels.current.find((novel) => novel.id === id);
    if (!current) throw new Error("小说已不存在。");
    await cloudNovelRepository.remove(id, current.revision);
    checkAccount(account); publish(currentNovels.current.filter((novel) => novel.id !== id));
  }, [checkAccount, publish]);
  const refreshNovel = useCallback(async (id) => {
    const account = identity.current; checkAccount(account);
    const novel = await cloudNovelRepository.get(id);
    checkAccount(account); mergeNovel(novel); return novel;
  }, [checkAccount, mergeNovel]);
  const acceptChapter = useCallback((novelId, chapter) => {
    const novel = currentNovels.current.find((item) => item.id === novelId && item.userId === identity.current);
    if (!novel) return;
    const old = novel.chapters.find((item) => item.id === chapter.id);
    if (!old || old.revision > chapter.revision) return;
    const chapters = novel.chapters.map((item) => item.id === chapter.id ? chapter : item);
    const summaries = novel.memory.chapterSummaries.filter((item) => item.chapterId !== chapter.id);
    if (chapter.summary) summaries.push({ chapterId: chapter.id, sourceChapterId: chapter.id, summary: chapter.summary });
    publish(currentNovels.current.map((item) => item.id !== novelId ? item : {
      // Only a complete aggregate response can advance the novel revision.
      // Otherwise a concurrent metadata edit could be silently overwritten.
      ...novel, chapters, updatedAt: chapter.updatedAt,
      stats: { chapterCount: chapters.length, wordCount: chapters.reduce((sum, item) => sum + item.wordCount, 0) },
      memory: { ...novel.memory, chapterSummaries: summaries },
    }));
    void refreshNovel(novelId).catch(() => {
      // The chapter is durable. Keeping the older aggregate revision makes any
      // later metadata save fail safely until the full novel can be refreshed.
    });
  }, [publish, refreshNovel]);

  return <StudioContext.Provider value={{ novels, user, ready, storageError, notify, addNovel, updateNovel, removeNovel, refreshNovels, refreshNovel, acceptChapter }}>
    {children}
    {toast && <div className={`toast toast-${toast.type}`} role={toast.type === "error" ? "alert" : "status"}>{toast.type === "success" ? <CheckCircle2 size={19} /> : <Info size={19} />}<span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="关闭提示"><X size={16} /></button></div>}
  </StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used within StudioProvider");
  return context;
}
