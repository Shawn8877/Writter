# NovelAI Studio

一个想法，写出一个世界。

基于 **Next.js App Router、JavaScript、Tailwind CSS、Supabase** 的网络小说创作平台。保留第一阶段深色界面和三栏工作台，第二阶段实现账号、数据库、权限、章节版本与记忆来源。没有 TypeScript 应用源码。

## 启动

需要 Node.js 22.15+（本机验收使用 24.19）和 npm，按锁文件安装：

```bash
npm ci
npm run dev
```

打开终端显示的地址，默认 `http://localhost:3000`。未配置 Supabase 时首页、登录和注册页可打开，受保护页面跳转登录并提示配置。正式创作需要先完成 [Supabase 配置](docs/SUPABASE_SETUP.md)：创建项目、执行迁移，把项目 URL 和公开 anon/publishable key 填入 `.env.local`，重启开发服务。

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-key
```

手动创作只需要 Supabase 公开配置，不需要 service role key。AI 构建使用 **DeepSeek**，需在服务器 `.env.local` 设置 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL=deepseek-flash`。密钥不能放入 `NEXT_PUBLIC_*` 或 Git，`.env.example` 中变量均为空。可选 `DEEPSEEK_PROXY_URL` 仅用于 DeepSeek 请求；本机可直连，保持空值即可。原有 `OPENAI_*` 配置不再被应用读取，不会自动回退到 OpenAI。

**Phase 3A 已切换到 DeepSeek 并通过真实生成验收（2026-10-09）。** 采用 DeepSeek Responses 的 JSON Schema 结构化输出，服务端继续严格校验人物、世界、故事阶段与记忆。19 组 AI/数据库检查、11 组隔离网页流程、5 组真实 DeepSeek + Supabase 验收通过；一个都市方案完成预览修改、确认保存和账号隔离验证，详见 [Phase 3A 报告](docs/PHASE_3A.md)。既有 UI、003 数据库结构及 Phase 2.5 数据保留。

## 已实现

- 邮箱密码注册、登录、退出、Cookie 会话与服务端访问保护。
- 当前账号的作品库、搜索、创建、编辑、删除确认和数据库字数统计。
- 小说核心设定、总纲、分卷、人物、世界观、时间线、章节大纲与正文。
- 正文输入立即写入本地临时草稿，停顿 1 秒后自动保存到云端；失败保留草稿、刷新恢复、重试。
- 数据库原子版本检查，阻止旧标签页或旧设备静默覆盖；表单打开后的数据变化同样需核对。
- 明确点击“保存版本”创建历史正文，版本记录可查看时间、来源、字数和内容。
- 记忆中心增删改查，类型、重要度、状态和章节／人物／世界资料来源。
- 第一阶段浏览器作品可在 Dashboard 明确确认后导入，原存储保持不变。
- `/create` 从创意构建基础设定：人物、世界、8–12 个宏观故事阶段与 10–30 条初始记忆；预览后确认才原子保存。
- 预览可修改书名、简介、核心设定、冲突、结局；重新生成需要确认。每个账号同一时间仅一个请求，每小时最多 6 次，重复确认不会多建一本。

**Phase 3C_0 已开放“生成本章”。** 先完善核心设定和本章大纲，在空白章节点击生成，预览后确认保存；正文和 `ai_generated` 版本在同一事务中写入。真实 DeepSeek 已生成 3204 字章节并通过刷新、重新登录、账号隔离验收，详见 [章节生成报告](docs/PHASE_3C_0.md)。已有正文会被保护，不会直接覆盖。缺少密钥时明确报错，不返回假正文。

**Phase 3C_1 接入章节自动记忆分析。** AI 正文确认保存后，在后台生成 100–300 字摘要，更新人物状态、事实记忆、时间线、伏笔和下一章连续性要求。首次分析失败保留正文与版本，可单独重试；相同正文成功后不重复调用模型。修改已分析正文时需要人工核对并明确确认，避免保留已撤销的事实；下一章使用核对后的资料和手动摘要。其他章节存在未完成分析或待核对资料时会提示先处理。需按顺序应用 005–008 迁移；既有测试项目已经执行。真实两章验收包含失败恢复，模型输出仍需审阅，详见 [章节记忆报告](docs/PHASE_3C_1.md)。

**Phase 3C_2 已开放“生成下一章”和连续创作 3/5/10 章。** 系统按最后一章正文自动找下一章；缺大纲时先生成大纲预览，经确认后才能写正文。单章正文继续走预览和手动确认；连续模式需要一次性确认预计调用次数，随后每章独立生成、保存 `ai_generated` 版本并更新记忆，前一章记忆成功后才开始下一章。进度保存在 Supabase，刷新、断网和关闭浏览器后可找回；失败只重试当前章节，取消保留已写章节。需按顺序应用 009–011 新迁移，详见 [连续创作报告](docs/PHASE_3C_2.md)。

