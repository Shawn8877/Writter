# 架构与后续扩展

## 分层

```text
App Router / Server Layout（验证账号、小说归属）
    ↓
页面组件 → StudioProvider / NovelContext
    ↓
cloudNovelRepository / cloudChapterRepository（同源 HTTP）
    ↓
Route Handlers → getApiAuth → server-only Supabase Repository
    ↓
当前用户 Cookie 会话 → SQL RPC / 事务 / RLS

authRepository → @supabase/ssr Browser Client
Proxy / Server Client → 认证服务校验与 Cookie 刷新
章节编辑器 → 按账号、小说、章节、编辑实例隔离的 localStorage 恢复草稿

创建表单 → /api/ai/novels/build → server-only Novel Builder Service
    → DeepSeek Responses JSON Schema → Zod + 一致性校验 → 预览
预览修改 → /api/novels/ai-confirm → 再鉴权、校验 → create_ai_novel_bundle
    → 同一数据库事务创建所有小说资料 → 刷新聚合并进入工作台
```

保留第一阶段页面组件、布局、颜色与交互。`src/app` 负责路由装配和服务端入口；组件不直接访问数据库 SDK。小说资源采用聚合仓库适配器，避免为每种表重复编写网络调用；UI 的 camelCase 模型在服务端统一映射为数据库字段。

## 身份与权限

浏览器客户端在 `src/lib/supabase/client.js`；`server.js` 使用当前请求的 `cookies()`；`src/proxy.js` 刷新会话并同步请求与响应 Cookie。鉴权使用 `auth.getUser()` 向认证服务校验，不信任浏览器 user_id 或单纯 getSession() 结果。

Dashboard、创建页、小说工作台有服务端 layout 保护。小说 layout 先验证 UUID、账号与 novels.user_id。所有数据 API 再独立鉴权，即使绕过页面仍受保护。

原有 11 表和 Phase 3A 新增的 ai_generation_logs / ai_novel_bundles 共 13 表全部开启 RLS：profiles.id / novels.user_id 对应 auth.uid()；子表沿 novel_id 关联所有者；版本通过 chapter_id → chapters → novels 判断。INSERT/UPDATE 使用 WITH CHECK，阻止伪造归属。应用只使用公开 key 加用户会话，不使用 service role 绕过权限。

业务 RPC 为 SECURITY INVOKER。少量注册、级联维护 trigger 使用受限权限与固定 search_path；应用事务仍校验拥有者和 RLS。来源触发器和复合外键限制跨小说引用，包括同一账号拥有的另一部小说。

写 API 检查 JSON、请求来源、大小和版本。401 表示未登录，404 表示不存在或无权访问，409 表示冲突／来源被引用，503 表示配置或服务不可用。账号切换清空内存作品库，过期请求不能回填另一账号状态。

## 数据模型

完整约束、外键、索引、触发器和 policies 位于 `supabase/migrations/001_initial_schema.sql`。`002_phase_2_5_fixes.sql` 修正三个事务 RPC 的冲突 SQLSTATE，不改变数据结构或权限。

`003_ai_novel_builder.sql` 为 Bible 增加 `story_stages` 与少量创作定位 `builder_metadata`，新增受保护的生成元数据与确认回执。人物、世界、记忆仍进入各自正式关系表，不把整个 AI JSON 塞入一列。宏观阶段在大纲页单独展示，不假装已经生成分卷或章节大纲。

- novels 存储基本信息、创作输入、目标、状态和总纲；novel_bible 对 novel_id 唯一。
- volumes / chapters 使用稳定 UUID，章节有独立 revision；修改其他设定不会让正文自动保存无谓冲突。
- chapter_versions 保留重要操作的正文快照。手动保存正文与插入版本在同一事务内完成；自动保存不插版本。历史不允许普通 UPDATE；整部小说删除时级联清理。
- characters、world_entries、timeline_events 保留现有表单字段和扩展 JSONB；编辑展示字段不抹去暂未展示的结构化信息。
- chapter_summaries 每章一条，手动摘要经触发器同步；结构化事件、人物变化和伏笔字段预留，不运行自动提取。
- memory_items 是长期事实的规范来源。世界观页的地点／物品／能力／伏笔是相同记录的投影。伏笔 active/resolved/obsolete 与中文标签无损映射。

