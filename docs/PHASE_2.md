# 第二阶段交付记录

## 范围与状态

验收日期：2026-09-20。第二阶段代码与本地验收完成；真实项目部署与线上验收待配置。

本文保留第二阶段交付时的历史状态。2026-10-08 的真实 Supabase 连接、修复和验收结果以 [PHASE_2_5.md](PHASE_2_5.md) 为准，不需要重新创建项目或测试账号。

在第一阶段现有项目上增加 Supabase 账号、数据库持久化、权限、章节版本与长期记忆，没有重建项目或更换 UI，也没有 TypeScript 应用源码。AI 按钮继续占位，没有任何模型请求。

**真实 Supabase 项目尚未连接验收：当前未提供项目 URL 与公开 key，未创建 `.env.local`，未向线上数据库执行迁移。** 代码、迁移和本地测试可先交付；配置项目后需完成 [真实账号验收步骤](SUPABASE_SETUP.md)。不能把本地测试替身视为线上认证服务已通过。

## 已实现

- 邮箱密码注册、登录、退出、Cookie 会话保持；受保护页面服务端跳转登录，外部小说 UUID 由服务端拒绝。
- 新建数据库小说、默认 Novel Bible、第一卷与第一章；UUID 路由与当前账号作品库。
- 手动编辑小说、核心设定、总纲、分卷、人物、世界观、时间线、章节与摘要。
- 作品搜索、状态筛选、章节数与数据库总字数、最近更新、保留原有主题封面、删除二次确认。
- 章节输入立即写本地临时缓存，1 秒 debounce 云端自动保存，错误提示、刷新恢复与重试。
- 小说与章节独立版本检查；数据库事务阻止过时写入。多标签冲突保留草稿、暂停保存，可复制后核对云端。
- 明确“保存版本”才插入正文快照，历史显示来源、时间、字数、内容，不能直接覆盖历史。
- `/novel/[id]/memory` 的新增、编辑、删除、类型筛选、重要度、状态和来源链接。
- 世界观页地点／物品／能力／伏笔与记忆中心共用真实记录，失效伏笔不会被其他页面编辑重新激活。
- 原有 localStorage 库保留，提供明确的导入确认；不自动上传、删除原稿或把无账号旧草稿自动归给新账号。

## 数据库表

| 表 | 用途 |
| --- | --- |
| profiles | 与 auth.users 同 ID 的笔名、头像资料，注册触发创建 |
| novels | 小说所有者、类型、风格、创意、目标、状态、封面、总纲和版本号 |
| volumes | 分卷名称、摘要、顺序、范围与关键节点 |
| chapters | 正文、大纲、摘要、字数、状态、卷归属与章节版本号 |
| chapter_versions | 重要正文快照、来源和保存时间；自动保存不产生快照 |
| characters | 人物身份、目标、性格、关系、能力、状态、首次出场与生存状态 |
| world_entries | 世界规则、组织、地点等分类设定与扩展 metadata |
| timeline_events | 故事时间、事件、关联章节、人物与重要度 |
| novel_bible | 每本小说唯一的最高级设定、主线、风格、冲突、结局和禁止变更项 |
| chapter_summaries | 每章摘要及未来的事件、人物变化、新信息、伏笔 JSONB |
| memory_items | 独立长期事实、类型、1–5 重要度、状态、来源与章节上下文 |

完整 SQL：[001_initial_schema.sql](../supabase/migrations/001_initial_schema.sql)，包含表、索引、外键、枚举约束、RLS policies、触发器及事务 RPC。扩展字段为未来数据留位，不代表 AI 提取功能已实现。

## RLS 如何工作

profiles 限定 `id = auth.uid()`，novels 限定 `user_id = auth.uid()`。其他资源通过 novel_id 查询小说所有者；chapter_versions 沿章节关联小说。读取、更新、删除使用 USING，写入使用 WITH CHECK，未登录角色不获业务表授权。

页面 layout 和 API 独立校验账号／所有者；数据库 RLS 是最终保护，即使直接调用 Supabase REST 也不能读取或修改别人的作品。业务 RPC 按调用者权限执行，无 service role。复合外键、来源校验和关系不可变 trigger 还会拒绝跨小说引用及迁移记录归属。

数据库内原子比较 revision 后再更新。保留的历史版本不可普通修改；删除小说时从属资料级联删除。只有历史快照的版本号保护不足以保证权限，因此 RLS 和版本检查同时存在。

## 配置与账号测试

