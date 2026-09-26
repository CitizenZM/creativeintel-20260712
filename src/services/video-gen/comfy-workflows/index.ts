/**
 * ComfyUI workflow templates (API format) and the pure helpers around them.
 *
 * Templates are the "Export (API)" JSON ComfyUI accepts on POST /prompt: an
 * object of node id → { class_type, inputs }. Values that vary per job are
 * written as `{{name}}` placeholders:
 *   {{prompt}} {{negative}} {{image}} {{driving_video}} {{checkpoint}}
 *   {{width}} {{height}} {{frames}} {{fps}} {{seed}}
 *
 * Bundled templates (model files and node packs are listed in docs/comfyui-node.md):
 *   t2i  t2i-keyframe.json              core nodes, any SD/SDXL checkpoint ({{checkpoint}})
 *   i2v  i2v-wan22-5b.json              core nodes, Wan 2.2 TI2V 5B (official ComfyUI template)
 *   talking_head liveportrait-talking-head.json  ComfyUI-LivePortraitKJ + VideoHelperSuite
 *
 * COMFYUI_WORKFLOW_DIR overrides any template by file name, so an operator can
 * swap in a heavier model without a deploy.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import t2iKeyframe from "./t2i-keyframe.json";
import i2vWan22 from "./i2v-wan22-5b.json";
import liveportrait from "./liveportrait-talking-head.json";

export type ComfyInputValue = string | number | boolean | null | [string, number] | ComfyInputValue[] | { [k: string]: ComfyInputValue };

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, ComfyInputValue>;
  _meta?: { title?: string };
}

export type ComfyWorkflow = Record<string, ComfyNode>;

export type WorkflowVars = Partial<
  Record<
    "prompt" | "negative" | "image" | "driving_video" | "checkpoint" | "width" | "height" | "frames" | "fps" | "seed",
    string | number
  >
> &
  Record<string, string | number | undefined>;

export const BUNDLED_WORKFLOWS = {
  t2i: { file: "t2i-keyframe.json", json: t2iKeyframe as unknown as ComfyWorkflow },
  i2v: { file: "i2v-wan22-5b.json", json: i2vWan22 as unknown as ComfyWorkflow },
  talking_head: { file: "liveportrait-talking-head.json", json: liveportrait as unknown as ComfyWorkflow },
} as const;

export type WorkflowName = keyof typeof BUNDLED_WORKFLOWS;

export const DEFAULT_NEGATIVE_PROMPT =
  "text, watermark, logo, subtitles, blurry, low quality, jpeg artifacts, deformed, distorted product, extra fingers, bad hands, static frame";

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const WHOLE = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/;

function walk(value: ComfyInputValue, visit: (s: string) => ComfyInputValue): ComfyInputValue {
  if (typeof value === "string") return visit(value);
  if (Array.isArray(value)) {
    // [nodeId, outputIndex] links are structure, not text.
    if (value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number") return [value[0], value[1]];
    return value.map((v) => walk(v, visit));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, visit)]));
  }
  return value;
}

/** Every placeholder name a template uses. */
export function placeholdersIn(workflow: ComfyWorkflow): string[] {
  const names = new Set<string>();
  for (const node of Object.values(workflow)) {
    walk(node.inputs as ComfyInputValue, (s) => {
      for (const m of s.matchAll(PLACEHOLDER)) names.add(m[1]);
      return s;
    });
  }
  return [...names];
}

/**
 * Substitute `{{name}}` placeholders. A string that is exactly one placeholder
 * takes the value with its own type (numbers stay numbers — ComfyUI rejects
 * "768" for an INT input); a placeholder inside longer text is interpolated.
 * Works on the parsed object, so prompt text never needs JSON escaping, and
 * substituted values are never re-scanned. Throws if any placeholder is unset.
 */
