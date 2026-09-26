/**
 * ComfyUI HTTP client — the self-hosted GPU render engine.
 *
 * Routes used (https://docs.comfy.org/development/comfyui-server/comms_routes,
 * checked against ComfyUI server.py on 2026-09-25):
 *   POST /prompt            { prompt: <API workflow>, client_id, front? } → { prompt_id, number, node_errors }
 *                           400 → { error: { type, message }, node_errors: { [id]: { class_type, errors[] } } }
 *   GET  /history/{id}      {} until done, then { [id]: { outputs, status: { status_str, completed, messages } } }
 *   GET  /view?filename=&subfolder=&type=   raw output bytes
 *   POST /upload/image      multipart image, subfolder, type, overwrite → { name, subfolder, type }
 *   GET  /system_stats      { system: { comfyui_version, … }, devices: [{ name, type, vram_total, vram_free }] }
 *
 * Env: COMFYUI_URL (required), COMFYUI_TOKEN (optional, sent as Bearer — for a
 * token proxy), COMFYUI_CF_ACCESS_CLIENT_ID/SECRET (optional, Cloudflare Access
 * service token). ComfyUI itself has no auth: never expose it unauthenticated.
 */
import type { ComfyWorkflow } from "@/services/video-gen/comfy-workflows";

export class ComfyError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ComfyError";
  }
}

export function comfyUrl(): string | undefined {
  const raw = process.env.COMFYUI_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : undefined;
}

export function isComfyConfigured(): boolean {
  return !!comfyUrl();
}

export function comfyHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = process.env.COMFYUI_TOKEN?.trim();
  if (token) h.Authorization = `Bearer ${token}`;
  const cfId = process.env.COMFYUI_CF_ACCESS_CLIENT_ID?.trim();
  const cfSecret = process.env.COMFYUI_CF_ACCESS_CLIENT_SECRET?.trim();
  if (cfId && cfSecret) {
    h["CF-Access-Client-Id"] = cfId;
    h["CF-Access-Client-Secret"] = cfSecret;
  }
  return h;
}

