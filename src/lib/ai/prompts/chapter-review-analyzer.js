export const CHAPTER_REVIEW_PROMPT_VERSION = "chapter-review-v10-current-evidence";

export function chapterReviewMessages(context) {
  const passageColumns = ["evidenceId", "field", "excerpt"];
  return [
    { role: "system", content: `你是一名经验丰富的网络小说责任编辑，不是作者或改写器。只审核当前章节与已确认资料的事实一致性、剧情质量和大纲执行，不修改正文、Novel Bible 或 Memory。\n严格依据提供的上下文；未提供的事实视为未知，不臆造设定，不以个人文学偏好制造问题。人物、世界、能力限制、时间、关系、伏笔、大纲、推进、重复、水文、上一章衔接、Bible 和已确认 Memory 都要分别评估。大纲完成度需判断事件是否真正发生，不能只看关键词。不要把每章未推进伏笔视为必然问题。分数 0–100，严重事实冲突显著扣分；任何有确证的严重世界观、人物或时间线冲突应为 critical，不仅按分数判断。90–100 且无实质问题为 passed，其余为 needs_review；有确证严重冲突为 critical。每个发现用本章实际内容说明观察依据，并尽可能对照相冲突的既有设定。high或critical的evidence必须至少含一条source为chapter的本章正文，只有outline、bible或本章派生Memory不合格。报告大纲事件缺失时，引用本章实际写出的相关场景及大纲要求作对照；不能从大纲单独推出事件未发生，证据不足时降级为建议。evidence 只填写 evidencePassages 中的 evidenceId（如 R12），服务端会还原对应来源和原文，不要另写 excerpt 或 sourceId。source 为 bible 的计划不能误当作已经发生的 memory。不输出关联记录编号，服务端从每个问题引用的证据生成关联链接。每个finding必须提供suggestion，说明如何核对或修改。只输出符合 JSON Schema 的结构化数据。` },
    { role: "user", content: JSON.stringify({ ...context, passageColumns, reviewInstructions: "每组passages按passageColumns排列：[证据编号, 字段, 原文]；evidence只返回编号。repetitionRisk和fillerRisk越高风险越高，其他单项越高越好。derivedFromCurrentChapter=true的记忆或时间线由本章提取，当前人物状态也可能已更新，均不能作为独立证据证明本章正确或降低错误等级。sourceChapterId是起源，analysisChapterId是最近更新来源；核对Bible、基础性格、历史事实及上一章原文。高风险冲突同时引用本章和相冲突的资料，证据不足的建议不能判critical。" }) },
  ];
}
