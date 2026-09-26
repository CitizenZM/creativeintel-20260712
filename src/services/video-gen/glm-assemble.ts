/**
 * Server-side assembly for GLM runs: cut each storyboard frame's window out of
 * the clip that covers it (the same coversFrames / frameOffsetsSec contract the
 * LibTV worker's assemble.py uses), hold CTA frames on their still, and concat
 * everything into one master MP4 with ffmpeg.
 *
 * Each frame's storyboard text overlay is burned in as a caption (Anton, OFL,
 * bundled in assets/fonts). Simpler than assemble.py — no beat grid or music.
 */
import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type { LibtvJob } from "@/generated/prisma/client";
import { uploadBuffer } from "@/services/storage";

const run = promisify(execFile);
const FPS = 30;

export interface AssembleFrame {
  frameNumber: number;
  startSec: number;
  endSec: number;
  /** The storyboard's on-screen text for this frame, burned in as a caption. */
  text?: string | null;
}

export const CAPTION_FONT = path.join(process.cwd(), "assets/fonts/Anton-Regular.ttf");

/** Break caption text into at most three lines of about `width` characters. */
export function wrapCaption(text: string, width = 22): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + w).length <= width) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  if (lines.length > 3) return [...lines.slice(0, 2), lines.slice(2).join(" ")];
  return lines;
}

/**
 * drawtext filters for a caption, one per line (this ffmpeg build has no
 * text_align, so each line is centred on its own). Each line is read from a
 * file so user text never needs filter escaping. Lines stack around 72% height.
 */
export function captionFilter(lineFiles: string[], canvas: { w: number; h: number }, fontFile = CAPTION_FONT): string {
  const size = Math.round(canvas.w * 0.068);
  const lineH = Math.round(size * 1.45);
  const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const top = Math.round(canvas.h * 0.72 - (lineFiles.length * lineH) / 2);
  return lineFiles
    .map((file, i) =>
      [
        `drawtext=fontfile='${esc(fontFile)}'`,
        `textfile='${esc(file)}'`,
        `fontsize=${size}`,
        "fontcolor=white",
        "box=1",
        "boxcolor=black@0.55",
        `boxborderw=${Math.round(size * 0.22)}`,
        "x=(w-text_w)/2",
        `y=${top + i * lineH}`,
      ].join(":")
    )
    .join(",");
}

type Settings = {
  coversFrames?: number[];
  frameOffsetsSec?: { frameNumber: number; clipStartSec: number; clipEndSec: number }[];
  compositeLocally?: boolean;
  frameNumber?: number;
};

export function canvasFor(aspectRatio: string): { w: number; h: number } {
  if (aspectRatio === "16:9") return { w: 1920, h: 1080 };
  if (aspectRatio === "1:1") return { w: 1080, h: 1080 };
  return { w: 1080, h: 1920 };
}

export type Segment =
  | { kind: "clip"; url: string; from: number; length: number; frameNumber: number; text?: string }
  | { kind: "still"; url: string; length: number; frameNumber: number; text?: string };

/** Timeline: one segment per storyboard frame, in order. Pure — unit-tested. */
export function planSegments(frames: AssembleFrame[], jobs: Pick<LibtvJob, "kind" | "status" | "resultUrl" | "settings">[]): Segment[] {
  const segments: Segment[] = [];
  for (const f of frames) {
    const length = Math.max(0.5, (f.endSec ?? 0) - (f.startSec ?? 0) || 2);
    const clip = jobs.find((j) => {
      const s = (j.settings ?? {}) as Settings;
      return j.kind === "video" && j.resultUrl && s.coversFrames?.includes(f.frameNumber);
    });
    if (clip) {
      const s = (clip.settings ?? {}) as Settings;
      const off = s.frameOffsetsSec?.find((o) => o.frameNumber === f.frameNumber);
      const from = off?.clipStartSec ?? 0;
      const len = off ? Math.max(0.5, off.clipEndSec - off.clipStartSec) : length;
      segments.push({ kind: "clip", url: clip.resultUrl!, from, length: len, frameNumber: f.frameNumber, text: f.text?.trim() || undefined });
      continue;
    }
    const still = jobs.find((j) => {
      const s = (j.settings ?? {}) as Settings;
      return j.kind === "image" && j.resultUrl && (s.frameNumber === f.frameNumber || s.coversFrames?.includes(f.frameNumber));
    });
    if (still) segments.push({ kind: "still", url: still.resultUrl!, length, frameNumber: f.frameNumber, text: f.text?.trim() || undefined });
  }
  return segments;
}

async function download(url: string, file: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download ${res.status} for ${url.slice(0, 80)}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

export async function assembleGlmMaster(input: {
  runId: string;
  aspectRatio: string;
  frames: AssembleFrame[];
  jobs: LibtvJob[];
}): Promise<string> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available on this server");
  const segments = planSegments(input.frames, input.jobs);
  if (!segments.length) throw new Error("Nothing to assemble — no finished clips");

  const { w, h } = canvasFor(input.aspectRatio);
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${FPS},format=yuv420p`;
  const dir = await mkdtemp(path.join(tmpdir(), `glm-${input.runId}-`));
  const hasCaptionFont = await access(CAPTION_FONT).then(() => true, () => false);
  if (!hasCaptionFont) console.warn(`[assemble] caption font missing at ${CAPTION_FONT} — rendering without captions`);
  try {
    const sources = new Map<string, string>();
    let n = 0;
    for (const seg of segments) {
      if (sources.has(seg.url)) continue;
      const file = path.join(dir, `src${n++}${seg.kind === "clip" ? ".mp4" : ".img"}`);
      await download(seg.url, file);
      sources.set(seg.url, file);
    }

    const parts: string[] = [];
    for (const [i, seg] of segments.entries()) {
      const out = path.join(dir, `seg${String(i).padStart(3, "0")}.mp4`);
      const src = sources.get(seg.url)!;
      let segVf = vf;
      if (seg.text && hasCaptionFont) {
        const lineFiles: string[] = [];
        for (const [n, line] of wrapCaption(seg.text).entries()) {
          const file = path.join(dir, `cap${String(i).padStart(3, "0")}-${n}.txt`);
          await writeFile(file, line);
          lineFiles.push(file);
        }
        segVf = `${vf},${captionFilter(lineFiles, { w, h })}`;
      }
      const args =
        seg.kind === "clip"
          ? ["-y", "-v", "error", "-ss", String(seg.from), "-t", String(seg.length), "-i", src]
          : ["-y", "-v", "error", "-loop", "1", "-t", String(seg.length), "-i", src];
      await run(ffmpegPath, [...args, "-vf", segVf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out], {
        timeout: 90_000,
      });
      parts.push(out);
    }

    const list = path.join(dir, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
    const master = path.join(dir, "master.mp4");
    await run(ffmpegPath, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", master], {
      timeout: 90_000,
    });

    const uploaded = await uploadBuffer({
      buffer: await readFile(master),
      filename: `master-${input.runId}.mp4`,
      contentType: "video/mp4",
      folder: "glm-masters",
    });
    if (uploaded.provider === "inline") throw new Error("No asset storage configured for the master video");
    return uploaded.url;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
