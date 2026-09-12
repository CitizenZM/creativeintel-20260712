# LibTV CLI — working knowledge

## Install / auth
- Binary `~/.libtv/libtv` (v1.1.3 as of 2026-09-10). Authoritative version + install/skill URLs:
  `https://api2.liblib.art/api/www/landing-activities/getById?id=240` — the `latest/manifest.json`
  channel lags behind.
- `libtv login web` prints a URL with a localhost callback; open it in the already-logged-in
  ego-browser tab and the CLI writes `~/.libtv/credentials.json`.
- **Tokens expire mid-session.** Symptom: `接口错误 [10001]: 用户未授权` on every call. Fix: rerun
  `libtv login web` in the background, open the callback URL, continue.
- Credit balance is **only** visible in the web UI top bar — no CLI command. Read it with
  ego-browser before and after a batch.

## Canvas model
- Workspace (工作区) → canvas (画布) → nodes. `libtv project create/use` binds the current
  directory via `.libtv/project.json`; all later commands default to that canvas.
- Node types: `image`, `video`, `text`, `script`, `audio`, `group`, plus canvas-only
  `director-console-3d`.
- Edges are references: `--left "<node name or id>"` (repeatable) feeds an upstream asset into a
  generation node. `libtv upload "name" --file x.png` creates an asset node.
- `--run` blocks until the task reaches a terminal state; `"status":2` = success, `3` = failed.
  Never background it or wrap it in a timeout.

## Parameters that matter
- `-s model=<模型名>` uses the **display name** (`Seedream 5.0 Pro`, `Hailuo 2.3 Fast`, `Kling O3`).
- `-s modeType=` — **image nodes with reference edges must be `image2image`**, otherwise node
  creation fails validation. Video: `singleImage2video`, `frames2video` (first+last frame),
  `image2video`, `mixed2video`, `videoEdit2video`, `audio2video`.
- Image: `-s ratio=9:16 -s quality=2K -s count=1` (Seedream) / `-s resolution=2K -s quality=high`
  (Lib Image). Video: `-s duration=N -s resolution=720p -s enableSound=off` — allowed keys differ
  per model; an unknown key fails validation and tells you the allowed set.
- `libtv model <modelKey>` dumps the full schema (enums, min/max, modeType input counts). No price
  fields in the schema.

## Measured credit prices (2026-09-10, annual-VIP account)

| Model | Spec | Credits |
|---|---|---|
| Seedream 5.0 Pro | image, 2K | **14 / image** |
| Lib Image 2.5 Pro | image, 2K, quality=high | ~27 / image |
| Hailuo 2.3 Fast | video, 1080P, 6s | **24** |
| Kling O3 | video 9:16, 3s / 5s (frames2video) | 24 / 40 |
| Kling 3.0 Turbo | 720p, 3s | 36 |
| Wan 3.0 | 720P, 4s / 2s | 40 / 20 |
| Seedance 2.0 Mini | 480P / 720P, 4s | 32 / 64 |
| Seedance 2.5 | 480P / 720P, 4s | 80 / **156** |
| Seedance 1.5 Pro | 1080P, 5s | 90 |

**Best value found: Hailuo 2.3 Fast** (1080P, 6s, 24 credits) for image-to-video with people;
**Kling O3 frames2video** (40) for orbit/camera-move shots. Seedance 2.5 costs 6× for no visible
gain at these shot lengths.

### Price probe — NOT zero cost via the CLI (measured 2026-09-11)
Creating nodes with `libtv node create … -s modeType=image2image` (no `--run`) through the CLI
and then reading the estimate in the UI **charged the account anyway**: 11 probe nodes = 72
credits, exactly the sum of their displayed prices (balance 133 → 61). Treat every CLI node
creation with a reference edge as a paid generation. Only probe prices in the web UI by changing
the model dropdown on an existing un-run node, or use the measured table below.

### Measured prices, 9:16, count=1, image2image with 1 reference (2026-09-11)
| Model | Settings | Credits |
|---|---|---|
| **Seedream 4.0** | quality=2K | **1** |
| Z-image Turbo | quality=1K | 1 |
| Seedream 4.5 | quality=2K | 2 |
| Seedream 5.0 Lite | quality=2K | 4 |
| Qwen image 3.0 | resolution=1K quality=std | 5 |
| Lib Image 2.5 Fast / Pro | resolution=1K quality=low | 6 |
| General image V2 | quality=1K | 8 |
| Seedream 5.0 Pro | quality=1K | 9 (2K = 14) |
| Hailuo 2.3 Fast video | 768P, 6 s, singleImage2video | **12** (1080P = 24) |
| Wan 3.0 video | 720P, 2 s, frames2video (no singleImage2video) | 20 |

## Canvas-only features worth using
- **运镜 presets** (23): 固定镜头 跟随拍摄 盘旋抬升/下降 镜头上/下/左/右摇 上升/下降/左移/右移
  前推/后移 变焦推进/拉远 柯克变焦 环绕拍摄 滚筒旋转 第一视角 无人机 高空航拍 手持拍摄.
- **特效 templates** (community, Seedance 2.0): 面部环拍, 产品扫光, 微距推镜, 试妆特写, AI 编舞,
  镜面分身, 悬浮缓入…
- **导演台 (director-console-3d)**: block a camera path with a 3D mannequin, export the animation,
  feed it as a 运镜参考 video into a generation node. Use when a camera move must be exact.

## Error catalogue
| Message | Cause / fix |
|---|---|
| `用户未授权` (10001) | token expired → re-login |
| `图片生成节点须为图生图模式` | add `-s modeType=image2image` when passing reference edges |
| `params 顶层不允许设置未知字段「x」` | that key isn't in this model's schema — check `libtv model` |
| `params.settings.duration=4 不在允许范围` | model has a fixed duration enum (e.g. 5/10) |
| `图片违反内容规则` | Lib Image false positive; re-run on Seedream or rephrase |
| download writes nothing | node name must match exactly; `-n` also accepts the node id |

## ego-browser notes
- `mouse.wheel` over the canvas **pans the canvas away** ("当前视窗没有节点" → click 返回节点).
- Selecting a node: click its label in the left list, or click the card body.
- Node panel buttons (参考 / 标记 / 特效 / 角色库 / 运镜) only appear when a node is selected.
