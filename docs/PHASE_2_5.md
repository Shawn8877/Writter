# Phase 2.5：真实 Supabase 验收

验收日期：**2026-10-08（北京时间）**。

**状态：本次要求的真实数据库与浏览器验收完成。Phase 3 尚未开始，OpenAI 未接入。**

沿用既有项目、UI、数据库与 A/B 账号；没有重新初始化、重新设计界面、创建替代 Supabase 项目或新测试账号。正常业务请求使用公开 publishable key + 用户 Session/RLS，不使用管理员密钥。本地 PGlite/fixture 结果不计作云端验收。

## 当前环境

| 项目 | 实际状态 |
| --- | --- |
| 工程 | C:\Users\wc-4\Documents\ChatGPT\Write |
| 网站 | http://localhost:3000；真实 Supabase 配置 |
| Supabase | 既有 Shawn8877's Project，ref stefdozqmqznfzfxnkjz，ap-southeast-2 |
| 恢复 | 开始时 INACTIVE；官方 API 恢复原项目后确认 ACTIVE_HEALTHY |
| 数据库 | PostgreSQL 17.6.1.166；11 表全部启用 RLS |
| 结构审计 | 12 policies、48 constraints、26 triggers、32 indexes |
| 配置 | .env.local 已配置真实 URL 与公开 key，Git 忽略 |
| 账号 | 沿用 2026-09-24 创建的 A/B，本次登录与 profiles 验证通过 |
| 邮箱确认 | 当前开发测试环境关闭；真实邮件投递不在本次验收范围 |
| 回调 | Site URL 为 localhost:3000，允许 /auth/callback、/auth/confirm |
| 依赖 | JavaScript、Next.js 16.3.5、React 19.2.3、Tailwind 4、Supabase SDK 2.116.0 / SSR 0.12.7 |

StudioProvider 使用 cloudNovelRepository，浏览器客户端和同源服务端 API 连接同一真实项目；云端失败明确显示错误，不切换示例或本地库。

## 发现并修复的问题

2026-09-24 真实 SDK 测试已通过登录、持久化、双向 RLS，停在旧版本拒写。恢复数据库后重现：业务版本冲突使用 SQLSTATE 40001，托管 PostgREST 将其当作可重试事务错误，导致请求不能及时返回 409。

新增 [002_phase_2_5_fixes.sql](../supabase/migrations/002_phase_2_5_fixes.sql)，将 studio_save_chapter、studio_patch_novel、studio_delete_novel 的业务冲突改为 PT409。保留事务、行锁、所有者校验和 RLS；Repository 映射为友好的 409 提示。001 未改，修复已保存在仓库且执行到原云端项目。

三个 RPC 的真实请求均返回 HTTP 409 / PT409，旧版本没有改变云端数据；本地 PostgreSQL、实际 Repository 和双窗口 UI 同样通过。原因与方案见 [Supabase 官方说明](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)。

本地测试与 fixture 现按文件名顺序加载全部 SQL migrations，避免漏测 002。

## 真实样本与持久化

A/B 各新建并保留一部小说。每部有 1 Bible、1 分卷、3 章节、3 人物、3 世界资料、3 时间线、3 记忆。首章初始正文 **948 个汉字**，超过 800 要求。数据库字数另包含标点、去除空白，不能与汉字数混淆。每部至少两个真实手动版本，A 又在 UI 保存了新版本。

| 标识 | User A | User B |
| --- | --- | --- |
| novel_id | 8f0c3b14-c3d8-4a2e-81c5-cba8415c4c8c | 4a2ba8c3-5d0b-47f0-bc41-965616f5928b |
| chapter_id | 6c7cc6ee-7690-4b3a-bf05-9011e77a20f8 | a95a1b43-d9bb-4c9e-9578-70869b8db519 |
| character_id | 0b505c7c-ba10-4f7b-9733-8af20003c1ca | 86dadd44-0890-4835-b453-40b04b2b1958 |
| memory_id | 0adfebe3-5d5f-40c0-9fd2-c75078f884a3 | c3589c49-d9d7-419b-99f7-2ec7f8ce862c |

- SDK 主动刷新 Session、退出后新建 SDK 客户端登录，完整小说对象一致。
- UI 退出、关闭页面、重新打开并登录，所有正式字段完整恢复。
- 关闭旧浏览器 Profile，新建空 Cookie / localStorage 的独立 Profile，重新登录 A，完整对象一致，正文及全部资料来自云端。
- 本地草稿仅保护未上传内容；保存成功清理当前副本，其他窗口的冲突副本保留。未用草稿代替正式数据。