记忆 source_type、source_id 指向章节、人物、世界资料或手工来源，chapter_id 可附加章节上下文。引用必须属于同一小说；来源仍被引用时单独删除会被拒绝，需先修改记忆。删除整部小说则原子级联。

`memory_items.source_id` 是多态引用，无法用一个普通外键同时指向三个来源表。迁移使用 `studio_validate_memory_source` 检查来源类型、记录存在性和小说归属，并通过 `studio_protect_source` 阻止删除仍被记忆引用的章节、人物或世界资料。`chapter_id` 另有复合外键。删除未被来源引用的章节会级联删除版本和摘要，并清空其他表的可选章节关联；删除分卷只清空章节的 `volume_id`，保留章节。2026-10-08 已通过真实云端来源保护、分卷/章节删除和整本小说级联验收。

## 自动保存与并发

1. 输入立即更新编辑区并写入 localStorage：`novelai-studio:chapter-draft:v2:<user>:<novel>:<chapter>:<writer>`。
2. 每个页面生命周期独立 writer，sessionStorage 记住前一个 writer 支持同标签刷新；其他恢复副本由用户明确选择。不同账号不混用。
3. 停顿 1 秒后携加载时的章节 revision 保存。数据库锁住小说和章节，原子比较更新，旧请求不能覆盖新正文。
4. 请求期间继续输入时，只确认已发送的 snapshotId；新草稿不会被清除，更新基线后继续保存。
5. 成功显示“已保存”；失败保留草稿并可重试，恢复 online 时尝试重试。localStorage 容量不足会单独提示。
6. 409 冲突暂停自动保存，保留编辑区，提供复制与明确确认后的云端加载。
7. 章节保存后后台刷新完整小说；只有完整聚合响应提升小说 revision，避免把旧设定标为最新。
8. 非章节表单固定打开时的小说 revision；编辑期间发生聚合更新时保留输入并要求核对，数据库仍对远端版本做最终检查。

业务版本冲突使用 SQLSTATE `PT409`，由托管 PostgREST 直接返回 HTTP 409。不要用 `40001` 表示这种永久冲突：它代表 serialization_failure，部分托管版本会反复重试。002 已修正章节保存、小说更新与删除；真实三个 RPC 和两窗口 UI 均通过。Repository 保留对旧 40001 的兼容映射，但现有数据库必须执行 002。

已保存字数由数据库去除空白后计算，包含标点；总字数汇总 word_count。编辑器当前字数是尚在编辑的文本预览。

## 第一阶段迁移

旧 `novelai-studio:novels:v1` 与 localNovelRepository 保留，不再作为正式仓库。Dashboard“导入本地作品”明确选择并确认目标账号，创建新 UUID 并映射内部引用。原浏览器数据不删除，重复导入创建副本。若创建成功但内容导入失败，提示云端空白作品，用户核对后删除重试。

原有无账号章节草稿只允许明确确认恢复。不同浏览器来源的 localStorage 无法相互读取。