export function fillWorkflow(template: ComfyWorkflow, vars: WorkflowVars): ComfyWorkflow {
  const missing = new Set<string>();
  const valueOf = (name: string): string | number | undefined => {
    const v = vars[name];
    if (v === undefined || v === null) {
      missing.add(name);
      return undefined;
    }
    if (typeof v === "number" && !Number.isFinite(v)) {
      missing.add(name);
      return undefined;
    }
    return v;
  };

  const out: ComfyWorkflow = {};
  for (const [id, node] of Object.entries(template)) {
    const inputs = walk(node.inputs as ComfyInputValue, (s) => {
      const whole = s.match(WHOLE);
      if (whole) return valueOf(whole[1]) ?? s;
      return s.replace(PLACEHOLDER, (m, name: string) => {
        const v = valueOf(name);
        return v === undefined ? m : String(v);
      });
    }) as Record<string, ComfyInputValue>;
    out[id] = { ...node, inputs };
  }
  if (missing.size) throw new Error(`Workflow placeholders without a value: ${[...missing].join(", ")}`);
  return out;
}

function assertApiFormat(json: unknown, source: string): ComfyWorkflow {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error(`${source} is not a ComfyUI API format workflow (use "Export (API)")`);
  }
  for (const [id, node] of Object.entries(json as Record<string, unknown>)) {
    const n = node as Partial<ComfyNode> | null;
    if (!n || typeof n !== "object" || typeof n.class_type !== "string" || typeof n.inputs !== "object") {
      throw new Error(`${source} is not a ComfyUI API format workflow (node "${id}" has no class_type/inputs — use "Export (API)")`);
    }
  }
  return json as ComfyWorkflow;
}

/**
 * The template for `name`: `<dir>/<file>` when COMFYUI_WORKFLOW_DIR (or
 * `opts.dir`) has one, else the bundled default.
 */
export async function loadWorkflow(name: WorkflowName, opts: { dir?: string } = { dir: process.env.COMFYUI_WORKFLOW_DIR }): Promise<ComfyWorkflow> {
  const bundled = BUNDLED_WORKFLOWS[name];
  if (opts.dir) {
    const file = path.join(opts.dir, bundled.file);
    const raw = await readFile(file, "utf8").catch(() => null);
    if (raw !== null) return assertApiFormat(JSON.parse(raw), file);
  }
  return bundled.json;
}

// ─── Outputs ────────────────────────────────────────────────────────────────

export interface ComfyFileRef {
  filename: string;
  subfolder: string;
  type: string;
  nodeId?: string;
}

export interface ComfyOutputs {
  images: ComfyFileRef[];
  videos: ComfyFileRef[];
}

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v|avi|gif)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|tiff?)$/i;

type RawFile = { filename?: unknown; subfolder?: unknown; type?: unknown; format?: unknown };
type RawNodeOutput = Record<string, unknown> | null | undefined;

/**
 * Files a finished prompt produced, from `history[promptId].outputs`:
 *   SaveImage / PreviewImage  → { images: [...] }
 *   SaveVideo (core)          → { images: [...mp4], animated: [true] }
 *   SaveAnimatedWEBP          → { images: [...webp], animated: [true] }
 *   VHS_VideoCombine          → { gifs: [{ ..., format: "video/h264-mp4" }] }
 *   some custom nodes         → { videos: [...] }
 * Real video containers rank before animated WEBP/GIF, saved outputs before temp previews.
 */
