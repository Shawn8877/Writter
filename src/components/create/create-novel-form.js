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
import { Field, Modal } from "@/components/ui";

const initial = {
  genre: "玄幻",
  idea: "",
  style: "细腻沉浸",
  targetWords: "800000",
  targetChapters: "300",
  wordsPerChapter: "2700",
  protagonist: "",
};

export function CreateNovelForm() {
  const router = useRouter();
  const { addNovel, notify, ready } = useStudio();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
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
    if (!validate() || saving || !ready) return;
    setSaving(true);
    try {
      const novel = await addNovel(createNovelDraft(values));
      notify("小说已创建并保存到云端。现在可以进入工作台完善设定。", "success");
      router.push(`/novel/${novel.id}`);
    } catch (error) {
      notify(error.message, "error");
      setSaving(false);
      setShowPreview(false);
    }
  }
  const expectedWords =
    Number(values.targetChapters) * Number(values.wordsPerChapter);
  return (
    <main className="create-page page-container">
      <Link className="back-link" href="/dashboard">
        <ArrowLeft size={15} />
        返回我的作品
      </Link>
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
            if (validate()) setShowPreview(true);
          }}
        >
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
          <div className="form-actions">
            <button
              type="button"
              className="button button-ghost"
              disabled={!ready || saving}
              onClick={saveDraft}
            >
              <Save size={16} />
              创建小说
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={!ready || saving}
            >
              <Sparkles size={17} />
              AI 构建小说 <ArrowRight size={17} />
            </button>
          </div>
          <p className="form-disclaimer">
            当前为界面预览，AI 构建尚未接入。你可以先创建小说。
          </p>
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
            <p>未来，AI 将从你的灵感出发，构建这些故事基石。</p>
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
          <div className="local-note">创意将保存到你的云端账号。</div>
        </aside>
      </div>
      {showPreview && (
        <Modal
          title="你的创意，已经准备好出发"
          onClose={() => setShowPreview(false)}
        >
          <div className="modal-callout">
            <Sparkles size={26} />
            <p>AI 构建小说尚未接入。</p>
            <span>
              当前不会自动生成书名、设定或正文。你可以将这份创意保存到你的云端账号，进入工作台继续完善。
            </span>
          </div>
          <div className="modal-actions">
            <button
              className="button button-ghost"
              onClick={() => setShowPreview(false)}
            >
              继续编辑
            </button>
            <button
              className="button button-primary"
              onClick={saveDraft}
              disabled={saving}
            >
              保存草稿并进入 <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