## 接口

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/novels` | GET / POST | 个人作品列表 / 创建小说及默认资料 |
| `/api/novels/[id]` | GET / PATCH / DELETE | 读取、按 revision 更新、删除 |
| `/api/chapters/[id]` | POST | 独立章节自动保存或保存版本 |
| `/api/chapters/[id]/versions?novelId=…` | GET | 授权后读取历史版本 |
| `/auth/callback` | GET | PKCE 邮件回调 |
| `/auth/confirm` | GET | token_hash 邮件确认 |
| `/api/ai` | POST | 鉴权后返回 501，占位且 UI 不调用 |
| `/api/ai/novels/build` | POST | 生成可编辑预览，仅写生成元数据，不建小说 |
| `/api/novels/ai-confirm` | POST | 再验证方案，事务保存、幂等返回小说 ID |

## AI 构建的请求与保存边界

模型和限额集中在 `src/lib/ai/config.js`；客户端、提示词、服务均 `server-only`。`deepseek.js` 使用 OpenAI 兼容 SDK，固定请求 `https://api.deepseek.com/responses`；通过 `text.format` 发送 JSON Schema，使用 `reasoning.effort=low`，返回后由 Zod 再验证字段和跨字段一致性。单次输出最多 24000 tokens，240 秒超时，不自动重试收费请求。默认 `deepseek-flash`，只读取 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` 和可选 `DEEPSEEK_PROXY_URL`，不使用旧 OpenAI 凭据。前端没有 SDK、密钥或可选择的代理地址。

输入、输出、确认都由正式 Zod schema 验证；额外检查规范人物引用、主角身份记忆、能力启用与边界、8–12 个连续阶段完整覆盖目标章节。Prompt 将用户创意当作素材，不能覆盖系统规则。自由文本的全部情节逻辑仍需要用户审阅，结构校验不是语义正确性的保证。

生成前用 `studio_begin_ai_generation` 按 auth.uid() 加事务锁，登记唯一 requestId、输入摘要及不可读取的随机 lease_token。每账号一个执行中请求、每小时最多 6 次；5 分钟过期租约防止异常退出永久阻塞。`studio_finish_ai_generation` 必须持有该随机 token 并匹配同一账号，记录状态、模型、usage、耗时和 provider request ID。这两个窄范围 SECURITY DEFINER 函数固定空 search_path、无动态 SQL；普通客户端无权更新/删除日志，不能清空计数绕过限制。日志不存完整 Prompt 或模型正文。

`create_ai_novel_bundle` 为 SECURITY INVOKER，校验生成成功、输入摘要、schema 版本与 auth.uid()，锁住账号+generation ID，依赖现有 RLS 写全部资料。回执在小说删除后保留空引用，不能通过重复确认重新创建。任何子表失败都会回滚整本小说。默认只建立第一卷与空正文的 planned 第一章。

预览只留在当前页面内存；刷新离开提示未保存，账号切换卸载旧预览。生成/确认按钮禁止重复点击，服务器是最终防重边界。错误保留已有预览；重新生成需要明确确认，只有成功后替换。确认成功后立即刷新聚合再导航。没有模拟成功的业务分支；所有替身仅存在于测试目录及测试进程的显式网络注入中。

## 当前限制与第三阶段边界

Phase 2.5 的验收记录见 [PHASE_2_5.md](PHASE_2_5.md)。2026-10-09 Phase 3A 按用户要求从 OpenAI 切换为 DeepSeek。通过本地样例和既有真实 Supabase 保存链路检查；本次真实生成验收结果见 [PHASE_3A.md](PHASE_3A.md)。切换不增加数据库迁移、不改变账号权限、不修改既有小说。不进行公网部署或生产邮件投递验收。

为了兼容既有页面，作品列表和工作台目前读取完整聚合（含正文），尚不适合大量百万字作品的实际负载。开启 AI 连写前应拆为轻量列表、按章正文读取和版本分页，并加入服务器限流、配额、审计及更大文本的恢复存储。

`src/lib/server/ai-service.js` 仅保留章节/大纲等旧占位契约；真正的 Novel Builder 位于独立 `src/lib/ai`。本次不开放章节生成，不自动提取或更新长期记忆。完成基础方案真实验收后，再决定 Phase 3B 范围。

本阶段未实现向量库、Embedding、RAG、AI 总结、Agent 或自动连写。测试替身只位于 scripts/testing，生产业务无模拟鉴权开关；NOVELAI_TEST_MODE 仅隔离 Next 构建目录。
