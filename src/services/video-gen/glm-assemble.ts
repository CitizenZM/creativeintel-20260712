/**
 * Server-side assembly for GLM runs: cut each storyboard frame's window out of
 * the clip that covers it (the same coversFrames / frameOffsetsSec contract the
 * LibTV worker's assemble.py uses), hold CTA frames on their still, and concat
 * everything into one master MP4 with ffmpeg.
 *
 * Each frame's storyboard text overlay is burned in as a headline at the top
 * (Anton, OFL). The storyboard voiceover is spoken with free Edge TTS, mixed in,
 * and subtitled at the bottom from the same word timings (Montserrat, OFL);
 * the voiceover MP3 and an SRT ship alongside the master. Fonts are bundled in
 * assets/fonts, drawn by sharp and overlaid by ffmpeg. No beat grid or music.
 */
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type { LibtvJob } from "@/generated/prisma/client";
import { uploadBuffer } from "@/services/storage";
import { DEFAULT_VOICE, placeLines, planVoiceover, subtitleCues, synthesize, toSrt, type SubtitleCue } from "./voiceover";

const run = promisify(execFile);
const FPS = 30;

export interface AssembleFrame {
  frameNumber: number;
  startSec: number;
  endSec: number;
  /** The storyboard's on-screen text for this frame, burned in as a caption. */
  text?: string | null;
  /** The storyboard's voiceover line for this frame (repeated across its beat). */
  voiceover?: string | null;
}

export const CAPTION_FONT = path.join(process.cwd(), "assets/fonts/Anton-Regular.ttf");
export const SUBTITLE_FONT = path.join(process.cwd(), "assets/fonts/Montserrat-Bold.ttf");

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

/** Pango markup needs &, < and > escaped. */
function pangoEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The caption as a transparent PNG: white Anton lines, centred, on a
 * translucent black box. Rendered with sharp (pango) rather than ffmpeg's
 * drawtext — the Linux ffmpeg-static build on Vercel has no drawtext filter.
 */
/**
 * Serverless Linux has no fonts and no fontconfig config, so pango can't find
 * even the bundled font. Point fontconfig at assets/fonts before sharp loads.
 */
async function ensureFontconfig(fontFile: string): Promise<void> {
  if (process.env.FONTCONFIG_FILE) return;
  const conf = path.join(tmpdir(), "creativeintel-fonts.conf");
  await mkdir(path.join(tmpdir(), "fontconfig-cache"), { recursive: true }).catch(() => {});
  await writeFile(
    conf,
    `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig><dir>${path.dirname(fontFile)}</dir><cachedir>${path.join(tmpdir(), "fontconfig-cache")}</cachedir></fontconfig>\n`
  );
  process.env.FONTCONFIG_FILE = conf;
}

async function textPng(
  lines: string[],
  canvas: { w: number; h: number },
  style: { family: string; fontFile: string; size: number; boxAlpha: number; widthPct: number }
): Promise<Buffer> {
  await ensureFontconfig(style.fontFile);
  const sharp = (await import("sharp")).default;
  const pad = Math.round(style.size * 0.35);
  const text = await sharp({
    text: {
      text: `<span foreground="white">${pangoEscape(lines.join("\n"))}</span>`,
      font: `${style.family} ${style.size}`,
      fontfile: style.fontFile,
      width: Math.round(canvas.w * style.widthPct),
      align: "centre",
      rgba: true,
      dpi: 72,
      spacing: Math.round(style.size * 0.2),
    },
  })
    .png()
    .toBuffer();
  const { width = 1, height = 1 } = await sharp(text).metadata();
  return sharp({
    create: { width: width + pad * 2, height: height + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: style.boxAlpha } },
  })
    .composite([{ input: text, top: pad, left: pad }])
    .png()
    .toBuffer();
}

/** The headline caption: white Anton lines on a translucent box. */
export function captionPng(lines: string[], canvas: { w: number; h: number }, fontFile = CAPTION_FONT): Promise<Buffer> {
  return textPng(lines, canvas, { family: "Anton", fontFile, size: Math.round(canvas.w * 0.068), boxAlpha: 0.55, widthPct: 0.86 });
}

