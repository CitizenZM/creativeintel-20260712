/**
 * Edit engine v2 — turns finished clips into a paced, beat-cut, sound-designed
 * ad on the server:
 *
 *   1. plan      edit-plan.ts: shots on a 120 BPM grid, transitions, text cards
 *   2. shots     each shot rendered frame-exact (reframe / punch-in; stills move)
 *   3. concat    hard cuts exactly on beat frames
 *   4. final     one encode: beat accents (light + scale pop on every beat),
 *                flash / whip / zoom envelopes on the boundaries, hook headline,
 *                claim chips, offer card, CTA button and word-by-word captions;
 *                voiceover + synthesised music (ducked under the voice) + SFX,
 *                normalised to −14 LUFS / −1.5 dBTP
 *   5. QC        measured on the file (qc.ts), plus a 720p preview and a contact sheet
 *
 * Every step is deterministic given the clips, so a re-assembly is identical.
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { pMap } from "@/lib/parallel";
import { FPS } from "./beat-grid";
import { planEdit, type EditPlan, type PlanInputSegment, type Shot } from "./edit-plan";
import { synthesizeMusic, toWav } from "./music-synth";
import { measureMaster, scoreQc, type QcReport } from "./qc";
import { renderSfxBed } from "./sfx";
import { claimChipPng, ctaButtonPng, hookHeadlinePng, kineticCaptionPng, offerCardPng } from "./text-layers";
import { kineticGroups, timedWords, toSrt, subtitleCues, type TimedWord } from "../voiceover";
import { speakVoiceover, type AssembleFrame, type Segment } from "../glm-assemble";

const run = promisify(execFile);

type Canvas = { w: number; h: number };

export interface EditV2Result {
  masterFile: string;
  previewFile: string;
  contactSheetFile: string;
  voiceoverFile: string | null;
  srt: string | null;
  qc: QcReport;
  plan: EditPlan;
}

const f3 = (n: number) => n.toFixed(3);

/** Per-shot video filter: reframe a clip, or fit a still and give it a camera move. */
export function shotFilter(shot: Shot, canvas: Canvas): string {
  const { w, h } = canvas;
  const dur = Math.max(0.1, shot.frames / FPS);
  if (shot.kind === "clip") {
    const z = shot.zoom;
    return [
      `[0:v]scale=${Math.round((w * z) / 2) * 2}:${Math.round((h * z) / 2) * 2}:force_original_aspect_ratio=increase`,
      `crop=${w}:${h}:(iw-${w})/2:(ih-${h})*${shot.anchorY}`,
      `fps=${FPS},tpad=stop_mode=clone:stop_duration=5,setsar=1,format=yuv420p[v]`,
    ].join(",");
  }
  // Stills: fit inside the canvas over a blurred fill, then move.
  const z0 = shot.zoom;
  const zoomExpr =
    shot.motion === "pull"
      ? `${z0 + 0.09}-0.09*min(t/${f3(dur)},1)`
      : shot.motion === "drift"
        ? `${z0 + 0.05}`
        : `${z0}+0.09*min(t/${f3(dur)},1)`;
  const xExpr = shot.motion === "drift" ? `(iw-${w})/2+(iw-${w})/2*0.8*(t/${f3(dur)}-0.5)` : `(iw-${w})/2`;
  return [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:2[bgb]`,
    `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs]`,
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,fps=${FPS},setsar=1[fit]`,
    `[fit]scale=w='2*trunc(${w}*(${zoomExpr})/2)':h='2*trunc(${h}*(${zoomExpr})/2)':eval=frame,crop=${w}:${h}:x='${xExpr}':y='(ih-${h})*${shot.anchorY}',format=yuv420p[v]`,
  ].join(";");
}

/**
 * Beat accents and boundary transitions as light / blur / scale envelopes over
 * the already-cut picture (a transition never swaps content — the cut does).
 */
export function fxFilter(plan: EditPlan, canvas: Canvas): string {
  const { w, h } = canvas;
  const P = f3(plan.grid.period);
  const punches = plan.boundaries.filter((b) => b.transition === "zoom").map((b) => `0.06*gte(t,${f3(b.atSec)})*exp(-(t-${f3(b.atSec)})*12)`);
  const scaleExpr = [`0.022*exp(-mod(t,${P})*18)`, ...punches].join("+");
  const parts = [
    `eq=brightness='0.045*exp(-mod(t,${P})*22)':eval=frame`,
    `scale=w='2*trunc(${w}*(1+${scaleExpr})/2)':h='2*trunc(${h}*(1+${scaleExpr})/2)':eval=frame`,
    `crop=${w}:${h}`,
  ];
  const fr = 1 / FPS;
  for (const b of plan.boundaries) {
    if (b.transition === "flash") parts.push(`eq=brightness=0.5:enable='between(t,${f3(b.atSec - fr)},${f3(b.atSec + fr)})'`);
    if (b.transition === "whip") parts.push(`avgblur=sizeX=48:sizeY=1:enable='between(t,${f3(b.atSec - 3 * fr)},${f3(b.atSec + fr)})'`);
  }
  parts.push("setsar=1");
  return parts.join(",");
}

