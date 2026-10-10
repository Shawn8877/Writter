# Phase 3C_0 — DeepSeek 单章生成闭环

验收日期：2026-10-10（北京时间）。继续原有 JavaScript / Next.js / Supabase 项目，保留深色三栏 UI，只接通“生成本章”。开发前已阅读 README、ARCHITECTURE、PHASE_3A；项目没有 PHASE_3B.md，未假设该阶段已实现。

## 原因与范围

原按钮位于 `src/components/novel/chapter-editor.js`，使用 `src/components/ui.js` 的 `AiButton`；点击只弹“尚未接入 AI”，没有生成请求。之前接通的是创建页的小说设定构建，并未连接章节正文。

本次用独立 `ChapterGeneration` 替换该按钮。其他五个 AI 操作仍保留占位。没有自动下一章、批量连写、重新生成、扩写、润色、改写、RAG、Embedding、向量数据库、Multi-Agent、自动记忆或伏笔更新。

## 实际配置与 Provider

- 统一客户端：`src/lib/ai/deepseek.js`，server-only，现有 OpenAI JavaScript SDK 7.30.1 作为兼容客户端。
- 固定 baseURL：`https://api.deepseek.com`；实际调用 `POST /responses`，没有请求 OpenAI 服务。
- 模型：`DEEPSEEK_MODEL`，默认 `deepseek-flash`；可在服务器改为 `deepseek-v4-pro`。未使用旧 chat/reasoner 默认名。
- `DEEPSEEK_API_KEY` 仅来自服务器环境；可选 `AI_PROVIDER=deepseek`，其他 provider 明确报错。本项目此前已完全切换 DeepSeek，并无硬编码 OpenAI 分支，因此没有新增双 provider 抽象或回退逻辑。
- `.env.example` 变量保持空值；真实配置只在忽略的 `.env.local`。前端只访问同源应用 API；日志、浏览器产物和 Git 都不得含密钥。
- 可选 `DEEPSEEK_PROXY_URL` 只影响 AI 客户端。本机直连，代理为空。SDK 禁用自动重试收费请求，超时 240 秒；路由最长 300 秒。

## 真实 Smoke Test

先于章节接线，于 2026-10-09 完成服务器真实请求：输入“只回复：DEEPSEEK_OK”，HTTP 200，响应严格为 `DEEPSEEK_OK`，实际模型 `deepseek-flash`，输入 12 tokens、输出 5、合计 17；耗时 507 ms，无错误。

证据：`artifacts/phase3c0/smoke.json`。不是测试夹具或模拟成功。

## API、权限与进度

`POST /api/ai/chapters/generate` 接收 requestId、novelId、chapterId、expectedRevision；拒绝多余字段，不接受客户端的正文、owner、模型或密钥。服务端验证 Cookie 账号、同源 JSON 和 4 KB 输入限制，以账号会话读取 RLS 保护的数据，再由数据库验证小说所有者和章节归属。

API 返回 NDJSON 事件：准备上下文→正在生成正文→完整预览或中文错误。DeepSeek 本身一次返回完整正文，不做逐 token UI。浏览器按钮立即锁定，编辑和手动保存暂停；预览独立于自动保存草稿，不会未确认就写入章节。正在保存→生成完成发生于用户点击确认后。

`POST /api/ai/chapters/confirm` 只接收 generationId，由服务器读取保护的预览。失败保留当前预览，可重试确认；不重新调用模型。已有正文直接拒绝。另一设备改变章节或小说设定后，确认也会拒绝，避免覆盖或保存已过时上下文的结果。

请求 UUID 去重；数据库账户锁和唯一 running 租约阻止多标签、多实例并发调用。与小说构建共用每小时 6 次限额，失败同样计入。租约 5 分钟过期。

## Context Builder 与 Prompt

`src/lib/ai/services/chapter-context.js` 独立于 API 路由，读取：

- 小说类型、风格、创意、主线、主角与单章目标。
- Novel Bible：核心前提、规则、冲突、能力、关系方向、禁止变更和故事阶段。
- 当前章节大纲、序号、标题，以及所在卷摘要和关键事件。
- 人物姓名、别名、性格、关系、能力、存活状态、当前位置等状态信息。
- 世界资料、按重要度和时间排序的最多 80 条 active 记忆。
- 上一章完整正文，前 5 章现有章节摘要及事件／人物变化等摘要字段。
- 现有 builder_metadata 中 continuityRequirements / specialRequirements；当前库没有单独的章节 continuityRequirements 字段，写在章节大纲中的连续性要求也作为原文输入。