/** A subtitle cue: smaller Montserrat Bold on a darker box, for the bottom of the frame. */
export function subtitlePng(text: string, canvas: { w: number; h: number }, fontFile = SUBTITLE_FONT): Promise<Buffer> {
  return textPng(wrapCaption(text, 30).slice(0, 2), canvas, {
    family: "Montserrat Bold",
    fontFile,
    size: Math.round(canvas.w * 0.045),
    boxAlpha: 0.7,
    widthPct: 0.9,
  });
}

/**
 * Stills (packshots, CTA cards) are often a different shape from the master —
 * a 16:9 "Apply now" card cover-cropped into 9:16 loses its words. Fit the
 * whole image and fill the rest with a blurred copy of it.
 */
export function fitStillFilter(canvas: { w: number; h: number }, fps = FPS): string {
  const { w, h } = canvas;
  return [
    "split=2[bg][fg]",
    `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:2[bgb]`,
    `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs]`,
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,fps=${fps},format=yuv420p`,
  ].join(";");
}

/**
 * Filter graph: fit the source to the canvas, then lay the headline in the top
 * third — the bottom belongs to the subtitles.
 */
export function overlayGraph(baseVf: string): string {
  return `[0:v]${baseVf}[base];[base][1:v]overlay=x=(W-w)/2:y=H*0.17-h/2:format=auto,format=yuv420p[out]`;
}

/** Subtitle overlays: input i+first is shown between its cue's start and end, above the safe bottom edge. */
export function subtitleGraph(cues: Pick<SubtitleCue, "startSec" | "endSec">[], firstInput: number): string {
  if (!cues.length) return "[0:v]null[v]";
  return cues
    .map((c, i) => {
      const from = i === 0 ? "[0:v]" : `[s${i - 1}]`;
      const to = i === cues.length - 1 ? "[v]" : `[s${i}]`;
      return `${from}[${firstInput + i}:v]overlay=x=(W-w)/2:y=H*0.84-h/2:enable='between(t,${c.startSec.toFixed(3)},${c.endSec.toFixed(3)})'${to}`;
    })
    .join(";");
}

async function durationOf(file: string): Promise<number> {
  const { stderr } = await run(ffmpegPath!, ["-i", file]).catch((e) => e as { stderr: string });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(stderr));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

export interface AssembledMaster {
  masterUrl: string;
  voiceoverUrl: string | null;
  subtitlesUrl: string | null;
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
  /** Edge TTS voice; defaults to TTS_VOICE or a US English neural voice. */
  voice?: string;
}): Promise<AssembledMaster> {
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
      const args =
        seg.kind === "clip"
          ? ["-y", "-v", "error", "-ss", String(seg.from), "-t", String(seg.length), "-i", src]
          : ["-y", "-v", "error", "-loop", "1", "-t", String(seg.length), "-i", src];
      const encode = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out];
      const segVf = seg.kind === "still" ? fitStillFilter({ w, h }) : vf;
      let captioned = false;
      if (seg.text && hasCaptionFont) {
        try {
          const cap = path.join(dir, `cap${String(i).padStart(3, "0")}.png`);
          await writeFile(cap, await captionPng(wrapCaption(seg.text), { w, h }));
          await run(ffmpegPath, [...args, "-i", cap, "-filter_complex", overlayGraph(segVf), "-map", "[out]", "-t", String(seg.length), ...encode], {
            timeout: 90_000,
          });
          captioned = true;
        } catch (err) {
          // A caption must never cost the whole master: fall back to the bare segment.
          console.warn(`[assemble] caption for frame ${seg.frameNumber} failed, rendering without it:`, err instanceof Error ? err.message.slice(0, 300) : err);
        }
      }
      if (!captioned) await run(ffmpegPath, [...args, "-vf", segVf, ...encode], { timeout: 90_000 });
      parts.push(out);
    }

    const list = path.join(dir, "list.txt");
    await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
    const master = path.join(dir, "master.mp4");
    await run(ffmpegPath, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", master], {
      timeout: 90_000,
    });

    const totalSec = segments.reduce((sum, seg) => sum + seg.length, 0);
    let finalFile = master;
    let voiceoverUrl: string | null = null;
    let subtitlesUrl: string | null = null;
    try {
      const voiced = await addVoiceoverAndSubtitles({ dir, master, frames: input.frames, totalSec, canvas: { w, h }, voice: input.voice });
      if (voiced) {
        finalFile = voiced.file;
        const [vo, srt] = await Promise.all([
          uploadBuffer({ buffer: await readFile(voiced.voiceoverFile), filename: `voiceover-${input.runId}.mp3`, contentType: "audio/mpeg", folder: "glm-masters" }),
          uploadBuffer({ buffer: Buffer.from(voiced.srt, "utf8"), filename: `subtitles-${input.runId}.srt`, contentType: "application/x-subrip", folder: "glm-masters" }),
        ]);
        voiceoverUrl = vo.provider === "inline" ? null : vo.url;
        subtitlesUrl = srt.provider === "inline" ? null : srt.url;
      }
    } catch (err) {
      // Voice and subtitles must never cost the master: ship it silent instead.
      console.warn(`[assemble] voiceover/subtitles failed for run ${input.runId}, shipping the silent master:`, err instanceof Error ? err.message.slice(0, 300) : err);
    }

    const uploaded = await uploadBuffer({
      buffer: await readFile(finalFile),
      filename: `master-${input.runId}.mp4`,
      contentType: "video/mp4",
      folder: "glm-masters",
    });
    if (uploaded.provider === "inline") throw new Error("No asset storage configured for the master video");
    return { masterUrl: uploaded.url, voiceoverUrl, subtitlesUrl };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Speak the storyboard's voiceover, mix it under the silent master and burn in
 * subtitles timed to the spoken words. Returns null when there is nothing to say.
 */
export async function addVoiceoverAndSubtitles(input: {
  dir: string;
  master: string;
  frames: AssembleFrame[];
  totalSec: number;
  canvas: { w: number; h: number };
  voice?: string;
}): Promise<{ file: string; voiceoverFile: string; srt: string } | null> {
  const lines = planVoiceover(input.frames);
  if (!lines.length) return null;
  const voice = input.voice || process.env.TTS_VOICE || DEFAULT_VOICE;

  const spoken: { file: string; words: Awaited<ReturnType<typeof synthesize>>["words"]; duration: number }[] = [];
  for (const [i, line] of lines.entries()) {
    const { audio, words } = await synthesize(line.text, voice);
    const file = path.join(input.dir, `vo${i}.mp3`);
    await writeFile(file, audio);
    spoken.push({ file, words, duration: (await durationOf(file)) || line.endSec - line.startSec });
  }
  const placements = placeLines(lines, spoken.map((s) => s.duration), input.totalSec);

  // One voiceover track the length of the master.
  const voiceoverFile = path.join(input.dir, "voiceover.mp3");
  const mixInputs = spoken.flatMap((s) => ["-i", s.file]);
  const chains = placements.map((p, i) => {
    const delay = Math.round(p.startSec * 1000);
    return `[${i}:a]atempo=${p.tempo.toFixed(3)},adelay=${delay}|${delay}[a${i}]`;
  });
  const mix = `${chains.join(";")};${placements.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placements.length}:normalize=0,apad,atrim=0:${input.totalSec.toFixed(3)}[vo]`;
  await run(ffmpegPath!, ["-y", "-v", "error", ...mixInputs, "-filter_complex", mix, "-map", "[vo]", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", voiceoverFile], {
    timeout: 90_000,
  });

  // Subtitles from the TTS word timings, kept inside the video.
  const cues = spoken
    .flatMap((s, i) => subtitleCues(s.words, placements[i], 32, lines[i].text))
    .map((c) => ({ ...c, endSec: Math.min(c.endSec, input.totalSec) }))
    .filter((c) => c.endSec - c.startSec > 0.2);
  const cueFiles: string[] = [];
  for (const [i, cue] of cues.entries()) {
    const file = path.join(input.dir, `sub${String(i).padStart(3, "0")}.png`);
    await writeFile(file, await subtitlePng(cue.text, input.canvas));
    cueFiles.push(file);
  }

  const out = path.join(input.dir, "master-voiced.mp4");
  await run(
    ffmpegPath!,
    [
      "-y", "-v", "error",
      "-i", input.master,
      "-i", voiceoverFile,
      ...cueFiles.flatMap((f) => ["-i", f]),
      "-filter_complex", subtitleGraph(cues, 2),
      "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k",
      "-t", input.totalSec.toFixed(3),
      "-movflags", "+faststart",
      out,
    ],
    { timeout: 120_000 }
  );
  return { file: out, voiceoverFile, srt: toSrt(cues) };
}