interface Overlay {
  file: string;
  startSec: number;
  endSec: number;
  /** Vertical centre as a share of the frame height. */
  y: number;
}

/** Caption windows: each word state is shown until the next word starts (short gaps are held). */
export function captionWindows(groups: TimedWord[][], totalSec: number): { group: number; word: number; startSec: number; endSec: number }[] {
  const out: { group: number; word: number; startSec: number; endSec: number }[] = [];
  groups.forEach((g, gi) => {
    const nextStart = groups[gi + 1]?.[0]?.startSec ?? Infinity;
    const groupEnd = g[g.length - 1].endSec;
    const hold = nextStart - groupEnd < 0.6 ? nextStart : groupEnd + 0.15;
    g.forEach((wd, wi) => {
      const end = wi + 1 < g.length ? g[wi + 1].startSec : hold;
      const s = Math.max(0, wd.startSec);
      const e = Math.min(totalSec, end);
      if (e - s > 0.02) out.push({ group: gi, word: wi, startSec: s, endSec: e });
    });
  });
  return out;
}

export async function renderEditV2(input: {
  dir: string;
  runId: string;
  aspectRatio: string;
  canvas: Canvas;
  frames: AssembleFrame[];
  segments: Segment[];
  /** Local files already downloaded for each segment URL. */
  sources: Map<string, string>;
  voice?: string;
}): Promise<EditV2Result> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available on this server");
  const ff = ffmpegPath;
  const { dir, canvas } = input;
  const bySeg = new Map(input.frames.map((f) => [f.frameNumber, f]));
  const planInput: PlanInputSegment[] = input.segments.map((s) => ({
    kind: s.kind,
    url: s.url,
    from: s.kind === "clip" ? s.from : 0,
    length: s.length,
    frameNumber: s.frameNumber,
    segment: bySeg.get(s.frameNumber)?.segment ?? null,
    text: s.text ?? null,
  }));
  const plan = planEdit(planInput, { voiceovers: new Map(input.frames.map((f) => [f.frameNumber, f.voiceover ?? null])) });
  const total = plan.durationSec;

  // 2. Shots, a few at a time.
  const shotFiles = await pMap(
    plan.shots,
    async (shot) => {
      const out = path.join(dir, `v2shot${String(shot.index).padStart(3, "0")}.mp4`);
      const src = input.sources.get(shot.url);
      if (!src) throw new Error(`Missing source for shot ${shot.index}`);
      const inArgs = shot.kind === "clip" ? ["-ss", f3(shot.srcFrom), "-i", src] : ["-loop", "1", "-t", f3(shot.frames / FPS + 0.5), "-i", src];
      await run(
        ff,
        ["-y", "-v", "error", ...inArgs, "-filter_complex", shotFilter(shot, canvas), "-map", "[v]", "-frames:v", String(shot.frames), "-an", "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", out],
        { timeout: 90_000 }
      );
      return out;
    },
    { concurrency: 3 }
  );

  // 3. Frame-exact concat — every cut on its beat frame.
  const list = path.join(dir, "v2list.txt");
  await writeFile(list, shotFiles.map((p) => `file '${p}'`).join("\n"));
  const body = path.join(dir, "v2body.mp4");
  await run(ff, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", body], { timeout: 90_000 });

  // 4a. Voice, captions, music, SFX.
  const vo = await speakVoiceover({ dir, frames: input.frames, totalSec: total, voice: input.voice }).catch((err) => {
    console.warn(`[edit-v2] voiceover failed for ${input.runId}:`, err instanceof Error ? err.message.slice(0, 200) : err);
    return null;
  });
  const words: TimedWord[] = vo ? vo.words.flatMap((w, i) => timedWords(w, vo.placements[i], vo.lines[i].text)) : [];
  // On the end card the offer and the button carry the message; captions stop there.
  const captionEnd = plan.ctaSec ?? total;
  const groups = kineticGroups(words.filter((w) => w.startSec < captionEnd));
  const windows = captionWindows(groups, captionEnd);
  const overlays: Overlay[] = [];
  for (const [i, win] of windows.entries()) {
    const file = path.join(dir, `v2cap${String(i).padStart(3, "0")}.png`);
    await writeFile(file, await kineticCaptionPng(groups[win.group].map((x) => x.text), win.word, canvas));
    overlays.push({ file, startSec: win.startSec, endSec: win.endSec, y: 0.7 });
  }
  for (const [i, card] of plan.cards.entries()) {
    const file = path.join(dir, `v2card${i}.png`);
    const png = card.role === "hook" ? await hookHeadlinePng(card.text, canvas) : card.role === "offer" ? await offerCardPng(card.text, canvas) : await claimChipPng(card.text, canvas);
    await writeFile(file, png);
    overlays.push({ file, startSec: card.startSec, endSec: card.endSec, y: card.role === "claim" ? 0.3 : 0.22 });
  }
  if (plan.ctaButton) {
    const file = path.join(dir, "v2cta.png");
    await writeFile(file, await ctaButtonPng(plan.ctaButton.text, canvas));
    overlays.push({ file, startSec: plan.ctaButton.startSec, endSec: total, y: 0.74 });
  }

  const music = synthesizeMusic({ durationSec: total, bpm: plan.grid.bpm, dropSec: plan.dropSec, breakdownSec: plan.breakdownSec, ctaSec: plan.ctaSec, energy: 0.8, seed: input.runId.length });
  const musicFile = path.join(dir, "v2music.wav");
  await writeFile(musicFile, toWav(music.left, music.right));
  const sfx = renderSfxBed(plan.sfx, total);
  const sfxFile = path.join(dir, "v2sfx.wav");
  await writeFile(sfxFile, toWav(sfx.left, sfx.right));

  // 4b. The final encode.
  const inputs = ["-i", body, ...(vo ? ["-i", vo.voiceoverFile] : []), "-i", musicFile, "-i", sfxFile, ...overlays.flatMap((o) => ["-i", o.file])];
  const voIdx = vo ? 1 : -1;
  const musicIdx = vo ? 2 : 1;
  const sfxIdx = musicIdx + 1;
  const firstOverlay = sfxIdx + 1;
  const video = [`[0:v]${fxFilter(plan, canvas)}[fx]`];
  overlays.forEach((o, i) => {
    const from = i === 0 ? "[fx]" : `[o${i - 1}]`;
    video.push(`${from}[${firstOverlay + i}:v]overlay=x=(W-w)/2:y=H*${o.y}-h/2:enable='between(t,${f3(o.startSec)},${f3(o.endSec)})'[o${i}]`);
  });
  const lastV = overlays.length ? `[o${overlays.length - 1}]` : "[fx]";
  video.push(`${lastV}format=yuv420p[v]`);
  const audio = vo
    ? [
        `[${voIdx}:a]aresample=44100,asplit=2[vo][vosc]`,
        `[${musicIdx}:a]volume=0.32[mus]`,
        `[mus][vosc]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[duck]`,
        `[duck][vo][${sfxIdx}:a]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=7,alimiter=limit=0.79:attack=2:release=40:level=disabled,atrim=0:${f3(total)}[a]`,
      ]
    : [`[${musicIdx}:a]volume=0.6[mus]`, `[mus][${sfxIdx}:a]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=7,alimiter=limit=0.79:attack=2:release=40:level=disabled,atrim=0:${f3(total)}[a]`];
  const master = path.join(dir, "v2master.mp4");
  await run(
    ff,
    ["-y", "-v", "error", ...inputs, "-filter_complex", [...video, ...audio].join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-t", f3(total), "-movflags", "+faststart", master],
    { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }
  );

  // 5. QC, preview, contact sheet.
  const measured = await measureMaster(master, dir);
  const spokenBeforeCta = words.filter((w) => w.startSec < captionEnd);
  const wordSpan = spokenBeforeCta.length ? spokenBeforeCta.reduce((n, w) => n + Math.max(0, Math.min(total, w.endSec) - w.startSec), 0) : 0;
  const covered = spokenBeforeCta.length
    ? spokenBeforeCta.reduce((n, w) => {
        const inWin = windows.some((x) => x.startSec <= w.startSec + 0.05 && x.endSec >= Math.min(total, w.endSec) - 0.05);
        return n + (inWin ? Math.max(0, Math.min(total, w.endSec) - w.startSec) : 0);
      }, 0)
    : 0;
  const qc = scoreQc({
    durationSec: total,
    ...measured,
    beats: plan.grid.beats,
    plannedCuts: plan.boundaries.map((b) => b.atSec),
    hookHeadline: plan.cards.some((c) => c.role === "hook" && c.startSec < 2),
    captionCoverage: spokenBeforeCta.length ? covered / Math.max(0.01, wordSpan) : null,
    ctaSec: plan.ctaSec,
  });

  const previewFile = path.join(dir, "v2preview.mp4");
  await run(ff, ["-y", "-v", "error", "-i", master, "-vf", "scale=-2:1280", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", previewFile], { timeout: 90_000 });
  const contactSheetFile = path.join(dir, "v2sheet.jpg");
  await run(ff, ["-y", "-v", "error", "-i", master, "-vf", `fps=6/${f3(total)},scale=270:-2,tile=6x1`, "-frames:v", "1", "-q:v", "4", contactSheetFile], { timeout: 60_000 });

  const srt = vo
    ? toSrt(vo.words.flatMap((w, i) => subtitleCues(w, vo.placements[i], 32, vo.lines[i].text)).map((c) => ({ ...c, endSec: Math.min(c.endSec, total) })).filter((c) => c.endSec - c.startSec > 0.2))
    : null;
  return { masterFile: master, previewFile, contactSheetFile, voiceoverFile: vo?.voiceoverFile ?? null, srt, qc, plan };
}