interface RequestOpts {
  method?: string;
  json?: unknown;
  body?: FormData;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

async function comfyRequest(path: string, opts: RequestOpts = {}): Promise<Response> {
  const base = comfyUrl();
  if (!base) throw new ComfyError("COMFYUI_URL is not configured");
  const attempts = Math.max(1, (opts.retries ?? 2) + 1);
  const headers: Record<string, string> = { ...comfyHeaders() };
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, (opts.retryDelayMs ?? 1500) * 2 ** (attempt - 1)));
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: opts.method ?? (opts.json !== undefined || opts.body ? "POST" : "GET"),
        headers,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        cache: "no-store",
      });
    } catch (err) {
      // Network failure / timeout: the box may be restarting — retry.
      lastErr = new ComfyError(`ComfyUI ${path} unreachable: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (res.ok) return res;
    if (res.status >= 500) {
      lastErr = new ComfyError(`ComfyUI ${path} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`, res.status);
      continue;
    }
    throw await clientError(path, res);
  }
  throw lastErr;
}

async function clientError(path: string, res: Response): Promise<ComfyError> {
  const text = await res.text().catch(() => "");
  let detail = text.slice(0, 300);
  try {
    const data = JSON.parse(text) as {
      error?: { message?: string } | string;
      node_errors?: Record<string, { class_type?: string; errors?: { message?: string; details?: string }[] }>;
    };
    const top = typeof data.error === "string" ? data.error : data.error?.message;
    const nodes = Object.entries(data.node_errors ?? {}).map(
      ([id, n]) => `${n.class_type ?? id}: ${(n.errors ?? []).map((e) => [e.message, e.details].filter(Boolean).join(" — ")).join("; ")}`
    );
    detail = [top, ...nodes].filter(Boolean).join(" | ") || detail;
  } catch {
    /* not JSON */
  }
  if (res.status === 401 || res.status === 403) detail = `${detail} (check COMFYUI_TOKEN / Cloudflare Access credentials)`.trim();
  return new ComfyError(`ComfyUI ${path} ${res.status}: ${detail}`, res.status);
}

/** Queue an API-format workflow; returns the prompt id. `front` jumps the queue. */
export async function queuePrompt(
  workflow: ComfyWorkflow,
  opts: { clientId?: string; front?: boolean; retryDelayMs?: number } = {}
): Promise<string> {
  const body: Record<string, unknown> = { prompt: workflow, client_id: opts.clientId ?? "creativeintel" };
  if (opts.front) body.front = true;
  const res = await comfyRequest("/prompt", { json: body, timeoutMs: 30_000, retryDelayMs: opts.retryDelayMs });
  const data = (await res.json()) as { prompt_id?: string; node_errors?: Record<string, unknown> };
  if (!data.prompt_id) throw new ComfyError("ComfyUI /prompt returned no prompt_id");
  return data.prompt_id;
}

/** Raw GET /history/{id} — parse it with `parseHistory` from comfy-workflows. */
export async function getHistory(promptId: string): Promise<Record<string, never> | Record<string, unknown>> {
  const res = await comfyRequest(`/history/${encodeURIComponent(promptId)}`, { timeoutMs: 20_000 });
  return (await res.json()) as Record<string, unknown>;
}

/** Download one output file through /view. */
export async function fetchOutput(ref: { filename: string; subfolder?: string; type?: string }): Promise<{ buffer: Buffer; contentType: string }> {
  const qs = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder ?? "", type: ref.type ?? "output" });
  const res = await comfyRequest(`/view?${qs.toString()}`, { timeoutMs: 120_000 });
  const contentType = res.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
}

export interface UploadedImage {
  name: string;
  subfolder: string;
  type: string;
  /** The value a LoadImage node expects: "subfolder/name". */
  loadImageName: string;
}

/** Upload an image (or a driving video — the route accepts any file) into ComfyUI's input dir. */
export async function uploadImage(
  buffer: Buffer,
  filename: string,
  opts: { subfolder?: string; overwrite?: boolean; contentType?: string } = {}
): Promise<UploadedImage> {
  const form = new FormData();
  form.set("image", new Blob([new Uint8Array(buffer)], { type: opts.contentType ?? "image/png" }), filename);
  form.set("type", "input");
  form.set("subfolder", opts.subfolder ?? "");
  form.set("overwrite", opts.overwrite === false ? "false" : "true");
  const res = await comfyRequest("/upload/image", { body: form, timeoutMs: 60_000 });
  const data = (await res.json()) as { name?: string; subfolder?: string; type?: string };
  if (!data.name) throw new ComfyError("ComfyUI /upload/image returned no name");
  const subfolder = data.subfolder ?? "";
  return {
    name: data.name,
    subfolder,
    type: data.type ?? "input",
    loadImageName: subfolder ? `${subfolder}/${data.name}` : data.name,
  };
}

export interface ComfySystemStats {
  system?: { os?: string; comfyui_version?: string; ram_total?: number; ram_free?: number };
  devices?: { name?: string; type?: string; index?: number | null; vram_total?: number; vram_free?: number }[];
}

export async function getSystemStats(timeoutMs = 5000): Promise<ComfySystemStats> {
  const res = await comfyRequest("/system_stats", { timeoutMs, retries: 0 });
  return (await res.json()) as ComfySystemStats;
}

const GB = 1024 ** 3;

/** "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync" → "NVIDIA GeForce RTX 4090". */
export function summariseSystemStats(stats: ComfySystemStats): {
  version: string | null;
  gpu: string | null;
  vramTotalGb: number | null;
  vramFreeGb: number | null;
} {
  const gpu = stats.devices?.find((d) => d.type && d.type !== "cpu");
  const round = (n?: number) => (typeof n === "number" && n > 0 ? Math.round((n / GB) * 10) / 10 : null);
  return {
    version: stats.system?.comfyui_version ?? null,
    gpu: gpu?.name ? gpu.name.replace(/^\S+:\d+\s+/, "").replace(/\s+:\s+\S+$/, "").trim() || gpu.name : null,
    vramTotalGb: gpu ? round(gpu.vram_total) : null,
    vramFreeGb: gpu ? round(gpu.vram_free) : null,
  };
}