没有大纲或核心设定时先提示补充。最多 80 人物、120 世界条目，总上下文不超过 180 KB；关键文本不静默截断，超限明确报错且不调用 AI。记忆按重要度选取，尚未实现语义检索。

`prompts/chapter-writer.js` 明确职业小说作家角色、数据与指令的边界、姓名／关系／能力／地点限制、章纲落实、上一章衔接和不得提前回收未来剧情。目标来自 chapter_word_target，允许 ±20%，只输出正文，不输出分析、提纲或 Markdown。

单次目标支持 100–6000 字，reasoning.effort=low，输出预算按目标分配并限制为 24000 tokens。拒绝空、拒答、截断和超过 120 KB 的结果。字数超出目标 ±20% 时预览明确提示，交给作者决定是否保存；不自动再次收费重写。

## 数据库与日志

迁移 `004_ai_chapter_generation.sql` 已在本地 PostgreSQL 引擎测试后应用到现有 Supabase。001–003 不变。004 SHA256：`00F9873A1153AF11E3DD43C7A27C4449BB6DAF1A7ACCA36DB5AFF741BFAC0FEC`。

- ai_generation_logs 新增 generation_type、provider、novel_id、chapter_id、原小说／章节 revision。
- 记录 chapter_generation、deepseek、实际 model、输入／输出 tokens、status、latency、provider request ID、error_type；没有 key、提示词或正文。
- 新表 ai_chapter_previews 保存正文和确认回执，RLS 只读本人记录，REST 不允许直接写入。生成完成 RPC 同事务记录日志完成和预览。
- 确认 RPC 按小说→章节锁定并重新检查所有者、空正文和原版本，一次事务更新 chapters.content、word_count、status=generated、updated_at、revision，同时插入 chapter_versions.source=ai_generated。
- 字数和更新时间沿用数据库触发器。版本写入失败时整笔事务回滚；重试只生成一个版本。再次确认已保存预览只返回当前章节，不覆盖人工修改。
- 删除小说会级联清理章节预览；不使用 service role key。

缺少 key、401 认证、402 余额、429 限流、模型不可用、超时、网络、上下文超长、数据库失败分别映射安全中文提示。控制台记录安全错误类别、provider code/status/request ID；不记录原始错误响应、密钥或故事内容。流开始后的错误在 error 事件中传输，不伪造成功。

## 真实章节验收与 Usage

真实测试小说：`3a85c364-8a6e-4606-9fda-c1557ea4403f`，名称“Phase 3C_0 验收 · 二十四小时之外”，归现有 A 测试账号。单独准备了 Bible、2 名人物、3 条世界资料、2 条有效记忆、分卷、上一章正文及摘要、本章大纲。

章节：`3922f128-50ff-4159-8302-4e3f96b71ef4`；生成记录：`2d626ccc-041e-43a5-b049-7dc2d6bc90aa`；版本：`bab353ee-f236-4b6d-83ec-35a0891abced`。

真实模型 deepseek-flash，输入 1379 tokens、输出 2403 tokens，生成日志耗时 15984 ms，浏览器从点击到取得预览证据约 25.8 秒。目标 3000 字，实际 3204 字，在 ±20% 范围内。

浏览器通过登录→本章生成→预览（章节仍空）→确认→正文与版本保存→刷新→退出再登录→正文仍在。连续确认没有重复版本，已有正文按钮没有第二次 AI 请求。B 无法生成／确认／读取 A 的内容和预览。最终浏览器 errors=[]，无非预期 404/500、React 警告或 hydration 错误；浏览器没有直接请求模型提供方。

人工阅读真实全文：衔接玻璃门开场；预见保持未来 24 小时以内；许青全程在上海档案馆，通过电话协助，无突然出现在北京的情节；未揭示幕后主使。仍有审校问题：模型补充了未指定的绝对日期与历史人物细节，部分时间差表述需核对；“发现今夜记录被改过”被扩展成较早记录的刮改，大纲落实并非完全精确。当前没有自动语义一致性评分或纠错，预览确认仍必需。

