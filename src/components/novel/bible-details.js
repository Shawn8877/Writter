"use client";

const fields = [["corePremise", "核心设定"], ["worldRules", "世界规则"], ["storyTone", "故事基调"], ["writingStyle", "写作风格"], ["protagonistArc", "主角成长"], ["powerSystem", "能力体系"], ["endingDirection", "结局方向"], ["forbiddenChanges", "不可随意改变的设定"]];
function Value({ value }) {
  if (Array.isArray(value)) return <ul className="builder-facts-list">{value.map((item, index) => <li key={index}><Value value={item} /></li>)}</ul>;
  if (value && typeof value === "object") return <>{Object.values(value).map((item, index) => <Value key={index} value={item} />)}</>;
  return <p>{value || "尚未设定"}</p>;
}
export function BibleDetails({ bible, metadata }) {
  return <details className="builder-section panel"><summary>完整核心设定与创作约束</summary><div className="builder-section-content"><dl className="builder-facts">{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd><Value value={bible[key]} /></dd></div>)}</dl>{metadata?.schemaVersion && <><h3>创作定位</h3><dl className="builder-facts">{[["alternativeTitles", "备选书名"], ["shortPitch", "一句话卖点"], ["subgenres", "细分题材"], ["targetAudience", "目标读者"], ["coreSellingPoints", "核心卖点"], ["storyThemes", "故事主题"]].map(([key, label]) => <div key={key}><dt>{label}</dt><dd><Value value={metadata[key]} /></dd></div>)}</dl></>}</div></details>;
}
