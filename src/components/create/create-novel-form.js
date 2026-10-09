"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  BookOpen,
  Users,
  Globe2,
  GitBranch,
  Check,
  Lightbulb,
  Save,
} from "lucide-react";
import {
  GENRES,
  STYLES,
  createNovelDraft,
  formatNumber,
  validateNovelInput,
} from "@/lib/domain/novel";
import { useStudio } from "@/components/studio-provider";
import { Field, LoadingState } from "@/components/ui";
import { useNovelBuilder } from "./use-novel-builder";
import { NovelPlanPreview } from "./novel-plan-preview";
import { BuilderError, BuilderStatus } from "./builder-status";

const initial = {
  genre: "玄幻",
  idea: "",
  style: "细腻沉浸",
  targetWords: "800000",
  targetChapters: "300",
  wordsPerChapter: "2700",
  protagonist: "",
  audience: "", pace: "", romanceLevel: "", darknessLevel: "", specialRequirements: "",
};

export function CreateNovelForm() {
  const { user, ready } = useStudio();
  if (!ready) return <LoadingState />;
  if (!user) return <main className="create-page page-container"><p>请登录后开始创作。</p><Link className="button button-primary" href="/login">前往登录</Link></main>;
  return <CreateNovelWorkspace key={user.id} />;
}
function CreateNovelWorkspace() {
  const router = useRouter();
  const { addNovel, notify, ready, refreshNovel } = useStudio();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const builder = useNovelBuilder();
  function change(key, value) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }
  function validate() {
    const result = validateNovelInput(values);
    setErrors(result);
    if (Object.keys(result).length) {
      document.getElementById(Object.keys(result)[0])?.focus();
      return false;
    }
    return true;
  }
  async function saveDraft() {
    if (!validate() || saving || builder.busy || !ready) return;
    setSaving(true);
    try {
      const novel = await addNovel(createNovelDraft(values));
      notify("小说已创建并保存到云端。现在可以进入工作台完善设定。", "success");
      router.push(`/novel/${novel.id}`);
    } catch (error) {
      notify(error.message, "error");
      setSaving(false);
    }
  }
  async function generate() {
    if (!validate() || saving || !ready || builder.busy) return;
    if (Number(values.targetChapters) < 8 || Number(values.targetChapters) > 2000 || Number(values.targetWords) < 1000 || Number(values.wordsPerChapter) < 100) {
      notify("AI 构建支持 8–2000 章、至少 1000 字，每章至少 100 字。手动创建不受此限制。", "error"); return;
    }
    await builder.generate({ genre: values.genre, premise: values.idea.trim(), style: values.style, protagonistHint: values.protagonist.trim(), targetWordCount: Number(values.targetWords), targetChapterCount: Number(values.targetChapters), chapterWordTarget: Number(values.wordsPerChapter), audience: values.audience, pace: values.pace, romanceLevel: values.romanceLevel, darknessLevel: values.darknessLevel, specialRequirements: values.specialRequirements });
  }
  async function confirm() {
    const id = await builder.confirm();
    if (!id) return;
    try { await refreshNovel(id); router.push(`/novel/${id}`); }
    catch { notify("小说已保存。工作台暂未加载，请点击进入工作台重试。", "info"); }
  }
  const expectedWords =
    Number(values.targetChapters) * Number(values.wordsPerChapter);
  return (
    <main className="create-page page-container">
      <Link className="back-link" href="/dashboard">
        <ArrowLeft size={15} />
        返回我的作品
      </Link>
      {builder.preview ? <NovelPlanPreview builder={builder} onConfirm={confirm} /> : <>
      <div className="create-heading">
        <span className="section-kicker">
          EVERY GREAT STORY STARTS WITH AN IDEA
        </span>
        <h1>给灵感，一个开始。</h1>
        <p>告诉我们你想写什么，让一个模糊的念头，成为完整的小说世界。</p>
      </div>
      <div className="create-layout">
        <form
          className="create-form panel"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <fieldset className="builder-fieldset" disabled={saving || builder.busy}>
          <div className="form-section-title">
            <span>01</span>
            <h2>故事的种子</h2>
            <small>定义你的故事方向</small>
          </div>
          <Field label="小说类型" htmlFor="genre" error={errors.genre}>
            <div className="genre-grid" role="group" aria-label="小说类型">
              {GENRES.map((genre) => (
                <button
                  type="button"
                  key={genre}
                  id={genre === values.genre ? "genre" : undefined}
                  className={
                    values.genre === genre
                      ? "genre-option selected"
                      : "genre-option"
                  }
                  aria-pressed={values.genre === genre}
                  onClick={() => change("genre", genre)}
                >
                  {genre}
                  {values.genre === genre && <Check size={12} />}
                </button>
              ))}
            </div>
          </Field>
          <Field
            label={
              <>
                一句话创意 <span className="required">*</span>
              </>
            }
            htmlFor="idea"
            error={errors.idea}
          >
            <textarea
              id="idea"
              rows={4}
              maxLength={500}
              required
              placeholder="例如：在失去星辰的永夜世界，一个修补旧物的少年，捡到了最后一颗活着的星星。"
              value={values.idea}
              onChange={(event) => change("idea", event.target.value)}
              aria-invalid={Boolean(errors.idea)}
            />
            <div className="input-counter">{values.idea.length} / 500</div>
          </Field>
          <Field label="写作风格" htmlFor="style" error={errors.style}>
            <select
              id="style"
              value={values.style}
              onChange={(event) => change("style", event.target.value)}
            >
              {STYLES.map((style) => (
                <option key={style}>{style}</option>
              ))}
            </select>
          </Field>
          <div className="form-section-title separated">
            <span>02</span>
            <h2>故事的轮廓</h2>
            <small>为长篇创作设定节奏</small>
          </div>
          <div className="form-number-grid">
            {[
              ["targetWords", "目标字数", "字", 10000000],
              ["targetChapters", "目标章节数", "章", 10000],
              ["wordsPerChapter", "单章字数", "字", 50000],
            ].map(([key, label, unit, max]) => (
              <Field key={key} label={label} htmlFor={key} error={errors[key]}>
                <div className="unit-input">
                  <input
                    id={key}
                    type="number"
                    min="1"
                    max={max}
                    step="1"
                    required
                    value={values[key]}
                    onChange={(event) => change(key, event.target.value)}
                    aria-invalid={Boolean(errors[key])}
                  />
                  <span>{unit}</span>
                </div>
              </Field>
            ))}
          </div>
          {expectedWords > 0 &&
            expectedWords !== Number(values.targetWords) && (
              <p className="calculation-note">
                <Lightbulb size={14} />
                按当前章节规划，预计约 {formatNumber(expectedWords)}{" "}
                字。可与目标字数略有差异。
              </p>
            )}
          <Field
            label="主角简单描述"
            htmlFor="protagonist"
            hint="可选。身份、性格、目标，或者一个与众不同的秘密。"
          >
            <textarea
              id="protagonist"
              rows={3}
              maxLength={1000}
              placeholder="你心中的主角是什么样的人？"
              value={values.protagonist}
              onChange={(event) => change("protagonist", event.target.value)}
            />
          </Field>
          <details className="builder-options">
            <summary>更多创作偏好（可选）</summary>
            <div className="builder-options-grid">{[["audience", "目标读者", "例如：喜欢职场成长的成年读者"], ["pace", "故事节奏", "例如：快节奏，冲突层层递进"], ["romanceLevel", "感情线比重", "例如：无感情线 / 单线慢热"], ["darknessLevel", "故事氛围", "例如：温暖、写实、有希望"]].map(([key, label, placeholder]) => <Field key={key} label={label} htmlFor={key}><input id={key} value={values[key]} maxLength={100} placeholder={placeholder} onChange={(event) => change(key, event.target.value)} /></Field>)}</div>
            <Field label="特殊要求" htmlFor="specialRequirements"><textarea id="specialRequirements" rows={3} value={values.specialRequirements} maxLength={1500} placeholder="例如：没有超能力，主角靠专业知识与团队成长。" onChange={(event) => change("specialRequirements", event.target.value)} /></Field>
          </details>
          <div className="form-actions">
            <button
              type="button"
              className="button button-ghost"
              disabled={!ready || saving || builder.busy}
              onClick={saveDraft}
            >
              <Save size={16} />
              创建小说
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={!ready || saving || builder.busy}
            >
              <Sparkles size={17} />
              {builder.busy ? "正在构建…" : "AI 构建小说"} <ArrowRight size={17} />
            </button>
          </div>
          <p className="form-disclaimer">
            AI 先生成可修改的完整方案，由你确认后保存。也可以直接创建小说，手动完善设定。
          </p>
          </fieldset>
          <BuilderError error={builder.error} />
          {builder.status === "generating" && <BuilderStatus />}
        </form>
        <aside className="create-aside">
          <div className="idea-note">
            <div className="idea-note-icon">
              <Sparkles size={24} strokeWidth={1.4} />
            </div>
            <span className="section-kicker">YOUR STORY, EXPANDED</span>
            <h2>
              一个想法，
              <br />
              不止一种可能。
            </h2>
            <p>AI 从你的灵感出发，构建这些故事基石。</p>
            <div className="generation-list">
              {[
                [BookOpen, "小说身份", "书名 · 简介 · 故事风格"],
                [Users, "鲜活人物", "主角 · 重要人物 · 主要反派"],
                [Globe2, "完整世界", "世界观 · 能力体系"],
                [GitBranch, "故事脉络", "核心冲突 · 主线 · 感情线"],
              ].map(([Icon, title, detail]) => (
                <div key={title}>
                  <Icon size={18} />
                  <span>
                    <strong>{title}</strong>
                    <small>{detail}</small>
                  </span>
                </div>
              ))}
            </div>
            <div className="aside-footnote">
              好的故事不必在开始时就完整。
              <br />
              先种下一颗种子，再让它慢慢生长。
            </div>
          </div>
          <div className="local-note">AI 方案经你确认后才保存到云端账号。</div>
        </aside>
      </div>
      </>}
    </main>
  );
}