## 数据库层 RLS 逐项结果

直接用普通用户 Session 调 Supabase 表。每项先确认所有者基线非空，攻击后再比较完整快照未改变。

| 读取表 | B 读 A | A 读 B |
| --- | --- | --- |
| profiles | 0 行，通过 | 0 行，通过 |
| novels | 0 行，通过 | 0 行，通过 |
| volumes | 0 行，通过 | 0 行，通过 |
| chapters | 0 行，通过 | 0 行，通过 |
| chapter_versions | 0 行，通过 | 0 行，通过 |
| characters | 0 行，通过 | 0 行，通过 |
| world_entries | 0 行，通过 | 0 行，通过 |
| timeline_events | 0 行，通过 | 0 行，通过 |
| novel_bible | 0 行，通过 | 0 行，通过 |
| chapter_summaries | 0 行，通过 | 0 行，通过 |
| memory_items | 0 行，通过 | 0 行，通过 |

| 写入攻击 | B 写 A | A 写 B |
| --- | --- | --- |
| UPDATE novels | 阻止 | 阻止 |
| DELETE novels | 阻止 | 阻止 |
| UPDATE chapters | 阻止 | 阻止 |
| DELETE chapters | 阻止 | 阻止 |
| INSERT characters | 42501 拒绝 | 42501 拒绝 |
| INSERT world_entries | 42501 拒绝 | 42501 拒绝 |
| INSERT timeline_events | 42501 拒绝 | 42501 拒绝 |
| INSERT memory_items | 42501 拒绝 | 42501 拒绝 |
| INSERT chapter_versions | 42501 拒绝 | 42501 拒绝 |
| UPDATE novel_bible | 阻止 | 阻止 |
| UPDATE chapter_summaries | 阻止 | 阻止 |

UPDATE/DELETE 的“阻止”指返回空记录或明确权限拒绝，且所有者数据快照不变。RLS 过滤为 0 行可能仍返回 HTTP 成功，不能仅看 HTTP 状态。

双方作品列表隔离，跨账号 Repository 请求 404。B 浏览器手动打开 A 地址与读取历史版本均被拒绝，页面没有 A 的工作台内容。

## 自动保存与浏览器结果

真实 Chrome 独立 Profile + 真实本地应用 + 现有账号，共 **14 组浏览器验收通过**。只有故障测试主动注入断网/503，未用模拟成功响应证明持久化。

| 验收 | 结果 |
| --- | --- |
| 首页、注册、登录、未登录保护 | 页面正常；保护页跳登录，未登录 API 401 |
| 注册边界 | 注册页和密码不一致校验通过；不重复注册 A/B，既有真实注册证据保留 |
| Dashboard | 真实名称、类型、状态、章节数、总字数、数据库更新时间；双方仅见自己的作品 |
| 重开与新 Profile | 两种方式恢复全部正式字段，无 localStorage 导入 |
| 输入与 debounce | 立即显示并写草稿；连续输入仅 1 次保存请求；等待自动保存 → 正在保存… → 已保存 |
| 刷新正文 | 保存成功后刷新，正文与云端一致 |
| 真正断网 | offline 后保留文字与草稿，提示“保存失败，本地草稿已保留”；恢复连接后自动重试入库 |
| 503 保存失败 | 刷新后恢复草稿，解除故障点击重试，云端成功 |
| 两窗口冲突 | 同一初始版本，A 先存，B 旧版明确冲突；A 云端正文不变，B 草稿刷新后仍保留 |
| 历史版本 | UI 保存创建真实版本，内容、来源、时间、字数可见；B 不可读；未新增恢复功能 |
| Memory | 新增、编辑、类型/重要度/状态、真实章节来源与跳转、删除通过 |
| 全部小说路由 | 概览、大纲、人物、世界观、时间线、章节、Memory 正常，原三栏 UI 保留 |
| Loading / error / empty | 真实响应延迟时显示 loading；模拟失败显示错误；搜索空结果与新小说空资料页面正常 |
| 创建与删除 | UI 创建真实 UUID/Bible/卷/章；取消删除保留，确认后 API 查不到 |
| not found | 不存在及跨用户 UUID 显示安全缺失页，无工作台数据 |
| Console / HTTP | 非预期 console error、pageerror、React/hydration warning、404/500 共 0 |

数据库/API 错误由 Repository 转为用户提示，不直接展示 SQL。预期断网、503、409、404 单独记录，不当作非预期故障。Next 流式 notFound 的 HTML 可能为 200，验收同时判断缺失页、无受保护内容及 API 404。

## 版本、记忆、摘要与删除

