# Phase 3C_1 — AI 章节自动记忆更新

实施日期：2026-10-13 至 2026-10-14。沿用 JavaScript、Next.js 16.4、Supabase、DeepSeek 和现有三栏 UI。只实现保存后分析与连续性资料更新，没有自动下一章、批量生成、润色改写、RAG、Embedding、Agent 或付费系统。

## 使用流程与失败边界

1. 在空白章节点击“生成本章”，审阅预览，再点击“确认保存正文”。
2. 原有事务提交正文与 `ai_generated` 版本，同时建立 pending 分析任务。
3. 确认请求立即返回；服务端使用 Next `after()` 继续分析，页面显示“正文已保存 · 正在分析章节…”。本章正文仍可阅读。
4. 成功后显示“记忆已更新”，刷新摘要、人物、记忆和时间线。章节摘要页展示摘要及下一章连续性要求。
5. 失败显示“正文已保存，记忆更新失败，请稍后重试”，点击“重试记忆更新”只分析已保存正文，不重新生成正文或版本。
6. 已成功分析后修改正文会显示“正文已修改，请人工核对记忆后继续”。修正受影响的摘要、人物、时间线和事实后，勾选确认，状态变为“记忆已人工核对”，允许继续创作；不收费、不自动撤回旧事实，也不把人工确认伪装成 AI 分析成功。

页面关闭不撤销已经开始的服务端分析。进程退出、部署超时或断网可能中断后台回调；任务持久化保留，pending/running 超过 5 分钟会显示可重试状态，不自动再次收费。该实现尚不是常驻任务队列，部署平台必须支持 Next `after()`，并允许最长 300 秒执行。

分析失败绝不调用删除正文或版本。记忆写入失败会回滚本次所有记忆/人物/时间线/摘要变化，再单独记录失败。分析期间正文或小说资料 revision 变化时拒绝旧结果，保留作者修改。已有成功分析或后续章节记忆时，不对改写的旧章执行只追加的重算；需人工核对后明确确认，避免保留已被正文撤销的事实或倒退人物状态。

## 文件与接口

| 文件 | 职责 |
| --- | --- |
| `src/lib/ai/services/chapter-memory-service.js` | DeepSeek 调用、分析生命周期、安全日志和状态读取 |
| `src/lib/ai/services/chapter-memory-mapper.js` | 正文证据验证、人物引用、去重、状态合并及写入白名单 |
| `src/lib/ai/schemas/chapter-memory-schema.js` | JSON Schema 和 Zod 字段校验 |
| `src/lib/ai/prompts/chapter-memory-analyzer.js` | 只提取本章明确事实的编辑提示词 |
| `src/lib/ai/context/chapter-memory-context-builder.js` | 当前章、Bible、人物及已有记忆上下文 |
| `src/app/api/ai/chapters/memory/route.js` | GET 状态；POST 明确重试 |
| `src/components/novel/chapter-memory-status.js` | 独立状态轮询、错误提示和重试 |
| `supabase/migrations/005_chapter_memory_analysis.sql` | 分析任务、状态、摘要字段及原子更新 RPC |
| `supabase/migrations/006_chapter_memory_version_source.sql` | 人工修改正文后不再引用不匹配的旧 AI 版本 |
| `supabase/migrations/007_chapter_memory_timeline_fallback.sql` | 从已验证的关键事件补齐缺失的时间线投影 |
| `supabase/migrations/008_chapter_memory_manual_review.sql` | 修改已分析正文后的人工核对、版本校验及恢复入口 |

`confirm` API 沿用受保护的生成预览确定小说与章节，不相信浏览器上传的正文。memory API 状态/重试接收 novelId/chapterId，人工核对另接收 action=acknowledge 与 expectedRevision；验证登录、同源 JSON、UUID 和 4 KB 大小，不接受模型输出、所有者、密钥或可指定的模型。

## Structured Output 与事实检查

