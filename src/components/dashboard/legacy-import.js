"use client";
import { useState } from "react";
import { Upload } from "lucide-react";
import { Modal } from "@/components/ui";
import { useStudio } from "@/components/studio-provider";
import { readLegacyNovels, prepareLegacyImport } from "@/lib/repositories/legacy-import";

export function LegacyImport() {
  const { user, addNovel, updateNovel, notify } = useStudio();
  const [records, setRecords] = useState(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  function open() {
    try { const novels = readLegacyNovels(); setRecords(novels); setSelected(novels[0]?.id || ""); }
    catch (error) { notify(error.message, "error"); }
  }
  async function importNovel() {
    const source = records.find((record) => record.id === selected);
    if (!source || busy) return;
    setBusy(true);
    let created;
    try {
      created = await addNovel({ ...source, title: `${source.title}（导入）`, protagonist: source.protagonist || "" });
      await updateNovel(created.id, () => prepareLegacyImport(source, created));
      notify("已导入云端，原来的本地数据仍完整保留。", "success"); setRecords(null);
    } catch (error) {
      notify(created ? `导入内容失败，原数据仍保留。云端已创建空白作品「${created.title}」，请核对后删除再重试。${error.message}` : error.message, "error");
    } finally { setBusy(false); }
  }
  return <><button className="button button-ghost button-small" onClick={open}><Upload size={14} />导入本地作品</button>{records && <Modal title="导入第一阶段的本地作品" onClose={() => { if (!busy) setRecords(null); }}><p className="migration-notice">选中的作品将复制到账号 {user?.email}。请确认这是你自己的作品。原始数据不会被清除；重复导入会创建副本。</p><div className="import-list">{records.length ? records.map((record) => <label key={record.id}><input type="radio" name="legacy" value={record.id} checked={selected === record.id} onChange={() => setSelected(record.id)} disabled={busy} /><span>{record.title}<small>{record.isDemo ? "第一阶段示例" : "本地创作"} · {record.chapters?.length || 0} 章</small></span></label>) : <p className="migration-notice">当前浏览器与站点来源下没有找到旧版作品。其他浏览器或 localhost 来源下的数据不会自动出现在这里。</p>}</div><div className="modal-actions"><button className="button button-ghost" onClick={() => setRecords(null)} disabled={busy}>取消</button><button className="button button-primary" onClick={importNovel} disabled={!selected || busy}>{busy ? "正在导入…" : "确认导入当前账号"}</button></div></Modal>}</>;
}
