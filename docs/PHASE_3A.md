# Phase 3A — AI Novel Builder

验收日期：2026-10-09（北京时间）。继续现有项目，保留深色 UI、三栏工作台、账号、章节与 Memory；未重建项目，没有 TypeScript 应用源码。

**AI 代码完成，但真实 API smoke test 未执行。** 用户明确选择 OpenAI，并选择稍后配置密钥、先完成代码。当前 `.env.local` 未配置 `OPENAI_API_KEY`，没有实际 OpenAI 模型调用或费用。样例通过不能视为模型质量或真实 API 可用性已验证。最终判定：**NOT READY FOR PHASE 3B**。

## 前置检查

Phase 2.5 已就绪。开发前用现有 A/B 账号重新验证真实 Supabase、Auth、RLS 和已保存正文，全部通过；证据 `artifacts/phase3a/preflight.json`。沿用项目 `stefdozqmqznfzfxnkjz`，不重新注册账号，不改变用户原小说。

## 实现范围

`/create` 输入创意 → 服务端构建 → 同页可编辑预览 → 明确确认 → Supabase 原子资料包 → 小说工作台。

原有“创建小说”按钮仍可手动建书。AI 只生成基础设定、核心人物、世界、初始记忆与宏观故事阶段；默认第一章仅 planned、正文为空。未实现 AI 正文、分卷详细大纲、几百章章节大纲、连续写作、自动摘要/记忆更新、RAG、Embedding、向量库或 Agent。

## SDK、模型与服务器配置

- 官方 `openai` JavaScript SDK 7.30.1，Zod 4.6.5；`responses.parse` + `zodTextFormat`。
- 配置集中在 `src/lib/ai/config.js`，默认 `gpt-6.1-sol`，实际调用模型以 `OPENAI_MODEL` 为准。默认模型使用 low reasoning，其他可配置模型不盲目附加该参数。
- 客户端位于 `openai.js`，带 `server-only`，固定官方 API 地址，不接受浏览器传入 key、模型或代理 URL。
- 使用 `store:false`；最多 24000 output tokens，240 秒超时，SDK 自动重试关闭。Route 最长运行时间设置 300 秒，部署平台仍需支持相应运行时长。
- `.env.example` 中 `OPENAI_API_KEY`、`OPENAI_MODEL` 都是空值。真实值只允许设置在服务器 `.env.local` 或部署平台环境变量，禁止 `NEXT_PUBLIC_*` 和 Git。
- 未配置 key 时返回 `AI_NOT_CONFIGURED` 中文提示；不保留 mock 成功分支，也不自动转用 DeepSeek。

