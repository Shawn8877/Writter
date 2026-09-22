# 第一阶段交付与验收

状态：已完成第一阶段；没有连接 Supabase 或 OpenAI。

## 页面与交互

- [x] 初始化 Next.js、JavaScript、Tailwind CSS 工程。
- [x] 首页：指定标题、副标题与两个入口，深色视觉、小说预览与记忆介绍。
- [x] Dashboard：作品卡片、搜索、我的草稿／示例分类、真实数据统计。
- [x] 创建表单：十种题材、创意、风格、三项目标、主角描述、必填与正整数校验。
- [x] 三栏小说工作台、统一导航、移动导航与 AI 助手侧栏。
- [x] 作品概览与核心设定编辑。
- [x] 总纲、分卷、章节大纲。
- [x] 人物新增、编辑与搜索。
- [x] 世界规则、地点、物品、能力、伏笔与回收记录。
- [x] 时间线与事件分类。
- [x] 章节新增、切换、正文与大纲编辑、手动摘要、保存与临时恢复。
- [x] 六个章节 AI 按钮均只显示功能未接入提示。
- [x] 服务端 AI 占位接口与 Supabase 仓库边界。
- [x] 本地存储失败、无内容、未知小说和 404 反馈。

## 已执行的检查

| 检查 | 结果 |
| --- | --- |
| `npm run dev` | 已启动，首页及全部业务页面可正常运行 |
| `npm run build` | 生产构建成功，九条业务路由及占位 API 编译通过 |
| `npm run lint` | 无错误、无警告 |
| 九条路由直接访问 | 全部 HTTP 200，标题与内容正常 |
| 桌面 1440 × 1000 | 全部页面无文档级横向溢出 |
| 手机 390 × 844 | 全部页面无文档级横向溢出，助手可打开与关闭 |
| 浏览器控制台 | 全路由与主流程无 JavaScript 错误、无控制台 error |
| 创建表单 | 空创意、负数拒绝；有效数据建立本地草稿并刷新恢复 |
| 章节操作 | 正文保存并刷新恢复、章节切换、摘要同步成功 |
| 人物与伏笔 | 人物保存与刷新恢复、伏笔回收状态与记录保存成功 |
| 浏览器后退／前进 | 未保存正文可从当前标签页临时缓存恢复 |
| 取消新增章节 | 保留当前未保存正文及恢复缓存，不误删临时内容 |
| 多标签页 | 旧标签页保存被明确阻止，新标签页创建的作品保留 |
| 存储损坏 | 展示示例并报错，原数据不被覆盖 |
| 存储容量／权限错误 | 明确报错，创意输入保留，不误报保存成功 |
| AI 按钮 | 六个操作未修改正文，未请求 `/api/ai` |
| 外部请求 | 主流程无 OpenAI、Supabase 请求 |
| API 边界 | 有效占位请求 501；非法操作与损坏 JSON 400 |
| 无效页面 | 未知小说有明确反馈；未知静态路径 HTTP 404 |

本机 Codex 环境提供 Node.js 与 pnpm，未提供全局 npm；验证时通过打包的 npm CLI 执行同一份 `dev`、`build` 脚本。标准安装了 Node.js 与 npm 的终端可直接使用 README 中的命令。

浏览器验收使用隔离会话，测试作品没有写入用户的日常浏览器。检查脚本、截图和机器可读结果保存在忽略目录 `artifacts/`。

## 完整新增文件清单与结构

初始目录为空，以下均为本阶段新增文件。`AGENTS.md` 与 `CLAUDE.md` 由 Next.js 开发服务器生成。未引入 TypeScript 应用源码、Supabase SDK 或 OpenAI SDK。

```text
Write/
├── .env.example
├── .gitignore
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── package.json
├── package-lock.json
├── jsconfig.json
├── next.config.mjs
├── postcss.config.mjs
├── eslint.config.mjs
├── docs/
│   ├── ARCHITECTURE.md
│   └── PHASE_1.md
├── public/
│   ├── favicon.svg
│   └── story-world.png
└── src/
    ├── app/
    │   ├── layout.js
    │   ├── globals.css
    │   ├── page.js
    │   ├── loading.js
    │   ├── error.js
    │   ├── not-found.js
    │   ├── api/ai/route.js
    │   ├── dashboard/page.js
    │   ├── create/page.js
    │   └── novel/[id]/
    │       ├── layout.js
    │       ├── page.js
    │       ├── outline/page.js
    │       ├── characters/page.js
    │       ├── world/page.js
    │       ├── timeline/page.js
    │       └── chapters/page.js
    ├── components/
    │   ├── brand.js
    │   ├── site-header.js
    │   ├── studio-provider.js
    │   ├── ui.js
    │   ├── create/
    │   │   └── create-novel-form.js
    │   ├── dashboard/
    │   │   ├── dashboard-view.js
    │   │   └── novel-card.js
    │   └── novel/
    │       ├── novel-shell.js
    │       ├── novel-context.js
    │       ├── ai-assistant.js
    │       ├── record-form.js
    │       ├── overview-view.js
    │       ├── outline-view.js
    │       ├── characters-view.js
    │       ├── world-view.js
    │       ├── timeline-view.js
    │       ├── chapters-view.js
    │       └── chapter-editor.js
    ├── lib/
    │   ├── domain/novel.js
    │   ├── hooks/use-unsaved-changes.js
    │   ├── mock/novels.js
    │   ├── repositories/
    │   │   ├── local-novel-repository.js
    │   │   └── chapter-draft-cache.js
    │   └── server/
    │       ├── ai-service.js
    │       └── supabase-repository.js
    └── styles/
        ├── app.css
        └── workspace.css
```

本地运行产物 `node_modules/`、`.next/` 与验收产物 `artifacts/` 均被忽略，不属于产品源码。

## 暂未实现

用户登录、云同步、真实 AI 生成、自动记忆提取、百万字数据分片、计费与部署均不在本阶段范围。具体顺序见 [第二阶段建议](ARCHITECTURE.md#第二阶段建议先建立可靠的数据基础)。