证据（本地 artifacts 被 Git 忽略）：

- `artifacts/phase3c0/browser-real-2026-10-10T05-39-17-767Z/results.json`、preview.png、saved.png、generated-chapter.txt。
- `artifacts/phase3c0/browser-fixture-2026-10-10T05-35-10-069Z/results.json`：6 组隔离浏览器验收，额外覆盖断网后保留预览和重试。
- `artifacts/phase3c0/unit-results.json`：8 组上下文、SDK、权限、并发、原子回滚和超限检查。夹具正文明确标记为模拟，不算真实生成证据。

## 回归与运行

运行入口保持 `npm run dev`。浏览器访问 http://127.0.0.1:3000。

```bash
npm run lint
npm run build
npm run test:db
npm run test:repository
npm run test:ai
npm run test:chapters
npm run test:browser:chapters
npm run test:security
```

真实收费浏览器测试只在显式启用时运行：`node scripts/testing/browser-chapters.mjs --real-ai-cloud --allow-cloud-test-writes`。使用忽略的测试账号文件，不在源码写凭据。测试期间不同时运行多个开发编译服务；本机曾出现热更新循环，重启单一开发服务后真实验收成功，失败运行没有调用模型。

既有真实云端回归：9 组数据库检查和 14 组浏览器检查通过，覆盖全部工作台路由、自动保存、断网恢复、多窗口冲突、历史版本、记忆编辑和账号隔离。证据：`artifacts/phase2.5/cloud-2026-10-10T05-39-48-614Z-0134ffbe.json`、`artifacts/phase2.5/browser-2026-10-10T05-43-35-858Z/results.json`，浏览器 errors=[]。

最终检查全部通过：lint、生产 build（24 条页面/API 路由）、DB、Repository、19 组既有 AI/数据库、8 组章节专项、6 组章节隔离浏览器、5 组真实章节浏览器、9 组既有真实云端数据库、14 组旧浏览器回归、11 组既有小说构建隔离浏览器。最后一项证据为 `artifacts/phase3a/browser-fixture-2026-10-10T05-51-04-637Z/results.json`。安全扫描覆盖 142 个源码文件及 28 个生产浏览器资源，issues=[]，环境文件和账号文件均未跟踪；应用源码仍为 JavaScript。

## 主要交付文件

```text
src/app/api/ai/chapters/
  generate/route.js                 生成进度和预览 API
  confirm/route.js                  确认保存 API
src/lib/ai/
  config.js / errors.js             Provider 配置和安全错误
  prompts/chapter-writer.js         正文提示词
  services/chapter-context.js       数据库上下文
  services/chapter-writer-service.js DeepSeek 正文请求
  services/chapter-workflow.js       租约、日志、确认编排
src/lib/repositories/chapter-generation-repository.js
src/components/novel/
  chapter-generation.js            生成状态和独立预览
  chapter-editor.js                编辑锁、防覆盖、确认后的同步
  chapters-view.js / ai-assistant.js 状态文字和切换提示
src/lib/hooks/use-unsaved-changes.js 导航保护提示
supabase/migrations/004_ai_chapter_generation.sql
scripts/test-chapters.mjs
scripts/testing/chapter-fixtures.mjs
scripts/testing/browser-chapters.mjs
```

此外更新 `.env.example`、package.json 测试入口、既有测试夹具/占位断言、README、ARCHITECTURE 和 SUPABASE_SETUP。未改动 UI 布局样式，未提交环境密钥或测试账号。

## 已知边界

只解决单章生成，不代表百万字连写完成。上下文有限额，作品页仍读取完整小说聚合，大规模正文分页待后续阶段。生成内容需要人工审校；数据库版本检查能避免覆盖，不能证明文学内容永远一致。

预览确认保存失败可以原位重试；未确认预览虽在云端留存，但本阶段尚无刷新后自动恢复预览的 UI。离开页面前应确认保存或自行复制，生成请求中断不会自动再付费重试。后续可以在明确的新阶段加入预览恢复、分页上下文和连续性校验，本阶段不提前实现。