export function findOutputs(outputs: Record<string, RawNodeOutput> | undefined | null): ComfyOutputs {
  const images: ComfyFileRef[] = [];
  const videos: (ComfyFileRef & { rank: number })[] = [];
  if (!outputs || typeof outputs !== "object") return { images, videos };

  for (const [nodeId, out] of Object.entries(outputs)) {
    if (!out || typeof out !== "object") continue;
    const animated = Array.isArray(out.animated) && out.animated.some(Boolean);
    for (const key of ["images", "gifs", "videos", "video"]) {
      const list = out[key];
      if (!Array.isArray(list)) continue;
      for (const f of list as RawFile[]) {
        if (!f || typeof f.filename !== "string") continue;
        const ref: ComfyFileRef = {
          filename: f.filename,
          subfolder: typeof f.subfolder === "string" ? f.subfolder : "",
          type: typeof f.type === "string" ? f.type : "output",
          nodeId,
        };
        const format = typeof f.format === "string" ? f.format : "";
        const isRealVideo = (VIDEO_EXT.test(f.filename) && !/\.gif$/i.test(f.filename)) || format.startsWith("video/");
        const isAnimated = key !== "images" || animated || /\.gif$/i.test(f.filename);
        const temp = ref.type === "temp" ? 2 : 0;
        if (isRealVideo) videos.push({ ...ref, rank: temp });
        else if (isAnimated && (IMAGE_EXT.test(f.filename) || /\.gif$/i.test(f.filename))) videos.push({ ...ref, rank: 1 + temp });
        else if (IMAGE_EXT.test(f.filename)) images.push(ref);
      }
    }
  }
  const tempLast = (a: ComfyFileRef, b: ComfyFileRef) => Number(a.type === "temp") - Number(b.type === "temp");
  images.sort(tempLast);
  videos.sort((a, b) => a.rank - b.rank);
  return { images, videos: videos.map(({ rank: _rank, ...v }) => v) };
}

export type HistoryState =
  | { state: "pending" }
  | { state: "success"; outputs: ComfyOutputs }
  | { state: "error"; error: string };

type HistoryEntry = {
  outputs?: Record<string, RawNodeOutput>;
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
};

/** Interpret GET /history/{prompt_id}: `{}` until the prompt finishes. */
export function parseHistory(history: Record<string, HistoryEntry> | null | undefined, promptId: string): HistoryState {
  const entry = history?.[promptId];
  if (!entry) return { state: "pending" };
  const status = entry.status;
  if (status?.status_str === "error") {
    const err = status.messages?.find((m) => m[0] === "execution_error")?.[1] ?? {};
    const node = typeof err.node_type === "string" ? `${err.node_type}: ` : "";
    const msg = typeof err.exception_message === "string" ? err.exception_message.trim() : "ComfyUI reported an execution error";
    return { state: "error", error: `${node}${msg}` };
  }
  if (status && status.completed === false && status.status_str !== "success") return { state: "pending" };
  return { state: "success", outputs: findOutputs(entry.outputs) };
}

// ─── Sizes ──────────────────────────────────────────────────────────────────

/** SDXL-native keyframe sizes (~1 MP). */
export function comfyImageSize(aspectRatio = "9:16"): { width: number; height: number } {
  if (aspectRatio === "16:9") return { width: 1344, height: 768 };
  if (aspectRatio === "1:1") return { width: 1024, height: 1024 };
  if (aspectRatio === "4:3") return { width: 1152, height: 896 };
  if (aspectRatio === "3:4") return { width: 896, height: 1152 };
  return { width: 768, height: 1344 };
}

/** Wan 2.2 TI2V 5B is trained at 1280×704; Wan22ImageToVideoLatent steps by 32. */
export function comfyVideoSize(aspectRatio = "9:16"): { width: number; height: number } {
  if (aspectRatio === "16:9") return { width: 1280, height: 704 };
  if (aspectRatio === "1:1") return { width: 960, height: 960 };
  if (aspectRatio === "4:3") return { width: 1088, height: 832 };
  if (aspectRatio === "3:4") return { width: 832, height: 1088 };
  return { width: 704, height: 1280 };
}

/** Wan latents are 4n+1 frames long (121 = 5 s at 24 fps). */
export function wanFrameCount(durationSec: number, fps = 24): number {
  const n = Math.round((Math.max(0, durationSec) * fps) / 4);
  return Math.max(5, n * 4 + 1);
}
