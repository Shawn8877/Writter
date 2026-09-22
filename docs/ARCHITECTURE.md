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
```

保留第一阶段页面组件、布局、颜色与交互。`src/app` 负责路由装配和服务端入口；组件不直接访问数据库 SDK。小说资源采用聚合仓库适配器，避免为每种表重复编写网络调用；UI 的 camelCase 模型在服务端统一映射为数据库字段。

## 身份与权限

浏览器客户端在 `src/lib/supabase/client.js`；`server.js` 使用当前请求的 `cookies()`；`src/proxy.js` 刷新会话并同步请求与响应 Cookie。鉴权使用 `auth.getUser()` 向认证服务校验，不信任浏览器 user_id 或单纯 getSession() 结果。

Dashboard、创建页、小说工作台有服务端 layout 保护。小说 layout 先验证 UUID、账号与 novels.user_id。所有数据 API 再独立鉴权，即使绕过页面仍受保护。

数据库开启全部 11 表的 RLS：profiles.id / novels.user_id 对应 auth.uid()；子表沿 novel_id 关联所有者；版本通过 chapter_id → chapters → novels 判断。INSERT/UPDATE 使用 WITH CHECK，阻止伪造归属。应用只使用公开 key 加用户会话，不使用 service role 绕过权限。

业务 RPC 为 SECURITY INVOKER。少量注册、级联维护 trigger 使用受限权限与固定 search_path；应用事务仍校验拥有者和 RLS。来源触发器和复合外键限制跨小说引用，包括同一账号拥有的另一部小说。

写 API 检查 JSON、请求来源、大小和版本。401 表示未登录，404 表示不存在或无权访问，409 表示冲突／来源被引用，503 表示配置或服务不可用。账号切换清空内存作品库，过期请求不能回填另一账号状态。

## 数据模型

完整约束、外键、索引、触发器和 policies 位于 `supabase/migrations/001_initial_schema.sql`。

- novels 存储基本信息、创作输入、目标、状态和总纲；novel_bible 对 novel_id 唯一。
- volumes / chapters 使用稳定 UUID，章节有独立 revision；修改其他设定不会让正文自动保存无谓冲突。
- chapter_versions 保留重要操作的正文快照。手动保存正文与插入版本在同一事务内完成；自动保存不插版本。历史不允许普通 UPDATE；整部小说删除时级联清理。
- characters、world_entries、timeline_events 保留现有表单字段和扩展 JSONB；编辑展示字段不抹去暂未展示的结构化信息。
- chapter_summaries 每章一条，手动摘要经触发器同步；结构化事件、人物变化和伏笔字段预留，不运行自动提取。
- memory_items 是长期事实的规范来源。世界观页的地点／物品／能力／伏笔是相同记录的投影。伏笔 active/resolved/obsolete 与中文标签无损映射。

记忆 source_type、source_id 指向章节、人物、世界资料或手工来源，chapter_id 可附加章节上下文。引用必须属于同一小说；来源仍被引用时单独删除会被拒绝，需先修改记忆。删除整部小说则原子级联。

## 自动保存与并发

1. 输入立即更新编辑区并写入 localStorage：`novelai-studio:chapter-draft:v2:<user>:<novel>:<chapter>:<writer>`。
2. 每个页面生命周期独立 writer，sessionStorage 记住前一个 writer 支持同标签刷新；其他恢复副本由用户明确选择。不同账号不混用。
3. 停顿 1 秒后携加载时的章节 revision 保存。数据库锁住小说和章节，原子比较更新，旧请求不能覆盖新正文。
4. 请求期间继续输入时，只确认已发送的 snapshotId；新草稿不会被清除，更新基线后继续保存。
5. 成功显示“已保存”；失败保留草稿并可重试，恢复 online 时尝试重试。localStorage 容量不足会单独提示。
6. 409 冲突暂停自动保存，保留编辑区，提供复制与明确确认后的云端加载。
7. 章节保存后后台刷新完整小说；只有完整聚合响应提升小说 revision，避免把旧设定标为最新。
8. 非章节表单固定打开时的小说 revision；编辑期间发生聚合更新时保留输入并要求核对，数据库仍对远端版本做最终检查。

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

## 当前限制与第三阶段边界

为了兼容既有页面，作品列表和工作台目前读取完整聚合（含正文），尚不适合大量百万字作品的实际负载。开启 AI 连写前应拆为轻量列表、按章正文读取和版本分页，并加入服务器限流、配额、审计及更大文本的恢复存储。

`src/lib/server/ai-service.js` 仍为 server-only 占位。下一阶段在用户授权后接服务端模型：先核心设定和大纲，再单章生成；保存候选版本，验证记忆变更与来源后提交。API Key 仅用服务端变量，不进 NEXT_PUBLIC_，浏览器不直连模型。

本阶段未实现向量库、Embedding、RAG、AI 总结、Agent 或自动连写。测试替身只位于 scripts/testing，生产业务无模拟鉴权开关；NOVELAI_TEST_MODE 仅隔离 Next 构建目录。