当前单章支持 100–6000 字、有限上下文。普通 AI 操作仍受每账号每小时 6 次限额；明确确认的连续任务最多 10 章，并对该任务的正文/记忆调用使用每小时 24 次上限。重新生成、扩写、润色、修改剧情仍为入口占位；Embedding、RAG、版本恢复、密码找回与头像／封面上传未实现。

## 页面

| 路由 | 页面 | 访问 |
| --- | --- | --- |
| `/` | 首页 | 公开 |
| `/login`、`/register` | 登录、注册 | 公开 |
| `/dashboard` | 当前账号作品库 | 登录 |
| `/create` | 手动创建 / AI 构建 / 方案预览 | 登录 |
| `/novel/[id]` | 概览与核心设定 | 小说所有者 |
| `/novel/[id]/outline` | 总纲、宏观故事阶段、分卷与章节大纲 | 小说所有者 |
| `/novel/[id]/characters` | 人物 | 小说所有者 |
| `/novel/[id]/world` | 世界观、地点、物品、能力、伏笔 | 小说所有者 |
| `/novel/[id]/timeline` | 时间线 | 小说所有者 |
| `/novel/[id]/chapters` | 正文、摘要、版本、下一章与连续创作任务 | 小说所有者 |
| `/novel/[id]/memory` | 长期记忆及来源 | 小说所有者 |

小说 ID 来自数据库 UUID，不再使用固定示例路由。

## 检查

```bash
npm run lint
npm run test:db
npm run test:repository
npm run test:ai
npm run test:chapters
npm run test:memory
npm run test:runs
npm run build
npm run test:security
npm start
```

两个数据测试通过 PGlite 执行真实 PostgreSQL 迁移与 RLS，不依赖外部密钥，也不改线上数据。浏览器联调使用可选的本地测试服务；运行方式和验收范围见 [第二阶段报告](docs/PHASE_2.md)。本地验证不能替代真实 Supabase 项目的邮件、会话刷新和部署验证。

AI 测试不调用收费接口。`npm run test:browser:ai` 使用独立的 SQL/Auth/DeepSeek 响应样例；`npm run test:browser:ai:cloud -- --allow-cloud-test-writes` 使用明确标注的方案样例和真实 Supabase。两者均需 Playwright + Chrome，可通过 `PLAYWRIGHT_MODULE` 指向已有 Playwright。配置 DeepSeek 密钥并重启网站后，可显式运行 `npm run test:ai:smoke -- --allow-cloud-test-writes`，仅构建一次真实 DeepSeek 方案并验收保存；操作前阅读 [验收配置和范围](docs/PHASE_3A.md)。

连续创作夹具浏览器验收为 `npm run test:browser:runs`；真实三章验收需明确执行 `npm run test:browser:runs -- --real-ai-cloud --allow-cloud-test-writes`，会使用独立测试账号并产生真实 DeepSeek 用量。真实任务中断后用同一证据目录加 `--resume artifacts/phase3c2/browser-real-...` 恢复，避免重写已生成章节。测试范围与结果见 [Phase 3C_2 报告](docs/PHASE_3C_2.md)。

真实项目另提供 `npm run test:cloud -- --allow-cloud-test-writes`，需要独立测试项目和两个真实测试账号；准备方式见 [云端验收脚本说明](docs/SUPABASE_SETUP.md#8-真实双账号-sdk-验收脚本)。该脚本会创建并保留 A/B 样本，仅删除本次创建的级联测试小说；它不能代替跨浏览器、断网草稿和自动保存界面验收。

## 数据与资料

正式内容保存在 Supabase；本地草稿是恢复副本，不是云端备份。`localhost` 与 `127.0.0.1` 是不同浏览器来源，请固定一个地址使用。旧作品不会自动上传，需在原来保存作品的浏览器与地址里选择“导入本地作品”。

- [配置 Supabase 与双账号权限验证](docs/SUPABASE_SETUP.md)
- [Phase 3A 架构、数据库映射、验收与限制](docs/PHASE_3A.md)
- [Phase 3C_2 下一章、连续创作与恢复验收](docs/PHASE_3C_2.md)
- [Phase 2.5 云端验收状态与待办](docs/PHASE_2_5.md)
- [第二阶段功能、表结构、变更文件、测试与第三阶段建议](docs/PHASE_2.md)
- [当前架构与数据约定](docs/ARCHITECTURE.md)
- [第一阶段历史交付记录](docs/PHASE_1.md)

第一阶段示例和本地仓库仍保留在代码中，用于兼容与迁移。首页插画继续使用 `public/story-world.png`。
