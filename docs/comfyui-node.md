# ComfyUI render node — operator guide

ComfyUI is the third Studio render engine, next to **LibTV** (paid credits, rendered on the Mac worker) and **GLM** (Zhipu's free cloud models, rendered on the server). With ComfyUI, keyframes and clips render on an NVIDIA GPU that you own or rent. A clip costs 0 credits; you pay only for the GPU hours. Assembly into the master MP4 still happens on the app server with ffmpeg, the same way it does for GLM.

```
Studio ─ approve ─▶ Next.js (Vercel) ── server-executor ──HTTPS──▶ Cloudflare Tunnel ─▶ ComfyUI :8188 on the GPU box
                         │  K<n>: t2i-keyframe.json  (SDXL checkpoint)
                         │  V<n>: i2v-wan22-5b.json  (Wan 2.2 TI2V 5B, off the keyframe)
                         └─ copies outputs into Cloudinary / Vercel Blob, then assembles with ffmpeg
```

Code map:

| Piece | File |
| --- | --- |
| HTTP client (`/prompt`, `/history`, `/view`, `/upload/image`, `/queue`, `/system_stats`) | `src/services/ai/comfyui.ts` |
| Workflow templates and `fillWorkflow` / `findOutputs` | `src/services/video-gen/comfy-workflows/` |
| ComfyUI engine adapter | `src/services/video-gen/comfy-executor.ts` |
| Graph walking shared by GLM and ComfyUI | `src/services/video-gen/server-executor.ts` |
| Catalog entries (`ComfyUI Image (self-hosted)`, `ComfyUI Video (self-hosted)`) | `src/services/video-gen/libtv-pricing.ts` |

The ComfyUI models show up in Studio's pickers only when `COMFYUI_URL` is set. They are also offered in strict free mode (`AI_COST_MODE=free`), because they spend no credits. The clip model decides the engine, so pick the ComfyUI keyframe model together with the ComfyUI clip model. The picker keeps the two aligned, and compile rejects a mismatched pair. Autopilot's "Render for free" step approves 0-credit ComfyUI runs automatically, as it already does for GLM.

## 1. Hardware

| Workflow | Model | VRAM | Notes |
| --- | --- | --- | --- |
| Keyframe (t2i) | SDXL base 1.0 or any SDXL fine-tune | 8 GB+ | ~1 MP; a few seconds per image on a 4090 |
| Clip (i2v) | **Wan 2.2 TI2V 5B** (fp16) | 8 GB minimum with ComfyUI's native offloading; **24 GB recommended** | 1280×704 / 704×1280, 24 fps, 121 frames = 5 s |
| Talking head | LivePortrait (KJ) | ~6–8 GB | Needs a driving video; see §6 |

- The Comfy docs say: *"The Wan2.2 5B version should fit well on 8GB vram with the ComfyUI native offloading"* ([docs.comfy.org — Wan 2.2](https://docs.comfy.org/tutorials/video/wan/wan2_2)). With only 8 GB it runs, but slowly.
- For speed, the Wan team reports under 9 minutes for a 5 s 720p clip on a single consumer GPU at 50 denoising steps ([Wan2.2-TI2V-5B model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)). The bundled template uses 20 steps (the official ComfyUI template's setting). **Estimate:** about 3–5 minutes per clip on an RTX 4090 or 5090, and longer on 16 GB cards. I have not measured this myself.
- Wan 2.2 **14B** i2v (the high-noise and low-noise experts) looks better, but it needs 40 GB+ or heavy offloading. To use it, export your own API workflow and drop it in `COMFYUI_WORKFLOW_DIR` (§5).
- An RTX 4090 or 5090 (24/32 GB) is the sweet spot. An L40S or A6000 (48 GB) gives you room for 14B.

## 2. Install ComfyUI and the models

Use a recent ComfyUI release (Wan 2.2 support landed in late July 2025, and the core `SaveVideo` node now uses the dynamic `format` / `format.codec` inputs that the template sends):

```bash
git clone https://github.com/comfyanonymous/ComfyUI && cd ComfyUI
python -m venv .venv && . .venv/bin/activate
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
```

Model files (the template's exact file names):

```bash
cd models
# Keyframes — any SDXL checkpoint; set COMFYUI_IMAGE_CHECKPOINT if the name differs
wget -P checkpoints https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors
# Wan 2.2 TI2V 5B (official ComfyUI repackage)
wget -P diffusion_models https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors
wget -P text_encoders   https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors
wget -P vae             https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors
```

The keyframe and clip templates use **core nodes only**: `CheckpointLoaderSimple`, `KSampler`, `SaveImage`, `UNETLoader`, `CLIPLoader (type wan)`, `VAELoader`, `ModelSamplingSD3`, `Wan22ImageToVideoLatent`, `CreateVideo` and `SaveVideo`. They need no custom nodes. The i2v graph is the official `video_wan2_2_5B_ti2v` template exported in API format.

## 3. Run it headless

Bind ComfyUI to localhost only. The tunnel (or proxy) is the only thing that should be able to reach it.

```bash
python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch
```

Run it under systemd (or `tmux`) so it survives a disconnect. Sanity-check it with `curl -s localhost:8188/system_stats`.

ComfyUI keeps the history of past prompts in memory. If the process restarts mid-clip, the app notices that the prompt is neither in the queue nor in the history, and fails that job with "ComfyUI lost prompt …". Re-approve the run to retry.

## 4. Expose it safely (never unauthenticated)

**ComfyUI has no authentication.** Anyone who can reach port 8188 can run arbitrary workflows on your GPU and read every file in its output folder. Put it behind one of these two options:

### Option A — Cloudflare Tunnel + Access service token (recommended)

1. On the GPU box: `cloudflared tunnel login`, `cloudflared tunnel create comfy`, and route a hostname such as `comfy.example.com` to `http://127.0.0.1:8188` ([Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)).
2. In Zero Trust, go to **Access → Applications** and add a self-hosted app for `comfy.example.com`, with a policy whose action is **Service Auth**.
3. Create a **service token** ([docs](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)) and include it in that policy.
4. Set `COMFYUI_CF_ACCESS_CLIENT_ID` and `COMFYUI_CF_ACCESS_CLIENT_SECRET` in Vercel. The client sends them as `CF-Access-Client-Id` / `CF-Access-Client-Secret` on every request.

### Option B — token proxy

Put a reverse proxy in front of ComfyUI that requires `Authorization: Bearer <token>`, then set `COMFYUI_TOKEN`. A Caddy example (TLS is automatic):

```caddyfile
comfy.example.com {
  @ok header Authorization "Bearer {$COMFY_PROXY_TOKEN}"
  handle @ok {
    reverse_proxy 127.0.0.1:8188
  }
  respond 401
}
```

Rented pods usually offer an HTTPS proxy URL, for example RunPod's `https://<pod>-8188.proxy.runpod.net`. Those URLs are **public**, so still use A or B in front of them.

## 5. App configuration (Vercel env)

| Variable | Required | Purpose |
| --- | --- | --- |
| `COMFYUI_URL` | yes | Public HTTPS base URL of the node, e.g. `https://comfy.example.com` |
| `COMFYUI_CF_ACCESS_CLIENT_ID` / `COMFYUI_CF_ACCESS_CLIENT_SECRET` | Option A | Cloudflare Access service token |
| `COMFYUI_TOKEN` | Option B | Sent as `Authorization: Bearer …` |
| `COMFYUI_IMAGE_CHECKPOINT` | no | Keyframe checkpoint file name (default `sd_xl_base_1.0.safetensors`) |
| `COMFYUI_WORKFLOW_DIR` | no | Directory of override templates on the **app server** (same file names as the bundled ones). On Vercel this must be a path inside the deployment, so it is mainly for self-hosted deployments. |
| `CLOUDINARY_URL` or `BLOB_READ_WRITE_TOKEN` | yes | ComfyUI outputs are private to the node, so they are copied into asset storage. The engine refuses to store them inline. |

Afterwards, open **/status**. The "ComfyUI render node" row calls `GET /system_stats` and shows the GPU name, its VRAM and the ComfyUI version, or the error.

### Custom workflows

Templates are ComfyUI **API format** (in ComfyUI, use *Workflow → Export (API)*). Values that change per job are written as placeholders: `{{prompt}}`, `{{negative}}`, `{{image}}`, `{{width}}`, `{{height}}`, `{{frames}}`, `{{fps}}`, `{{seed}}`, `{{checkpoint}}` and `{{driving_video}}`. A value that is only a placeholder keeps its type, so numbers stay numbers. A placeholder that is left unset fails the job with a clear error instead of queueing a broken prompt. The output is found automatically: core `SaveImage` / `SaveVideo`, `SaveAnimatedWEBP` and VideoHelperSuite `VHS_VideoCombine` all work. Real video files are preferred over animated WEBP/GIF.

## 6. LivePortrait talking head (optional)

`comfy-workflows/liveportrait-talking-head.json` animates a still portrait (`{{image}}`) with the facial motion of a driving video (`{{driving_video}}`). This is motion transfer: it does not generate lip-sync from audio. You record or choose a driving clip of someone speaking the line.

- Node packs: **ComfyUI-LivePortraitKJ** (`git clone https://github.com/kijai/ComfyUI-LivePortraitKJ` into `custom_nodes/`, then `pip install -r requirements.txt`) and **ComfyUI-VideoHelperSuite** (for `VHS_LoadVideo` / `VHS_VideoCombine`).
- Models are downloaded automatically to `models/liveportrait` from [Kijai/LivePortrait_safetensors](https://huggingface.co/Kijai/LivePortrait_safetensors).
- The template uses the **MediaPipe** cropper (MIT/Apache-2.0). The default InsightFace cropper's license is **non-commercial**, so do not switch to it for client work ([ComfyUI-LivePortraitKJ README](https://github.com/kijai/ComfyUI-LivePortraitKJ)).
- Upload the driving video to the node with the same `POST /upload/image` route (it accepts any file) and pass the returned `subfolder/name` as `driving_video`.

**Status:** the template is bundled. Its node inputs were checked against the LivePortraitKJ and VideoHelperSuite source, but it has not been run on a GPU yet. Also, the Studio storyboard does not yet have a driving-video input. Talking-head shots are therefore not generated automatically. Wiring them in means adding a job kind whose adapter call fills this template, instead of i2v, for frames marked as talking-head.

## 7. What it costs (estimates)

On-demand prices from [RunPod's pricing page](https://www.runpod.io/pricing), read on 2026-09-25. Community Cloud / Secure Cloud per hour:

| GPU | VRAM | Community | Secure |
| --- | --- | --- | --- |
| RTX 4090 | 24 GB | $0.34 | $0.74 |
| RTX 5090 | 32 GB | $0.69 | $0.99 |
| RTX A6000 | 48 GB | $0.33 | $0.53 |
| L40S | 48 GB | $0.79 | $1.09 |
| A100 80GB PCIe | 80 GB | $1.19 | $1.59 |
| H100 PCIe | 80 GB | $1.99 | $2.89 |

[Vast.ai](https://vast.ai/pricing) is a marketplace with per-second billing, and it is often cheaper than RunPod's Community Cloud. Its prices move with the market, so check them live.

**Estimate per ad:** a typical economy run has 6–8 clips. At about 4 minutes per clip plus keyframes on a 4090, that is about 30–40 GPU-minutes, which works out to **about $0.20–$0.50 per master video** on a rented 4090. On hardware you already own it costs only electricity. Stop or pause rented pods when you are not using them: idle hours cost the same as busy ones.
