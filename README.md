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

手动创作只需要 Supabase 公开配置，不需要 service role key。AI 构建另需在服务器 `.env.local` 设置 `OPENAI_API_KEY` 和 `OPENAI_MODEL=gpt-6.1-sol`；后者可换成支持 Responses + Structured Outputs 的可用模型。密钥不能放入 `NEXT_PUBLIC_*` 或 Git，`.env.example` 中变量均为空。若服务器需要 HTTP(S) 代理，可设置仅供 OpenAI 使用的 `OPENAI_PROXY_URL`；未设置时保持直连，Supabase 和浏览器不受影响。本机使用已有的本地代理，代理程序需保持运行；部署服务器时按其网络情况填写或留空。

**Phase 3A 状态（2026-10-09）：AI Novel Builder 代码与测试流程完成；密钥和模型访问已验证，真实生成被 OpenAI API 余额不足阻塞。** 已实际尝试 smoke test，服务返回 `429 / credit_balance_exhausted`，尚未获得真实生成方案。目前已验证 Structured Outputs 的 SDK 测试、预览修改、事务保存、幂等和真实 Supabase 账号隔离。当前项目已应用 003 迁移，原有 Phase 2.5 数据保留。完整结果及剩余限制见 [Phase 3A 报告](docs/PHASE_3A.md)。

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

**本阶段只开放 AI 基础方案构建接口。** 缺少密钥时明确报错，不返回假方案。章节正文、逐章大纲、自动总结、Embedding、RAG 和连续写作仍未实现。版本恢复、密码找回与头像／封面上传也未实现。

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
| `/novel/[id]/chapters` | 正文、摘要、自动保存与版本 | 小说所有者 |
| `/novel/[id]/memory` | 长期记忆及来源 | 小说所有者 |

小说 ID 来自数据库 UUID，不再使用固定示例路由。

## 检查

```bash
npm run lint
npm run test:db
npm run test:repository
npm run test:ai
npm run build
npm run test:security
npm start
```

两个数据测试通过 PGlite 执行真实 PostgreSQL 迁移与 RLS，不依赖外部密钥，也不改线上数据。浏览器联调使用可选的本地测试服务；运行方式和验收范围见 [第二阶段报告](docs/PHASE_2.md)。本地验证不能替代真实 Supabase 项目的邮件、会话刷新和部署验证。

AI 测试不调用收费接口。`npm run test:browser:ai` 使用独立的 SQL/Auth/OpenAI 测试服务；`npm run test:browser:ai:cloud -- --allow-cloud-test-writes` 使用明确标注的方案样例和真实 Supabase。两者均需 Playwright + Chrome，可通过 `PLAYWRIGHT_MODULE` 指向已有 Playwright。配置密钥并重启网站后，可显式运行 `npm run test:ai:smoke -- --allow-cloud-test-writes`，仅构建一次真实方案并验收保存；操作前阅读 [验收配置和范围](docs/PHASE_3A.md)。

真实项目另提供 `npm run test:cloud -- --allow-cloud-test-writes`，需要独立测试项目和两个真实测试账号；准备方式见 [云端验收脚本说明](docs/SUPABASE_SETUP.md#8-真实双账号-sdk-验收脚本)。该脚本会创建并保留 A/B 样本，仅删除本次创建的级联测试小说；它不能代替跨浏览器、断网草稿和自动保存界面验收。

## 数据与资料

正式内容保存在 Supabase；本地草稿是恢复副本，不是云端备份。`localhost` 与 `127.0.0.1` 是不同浏览器来源，请固定一个地址使用。旧作品不会自动上传，需在原来保存作品的浏览器与地址里选择“导入本地作品”。

- [配置 Supabase 与双账号权限验证](docs/SUPABASE_SETUP.md)
- [Phase 3A 架构、数据库映射、验收与限制](docs/PHASE_3A.md)
- [Phase 2.5 云端验收状态与待办](docs/PHASE_2_5.md)
- [第二阶段功能、表结构、变更文件、测试与第三阶段建议](docs/PHASE_2.md)
- [当前架构与数据约定](docs/ARCHITECTURE.md)
- [第一阶段历史交付记录](docs/PHASE_1.md)

第一阶段示例和本地仓库仍保留在代码中，用于兼容与迁移。首页插画继续使用 `public/story-world.png`。