参考：[Responses Structured Outputs 官方文档](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)、[默认模型官方文档](https://developers.openai.com/api/docs/models/gpt-6.1-sol)。文档支持不代表当前账户已取得模型权限，仍需真实 smoke test。

## Schema 和一致性

输入包含 genre、premise、style、protagonistHint、targetWordCount、targetChapterCount、chapterWordTarget；可选 audience、pace、romanceLevel、darknessLevel、specialRequirements。创意最多 500 字，主角 1000 字，特殊要求 1500 字；AI 构建支持 8–2000 章、1000–1000 万字、单章 100–50000 字。原有手动创建限制保持独立。

输出包含全部请求字段：title、alternativeTitles、synopsis、shortPitch、genre、subgenres、targetAudience、tone、writingStyle、corePremise、coreSellingPoints、mainConflict、storyThemes、protagonist、majorCharacters、antagonists、world、powerSystem、relationships、storyStages、romanceDirection、endingDirection、forbiddenChanges、seedMemories。

Schema 使用严格对象，禁止未知字段，限制所有字符串与数组大小。5–10 个核心配角、3–8 个具体卖点、8–12 个宏观阶段、10–30 条初始记忆。powerSystem 不启用时名称与描述为 null、其余列表为空；启用时必须有规则、限制、成长、代价和禁止用途。

服务端额外验证：主角与核心配角姓名唯一，关系只能引用已定义人物/对手；阶段与记忆的 characterNames 使用规范姓名；每阶段关联主角，至少一条人物记忆明确记录主角姓名与身份；检查显式相冲突的主角姓名断言。故事阶段从 1 章连续覆盖全部目标章节，不能重叠、倒序或缺尾。

以上检查保障结构和明确引用，不宣称能发现自由文本中的一切语义矛盾。悬疑简介不剧透、题材自然性、人物成长和能力代价仍需真实生成与人工审阅。

## Prompt 架构

`prompts/novel-builder.js` 以资深网文策划、故事架构、人物设计、连续剧情规划的职责约束输出；强调独立动机、递进冲突、长期升级空间与代价，不开局耗尽设定或解决最终矛盾。

创意以独立 user 消息中的 JSON 数据传入。系统规则明确将其视为素材，不执行其中覆盖规则、泄漏指令或数据库密码的要求。按不同题材安排社会、经济、技术/修炼约束；现实都市和普通言情不强塞超能力。禁止复制具体小说、已有角色与标志性世界观，不模仿在世作者独特文风。

## API、预览和错误

| 接口 | 行为 |
| --- | --- |
| `POST /api/ai/novels/build` | Session → 同源/体积检查 → 输入校验 → 配置检查 → 限流/唯一 requestId → OpenAI → 结构与一致性校验 → 完成元数据 → 返回 Preview |
| `POST /api/novels/ai-confirm` | 再鉴权 → 严格 payload/schema/一致性校验 → 校验原始输入摘要 → 关系字段映射 → 事务 RPC → 返回 novelId |

预览使用分区卡片、人物资料和阶段列表，不直接展示 JSON。可编辑书名、简介、核心设定、冲突、结局。复杂数组当前只读。重新生成明确提示替换整份预览、再次产生调用，失败保留原预览与修改；取消需确认，不改动已保存小说。

等待动画说明自己是单次请求的等待提示，不虚称多个独立子任务已完成。页面与服务端同时防重；账号就绪后才展示表单，切换账号卸载旧预览。预览只在当前页面内存，未确认时离开有浏览器提示，刷新仍可能丢失。确认成功后拉取完整聚合再跳转，无需手动刷新。

缺少 key、OpenAI 401/403/429、超时、网络失败、模型不可用、拒绝、结构异常、session 失效、数据库失败均有中文提示。日志仅保留问题编号、错误类别和 provider request ID，不输出密钥、Prompt、SQL 或完整内部错误。数据库失败可用同一预览安全重试。

## 数据库设计与映射

新增迁移 `003_ai_novel_builder.sql` 已应用到现有真实项目。001/002 不变。003 SHA256：`3C6039B90AB5B7F846DA16B671C610B4E1E9596A818E2AC6BDFE13E90898F909`。

| AI 数据 | 正式存储 |
| --- | --- |
| 书名、简介、题材、核心创意、篇幅 | novels |
| 主角、核心人物、对手 | characters，关系/状态等结构保留于其现有字段 |
| 地点、组织、概念、规则、时代 | world_entries，分别使用 location/organization/concept/rule/history |
| 能力体系 | Bible power_system；启用时另建 category=system 的世界条目 |
| 核心设定、规则、基调、文风、主角成长、冲突、能力、感情、结局、禁止改动 | novel_bible 对应正式字段；每本唯一 |
| 8–12 个宏观阶段 | novel_bible.story_stages JSONB，大纲页单独展示 |
| 备选名、卖点、主题、读者定位等少量补充 | novel_bible.builder_metadata JSONB |
| 初始事实 | memory_items，source_type=ai、metadata 记录 generationId/schemaVersion/人物引用 |
| 默认创作入口 | 第一卷 + planned 第一章，正文和章节大纲为空 |

没有把整份 AI JSON 存入单个 JSONB，也不默认存完整 Prompt 或响应副本。

`create_ai_novel_bundle` 是 SECURITY INVOKER，所有者只能来自 auth.uid()。它检查成功的生成记录、输入 SHA256、schema 版本，以账号+generationId 事务锁串行确认。任何子表写入失败均回滚整本小说。`ai_novel_bundles` 保存唯一回执；重复确认返回同一小说 ID，不覆盖修改；删除小说后回执保留空引用，不能重建重复副本。

`ai_generation_logs` 仅记录 requestId、输入摘要、模型、schema 版本、状态、token 用量、耗时、provider request ID、错误类别。字段 token 数量来自真实 SDK response；自动测试报告中的 1200/5800 仅是明确标记的测试值，不是实际消耗。

生成计数由两个窄范围 SECURITY DEFINER 函数维护，固定 search_path、强制 auth.uid()、无动态 SQL。普通客户端只能读取自己的非敏感元数据，无 INSERT/UPDATE/DELETE 权限，lease_token 不可读；完成请求需匹配服务器随机租约。每账号同一时间最多 1 个生成、每小时 6 次、租约 5 分钟到期。多进程和多标签共享数据库限制；进程崩溃可能需等租约过期，不会永久卡死。

## 测试与证据

结果保存在 Git 忽略的 `artifacts/phase3a/`。测试替身只在 `scripts/testing`，生产代码不读取测试开关；测试进程通过显式 preload 将 SDK 的请求转给本机 fixture，并移除 Authorization，绝不会拿假响应冒充真实 AI。

| 验收 | 结果 |
| --- | --- |
| 16 组 AI/数据库测试 | 通过：4 题材 × 100/300/800 章、SDK 结构输出、输入/一致性、错误、两 API 鉴权、事务回滚、幂等、A/B 权限、租约与限流 |
| 隔离浏览器流程 | 11 组通过：完整流程、重新生成失败保留修改、移动端、保存失败重试、完整 Bible/各页面、B 越权、取消、429/异常结构、手动创建、脚本就绪前登录保护 |
| 真实 Supabase + 测试方案浏览器 | 6 组通过：真实缺密钥错误、预览不建书、修改确认、关系表/各页面、重复确认、B 不能读取或确认 A |
| 真实 OpenAI smoke test | **未执行：没有配置 key，用户选择稍后配置** |
| 原有数据库 / Repository | 通过 |
| 原有真实 SDK 数据库回归 | 9 组通过，未破坏保存、CAS、来源与级联 |
| 原有真实浏览器回归 | 14 组全部通过，console / hydration / 非预期 HTTP 错误为 0 |
| lint / build / 安全扫描 | 全部通过；扫描 129 个源码文件、28 个浏览器产物，未发现实际密钥或测试密码 |

已保存一部清晰命名为 `Phase 3A 样例验收 · 2026-10-09` 的测试小说，归 A 测试账号，UUID 为 `f8db9149-d1e6-4c53-a33c-78376bde8808`。其内容来自固定样例，不是模型真实生成。

主要证据：

- `artifacts/phase3a/unit-database.json`
- `artifacts/phase3a/browser-cloud-2026-10-09T05-18-22-767Z/results.json`，真实 Supabase 测试，errors=[]
- `artifacts/phase3a/browser-fixture-2026-10-09T06-14-44-097Z/results.json`，11 组浏览器通过，errors=[]
- `artifacts/phase2.5/cloud-2026-10-09T05-22-17-193Z-b2c51d35.json`，旧数据库回归
- `artifacts/phase2.5/browser-2026-10-09T06-14-47-388Z/results.json`，14 组旧浏览器回归通过，errors=[]
- `artifacts/phase2.5/security.json`，源码与生产浏览器资源扫描通过

## 复验方法

本机 Node 已存在，无全局 npm，使用忽略目录下官方 npm 11.6.2 执行相同 scripts。标准环境可直接：

```sh
npm run lint
npm run test:db
npm run test:repository
npm run test:ai
npm run build
npm run test:security
npm run test:browser:ai
```

浏览器测试需 Chrome + Playwright；本机通过 `PLAYWRIGHT_MODULE` 指向已有运行时包。云端脚本还需 `NOVELAI_BROWSER_BASE` 指定本地网站地址，默认 `http://localhost:3000`；账号文件使用既有 `.tools/cloud-test-accounts.json`，必须标记为 disposableTestProject 并匹配 projectRef，不包含于 Git。详见 [Supabase 测试配置](SUPABASE_SETUP.md)。

```sh
npm run test:cloud -- --allow-cloud-test-writes
npm run test:browser:cloud -- --allow-cloud-test-writes
npm run test:browser:ai:cloud -- --allow-cloud-test-writes
```

未来在本地填好 `OPENAI_API_KEY` / `OPENAI_MODEL`，重启网站后，下面一条命令才会真正请求一次 OpenAI，并验证修改、确认、各表与账号隔离：

```sh
npm run test:ai:smoke -- --allow-cloud-test-writes
```

脚本只对已有测试账号操作，不输出密码/key/session；不会因失败自动退回 fixture。多次重跑云端 AI 方案测试仍会计入每账号每小时 6 次限额。

## 文件结构与变更

```text
src/lib/ai/
  config.js                 模型、超时与体积上限
  openai.js                 server-only 官方客户端
  errors.js                 中文错误与安全日志
  route-handler.js          两接口共有鉴权/同源处理
  schemas/novel-builder-schema.js
  prompts/novel-builder.js
  services/novel-builder-service.js
  services/builder-workflow.js
  services/novel-bundle-mapper.js
src/app/api/ai/novels/build/route.js
src/app/api/novels/ai-confirm/route.js
src/components/create/
  create-novel-form.js       扩展既有表单
  use-novel-builder.js       预览/生成/确认状态
  builder-status.js
  novel-plan-preview.js
src/components/novel/bible-details.js
src/styles/novel-builder.css
supabase/migrations/003_ai_novel_builder.sql
scripts/test-ai.mjs
scripts/testing/{novel-builder-fixtures,register-server,browser-ai-builder,browser-ai-cloud}.mjs
scripts/testing/openai-fixture-preload.cjs
```

其余修改：`.env.example`、`package.json`/lock、框架生成的 `AGENTS.md` 标题级别、`src/app/globals.css`、`overview-view.js`、`outline-view.js`、`world-view.js`、`src/components/auth/auth-form.js`、`src/styles/auth.css`、`src/lib/domain/memory.js`、`src/lib/server/{supabase-repository,ai-service}.js`、`scripts/test-security.mjs`、已有 `supabase-fixture.mjs`/`browser-cloud.mjs`、README、ARCHITECTURE、SUPABASE_SETUP 与本文。

回归额外修复：旧登录/注册表单在 hydration 前可能按浏览器默认 GET 提交，导致测试凭据进入本地地址与失败记录。已增加脚本就绪前的 disabled fieldset，并显式使用 POST；测试禁止脚本时无法提交。受影响的 A 测试账号密码已更换、重新登录验证，相关记录已脱敏；只涉及本次临时测试账号，未更改用户主账号。浏览器回归失败报告也不再记录可能带敏感 URL 的原始错误。证据 `artifacts/phase3a/auth-remediation.json`。

## 当前限制与后续

1. 阻塞真实验收：OpenAI key 未配置；模型账户权限、真实耗时、token 消耗和四题材实际输出质量尚未验证。不要据样例测试宣称真实 AI 已连通。
2. 未确认预览保存在内存；刷新丢失后需要重新生成，可能再次计费。生产部署需支持约 4–5 分钟请求，平台超时过短应先改任务队列，不扩大本次范围。
3. 列表仍读取旧聚合（含正文），百万字规模前应优化为轻量列表与按章节读取；本阶段没有假装完成百万字连续生成。
4. 依赖兼容更新后的锁文件使用 Next 16.4.0；`npm audit --omit=dev` 为 0 漏洞。开发依赖仍有 5 个 high 条目，来自同一 braces→micromatch→fast-glob→Next ESLint 链；现有自动修复建议会降级 ESLint 配置到 Next 14，故未强行采用。需跟进开发工具链上游修复。
5. 当前停止在 Phase 3A。先补一次真实端到端验收并审阅生成质量，再确定 Phase 3B 的宏观阶段展开/详细大纲范围；不提前编写正文、连续写作或长期记忆自动更新。

## 最终交付记录

`npm run dev` 正常运行；`lint`、`build`、原有 DB/Repository、16 组 AI 测试、11 组隔离浏览器、6 组真实 Supabase 样例浏览器、9 组原有云端数据库和 14 组旧浏览器回归通过。所有成功浏览器报告 errors=[]；预期的 401/404/429/503 负面用例单独识别。001/002 校验值保持原样，003 已真实部署。

Git 交付标题为 `Phase 3A: add AI novel builder`，目标 `https://github.com/Shawn8877/Writter` 的 `main`；本地密钥、账号、CLI 和 artifacts 不提交。具体提交编号与远端校验以交付回复为准。

**AI代码完成，但真实API smoke test 未执行。NOT READY FOR PHASE 3B。** 唯一真实 AI 验收阻塞是尚未配置密钥；实际模型权限、输出质量与耗时需在配置后验证。已停止于 Phase 3A，没有提前实现下一阶段功能。
