<div align="center">

# CreativeIntel

**竞品广告情报 → 营销方案 → 脚本 → 分镜 → AI 视频与图片广告**
面向 DTC 品牌及其营销团队。

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2d3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ecf8e?logo=supabase&logoColor=white)
![Auth](https://img.shields.io/badge/Auth-Clerk-6c47ff?logo=clerk&logoColor=white)
![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)

[English](README.md) · **简体中文** · 线上应用：<https://creative.xark.io>（需登录）

</div>

---

## 目录

1. [功能概览](#功能概览)
2. [系统架构](#系统架构)
3. [技术栈](#技术栈)
4. [代码结构](#代码结构)
5. [快速开始](#快速开始)
6. [配置](#配置)
7. [账号、权限与项目分享](#账号权限与项目分享)
8. [成本控制](#成本控制)
9. [AI 服务商与模型](#ai-服务商与模型)
10. [数据层与并发](#数据层与并发)
11. [后台任务与本地 Worker](#后台任务与本地-worker)
12. [安全](#安全)
13. [测试与质量门禁](#测试与质量门禁)
14. [部署](#部署)
15. [贡献约定](#贡献约定)
16. [文档索引](#文档索引)
17. [许可](#许可)

---

## 功能概览

CreativeIntel 把“竞品在投什么广告？”变成可直接上线的平台化广告成片。每个项目按流水线推进；每个阶段既能在界面里操作，
也能通过 HTTP 让智能体无人值守地驱动（见 [`docs/agent-api.md`](docs/agent-api.md)）。

| 阶段 | 做什么 | 路由 |
|---|---|---|
| **Setup 设置** | 品牌资料（Logo、产品图、SKU 尺寸、色彩、CTA 池、优惠、落地页、允许 / 禁止的宣称）与商品页导入（Shopify / Amazon / 通用适配器）。 | `/projects/[id]/overview` |
| **Research 研究** | 广告素材适配器（Meta 广告库、TikTok Creative Center、YouTube Shorts、Google 广告透明度中心、Instagram Reels）、UGC 过滤、排序、每个竞品取 Top-N。 | `/projects/[id]/content` |
| **Insights 洞察** | 逐条广告的多模态拆解（钩子、节拍、证明、CTA、优惠）、竞品汇总、跨竞品空白点、受众画像。 | `/projects/[id]/insights` |
| **Planning 规划** | 结构化产品 brief、平台画像、钩子库、结尾卡画廊，以及带各平台钩子变体的营销方案。 | `/projects/[id]/planning` |
| **Creative 创意** | 脚本原型 × 视频类型 → 结构化脚本 → 以 2 秒为单位、标注 HOOK / BODY / CTA 的分镜，并生成关键帧图片。 | `/projects/[id]/creative` |
| **Studio 制作** | 把分镜编译成渲染任务：成本预估 → 所有者审批 → 关键帧与片段（OpenRouter、Matrix、GLM、ComfyUI 或本地 LibTV Worker）→ ffmpeg 合成（字幕、配音、音乐、结尾卡）→ 质检与一致性（漂移）检查。 | `/projects/[id]/studio` |
| **Deliver 交付** | 成片、多种比例导出（4:5、1:1、16:9、15 秒 / 10 秒剪辑）、封面、导出包，以及面向客户的投放报告（HTML / DOCX）。 | `/projects/[id]/deliver` |
| **History 历史** | 每份 brief、方案、分镜、脚本、关键帧、片段、成片、导出和报告都会归档为带版本、可再次下载的文件，存放在数据库中。 | `/projects/[id]/history` |

另外还有：**Autopilot 自动驾驶**（在所有者批准的预算内跑完 抓取 → 规划 → 渲染 → 报告 的状态机）、基于商品表的**图片广告**与**商品目录广告**、
能根据导入的投放结果回答问题的**效果分析智能体**、跨平台**媒体计划**、**每周摘要**和**运维健康**看板。

各阶段完成度由服务端计算（`src/services/project-stages.ts`），驱动侧边栏进度条和“下一步”按钮。

## 系统架构

```mermaid
flowchart LR
  U[浏览器] --> CF[Cloudflare DNS / TLS]
  CF --> P

  subgraph V["Vercel · Fluid Compute · pdx1"]
    P["proxy.ts<br/>Clerk 会话 + 租户闸门"] --> R["路由处理器<br/>withAccess()：第二层鉴权 + 花费作用域"]
    R --> S["服务层<br/>creative · research · video-gen · ops · reports"]
  end

  S --> DB[("PostgreSQL<br/>Supabase 连接池 · us-west-2")]
  S --> BL[("Vercel Blob<br/>媒体文件")]
  S --> AI["AI 服务商<br/>OpenRouter · Google · OpenAI · fal · 智谱 · Matrix"]
  CR["Vercel Cron ×5"] --> R
  W["本地 Worker<br/>研究 · LibTV · 浏览器"] -- "HTTPS + x-worker-token" --> R
  CL[Clerk] <--> P
```

核心设计：

- **两层鉴权。** `src/proxy.ts` 对每个请求做访问判断；每个面向用户的 API 路由还被 `withAccess()`
  （`src/lib/auth/route-guard.ts`）包裹，在处理器内部重复同样的判断。新增路由漏掉它，测试会直接失败。
- **花费作用域。** `withAccess()` 会打开一个 `AsyncLocalStorage` 作用域，记录项目和操作人，
  共享代码深处的任何付费模型调用都会按正确的预算预扣。
- **笔记本上没有数据库凭据。** 本地 Worker 只通过 HTTPS 访问已部署的应用。

## 技术栈

| 层 | 选择 |
|---|---|
| 框架 | Next.js 16（App Router、Turbopack、`proxy.ts`）、React 19、TypeScript（strict） |
| 界面 | Tailwind CSS 4、shadcn/ui（Base UI）、lucide-react、Recharts |
| 数据 | Prisma 7 + PostgreSQL（`@prisma/adapter-pg`，显式 `pg.Pool`），Supabase 连接池（事务模式） |
| 认证 | Clerk（邮箱 + 密码 + 邮箱验证码）、邀请、按账号隔离的工作区 |
| 存储 | Vercel Blob；≤ 2 MB 的小文件同时存入数据库，供历史下载 |
| AI | OpenRouter（DeepSeek 文本、Seedream 图片、Veo / Kling / Wan 视频）、Google Gemini / Veo、OpenAI、fal.ai、智谱 GLM、Matrix、ComfyUI |
| 媒体 | ffmpeg（`ffmpeg-static`）、sharp 0.35、msedge-tts |
| 质量 | Vitest、ESLint、`tsc --noEmit`、GitHub Actions 冒烟测试、Vercel 预览构建 |
| 托管 | Vercel（函数固定在 `pdx1`，紧挨数据库）、Cloudflare DNS |

## 代码结构

```text
src/
  app/                  Next.js 路由：页面与 /api（projects、settings、worker、cron、health…）
  components/           按领域划分的界面：dashboard、creative、studio、research、planning、settings、legal…
  lib/                  纯函数辅助：鉴权闸门与访问规则、校验、optimistic-json、安全
  services/
    ai/                 模型客户端、路由、用量记录、分析流水线
    research/           广告库适配器、相关性、信号、钩子趋势
    creative/           brief、营销方案、脚本、分镜、plan-to-storyboard、广告克隆
    video-gen/          渲染引擎、执行器、剪辑合成（ffmpeg）、质检、漂移、导出、变体
    ops/                花费账本与守卫、成本模型、月度额度、健康检查、心跳
    autopilot/          状态机与运维动作
    reports/            投放报告（HTML / DOCX）、每周摘要
    artifacts/          历史归档（ProjectArtifact + ArtifactBlob）
    …                   brand-kit、image-ads、catalog、performance、strategy、settings、storage
  proxy.ts              所有路由前的访问闸门
prisma/schema.prisma    数据模型（只做增量变更）
workers/                本地运维 Worker（研究、LibTV、浏览器）
scripts/                冒烟测试、回填、预览工具
docs/                   运行手册、智能体 API、审计、验收记录
```

## 快速开始

环境要求：Node 20.9+（开发使用 Node 24）、pnpm、PostgreSQL 16。

```bash
pnpm install
docker compose up -d postgres            # 或：createdb creativeintel_dev
cp .env.example .env.local               # 填入密钥；DATABASE_URL 指向本地数据库
                                         # （compose 默认：postgresql://postgres:postgres@localhost:5432/brand_intelligence）
pnpm exec prisma db push && pnpm exec prisma generate
pnpm dev                                 # http://localhost:3000
```

未设置 Clerk 密钥时，应用**不设访问闸门**（鉴权模式 `none`）——本地开发可以，共享主机绝不可以。
`MOCK_AI` / `MOCK_CRAWL` 仅用于测试和部分离线场景；真实的分析与生成需要服务商密钥。

| 命令 | 用途 |
|---|---|
| `pnpm dev` / `pnpm start` | 开发服务器 / 生产服务器 |
| `pnpm test` | Vitest（单元与路由测试） |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm build` | `prisma generate && prisma db push && next build`（生产构建） |
| `pnpm build:check` | `prisma generate && next build`——不触碰数据库的构建 |
| `pnpm smoke` | 对运行中的实例做端到端冒烟测试（`scripts/smoke.ts`） |
| `pnpm worker:libtv` | 本地 LibTV 渲染 Worker（`--dry-run` 只打印命令） |

安全规则：`.env.local` 必须指向**本地**数据库；不要在 shell 里 `source` 拉取下来的生产环境文件；
数据库变更必须是增量的，因为生产构建运行 `prisma db push` 时**不带** `--accept-data-loss`。

## 配置

变量放在 `.env.local`（本地）和 Vercel 项目设置（线上）。`.env.example` 列出了全部变量；**仓库里不会提交任何密钥。**

| 领域 | 变量 |
|---|---|
| 数据库 | `DATABASE_URL`（或用 `APP_DATABASE_URL` + `APP_DATABASE_DIRECT_URL` 分别给应用连接池和 CLI 直连）、`DB_POOL_MAX`（默认 5）、`DB_POOL_ACQUIRE_TIMEOUT_MS`（5000）、`DB_POOL_IDLE_TIMEOUT_MS`（5000） |
| 认证 | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`、`CLERK_SECRET_KEY`、`NEXT_PUBLIC_CLERK_SIGN_IN_URL`、`NEXT_PUBLIC_CLERK_SIGN_UP_URL`、`OWNER_EMAILS`（逗号分隔的管理员）、`AUTH_CANONICAL_HOST`、`AUTH_PROVIDER` |
| 模型 | `OPENAI_API_KEY`、`OPENROUTER_API_KEY`、`GOOGLE_API_KEY` / `GEMINI_API_KEY`、`FAL_KEY`、`ZHIPU_API_KEY`、`MATRIX_API_KEY`、`GROQ_API_KEY`、`AI_PROVIDER`、`AI_MODEL`、`AI_COST_MODE` |
| 研究 | `YOUTUBE_API_KEY`、`META_ACCESS_TOKEN`、`TOP_N_PER_COMPETITOR`、`TOP_N_DEEP` |
| 存储 | `BLOB_READ_WRITE_TOKEN`（或 `CLOUDINARY_*`） |
| 花费 | `MEMBER_MONTHLY_ALLOWANCE_USD`（默认 1）、`SPEND_GUARD`（`off` = 紧急旁路）、`CI_PRICE_OVERRIDES`、`LIBTV_MAX_RUN_CREDITS` |
| Worker 与定时任务 | `WORKER_TOKEN`、`BROWSER_WORKER_TOKEN`、`VERCEL_AUTOMATION_BYPASS_SECRET`、`CRON_SECRET`、`LIBTV_BIN` |
| 报告 | `REPORT_DELIVERY_SEND`（除非为 `on`，摘要一律只演练不发送） |
| 法务 | `LEGAL_CONTACT_EMAIL`（显示在 `/terms` 和 `/privacy`） |
| 其他 | `NEXT_PUBLIC_APP_NAME`、`LOCAL_FILES_ROOT`（在开发环境之外启用 `/api/local-files`）、`MOCK_AI`、`MOCK_CRAWL` |

## 账号、权限与项目分享

认证使用 **Clerk**（`src/lib/auth/mode.ts` 按部署选择闸门）：设置了 Clerk 密钥用 `clerk`，旧的 Cloudflare Access 方案用 `cf-access`，
本地开发用 `none`。配置错误时会锁住路由（503），而不是不设防地放行。

- **开放注册 + 账号隔离。** 任何人都可以注册（邮箱 + 密码 + 邮箱验证码，并勾选同意[服务条款](src/app/terms/page.tsx)与
  [隐私政策](src/app/privacy/page.tsx)）。每个新账号拥有**自己的空工作区**，看不到任何其他人的内容。
- **角色。** `OWNER_EMAILS` 中（已验证）的邮箱成为**管理员**，可以看到所有工作区，以及 *AI 引擎*、*系统状态*、*用户* 页面；
  其余账号是**成员**。管理员可在 `/settings/users` 封禁 / 解封账号、提升或取消管理员。
- **项目分享。** 管理员按邮箱邀请同事，勾选要分享的项目并选择权限级别：**查看**（浏览并播放媒体）→ **下载**（再加导出、归档、报告文件）
  → **编辑**（再加修改与生成，费用计入该同事自己的额度）。删除项目、设置预算、审批 LibTV 渲染和管理分享始终只有所有者可以做。
  见 `src/lib/auth/gate.ts`（`projectAction`）。
- **共享记忆也隔离。** 结构库、趋势数据和研究耗时估算都按账号隔离（`src/services/tenancy.ts`）。
- **被封禁的账号**，页面跳转到 `/blocked`，API 返回 `403`。

## 成本控制

付费生成都会计量；没有预算覆盖就不会执行任何付费调用。

- **花费账本**（`src/services/ops/`）：每次付费调用先在 Postgres 咨询锁下**预扣**预估金额，执行后再按服务商返回的实际费用**结算**。
  超额的请求在调用服务商之前就被拒绝。
- **预算。** 按渲染任务（所有者审批时设置的 `approvedBudgetUsd`）和按项目（`budgetUsd`）。不设预算表示不设上限，但花费仍会记录。
- **成员月度额度。** 每个成员账号在其全部项目上有一个月度额度（默认 **$1**，可按用户调整）。管理员不受限。
  同事在被分享的项目上工作时，由**同事自己的额度**付费。
- **所有模型调用都被覆盖。** 全部文本和视觉调用都经过 `analyzeWithClaude`，在请求的花费作用域内预扣；
  被拒绝时返回 HTTP **402**，`{ "code": "BUDGET_EXCEEDED" }`。
- **严格免费模式**只使用免费模型；付费回退默认**关闭**。
- **Autopilot** 需要所有者批准的预算不低于其高位预估，且永远不会自行提高预算。

## AI 服务商与模型

| 能力 | 服务商（在 *设置 → AI 引擎* 中选择，带自动回退顺序） |
|---|---|
| 文本 / 视觉 | OpenAI（GPT-4o 系列）、Google Gemini、Anthropic、OpenRouter（DeepSeek、GPT-4o）、智谱 GLM（免费档） |
| 图片 | OpenRouter（Seedream 5 Flash、Qwen Image）、Matrix、fal.ai（FLUX）、OpenAI `gpt-image-1`、智谱 CogView、Pollinations、ComfyUI |
| 视频 | OpenRouter（Veo 3.1 Lite、Kling、Wan、Seedance）、Matrix、fal.ai、Google Veo、智谱 CogVideoX、ComfyUI（Wan）、LibTV |
| 音频 | Groq / OpenAI Whisper（转写）、Edge TTS（配音） |

单价在 `src/services/ops/cost-model.ts`（可用 `CI_PRICE_OVERRIDES` 覆盖）。请求超时、重试和并发上限定义在各客户端旁边，
位于 `src/services/ai/` 与 `src/services/video-gen/`。

## 数据层与并发

- **每个实例一个连接池**（`src/lib/db.ts`）：`pg.Pool`，`max` 为 5，5 秒获取超时，空闲即释放，
  实例休眠前主动关闭（`attachDatabasePool`）。
- **函数运行在 `pdx1`**（`vercel.json`），与数据库同区域——请保持两者在一起。
- **不丢更新。** JSON 文档（分镜帧、字段状态、品牌资料、图片广告集、研究步骤）用基于 `updatedAt` 的乐观重试循环更新
  （`src/lib/optimistic-json.ts`），并发写入会合并而不是互相覆盖。
- **鉴权查询有短时内存缓存**，数据库短暂抖动时回退到上一次确认的结果。

## 后台任务与本地 Worker

**Vercel Cron**（`vercel.json`）——全部需要 `CRON_SECRET`：

| 任务 | 频率 | 用途 |
|---|---|---|
| `poll-video-jobs` | 每 5 分钟 | 推进渲染任务和视频任务 |
| `hook-variants` | 每 5 分钟 | 渲染排队的钩子 A/B 变体和导演复审 |
| `autopilot` | 每 5 分钟 | 推进已批准的自动驾驶任务 |
| `ops-health` | 每 10 分钟 | 健康扫描与安全自动恢复 |
| `report-digest` | 每周一 14:00 UTC | 每周投放摘要（除非启用，否则只演练） |

**本地 Worker**（运维机器；只通过 HTTPS 访问已部署的应用，使用 `x-worker-token`）：

| Worker | 用途 |
|---|---|
| `workers/research-worker` | 只能用浏览器完成的广告库抓取，以 `WorkerTask` 排队 |
| `workers/libtv-worker` | 执行已批准的 LibTV 渲染（上传 → 图片节点 → 视频节点 → 下载 → 本地合成） |
| `workers/browser-worker` | 浏览器生成任务 |

## 安全

- `src/proxy.ts` 的会话闸门**加上**每个用户路由内部的二次校验；管理员专属区域列在 `src/lib/auth/gate.ts`。
  机器路由（`/api/worker`、`/api/cron`、`/api/local-files`）各自校验自己的令牌。
- 所有响应都带安全响应头：CSP（`frame-ancestors 'none'`、`base-uri`、`object-src`）、`X-Frame-Options`、
  `X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、COOP、HSTS（`next.config.ts`）。
- 服务商 API 密钥可加密后存入数据库（`src/lib/settings-crypto.ts`）；仓库里不提交任何敏感信息。
- `*.vercel.app` 别名会跳转到正式域名；预览部署受 Vercel SSO 保护。

发现漏洞？请在本仓库提交**私密安全公告**，不要开公开的 issue。

## 测试与质量门禁

```bash
pnpm typecheck && pnpm lint && pnpm test
```

- 路由和服务测试使用内存假对象——**单元测试绝不能连到真实数据库或服务商**。
- `src/lib/auth/route-guard.test.ts` 会在任何面向用户的 API 路由没有被 `withAccess()` 包裹时失败。
- 机器繁忙时 5 秒默认超时可能不稳定，可用 `pnpm test -- --testTimeout=60000`。
- 每个 Pull Request 都会触发 Vercel 预览构建（同时应用增量数据库变更）。每次生产部署后，`smoke` 工作流
  （`.github/workflows/smoke.yml`）会运行 `scripts/smoke.ts` 里免费、只读的检查。

## 部署

1. **Vercel** 项目配置上述环境变量；`pnpm build` 会运行 `prisma db push`（仅增量）。
2. **Clerk** 生产实例绑定应用域名：在 Cloudflare 里把 Clerk 给出的 DNS 记录（前端 API、accounts 和邮件记录）设为*仅 DNS*；
   启用邮箱 + 密码注册、邮箱验证码，并让法务同意复选框指向 `/terms` 和 `/privacy`。
3. **定时任务与区域**来自 `vercel.json`；设置 `CRON_SECRET`。
4. 可选：在运维机器上用 `WORKER_TOKEN` 运行本地 Worker。

## 贡献约定

- 分支 → Pull Request → squash 合并到 `main`；提交信息格式 `type: description`（`feat`、`fix`、`perf`、`test`…）。
- **新增 API 路由？** 导出写成 `export const GET = withAccess(unguardedGET)`。
- **新增付费模型调用？** 走花费守卫（`analyzeWithClaude`、`guardJobCall`、`withSpendGuard`）。
- **改数据库结构？** 只能增量且带默认值。
- **多方写入的 JSON 字段？** 用 `patchRow` / `patchJsonField`，不要先读后写。
- 测试里不要访问网络和数据库。

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/agent-api.md`](docs/agent-api.md) | 通过 HTTP 驱动每个阶段；运维动作 |
| [`docs/studio-libtv.md`](docs/studio-libtv.md) | LibTV 渲染运行手册 |
| [`docs/comfyui-node.md`](docs/comfyui-node.md) | 自托管 ComfyUI 引擎 |
| [`docs/audit/`](docs/audit) | 多模型架构审计与重建方案 |
| [`docs/acceptance/`](docs/acceptance) | 验收轮次与发现 |
| `workers/*/README.md` | 各 Worker 的安装说明 |

## 许可

专有软件 — © Cell Digital Technology Inc. 保留所有权利。本仓库虽然公开可见，但不授予任何使用、复制、修改或分发代码的许可。
