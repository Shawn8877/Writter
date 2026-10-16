# Phase 3C_2：AI 下一章与连续创作

## 用户流程

章节页新增“生成下一章”和“连续创作”。系统取最后一个有正文的章节号加一，不要求用户输入编号。目标章节必须没有正文且有已确认的大纲；缺大纲时可以让 DeepSeek 生成大纲预览，作者逐章确认后再启动正文。单章正文保留 Preview → 用户确认 → Save → `ai_generated` Version → Memory；连续创作选择 3、5、10 章（默认 3、最多 10）并一次性确认预计调用数。每章仍独立生成与保存，当前章记忆成功后才重建最新上下文进入下一章。

确认弹窗显示起止章号、单章目标字数、正文/分析预计次数和额外大纲调用提示；实际费用由 Token 决定。普通 AI 操作保持每账号每小时 6 次上限。连续任务有明确章数和一次性确认，正文/记忆调用在数据库中以每小时 24 次封顶，允许 10 章各进行一次正文和分析。模型仍由服务器 `DEEPSEEK_MODEL` 配置，浏览器不持有密钥。

## 持久化状态机

`009_generation_runs.sql` 新增 `generation_runs`、`generation_run_chapters`、`ai_outline_previews`，章节增加 `outline_approved_at`，并给正章节编号加唯一索引。任务状态为 `pending/running/paused/completed/failed/cancelled`，步骤为 `ready/generating/preview/saving/analyzing/completed`。每章记录 `pending/generating/generated/analyzing/completed/failed`。旧手写大纲回填为已确认；新手写大纲保存后视为作者确认，AI 大纲只有确认预览后才写入。

事务 RPC 在小说锁下计算起点、检查全体大纲并创建唯一活跃任务。领取步骤时设置数据库租约和一次性 `request_id`；两个浏览器同时请求只会有一个得到工作。正文仍通过原 `generateChapterPreview`，保存仍通过原 `studio_confirm_chapter_generation`，分析仍通过原 `updateChapterMemory`。一步完成时数据库验证真实预览、版本或成功的记忆分析证据。连续任务不能覆盖有正文的章节。`010_generation_run_memory_review_fix.sql` 保留 3C_1 的 `needs_review/reviewed` 人工核对保护，同时支持已确认连续任务的调用限额。`011_generation_run_safe_cancel.sql` 让取消发生在正文确认或记忆分析期间时，先完成当前章记忆再停止。

`/api/ai/generation-runs` GET/POST 查询和创建任务；`/[id]` GET 读取状态并核对过期租约；`/[id]/advance` POST 领取一步，Next `after()` 在本次请求生命周期内执行最多一次模型调用；`/[id]/cancel` 和 `retry` 控制任务。`/api/ai/chapters/next-outline` 生成大纲预览并确认。全部 API 验证登录、输入与小说归属，数据库 RLS 进一步隔离 A/B 账号。

## 失败、恢复和一致性

网页每 3 秒查询数据库进度。刷新、断网或关闭页面不删除任务；重开后显示当前状态，点击“继续任务”驱动后续步骤。请求中断后，5 分钟租约超时会根据生成日志、预览回执、正文版本和记忆结果核对。已经成功的章节不重新生成；不确定的收费请求只在用户明确重试后再发。第二章失败时第一章保留，重试从第二章继续。记忆失败时正文与 `ai_generated` 版本保留，仅重新分析记忆。取消停止后续章节，不删除已完成章节；如果当前章正在确认或分析，则先完成其记忆。

每章构建新的有界上下文：Bible、当前大纲、卷/阶段、上一章正文、最近 5 章摘要、人物状态、重要记忆与未回收伏笔；不会把所有历史正文一并发送。基础一致性检查会拒绝缺失 Bible/人物/前章、旧记忆未完成、已有正文或大纲未确认，并在 Bible 明确禁止复活与已死亡人物的大纲复活描述冲突时暂停。它不是完整语义判定，复杂的地点、能力、人物关系冲突仍需要作者审阅。AI 分析不会修改 Bible；人物基础档案不会被整体替换。

## 验收与数据

- 本地 PostgreSQL/RLS 夹具：`npm run test:db`、`test:chapters`、`test:memory`、`test:runs`。`test:runs` 覆盖大纲预览、单章手动确认、3/5/10 独立版本与记忆、第二章失败重试、双浏览器争抢、A/B 隔离、取消及记忆失败重试。
- 浏览器夹具：`npm run test:browser:runs`，覆盖设置与确认、刷新、断网、关闭页面再打开、三章进度与数据库写入，以及单章下一章预览、确认和记忆。结果在 `artifacts/phase3c2/browser-fixture-2026-10-16T05-52-54-560Z/results.json`，无页面错误。
- 真实 DeepSeek + Supabase：`npm run test:browser:runs -- --real-ai-cloud --allow-cloud-test-writes`，2026-10-16 使用已有独立 A/B 测试账号执行。一次云端小说列表请求曾短暂返回 503；同一个 `run_id` 从第一章预览恢复，未重复调用正文。最终三章均有一个成功的 `ai_generated` 版本、成功记忆任务与分析摘要，A/B 任务隔离通过。模型 `deepseek-flash`；正文 3 次、记忆分析 3 次；合计输入 37,366、输出 22,887 tokens，六次调用延迟合计 138,141 ms。证据在 `artifacts/phase3c2/browser-real-2026-10-16T05-41-05-904Z/results.json`，最终无浏览器错误。
- 新增 009–011 迁移在现有 Supabase 测试项目执行并复查了表、RPC 和无重复章节编号。该项目过去通过 SQL 直接应用旧迁移，没有 Supabase 迁移历史表；在此项目继续按顺序执行新增 SQL，不能直接让 CLI 重放 001–008。正式新项目按完整迁移顺序初始化。

## 当前限制

浏览器关闭后当前 `after()` 步骤可完成，下一步需要用户重开页面点击“继续任务”；首版没有独立常驻工作队列。若 Vercel 的函数执行上限低于一次 240 秒模型超时，需在部署前配置足够的 `maxDuration` 或引入受控队列。5/10 章通过数据库与服务夹具完整验收；真实付费浏览器验收只执行了 3 章。自动大纲逐章预览确认，尚不自动批量批准。重新生成、扩写、润色、剧情修改、会员与支付不在本阶段。
