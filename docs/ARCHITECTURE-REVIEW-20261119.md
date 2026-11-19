# 视频平台架构复盘与下一步 · Architecture Review & Roadmap（2026-11-19）

范围：Xark Studio（creativeintel，creative.xark.io）、Ad Studio 流水线（Mac worker）、Video Brain（PR #168，launchd `co.celldigital.video-brain`）、视频技能库（ad-studio / video-shotcraft / hypit / video-use / video-ads-playbook / proposal-content-video），以及这周在平台外跑的批量项目（acw 81 条、bdsmpub 10 条幻灯片）。

---

## 1. 按 4 个目标系统打分（现状 · 证据）

| # | 目标系统 | 现在有什么 | 缺口（核心问题） | 成熟度 |
|---|---|---|---|---|
| 1 | **Agent 系统**：每个项目一条工作线，按场景/上下文跑 | Xark 项目状态机（Setup→…→Deliver）；Ad Studio 8 步 worker；Brain 每 5 分钟巡检 15 条 loop | **两套世界**：平台内的项目（Neon `Project`/`AdStudioRun`）有人管；平台外的批量活（acw-bf-videos、bdsm-ops-center/videos、motion promo）是临时 Claude 会话 + 脚本，**Brain 看不到、不复查、不学习**。没有"工作线"概念——客户/品牌 × 目的（广告、BF 促销、社媒日更、提案样片）没有独立的配置（语气、合规、预算、模式）。 | 50% |
| 2 | **Agent Brain**：从错误、指令、爆款中学习并回灌 | 7 阶段循环、自动批准 ≤$3/条 ≤$20/天、失败重试、二次复查（ffprobe/LUFS/URL/成本）、20 条 learnings 同步到 6 个技能 | **只学到了"运维"，没学到"创意"**：20 条 learnings 几乎都是估价、402、重试、浏览器超时；`learn` 阶段 loops = 0（日志 `stages.learn:0`）。①没有投放数据回流（`AdPerformance` 有表无导入）→ 不知道哪条"上头"；②Barron 在聊天里给的指令（如"不暴露"、"预算用完转幻灯片"、"温柔音乐吸引女性"）不会被收进大脑；③没有 A/B 归因到元素（钩子 H?、结构、音乐、开头 1.5 s）。 | 35% |
| 3 | **共同学习库 + 经验库 + skill** | Brain learnings（`AppSetting brain:learnings` JSON）；6 份 `LEARNINGS.md`（同一块内容复制 6 次）；样式库 209 模板/845 规则（sqlite）；钩子 H01–H35、结尾 E01–E12；提示词库 v2 | **知识散在 5 处、没有统一索引、没有"用了哪条→效果如何"**。learnings 是 JSON blob，不能按品牌/平台/模式查询；技能里是复制件，不是引用；样式库在 sqlite，平台用不到。另外还有 5 个各自为政的 brain（`com.barron.brain`、uga-brain、resalehub.brain、xarknooks-brain、video-brain）。 | 30% |
| 4 | **外部 Dashboard**：上传素材 / 给链接 → 抓产品 → 出不同目的的视频 | Xark：产品 URL 抓取（`/api/projects/[id]/product`，preview→commit）、brief 上传、品牌素材上传、Studio、Deliver | **入口太重**：要走完 Setup→Research→Insights→Planning 才能出片；没有"一页输入：网址/文件 + 目的 + 数量 + 模式 → 一批视频"的快速通道；幻灯片 $0 模式、批量出片、合规模式（如 bdsmpub 无暴露）都不在 UI 里，只在脚本里。站点级抓取（首页热门 N 个产品）没有。 | 45% |

**一句话**：零件和监督循环已经有了；真正的短板是 **(a) 平台外的工作 Brain 看不见，(b) 没有效果数据所以学不到"上头"，(c) 知识没有一个可查询的单一来源，(d) 前台缺一个"丢链接就出一批片"的入口。**

---

## 2. 目标架构（一张图）

```
                ┌─────────────── 前台 Dashboard（creative.xark.io）───────────────┐
                │ 快速通道 Quick Create：网址/上传 + 目的 + 数量 + 模式 + 合规档     │
                │ 工作线 Workstreams：品牌×目的 的配置与看板 · /brain · 审片/评论     │
                └───────────────┬─────────────────────────────────────────────────┘
                                ▼  一个任务模型：Job（属于 Workstream）
┌──────────── Video Brain（唯一调度/监督，确定性代码）────────────┐
│ observe → plan → gate → execute → verify(二次复查) → recover → learn │
└──────┬──────────────────────────┬───────────────────────────────┘
       ▼                          ▼
 执行器 Executors（可插拔）        学习库 Knowledge Base（Neon，唯一来源）
 · ad-studio（AI 视频 8 步）       · Lesson（教训：作用域 brand/platform/mode/stage，证据，状态）
 · slideshow（$0 图片+配音）       · Directive（Barron 指令：来源会话、作用域、生效期）
 · shotcraft/Remotion（网页宣传片） · CraftItem（钩子/结构/音乐/提示词/模板 + 使用次数 + 成绩）
 · local-batch（Claude 会话里的批量 · Outcome（每条视频：元素标签 + QA 分 + 投放指标）
   脚本，用 CLI 上报）              ↓ 生成
                                   技能侧只读快照：~/.claude/skills/_shared/VIDEO-KNOWLEDGE.md
                                   （6 个技能引用同一文件，不再复制 6 份）
```