详细步骤见 [SUPABASE_SETUP.md](SUPABASE_SETUP.md)。简要流程：

1. 创建 Supabase 测试项目，取得项目 URL 和公开 anon/publishable key。
2. 按 `.env.example` 建立本地 `.env.local`；不要填写 secret/service_role。
3. 在 SQL Editor 一次性执行正式迁移，确认 public 下 11 表都已启用 RLS。
4. 配置 Auth 站点地址与邮件回调，固定 localhost 或 127.0.0.1 中的一个来源。
5. 重启开发服务，用两个不同浏览器会话注册 A/B。需要邮箱确认时先完成邮件确认。
6. A 创建小说；B 手动输入 A 的 UUID 页面及 API 应被拒绝；以 B 的真实用户会话直接请求数据库也应返回零行或拒绝。

## 验收与限制

本地自动化包含三个层次：

| 层次 | 覆盖 | 结果 |
| --- | --- | --- |
| `npm run test:db` | PGlite 执行真实迁移、11 表隔离、伪造所有者、跨小说来源、原子冲突、摘要同步、版本与级联 | 通过 |
| `npm run test:repository` | 实际服务端适配器连 PostgreSQL，CRUD、隐藏 JSON 保留、记忆投影、字数、章节版本及 Origin 校验 | 通过 |
| 主流程浏览器联调 | 实际 Next、SSR Cookie、CRUD、保存、刷新恢复、版本、记忆来源、退出重登录、双账号读写隔离、删除确认与移动布局 | 15 项通过 |
| 边界浏览器回归 | 六个 AI 按钮不请求模型、保存中继续输入、离页后保存、旧表单覆盖保护、320/390px 布局、旧稿完整导入 | 7 项通过 |
| 公开页面浏览器检查 | 首页、无配置账号页面、受保护路由、无效邮件回调、固定访问来源、320/390px 布局与控制台 | 25 项通过 |
| 生产构建与 lint | package.json 中 Next build、ESLint 检查入口 | 全部通过，lint 无错误或警告 |

合计 **47 项浏览器检查通过**，非预期控制台错误、页面异常均为 0。结果位于 `artifacts/phase2/{browser-results,edge-results,public-results}.json`，截图在同目录，已检查桌面与手机页面。开发服务正常运行。此机器没有全局 npm，构建及 lint 使用对应 Node 入口执行，与 package.json 脚本一致。

浏览器里的 Auth/PostgREST 为本地测试替身，SQL/RLS 为真实迁移。双账号验证覆盖读取、更新、删除、章节写入和版本查询的 404 拒绝。Next.js 流式 notFound 页面可能使用 200 响应外壳；测试同时确认服务器拒绝数据访问、页面不含他人标题或工作台，不能只凭页面外壳状态判断权限。

修复了两类真实并发问题：失效伏笔在世界观页被重新编码为有效，以及已打开的旧表单误用后台刷新后的新版本号。另修复本地 Origin 校验、邮件回调来源保持与手机端退出按钮换行。断网恢复测试早期失败是测试脚本把实际 POST 误当 PATCH 拦截，修正测试后，保存失败提示、刷新恢复和重试均已验证。

测试服务只绑定本机，不需要或读取真实 key，不写 `.env.local`。Next 测试实例使用 `.next-test`，与普通开发实例分开。需要浏览器测试时分别运行：

```bash
node scripts/testing/supabase-fixture.mjs
node scripts/testing/start-fixture-app.mjs
node scripts/testing/browser-phase2.mjs
node scripts/testing/browser-edge-phase2.mjs
```

浏览器检查需要环境中可用的 Playwright 包与 Chrome；可用 `PLAYWRIGHT_MODULE` 指向已安装 Playwright 的 `index.mjs`。`browser-public.mjs` 另对未配置 Supabase 的普通开发服务 `127.0.0.1:3000` 执行检查，不能用于已配置的实例。这些是测试工具，不是平台运行依赖。测试记录存于内存，停服务后丢弃。不要将测试服务暴露到公网。真正的 Supabase 邮件投递、PKCE、刷新令牌轮换及托管 REST 行为仍需在实际项目验证。

## 新增与修改文件

第二阶段实施时工作区尚未初始化 Git，以下按阶段实施记录列出文件变更。