实际接口为 DeepSeek `POST /responses`，`text.format.type=json_schema`，`name=chapter_memory_analysis`、`strict=true`；使用 Zod 生成的包含 `additionalProperties:false` 的 JSON Schema，没有自由文本 JSON 提示作为降级方案。官方参数说明：[DeepSeek Responses](https://api-docs.deepseek.com/api/create-response/)。

包含 chapterSummary、keyEvents、characterChanges、newCharacters、relationshipChanges、newFacts、worldUpdates、timelineEvents、abilityChanges、items、foreshadowingAdded、foreshadowingResolved、nextChapterRequirements。摘要限制 100–300 字符；数组、每项长度和重要度均有上限。其余每个提取条目必须有来自本章正文的连续 evidence；服务器忽略排版空白后检查原文存在。未知人物/记忆引用、跨小说引用、缺失字段、类型错误、超长输出或缺少证据会拒绝整次更新。

真实提供方可能附加 schema 外的注释字段。服务器对输出做白名单投影，丢弃额外字段，再执行已知字段和引用校验；额外的姓名、年龄等字段不能改变人物基础资料。结构及逐字证据并不证明全部语义正确，作者仍需审阅摘要与事实是否准确对应原文。

分析上下文只包含当前章完整正文/标题/大纲、Bible、人物、现有记忆，不包含整本正文。最多 80 名人物、300 条记忆、180 KB；超限明确报错，不静默截断正文。记忆包含已回收条目以避免重新激活。16000 输出 tokens、240 秒请求超时、SDK 自动重试关闭。

## 数据库与去重

005–008 是新增迁移，001–004 不改。已通过本地 SQL/RLS 验证后使用 CLI 迁移文件应用到既有 Supabase 项目，没有手工改线上表。新增 `chapter_memory_jobs`；全部 15 张业务表开启 RLS。应用只使用公开 key 与当前用户会话，无 service role key。

- `chapter_summaries`：按 chapter_id 更新摘要、关键事件、人物变化、新信息、伏笔及下一章要求；保存分析内容 hash 和版本来源。
- `memory_items`：事实的 source_type=chapter、source_id=当前章节；重要程度 1–5，新增状态 active。相同类型按已有 ID、规范化标题、相似内容及同一主体描述去重。更新保留旧事实并合并新增限制/代价，metadata 保留有限来源历史。
- `characters`：新人物只填正文中有依据的姓名、身份和简介。既有人物只更新 current_state、relationships、abilities、is_alive 和最近变化，不覆盖姓名、年龄、背景或基础人设。状态字段未确认时为 null，保留已有值。
- `timeline_events`：关联当前章节，记录 title/description/importance/event_time；没有明确时间时为空。重试按本章及标题更新。
- 伏笔新增为 memory_type=foreshadowing；回收必须引用已有伏笔，更新为 resolved，保留原记录、回收章节和证据，不直接删除。

模型有时返回非空 keyEvents、空 timelineEvents。007 在当前章没有时间线记录时，从已经通过原文证据验证的 keyEvents 生成事件，event_time 为空；不新增一次模型调用，不推断日期。006 在正文变化时清空 version_id，避免把手工改写后的分析归到原 AI 版本。世界观“伏笔”标签页兼容旧文字回收记录与新结构化记录，编辑展示文字时保留原始证据和来源。

正文内容 hash 相同且已成功时直接返回，重复确认和重复分析不再调用 AI。有效 running 租约阻止并发付费调用；分析完成时检查小说/章节 revision 和内容 hash，整批原子提交。日志 generation_type=chapter_memory_analysis，记录模型、tokens、status、latency、provider request ID 和安全错误码，不保存密钥、完整提示词或正文。

008 补充 needs_review/reviewed 状态：本章曾成功分析但正文修改后，不能简单追加新事实，否则被删掉的旧事实还会存在。已有后续成功记忆的旧章也转入人工核对，避免永久阻塞。POST `{action:"acknowledge",expectedRevision}` 校验所有者、章节版本和待核对状态；记录人工核对时间/版本，保留旧分析来源，撤销可能残留的旧运行租约。确认按钮必须先勾选已核对受影响资料；再次修改正文重新需要核对，空正文也可处理。对 reviewed 章节，下一章只读取作者当前手动摘要，排除旧 keyEvents、人物变化、自动下一章要求等结构化投影；作者负责核对长期事实与人物状态。后续自动回撤/重放不在本阶段。

手动摘要只有实际发生变化才同步，普通正文自动保存不会清空 AI 摘要。分析仅更新 chapter_summaries，不修改 chapters.content 或正文 revision，避免后台摘要更新让正在阅读/编辑的正文产生无意义冲突。

## 下一章上下文

Writer 沿用 Bible、章纲、卷纲、世界、上一章全文和最近 5 章摘要；现在优先读取 importance=5/4、最近更新的最多 80 条 active 记忆、最新人物状态、另行查询的最多 40 条未回收伏笔以及上一章 next_chapter_requirements。小说内其他章节任务未完成、失败或因修改而失效时，先提示处理记忆，不支付生成费用；检查不限于最近 5 章。总上下文仍限制在 180 KB，没有向量检索。

每账号同一时间只有一个 AI 任务，每小时最多 6 次，小说构建、正文生成、记忆分析共用；失败也计入。一次正常章节闭环通常占两次调用。测试不会修改或清空线上限额记录。

## 验收方式与证据

```bash
npm run test:db
npm run test:repository
npm run test:ai
npm run test:chapters
npm run test:memory
npm run test:browser:memory
npm run lint
npm run build
npm run test:security
```

浏览器需要 Playwright + Chrome；可用 PLAYWRIGHT_MODULE 指向已有模块。默认 memory 浏览器验收使用隔离 Auth/模型样例和真实本地 SQL，不算真实 DeepSeek。显式真实验收：

```bash
npm run test:browser:memory -- --real-ai-cloud --allow-cloud-test-writes
```

仅使用 `.tools/cloud-test-accounts.json` 中已授权的独立 A/B 测试账号；创建新的测试小说，通常调用 2 次正文、2 次分析。`--actor-b` 交换测试所有者/隔离账号；每个账号仍遵守原有限额。`--resume artifacts/phase3c1/browser-real-…` 可恢复已有测试，已保存正文不会再次生成；失败分析通过页面重试。证据文件只在被 Git 忽略的 artifacts 下。

### 本次检查结果（2026-10-14）

| 检查 | 结果 | 本地证据 |
| --- | --- | --- |
| SQL / RLS / Repository | 通过；包括事务回滚、来源保护、版本并发和结构化伏笔记录的无损编辑 | `test:db`、`test:repository` |
| AI 小说构建单元 / SQL | 19 组通过 | `artifacts/phase3a/unit-database.json` |
| 章节生成单元 / SQL | 8 组通过 | `test:chapters` |
| 章节记忆单元 / SQL | 8 组通过；包含失败不丢正文、显式重试、去重、状态合并、时间线补齐、人工核对、租约和过时上下文 | `artifacts/phase3c1/unit-results.json` |
| 真实云端双账号 SDK | 9 组通过 | `artifacts/phase2.5/cloud-2026-10-14T01-00-45-444Z-c422e9b3.json` |
| 真实云端浏览器回归 | 14 组通过；登录、新环境、断网草稿、恢复、版本、Memory、全部路由和 RLS | `artifacts/phase2.5/browser-2026-10-14T01-03-48-797Z/results.json` |
| AI 构建浏览器（模型样例） | 11 组通过 | `artifacts/phase3a/browser-fixture-2026-10-14T01-20-46-378Z/results.json` |
| 章节生成浏览器（模型样例） | 6 组通过 | `artifacts/phase3c0/browser-fixture-2026-10-14T01-19-05-679Z/results.json` |
| 章节记忆浏览器（模型样例） | 8 组通过；包含全部世界观标签页、已回收伏笔及人工核对完整流程 | `artifacts/phase3c1/browser-fixture-2026-10-14T06-39-12-354Z/results.json` |
| 真实 DeepSeek 两章闭环 | 7 组通过；含失败恢复后复核，不代表首轮全部成功 | `artifacts/phase3c1/browser-real-2026-10-13T01-34-04-421Z/results.json` |
| 真实网页重试 | 通过，Next `after()` 后台执行，正文/版本不变 | `artifacts/phase3c1/real-ui-retry.json` |
| 真实云端人工核对 | 正式构建通过；修改测试章后恢复原文并核对摘要，刷新保留 reviewed、原版本数量不变、没有新 AI 调用 | `artifacts/phase3c1/cloud-manual-review.json` |
| `npm run lint` | 通过，无 ESLint 错误或警告 | 2026-10-14 最终运行 |
| `npm run build` | 通过，包含新增 memory API 和全部原有路由 | Next 16.4 正式构建 |
| 密钥检查 | 通过，157 个源码文件、29 个前端产物，无实际密钥或测试密码 | `artifacts/phase2.5/security.json` |

构建首次在 Windows 沙箱因路径访问限制失败，使用获准的沙箱外执行后通过；不是隐藏代码构建错误。浏览器记录没有非预期 console error、React/hydration warning、前端直连模型或 HTTP 错误；测试主动制造的离线、401/404、模型失败均单独处理。

### 两章真实数据与人工核对

测试小说 ID：`81572725-7d7c-4c02-8401-02a03cddb5fb`，只属于独立 B 测试账号。两章 ID：`e5f18cad-8a4c-49d7-82f3-5405dc059ad6`、`74998975-c274-4268-8e87-e6a00e012e7c`。

- 两章正文分别 1828、1937 字；每章保留且仅有 1 条 `ai_generated` 版本。
- 两条摘要分别 204、190 字；下一章约束分别 5、4 条。
- 当前 23 条事实记忆、3 名人物、8 条时间线记录；能力记忆仍只有 1 条。
- 第一章确立预见最多二十四小时、越界无画面且流鼻血、停止使用并休息的状态。
- 第二章实际输入摘要为 `6ede8b150e5703d4ad3496f152c875dc65603f7b07c5c41b90871ada4f822f4f`，与服务器 `chapter_generation` 日志完全相同。输入包含第一章新能力记忆、人物状态、摘要、未回收伏笔和下一章要求，不是只检查 UI 文案。
- 人工通读第二章：从鼻血后休息衔接，许青仍在档案馆电话联系，林舟没有再次使用能力，未预见一年后的事情。第二章没有重复写“24小时”字样，因此验收检查实际行为和输入约束，不用关键词缺失误判。
- 铜钥匙记录复用原 ID 更新；“钥匙对应何处”伏笔在第二章标记 resolved，并保留第一章来源与第二章回收证据。人物基础年龄 26、背景“普通修表师”未被覆盖。

真实成功调用均为 `deepseek-flash`：

| 调用 | 输入 tokens | 输出 tokens | 总耗时 ms |
| --- | ---: | ---: | ---: |
| 第一章正文 | 1193 | 1444 | 12567 |
| 第一章记忆（重试成功） | 5155 | 4484 | 29423 |
| 第二章正文 | 6587 | 1728 | 14148 |
| 第二章记忆（重试成功） | 8769 | 7660 | 47392 |

### 真实失败记录与限制

没有把失败尝试删除或改成成功。首个独立样本完成了确认保存后的自动分析，但正文未落实 24 小时边界，未通过内容验收；之后加强章纲及 Writer 提示。另一次模型附加字段被旧严格接收校验拒绝，已改为已知字段白名单投影，同时保留完整结构、长度、引用及证据校验。主验收小说两章的首次分析均记录 `INVALID_AI_OUTPUT`，正文和版本保留；通过同一生产分析服务真实重试成功，再用网页复核全链路。独立 A 样本又通过真实网页重试确认 Next 后台执行可用。

早期失败原始模型返回没有留存，无法断言这些 `INVALID_AI_OUTPUT` 都有同一根因；新增安全诊断区分空输出、超大输出、JSON 语法与 schema/证据路径，生产日志仍不记录正文或密钥。当前原生 JSON Schema 请求并不保证每次返回都能通过应用校验；需要明确重试，不自动增加费用。

当前不是“正文质量无误”的证明：第二章把大纲中的储物柜写成铁盒，生成了章纲未授权的历史日期；1937 字略超 1600 字目标的 20% 上界，预览提供原有字数警告。能力一年期越界未出现，但作者仍须审阅剧情和记忆语义。分析系统以已确认保存的正文为事实来源，不擅自改写正文以掩盖偏差。

去重使用 ID、标题和字符相似度，不是语义检索；低相似度同义事实仍可能漏合并，相近事实也需要人工核对。追加事实保留历史，不能自动裁决互相矛盾的设定；已分析正文改写需人工核对后明确确认。当前容量上限、每小时调用配额、完整聚合读取和 `after()` 非常驻队列限制仍在，不能据此宣称已支持稳定百万字自动连写。

### 迁移校验

已向既有测试 Supabase 应用以下文件，未修改 001–004：

| 文件 | SHA-256 |
| --- | --- |
| 005 | `0553F6E998D24436308A6FDBB185A8EC3C059AF36FECCE9D6A6A8BEF033E6785` |
| 006 | `EA3DBD56EB146BF99217BC67BDBD5C7653E7D4A18EC7E082684A753C760024C7` |
| 007 | `34A56E9A494455DB373AE7869EB3AB266BA437EBA6F03F22819B83FA509A23D7` |
| 008 | `C621BE19AF63A3F4046E1CB4DA19C7124F4BE0B0AD682814A3658B831DB64E1B` |

### 变更文件与目录

```text
README.md
docs/
  ARCHITECTURE.md
  SUPABASE_SETUP.md
  PHASE_3C_1.md                     新增
package.json
src/
  app/api/ai/chapters/
    confirm/route.js
    memory/route.js                新增
  app/globals.css
  components/
    studio-provider.js
    novel/
      chapter-editor.js
      chapter-memory-status.js    新增
      characters-view.js
      memory-view.js
      world-view.js
  lib/
    ai/
      context/chapter-memory-context-builder.js  新增
      prompts/chapter-memory-analyzer.js         新增
      prompts/chapter-writer.js
      schemas/chapter-memory-schema.js           新增
      services/chapter-memory-service.js         新增
      services/chapter-memory-mapper.js          新增
      services/chapter-context.js
      services/chapter-workflow.js
    server/supabase-repository.js
supabase/migrations/
  005_chapter_memory_analysis.sql        新增
  006_chapter_memory_version_source.sql  新增
  007_chapter_memory_timeline_fallback.sql 新增
  008_chapter_memory_manual_review.sql    新增
scripts/
  test-chapter-memory.mjs                新增
  test-repository.mjs
  testing/
    browser-chapter-memory.mjs           新增
    chapter-memory-fixtures.mjs          新增
    browser-chapters.mjs
    supabase-fixture.mjs
```

未新增依赖，没有应用 TypeScript 源码。`.env.local`、本地测试凭证、诊断辅助脚本和 artifacts 均被 Git 忽略；业务代码没有诊断网络注入。提交标题按要求为 `Phase 3C_1: add AI chapter memory update system`。

本阶段验收结论：**READY FOR PHASE 3C_2**。正文生成 → 确认保存 → 自动分析（失败可明确重试）→ 记忆写入 → 下一章读取的闭环已通过；真实模型质量与重试限制见上文。下一阶段尚未开发。