关键原则：
1. **所有出片都是一个 Job**——不管是平台里点的，还是 Claude 会话里跑脚本。会话侧用一个 CLI（`xark job start/report/finish`）上报，Brain 就能复查和学习。
2. **执行器可插拔**：AI 视频、$0 幻灯片、Remotion 宣传片是同一个 Job 的不同 `mode`；预算用完自动切 slideshow 由 Brain 统一决定（现在是写在规则里）。
3. **学习库进 Neon 表**，技能里只放生成的快照；每条 Lesson 带作用域和证据，能被查询、被淘汰。
4. **"上头"靠数据而不是感觉**：每条视频打元素标签 → 投放/社媒数据回流 → 元素级排名 → 策略权重。

---

## 3. 路线图（按价值排序，每阶段有可验证的完成条件）

### P1 · 让 Brain 看见所有工作（1 周）
- `Workstream` 概念（先用 `AppSetting`/现有 `Project` 字段承载，避免生产 `db push`；表结构等 PR #180 一起迁）：品牌 × 目的，带默认模式、合规档、预算、语气、目标平台。
- `xark-job` CLI（Node，读 worker token）：会话里的批量脚本开始/结束时上报 Job + 产物路径；Brain 对这些产物跑同一套二次复查。
- 把 acw-bf-videos（81）和 bdsmpub（10+noir）补录为历史 Job。
- **完成条件**：`/brain` 能看到 acw 与 bdsmpub 两条工作线及其 91+ 条产物的复查结果；新跑一条会话批量，5 分钟内出现在 `/brain`。

### P2 · 学习库单一来源 + 指令收割（1 周）
- Neon 表 `Lesson` / `Directive` / `CraftItem` / `Outcome`（随 PR #180 的 schema 迁移一起上，需 Barron 批）。迁移现有 20 条 learnings、钩子/结尾/提示词库、sqlite 样式库索引。
- **指令收割**：每天扫一次 handoff journal + 各项目 RUN-REPORT/HANDOFF + 会话转录里 Barron 的原话（如"无暴露"、"温柔音乐"、"预算用完转幻灯片"），抽成 `Directive`（作用域 + 原话 + 来源），候选状态，Brain 页一键确认。
- 技能侧：6 份 `LEARNINGS.md` 改为引用 `_shared/VIDEO-KNOWLEDGE.md`（按作用域生成），Ad Studio 脚本提示词按 Workstream 取相关条目（不是全量 20 条）。
- **完成条件**：在 Brain 页按"bdsmpub × 社媒"能查到合规指令与音乐偏好；新开 bdsmpub Job 时提示词里自动带上这些条目（有一个会失败的接线测试）。

### P3 · 学"上头"：效果闭环（2 周，依赖数据源）
- 每条成片打元素标签：钩子类型、开头 1.5 s 画面、结构模板、时长、音乐情绪、VO 风格、字幕样式、模式（AI/幻灯片）。
- 数据回流：社媒（Postiz/YouTube API 已有 social-autopost 项目）→ 播放、完播、3 s 留存；广告（Meta/TikTok，有账号时）→ hook rate、ThruPlay、CTR、ROAS → `Outcome`。
- 元素级排名 + Strategist（每天一次）出"下一轮测什么"的实验矩阵（比如 3 个钩子 × 2 个结构），自动排进 Workstream。
- QA 打分加"上头度"预测（独立模型族评审：前 1.5 s 抓眼、节奏、情绪峰值），与真实数据对比校准。
- **完成条件**：有 ≥30 条带数据的视频后，Brain 页显示元素排名；Strategist 的下一轮矩阵引用这些排名。

### P4 · Dashboard 快速通道（1–2 周，可与 P2 并行）
- `Quick Create` 一页：粘网址（单品页或首页——首页模式抓"热门 N 个产品"）或拖文件 → 选目的（广告 / 促销 / 社媒日更 / 提案样片）→ 数量 → 模式（自动 / AI 视频 / $0 幻灯片 / 网页宣传片）→ 合规档（标准 / 敏感品类：无暴露、无露骨文案）→ 提交即成一批 Job。
- 结果页：网格预览、逐条通过/重做/评论（评论变成 `Directive` 候选）、一键打包下载。
- **完成条件**：在线上粘 `https://bdsmpub.com/` 选"社媒 × 幻灯片 × 10 × 敏感档"，不开 Claude 会话就产出 10 条并通过二次复查。

### P5 · 收敛多个 brain（之后）
- 5 个 brain 进程统一用同一套 `Lesson/Directive` 存储与同一个 journal 收割器；video-brain 作为样板，其余按需迁移。不在本轮做。

---

## 4. 需要 Barron 决定的事

| # | 决策 | 选项（推荐在前） |
|---|---|---|
| 1 | 先做哪个 | **A. P1+P2（看见所有工作 + 统一学习库）** / B. P4 快速通道先上 / C. P3 效果闭环先上 |
| 2 | 学习库表结构上线方式 | **A. 跟 PR #180 一起做一次生产 `prisma db push`** / B. 继续塞 `AppSetting` JSON，晚点再迁 |
| 3 | "上头"的数据来源 | **A. 先用社媒自然流量数据（已有 Postiz/YouTube 接入）** / B. 等广告账户数据（Meta/TikTok） |
| 4 | 指令收割要不要扫会话转录 | **A. 扫 journal + RUN-REPORT + 会话里 Barron 原话，候选需确认** / B. 只扫 journal 和文件 |

## 5. 已知阻塞（不改架构也存在）
- OpenRouter key 额度为 0（Brain probe `openrouter balance` 失败）→ AI 视频暂停，只能走 $0 幻灯片。
- PR #180 未合并（含生产 `prisma db push`）。