- chapter_versions：检查 chapter_id、content、word_count、source=manual、created_at；至少两版本，自动保存不创建版本。
- memory_items：真实新增/读取/更新/删除；location/item/foreshadowing/secret，importance 4/5，active/resolved；chapter 来源正确，跨小说来源返回 23514。
- chapter_summaries：删除、读空、重建、更新 summary/key_events 通过；跨用户读取与修改被阻止。
- novel_bible：UNIQUE(novel_id) 存在，重复插入真实返回 23505，无需重复加约束。
- 删除分卷保留章节、volume_id 置空。仍被记忆引用的章节拒绝删除；解除引用后章节版本/摘要随章节清理。
- 完整级联：先确认所有子表有记录，再删除专用小说；小说、卷、章、版本、摘要、Bible、人物、世界、时间线、记忆均为 0 行，其他小说完整。
- 级联测试小说 84083d57-a2c0-4751-96bc-a5c3ebb78cb9、UI 删除测试小说 58b7dacc-2b88-4324-bd7c-ec242a6c1083 已删除；没有清空旧样本或其他作品。
- memory_items.source_id 是多态引用，不能以单一普通 FK 指向三张表；由来源验证和删除保护触发器保证，chapter_id 另有复合 FK。见 [架构文档](ARCHITECTURE.md)。

## 工程与安全

| 检查 | 结果 |
| --- | --- |
| npm run dev | 真实 .env.local，localhost:3000 可运行；全部路由实际访问 |
| npm run lint | 通过 |
| npm run test:db | 加载 001→002 后通过 |
| npm run test:repository | 实际适配器与 PostgreSQL 集成通过 |
| npm run build | 通过，全部 App Router 页面/API 编译成功 |
| npm run test:cloud -- --allow-cloud-test-writes | 真实 SDK/数据库通过 |
| npm run test:browser:cloud -- --allow-cloud-test-writes | 14 组真实浏览器通过 |
| npm run test:security | 可提交源码与构建浏览器资源扫描通过 |
| Git 忽略 | .env.local、账号、CLI 工具、原始 artifacts 均忽略；仅空 .env.example 入库 |

本机已有 Node、无全局 npm；从官方注册表下载 npm 11.6.2 到忽略目录 .tools，执行对应 npm scripts，未增加应用依赖。Playwright 使用已有运行时，以 PLAYWRIGHT_MODULE 指定。

扫描未发现真实账号密码、管理令牌、service-role JWT、sb_secret、含密码数据库地址或 OpenAI key 进入源码/前端 bundle。公开 publishable key 属于正常浏览器配置。旧 fixture 的虚构测试值不是可登录真实账号的凭证。管理授权仅用于恢复、迁移和结构审计，临时令牌文件已清空。

## 本地证据

均位于 Git 忽略的 artifacts/phase2.5/；不含密码、Session token 或管理员密钥。

- auth-registration.json：此前两个真实账号注册成功记录。
- schema-audit-latest.json：本次结构/RLS 审计。
- cloud-2026-10-08T08-14-53-512Z-5dfcbc8a.json：真实 SDK/数据库结果、样本 UUID。
- browser-2026-10-08T08-22-30-370Z/results.json：14 组浏览器结果，errors=[]。
- 同目录 chapters.png、conflict.png、versions.png 及各小说页面截图。
- security.json：源码与前端资源扫描。

旧失败报告保留用于追踪，不覆盖以上最新成功结果。

## 本次修改文件

- 业务：src/lib/server/supabase-repository.js，仅调整冲突映射。
- 迁移：新增 supabase/migrations/002_phase_2_5_fixes.sql，001 未改。
- 验收：新增 scripts/test-cloud.mjs、scripts/testing/browser-cloud.mjs、scripts/test-security.mjs。
- 测试维护：scripts/test-database.mjs、scripts/test-repository.mjs、scripts/testing/supabase-fixture.mjs、supabase/tests/rls.sql、package.json。
- 文档配置：.env.example、.gitignore、README.md、docs/PHASE_2.md、docs/PHASE_2_5.md、docs/SUPABASE_SETUP.md、docs/ARCHITECTURE.md。

## 后续边界

本次 Phase 2.5 项已通过，停止于此。OpenAI、AI 总结、向量检索、RAG、自动连写尚未开发；本地运行不等于公网部署。

下阶段建议先拆分轻量作品列表、按章正文读取和版本分页，避免百万字作品加载完整聚合；用户授权后再接入服务器端 AI，先单章生成及人工确认保存，再摘要/记忆更新。正式上线另需生产邮箱确认、HTTPS 回调、限流、配额和备份验收。
