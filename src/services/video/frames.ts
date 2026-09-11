import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { prisma } from "@/lib/db";
import { checkBinaries, runProc } from "./binaries";
import { cloudDownload } from "./cloud-downloader";

export type FrameSource = "ffmpeg" | "youtube_storyboard" | "stored" | "thumbnail" | "none";

export interface KeyframeAsset {
  id?: string;
  url: string;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  frameUrls?: unknown;
  platform?: string | null;
}

export interface KeyframeResult {
  frameUrls: string[];
  source: FrameSource;
  error?: string;
}

const MAX_FRAMES = 6;
const FFMPEG_TOTAL_BUDGET_MS = Number(process.env.FRAME_EXTRACT_BUDGET_MS) || 40_000;

export function youtubeIdFrom(url: string | null | undefined): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?[^#]*\bv=)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /(?:i\.ytimg\.com\/vi\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * Sampling plan: opening frame, 1 s, 3 s, midpoint, 3 s before the end (pre-CTA)
 * and the last frame. Collapses to a shorter unique plan for very short videos.
 */
export function frameTimestamps(durationSec: number): number[] {
  const d = Math.max(1, durationSec);
  const raw = [0, 1, 3, d / 2, d - 3, d - 0.2];
  const clamped = raw.map((t) => Math.min(Math.max(t, 0), Math.max(d - 0.05, 0)));
  const unique: number[] = [];
  for (const t of clamped) {
    const rounded = Math.round(t * 10) / 10;
    if (!unique.some((u) => Math.abs(u - rounded) < 0.35)) unique.push(rounded);
  }
  return unique.slice(0, MAX_FRAMES).sort((a, b) => a - b);
}

function storedFrames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, MAX_FRAMES);
}

function youtubeStoryboard(id: string): string[] {
  return [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/0.jpg`,
    `https://i.ytimg.com/vi/${id}/1.jpg`,
    `https://i.ytimg.com/vi/${id}/2.jpg`,
    `https://i.ytimg.com/vi/${id}/3.jpg`,
  ];
}

async function downloadBuffer(asset: KeyframeAsset): Promise<{ buffer: Buffer; ext: string } | null> {
  const ytId = youtubeIdFrom(asset.videoUrl) || youtubeIdFrom(asset.url);
  if (ytId) {
    const cd = await cloudDownload(`https://www.youtube.com/watch?v=${ytId}`);
    return { buffer: cd.buffer, ext: cd.contentType === "video/webm" ? "webm" : "mp4" };
  }
  if (!asset.videoUrl) return null;
  const res = await fetch(asset.videoUrl);
  if (!res.ok) throw new Error(`video fetch ${res.status}`);
  const arr = Buffer.from(await res.arrayBuffer());
  const ext = asset.videoUrl.toLowerCase().endsWith(".webm") ? "webm" : "mp4";
  return { buffer: arr, ext };
}

async function ffmpegFrames(asset: KeyframeAsset, deadline: number): Promise<string[]> {
  const dl = await downloadBuffer(asset);
  if (!dl) return [];

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "keyframes-"));
  try {
    const videoPath = path.join(tmpDir, `source.${dl.ext}`);
    await fs.writeFile(videoPath, dl.buffer);

    const duration = asset.durationSec && asset.durationSec > 0 ? asset.durationSec : 30;
    const stamps = frameTimestamps(duration);
    const frames: string[] = [];

    for (const [i, t] of stamps.entries()) {
      if (Date.now() > deadline) break;
      const outPath = path.join(tmpDir, `frame-${i}.jpg`);
      await runProc(
        "ffmpeg",
        [
          "-y", "-ss", String(t), "-i", videoPath,
          "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "6",
          outPath,
        ],
        { timeoutMs: 15_000 }
      );
      const buf = await fs.readFile(outPath).catch(() => null);
      if (buf && buf.length > 0) {
        frames.push(`data:image/jpeg;base64,${buf.toString("base64")}`);
      }
    }
    return frames;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Obtains 4–6 keyframes for an ad. Never throws: any failure degrades to the
 * best available still (stored frames → YouTube storyboard → thumbnail → none)
 * and the caller records a lower evidence level.
 */
export async function extractKeyframes(asset: KeyframeAsset): Promise<KeyframeResult> {
  const already = storedFrames(asset.frameUrls);
  if (already.length >= 4) return { frameUrls: already, source: "stored" };

  const deadline = Date.now() + FFMPEG_TOTAL_BUDGET_MS;
  let error: string | undefined;

  try {
    const bins = await checkBinaries();
    if (bins.ffmpeg.available && (asset.videoUrl || youtubeIdFrom(asset.url))) {
      const frames = await ffmpegFrames(asset, deadline);
      if (frames.length >= 2) {
        await persistFrames(asset, frames);
        return { frameUrls: frames, source: "ffmpeg" };
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "ffmpeg keyframe extraction failed";
    console.error(`extractKeyframes: ffmpeg path failed for ${asset.url}:`, err);
  }

  const ytId = youtubeIdFrom(asset.videoUrl) || youtubeIdFrom(asset.url) || youtubeIdFrom(asset.thumbnailUrl);
  if (ytId) {
    const frames = youtubeStoryboard(ytId);
    await persistFrames(asset, frames);
    return { frameUrls: frames, source: "youtube_storyboard", error };
  }

  const fallback = [...already];
  if (asset.thumbnailUrl && !fallback.includes(asset.thumbnailUrl)) fallback.unshift(asset.thumbnailUrl);
  if (fallback.length > 0) {
    await persistFrames(asset, fallback);
    return { frameUrls: fallback.slice(0, MAX_FRAMES), source: "thumbnail", error };
  }

  return { frameUrls: [], source: "none", error };
}

async function persistFrames(asset: KeyframeAsset, frames: string[]): Promise<void> {
  if (!asset.id || frames.length === 0) return;
  await prisma.contentAsset
    .update({ where: { id: asset.id }, data: { frameUrls: frames.slice(0, MAX_FRAMES) } })
    .catch(() => {});
}

/**
 * Local-only companion to extractKeyframes: when ffmpeg is present we already
 * have the media buffer, so timestamped Whisper segments can be produced for
 * the same ad. Returns null on Vercel (no ffmpeg) or on any failure.
 */
export async function extractTranscriptSegments(
  asset: KeyframeAsset
): Promise<{ text: string; segments: { start: number; end: number; text: string }[] } | null> {
  let tmpDir: string | undefined;
  try {
    const bins = await checkBinaries();
    if (!bins.ffmpeg.available) return null;
    const dl = await downloadBuffer(asset);
    if (!dl) return null;

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "keyframe-audio-"));
    const mediaPath = path.join(tmpDir, `source.${dl.ext}`);
    await fs.writeFile(mediaPath, dl.buffer);

    const { transcribeAudio } = await import("./transcribe");
    const result = await transcribeAudio(mediaPath);
    if (!result.text) return null;
    return { text: result.text, segments: result.segments };
  } catch (err) {
    console.error(`extractTranscriptSegments failed for ${asset.url}:`, err);
    return null;
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
