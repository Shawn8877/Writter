import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  Check,
  BookOpen,
  Feather,
  Network,
  Layers3,
  WandSparkles,
  CircleDot,
  ChevronRight,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Brand } from "@/components/brand";

const steps = [
  {
    icon: Sparkles,
    title: "捕捉灵感",
    detail: "一个题材，一句话，故事由此开始。",
  },
  {
    icon: Network,
    title: "构建世界",
    detail: "人物、世界观与规则，环环相扣。",
  },
  {
    icon: Layers3,
    title: "铺陈故事",
    detail: "从全书主线，到每一章的起承转合。",
  },
  {
    icon: Feather,
    title: "落笔成章",
    detail: "续写、扩写、润色，让故事不断生长。",
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="home-hero page-container">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="tiny-star">✦</span> 为长篇叙事而生的 AI 创作空间
            </div>
            <h1>
              一个想法，
              <br />
              写出<span className="gold-text">一个世界。</span>
            </h1>
            <p className="hero-description">
              从故事设定、人物、大纲到百万字正文，
              <br className="desktop-break" />让 AI 帮你完成网络小说创作。
            </p>
            <div className="hero-actions">
              <Link href="/create" className="button button-primary">
                开始创作 <ArrowRight size={18} />
              </Link>
              <Link href="/dashboard" className="button button-ghost">
                查看作品 <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="hero-note">
              <span>
                <Check size={14} /> 从灵感到长篇
              </span>
              <span>
                <Check size={14} /> 让每条伏笔有回响
              </span>
            </div>
          </div>
          <div className="hero-visual" aria-label="小说创作工作台预览">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="floating-tag floating-tag-top">
              <span className="status-dot" />
              <span>世界观已建立</span>
              <span className="tag-code">WORLD</span>
            </div>
            <div className="hero-manuscript">
              <div className="manuscript-top">
                <span>
                  <BookOpen size={14} /> 故事正在生长
                </span>
                <span>01 / ∞</span>
              </div>
              <div
                className="manuscript-art"
                style={{
                  backgroundImage:
                    "linear-gradient(#14201b33, #14201bc9), url('/story-world.png')",
                  backgroundSize: "cover",
                  backgroundPosition: "center 54%",
                }}
              >
                <div className="art-label">THE LAST STARKEEPER</div>
                <div className="art-title">长夜拾星人</div>
                <div className="art-bottom">
                  在被遗忘的世界，点亮最后一颗星。
                </div>
              </div>
              <div className="manuscript-excerpt">
                <div className="section-kicker">第一章 · 坠落的星光</div>
                <p>
                  长夜降临的第七百年，沈砚在旧城的废墟里，捡到了一颗还在呼吸的星星。
                </p>
                <div className="writing-cursor">
                  <span />
                  <span />
                  <span />
                  <span className="cursor" />
                </div>
              </div>
              <div className="manuscript-footer">
                <span>
                  <CircleDot size={12} /> 创作工作台预览
                </span>
                <span>玄幻 · 东方幻想</span>
              </div>
            </div>
            <div className="floating-tag floating-tag-bottom">
              <span className="mini-icon">
                <Network size={18} />
              </span>
              <div>
                <strong>让故事记得每个细节</strong>
                <small>人物 · 伏笔 · 时间线</small>
              </div>
              <Check size={15} className="gold-text" />
            </div>
            <div className="visual-caption">YOUR IMAGINATION, UNLIMITED.</div>
          </div>
        </section>
        <section id="workflow" className="workflow-section page-container">
          <div className="section-intro">
            <div>
              <span className="section-kicker">FROM SPARK TO STORY</span>
              <h2>让灵感，拥有完整的生命。</h2>
            </div>
            <p>你决定故事的方向，AI 陪你写完每一程。</p>
          </div>
          <div className="workflow-grid">
            {steps.map(({ icon: Icon, title, detail }, index) => (
              <div className="workflow-step" key={title}>
                <div className="step-top">
                  <Icon size={23} strokeWidth={1.4} />
                  <span>0{index + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{detail}</p>
                {index < 3 && (
                  <ChevronRight className="step-chevron" size={16} />
                )}
              </div>
            ))}
          </div>
        </section>
        <section id="memory" className="memory-section page-container">
          <div className="memory-intro">
            <span className="section-kicker">A WORLD THAT REMEMBERS</span>
            <h2>
              故事写得再远，
              <br />
              也不忘来时的伏笔。
            </h2>
            <p>
              以小说核心设定为起点，将人物、时间线与章节摘要连接起来。为持续创作长篇小说，建立有迹可循的记忆。
            </p>
            <Link href="/dashboard" className="text-link">
              探索创作空间 <ArrowRight size={16} />
            </Link>
          </div>
          <div className="memory-map">
            <div className="memory-core">
              <Sparkles size={24} />
              <strong>Novel Bible</strong>
              <span>小说核心设定</span>
            </div>
            <div className="memory-nodes">
              {[
                "人物与关系",
                "世界与地点",
                "能力与物品",
                "时间与事件",
                "伏笔与回收",
                "章节与摘要",
              ].map((text) => (
                <span key={text}>
                  <CircleDot size={13} />
                  {text}
                </span>
              ))}
            </div>
          </div>
        </section>
        <section className="home-cta page-container">
          <WandSparkles size={25} />
          <h2>你的下一个世界，从这里开始。</h2>
          <Link href="/create" className="button button-primary">
            写下第一个想法 <ArrowRight size={17} />
          </Link>
          <p>当前为创作界面预览 · AI 生成功能将在后续阶段接入</p>
        </section>
      </main>
      <footer className="site-footer page-container">
        <Brand />
        <span>把想象，写成无限可能。</span>
        <span>© 2026 NovelAI Studio</span>
      </footer>
    </>
  );
}
