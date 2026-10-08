# NovelAI Studio

一个想法，写出一个世界。

基于 **Next.js App Router、JavaScript、Tailwind CSS、Supabase** 的网络小说创作平台。保留第一阶段深色界面和三栏工作台，第二阶段实现账号、数据库、权限、章节版本与记忆来源。没有 TypeScript 应用源码。

## 启动

需要 Node.js 20.9+ 和 npm，按锁文件安装：

```bash
npm ci
npm run dev
```

打开终端显示的地址，默认 `http://localhost:3000`。未配置 Supabase 时首页、登录和注册页可打开，受保护页面跳转登录并提示配置。正式创作需要先完成 [Supabase 配置](docs/SUPABASE_SETUP.md)：创建项目、执行迁移，把项目 URL 和公开 anon/publishable key 填入 `.env.local`，重启开发服务。

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-key
```

不需要 service role key 或 OpenAI key；不要将真实密钥放入源码或提交到 Git。`.env.example` 仅有占位配置。

**Phase 2.5 状态（2026-10-08）：真实 Supabase 数据库与浏览器验收完成。** 沿用原项目和 A/B 账号，恢复暂停数据库；双向 RLS、948 汉字正文持久化、独立浏览器、自动保存、断网草稿、冲突、历史版本及级联删除通过。新增 002 迁移修复托管 API 对版本冲突反复重试的问题。14 组真实浏览器验收无非预期错误。详见 [Phase 2.5 报告](docs/PHASE_2_5.md)，配置和复验方式见 [Supabase 配置](docs/SUPABASE_SETUP.md)。Phase 3 与 OpenAI 尚未开始。

## 已实现

- 邮箱密码注册、登录、退出、Cookie 会话与服务端访问保护。
- 当前账号的作品库、搜索、创建、编辑、删除确认和数据库字数统计。
- 小说核心设定、总纲、分卷、人物、世界观、时间线、章节大纲与正文。
- 正文输入立即写入本地临时草稿，停顿 1 秒后自动保存到云端；失败保留草稿、刷新恢复、重试。
- 数据库原子版本检查，阻止旧标签页或旧设备静默覆盖；表单打开后的数据变化同样需核对。
- 明确点击“保存版本”创建历史正文，版本记录可查看时间、来源、字数和内容。
- 记忆中心增删改查，类型、重要度、状态和章节／人物／世界资料来源。
- 第一阶段浏览器作品可在 Dashboard 明确确认后导入，原存储保持不变。

**AI 尚未接入。** 所有 AI 按钮继续显示占位提示，没有模型调用、自动总结、Embedding、RAG 或自动连写。版本恢复、密码找回与头像／封面上传未实现。

## 页面

| 路由 | 页面 | 访问 |
| --- | --- | --- |
| `/` | 首页 | 公开 |
| `/login`、`/register` | 登录、注册 | 公开 |
| `/dashboard` | 当前账号作品库 | 登录 |
| `/create` | 创建小说 | 登录 |
| `/novel/[id]` | 概览与核心设定 | 小说所有者 |
| `/novel/[id]/outline` | 总纲、分卷与章节大纲 | 小说所有者 |
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
npm run build
npm run test:security
npm start
```

两个数据测试通过 PGlite 执行真实 PostgreSQL 迁移与 RLS，不依赖外部密钥，也不改线上数据。浏览器联调使用可选的本地测试服务；运行方式和验收范围见 [第二阶段报告](docs/PHASE_2.md)。本地验证不能替代真实 Supabase 项目的邮件、会话刷新和部署验证。

真实项目另提供 `npm run test:cloud -- --allow-cloud-test-writes`，需要独立测试项目和两个真实测试账号；准备方式见 [云端验收脚本说明](docs/SUPABASE_SETUP.md#8-真实双账号-sdk-验收脚本)。该脚本会创建并保留 A/B 样本，仅删除本次创建的级联测试小说；它不能代替跨浏览器、断网草稿和自动保存界面验收。

## 数据与资料

正式内容保存在 Supabase；本地草稿是恢复副本，不是云端备份。`localhost` 与 `127.0.0.1` 是不同浏览器来源，请固定一个地址使用。旧作品不会自动上传，需在原来保存作品的浏览器与地址里选择“导入本地作品”。

- [配置 Supabase 与双账号权限验证](docs/SUPABASE_SETUP.md)
- [Phase 2.5 云端验收状态与待办](docs/PHASE_2_5.md)
- [第二阶段功能、表结构、变更文件、测试与第三阶段建议](docs/PHASE_2.md)
- [当前架构与数据约定](docs/ARCHITECTURE.md)
- [第一阶段历史交付记录](docs/PHASE_1.md)

第一阶段示例和本地仓库仍保留在代码中，用于兼容与迁移。首页插画继续使用 `public/story-world.png`。
