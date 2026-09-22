# Supabase 配置与真实账号验收

本指南适用于 NovelAI Studio 第二阶段。应用使用 Supabase Auth、用户会话与数据库行级权限（RLS）；不需要 `service_role` 或 `sb_secret_` 密钥，也不需要 OpenAI 配置。

**当前边界：尚未提供真实 Supabase 项目的 URL、公开密钥和测试账号，因此真实云端连接、邮件投递及线上权限尚未验证。** 项目内的本地数据库与模拟服务测试不能代替本文最后的真实账号验收。

## 1. 创建独立测试项目

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)，创建一个独立的测试项目，等待数据库就绪。不要把测试迁移和测试数据放进已有生产项目。
2. 打开项目的 **Connect** 对话框，复制 **Project URL**，格式类似 `https://your-project.supabase.co`。这里需要 HTTP 项目地址，不是 PostgreSQL 数据库连接字符串。
3. 在 **Settings > API Keys** 获取公开的 **Publishable key**（`sb_publishable_...`），或者已有项目的旧版 **anon** key。不要复制 secret 或 service-role key。公开密钥配合用户会话和 RLS 使用，不提供管理员权限。入口和密钥区别见 [Supabase API Keys 官方文档](https://supabase.com/docs/guides/getting-started/api-keys)。

项目已经包含 JavaScript 版 Supabase 浏览器客户端、服务端客户端与会话处理，无须按官方示例重新创建 Next.js 项目。可参考 [Next.js Auth 快速入门](https://supabase.com/docs/guides/auth/quickstarts/nextjs) 和 [服务端客户端配置](https://supabase.com/docs/guides/auth/server-side/creating-a-client) 理解配置背景。

## 2. 设置本地环境变量

在项目根目录，把 `.env.example` 复制为 `.env.local`，填写实际值：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_REPLACE_WITH_YOUR_PUBLIC_KEY
```

本项目的变量名固定为 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，它同时接受 publishable key 和旧版 anon key。官方文档中的 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 不能直接替换这里的变量名，除非同步修改项目配置代码。

`.env.local` 已被 Git 忽略。只填写这两个公开项目配置；不要添加 `SUPABASE_SERVICE_ROLE_KEY`，不要把 secret key 放进任何 `NEXT_PUBLIC_` 变量。

安装依赖并启动：

```sh
npm install
npm run dev
```

修改环境变量后重启开发服务。以下步骤统一使用 `http://localhost:3000`；如果实际端口不同，所有网站地址、Site URL 和回调白名单一起替换为实际端口。

**整个注册、邮件确认、登录和旧版作品导入过程固定使用同一个来源。不要交替使用 `localhost` 和 `127.0.0.1`。** 它们的会话与浏览器存储可能不同；旧版本地作品也只会在原浏览器和原站点来源下出现。

## 3. 执行数据库迁移

在新测试项目的 SQL Editor 中，以项目数据库所有者身份打开并执行仓库内的完整文件：

```text
supabase/migrations/001_initial_schema.sql
```

文件内包含 `begin;` / `commit;`，需整体执行。它创建作品、分卷、章节、版本、人物、世界、时间线、核心设定、摘要和记忆等表，同时配置 RLS、来源约束、版本检查与 RPC。

这是初始建库迁移，不是可重复运行的初始化按钮。成功执行一次后，不要反复粘贴执行；若提示表已存在，先确认目标项目和迁移历史，不要删除现有表来消除报错。

迁移成功后再创建应用测试账号，便于验证注册时自动创建用户资料的流程。此操作使用 SQL Editor 的数据库管理权限，与应用配置公开密钥是两回事；应用仍以已登录用户的权限访问数据。

## 4. 配置邮箱确认与回调

在项目的 Authentication 设置中启用邮箱注册登录。保留邮箱确认时，用户注册后需打开确认邮件才能完成登录。

在 **Authentication > URL Configuration** 设置：

| 配置 | 本地测试值 |
| --- | --- |
| Site URL | `http://localhost:3000` |
| Redirect URLs | `http://localhost:3000/auth/confirm` |
| Redirect URLs | `http://localhost:3000/auth/callback` |

白名单填入具体地址。部署到正式域名时，将 Site URL 改为正式 HTTPS 地址，并添加该域名下的两个回调地址。Site URL 与重定向白名单的作用见 [Redirect URLs 官方说明](https://supabase.com/docs/guides/auth/redirect-urls)。

在 Authentication 的 **Email Templates > Confirm sign up** 中，将确认链接设置为本项目实现的 token-hash 路由：

```html
<h2>确认你的 NovelAI Studio 账号</h2>
<p>点击下方链接，完成邮箱确认：</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">确认邮箱</a></p>
```

`{{ .SiteURL }}` 使用刚配置的站点地址；`{{ .TokenHash }}` 由 Supabase 在发信时替换，不要手工填入或把完整确认链接公开。模板变量说明见 [Email Templates 官方文档](https://supabase.com/docs/guides/auth/auth-email-templates)。

本项目提供两个不同的处理入口：

| 入口 | 接收内容与行为 |
| --- | --- |
| `/auth/confirm` | 接收 `token_hash` 和 `type=email`，服务端调用 `verifyOtp`；成功后进入 Dashboard。上述邮件模板使用此入口。 |
| `/auth/callback` | 接收 PKCE 的 `code`，服务端调用 `exchangeCodeForSession`；成功后进入 Dashboard。注册代码的 `emailRedirectTo` 指向此入口，供相应授权码流程使用。 |

不要把 `token_hash` 链接改发到 `/auth/callback`，也不要把 `code` 发到 `/auth/confirm`。若使用 PKCE 授权码流程，应在发起注册的同一浏览器、同一来源完成回调，以保留校验所需的会话信息。

随后访问 `/register`，用可接收邮件的测试邮箱注册；打开最新确认邮件，再访问 `/login` 验证邮箱密码登录。若收不到邮件，先检查 Authentication 日志、邮件发送设置、发信额度与收件箱，不要将“注册请求返回成功”等同于“确认邮件已送达”。

## 5. 用两个真实测试账号验证隔离

准备两个由你控制、可接收确认邮件的测试邮箱，分别称为 A 和 B。使用两个独立浏览器配置文件，避免同一浏览器普通标签页共享登录状态。下面只使用可删除的测试作品。

1. A 登录后创建“账号 A 测试作品”，编辑章节并等待“已保存”；再手动保存一个版本，添加人物、世界设定和一条带来源的记忆。
2. 刷新页面，确认作品、正文和记忆仍存在，版本记录可读取。记录该作品和章节的 ID，供越权验证使用。
3. B 登录后应看不到 A 的作品；B 新建“账号 B 测试作品”后，A 刷新也不应看到它。
4. 在 B 已登录的浏览器中，把 A 的作品 ID 放入 `/novel/<A的作品ID>`。页面应说明记录不存在或无权访问；不能呈现 A 的标题、正文或记忆。
5. 在 B 的会话中检查下表接口。可通过浏览器开发者工具发送同源请求或重放 B 自己的请求，仅将目标 ID 替换为 A 的测试记录；写入请求仍需正确 JSON 结构、`Content-Type: application/json` 和有效的版本号。不要使用管理员密钥来做这些测试。

| B 会话下的目标 | 预期结果 |
| --- | --- |
| `GET /api/novels` | 仅返回 B 的作品。 |
| `GET /api/novels/<A的作品ID>` | 404，不泄露作品内容。 |
| `PATCH /api/novels/<A的作品ID>` | 404，A 的作品不变。 |
| `DELETE /api/novels/<A的作品ID>` | 404，A 的作品仍存在。 |
| `POST /api/chapters/<A的章节ID>`，请求中的 `novelId` 为 A 的作品 | 404，A 的正文不变。 |
| `GET /api/chapters/<A的章节ID>/versions?novelId=<A的作品ID>` | 404，不泄露历史正文。 |

6. 回到 A 刷新，确认越权请求后数据仍完整。退出 A，再直接打开受保护页面，应要求重新登录；受保护 API 应拒绝未登录请求。
7. A 在两个浏览器页面打开同一章节：先在一处保存，再从另一处提交旧内容，应出现冲突提示并保留未同步草稿，不能静默覆盖。

以上流程验证真实登录、Cookie、应用 API 与云端数据库的组合行为。验收记录应包含测试日期、环境、每项实际结果和失败信息；不要把待执行项标为通过。

## 6. 执行数据库层 RLS 回归

在完成初始迁移的**独立测试项目**里，使用 SQL Editor 整体执行：

```text
supabase/tests/rls.sql
```

该文件从 `begin;` 开始，以 `rollback;` 结束。保留完整事务，不要改为 `commit;`，不要只选择其中部分执行。脚本会临时创建两个固定测试身份，切换到 `authenticated` 角色并设置测试用户声明，验证跨用户读取、写入、删除、来源关联、并发版本和级联删除，最后回滚测试数据。

预期看到：

```text
PASS: schema, owner RLS, atomic CAS, summary, immutable versions, source integrity and cascade
```

同时确认事务已回滚。若脚本中断，先确保测试事务已回滚，再排查错误；不要把脚本里的固定身份当作可登录的真实测试账号。

**直接以 SQL Editor 的所有者身份执行 `SELECT`，看到或看不到数据，本身不能证明 RLS 正确。** 所有者权限和普通用户权限不同；这里的回归脚本通过切换实际数据库角色和用户声明验证数据库策略，上一节则通过真实 A/B 会话补齐 Auth 与应用链路验证。

仓库还提供无需云端凭证的本地检查：

```sh
npm run test:db
npm run test:repository
```

它们通过本地 PostgreSQL 引擎检查迁移、权限与真实服务端适配器逻辑；不会执行你的线上 Supabase 项目，也不证明该项目已完成配置。

## 7. 常见配置问题

| 现象 | 优先检查 |
| --- | --- |
| 登录页显示“账号服务尚未配置” | `.env.local` 是否在项目根目录，变量名是否准确，是否重启开发服务，是否误填 secret/service-role key。 |
| 登录成功但作品加载报数据库错误 | 是否在同一个 Supabase 项目完整执行迁移；URL 和公开密钥是否属于同一个项目。 |
| 确认链接回到登录失败页 | 邮件模板入口与参数是否匹配；Site URL、浏览器来源与端口是否一致；链接是否过期或已使用。 |
| POST 返回来源不受信任 | 浏览器访问来源与服务器收到的 Host 是否一致；是否混用 localhost、127.0.0.1 或不同端口；代理是否保留正确请求信息。 |
| 本地作品导入列表为空 | 是否使用第一阶段保存作品时的浏览器、协议、主机和端口；云端新账号不会自动获得其他来源的本地存储。 |
| 多页面保存出现版本冲突 | 先复制未保存内容，再加载云端版本核对；这是阻止旧内容覆盖新内容的保护机制。 |

完成真实项目的全部验收后，再将结果记录为已验证。配置文档存在、开发服务可运行或本地测试通过，都不应被表述为线上部署验收完成。