| 分组 | 文件 |
| --- | --- |
| 配置 | `package.json`、`package-lock.json`、`.env.example`、`.gitignore`、`next.config.mjs`、`eslint.config.mjs` |
| 文档 | `README.md`、`docs/ARCHITECTURE.md`、`docs/PHASE_2.md`、`docs/SUPABASE_SETUP.md` |
| 迁移与权限测试 | `supabase/migrations/001_initial_schema.sql`、`supabase/tests/rls.sql` |
| 检查脚本 | `scripts/test-database.mjs`、`scripts/test-repository.mjs`、`scripts/testing/supabase-fixture.mjs`、`scripts/testing/start-fixture-app.mjs`、`scripts/testing/browser-phase2.mjs`、`scripts/testing/browser-edge-phase2.mjs`、`scripts/testing/browser-public.mjs` |
| Supabase 与认证 | `src/lib/supabase/{config,client,server,proxy}.js`、`src/lib/auth/server.js`、`src/proxy.js` |
| 仓库与模型 | `src/lib/server/{supabase-repository,request-origin}.js`、`src/lib/repositories/{auth-repository,cloud-novel-repository,cloud-chapter-repository,chapter-draft-cache,legacy-import}.js`、`src/lib/domain/{novel,memory}.js`、`src/lib/hooks/use-unsaved-changes.js` |
| 认证页面与保护 | `src/app/{login,register}/page.js`、`src/app/auth/{callback,confirm}/route.js`、`src/app/{dashboard,create}/layout.js`、`src/app/novel/[id]/layout.js` |
| 数据 API | `src/app/api/novels/route.js`、`src/app/api/novels/[id]/route.js`、`src/app/api/chapters/[id]/route.js`、`src/app/api/chapters/[id]/versions/route.js`、`src/app/api/ai/route.js` |
| 首页与通用 UI | `src/app/page.js`、`src/app/globals.css`、`src/components/{studio-provider,site-header,ui}.js` |
| 账号与作品 | `src/components/auth/{auth-form,auth-controls}.js`、`src/components/dashboard/{dashboard-view,legacy-import}.js`、`src/components/create/create-novel-form.js` |
| 小说工作台 | `src/components/novel/{novel-shell,record-form,overview-view,outline-view,characters-view,world-view,timeline-view,chapters-view,chapter-editor,chapter-versions,memory-view}.js`、`src/app/novel/[id]/memory/page.js` |
| 样式 | `src/styles/{auth,chapters-phase2,phase2}.css` |

第一阶段 `docs/PHASE_1.md`、本地仓库、示例与插画作为历史兼容资料保留。

## 项目结构

```text
NovelAI Studio/
├── docs/                         架构、配置、阶段记录
├── public/                       既有插画与图标
├── scripts/
│   ├── test-database.mjs
│   ├── test-repository.mjs
│   └── testing/                  独立本地联调工具
├── supabase/
│   ├── migrations/001_initial_schema.sql
│   └── tests/rls.sql
├── src/
│   ├── app/
│   │   ├── api/{ai,novels,chapters}/
│   │   ├── auth/{callback,confirm}/
│   │   ├── login/ register/ dashboard/ create/
│   │   └── novel/[id]/{outline,characters,world,timeline,chapters,memory}/
│   ├── components/{auth,dashboard,create,novel}/
│   ├── lib/{auth,supabase,repositories,server,domain,hooks,mock}/
│   ├── styles/
│   └── proxy.js
├── .env.example
└── package.json
```

## 未实现与第三阶段建议

当前没有真实项目部署、邮件线上验收、密码找回、版本一键恢复、头像／封面上传、离线新建作品、实时协作。世界观／人物／时间线主要复用现有新增编辑 UI，没有新增全部字段的管理表单。

百万字能力需要下一步优化：当前为了兼容 UI 仍按完整小说聚合读取；应先改轻量作品列表、按章加载、版本分页与较大草稿的 IndexedDB 存储，再接生成。

第三阶段建议顺序：

1. 先完成真实 Supabase 部署和双账号验收，再处理长文本按章加载、限流、配额与审计。
2. 在服务端接 OpenAI，先实现设定、总纲、分卷与章节大纲，API Key 仅在服务器。
3. 单章生成保存为明确来源的候选版本，支持流式输出、取消、重试和幂等提交。
4. 从章节提取摘要及结构化记忆变更，验证 source_id、人物状态、伏笔回收后提交；设定冲突向用户展示依据。
5. 基于 Novel Bible、相关人物、近章摘要和未回收伏笔组装受预算约束的上下文，再评估检索与连续生成。

此处仅为建议，本次停止在第二阶段，不启动上述 AI 工作。
