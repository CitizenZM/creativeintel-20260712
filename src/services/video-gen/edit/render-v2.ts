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
import { planEdit, type EditPlan, type HookStyle, type PlanInputSegment, type Shot } from "./edit-plan";
import { synthesizeMusic, toWav } from "./music-synth";
import { bestWindow, motionScores } from "./motion";
import { detectBeats, trackWindowStart } from "./beat-detect";
import { measureCuts, measureMaster, scoreQc, type QcReport } from "./qc";
import { renderSfxBed } from "./sfx";
import { claimChipPng, comparisonLabelPng, ctaButtonPng, domainPng, hookHeadlinePng, kineticCaptionPng, logoPng, offerCardPng } from "./text-layers";
import { DEFAULT_STYLE, type BrandStyle } from "./brand-style";
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
export function shotFilter(shot: Shot, canvas: Canvas, beatSec = 0.5): string {
  const base = shotBaseFilter(shot, canvas);
  if (!shot.contrast) return base;
  // Contrast hook: the picture sits small in a dimmed, blurred frame for the
  // first beat, then fills the screen — the size jump is the claim.
  const pre = base.replace(/\[v\]$/, "[pre]");
  return `${pre};[pre]split=2[c1][c2];[c1]boxblur=30:2,eq=brightness=-0.18[cb];[c2]scale=w='2*trunc(iw*if(lt(t,${f3(beatSec)}),0.56,1)/2)':h='2*trunc(ih*if(lt(t,${f3(beatSec)}),0.56,1)/2)':eval=frame[cf];[cb][cf]overlay=(W-w)/2:(H-h)/2:eval=frame,format=yuv420p[v]`;
}

/**
 * Comparison composite: ours (the shot as rendered) and the other side (input 1,
 * a desaturated still) share the frame — stacked top/bottom on vertical
 * canvases, side by side on landscape — split by a white rule, each labelled
 * (inputs 2 = ours, 3 = other). Ours is always the second half the eye lands on.
 */
export function compareFilter(shotGraph: string, canvas: Canvas): string {
  const { w, h } = canvas;
  const vertical = h >= w;
  const hw = vertical ? w : Math.round(w / 4) * 2;
  const hh = vertical ? Math.round(h / 4) * 2 : h;
  const pre = shotGraph.replace(/\[v\]$/, "[ours0]");
  const stack = vertical ? "vstack" : "hstack";
  return [
    pre,
    `[ours0]scale=${hw}:${hh}:force_original_aspect_ratio=increase,crop=${hw}:${hh},setsar=1[ours]`,
    `[1:v]fps=${FPS},scale=${hw}:${hh}:force_original_aspect_ratio=increase,crop=${hw}:${hh},hue=s=0.35,eq=brightness=-0.06:contrast=0.9,setsar=1[other]`,
    `[other][ours]${stack}=inputs=2,format=yuv420p[st]`,
    vertical
      ? `[st]drawbox=x=0:y=${hh - 3}:w=${w}:h=6:color=white@0.95:t=fill[ruled]`
      : `[st]drawbox=x=${hw - 3}:y=0:w=6:h=${h}:color=white@0.95:t=fill[ruled]`,
    vertical
      ? `[ruled][3:v]overlay=x=(W-w)/2:y=H*0.16-h/2[l1];[l1][2:v]overlay=x=(W-w)/2:y=H*0.56-h/2,format=yuv420p[v]`
      : `[ruled][3:v]overlay=x=W*0.25-w/2:y=H*0.12-h/2[l1];[l1][2:v]overlay=x=W*0.75-w/2:y=H*0.12-h/2,format=yuv420p[v]`,
  ].join(";");
}

function shotBaseFilter(shot: Shot, canvas: Canvas): string {
  const { w, h } = canvas;
  const dur = Math.max(0.1, shot.frames / FPS);
  if (shot.kind === "clip" && w > h) {
    // Vertical footage in a landscape export: fit the height over a blurred fill
    // (cover-cropping 9:16 into 16:9 would leave a face fragment).
    const z = Math.min(shot.zoom, 1.08);
    return [
      `[0:v]fps=${FPS},tpad=stop_mode=clone:stop_duration=5,split=2[bg][fg]`,
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:2,eq=brightness=-0.08[bgb]`,
      `[fg]scale=-2:${Math.round((h * z) / 2) * 2}[fgs]`,
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`,
    ].join(";");
  }
  if (shot.kind === "clip") {
    const z = shot.zoom;
    return [
      `[0:v]scale=${Math.round((w * z) / 2) * 2}:${Math.round((h * z) / 2) * 2}:force_original_aspect_ratio=increase`,
      `crop=${w}:${h}:(iw-${w})/2:(ih-${h})*${shot.anchorY}`,
      // Light grade + fine temporal grain: takes the clean, over-smooth AI sheen off generated footage.
      `eq=contrast=1.04:saturation=0.95,noise=alls=5:allf=t`,
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
  // Flashes decay from the beat frame (largest change exactly on the cut).
  const flashes = plan.boundaries.filter((b) => b.transition === "flash").map((b) => `0.5*gte(t,${f3(b.atSec - 0.004)})*exp(-(t-${f3(b.atSec)})*28)`);
  const parts = [
    `eq=brightness='${[`0.045*exp(-mod(t,${P})*22)`, ...flashes].join("+")}':eval=frame`,
    `scale=w='2*trunc(${w}*(1+${scaleExpr})/2)':h='2*trunc(${h}*(1+${scaleExpr})/2)':eval=frame`,
    `crop=${w}:${h}`,
  ];
  const fr = 1 / FPS;
  for (const b of plan.boundaries) {
    // Whip: motion blur ramps up over the three outgoing frames and is gone on
    // the beat frame, which arrives sharp with the new shot.
    if (b.transition === "whip") {
      [8, 18, 32].forEach((size, k) => {
        const t0 = b.atSec - (3 - k) * fr;
        parts.push(`avgblur=sizeX=${size}:sizeY=1:enable='between(t,${f3(t0 - 0.004)},${f3(t0 + fr - 0.01)})'`);
      });
    }
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
  /** A/B hook variant (only the opening shot and headline change). */
  hookStyle?: HookStyle;
  hookText?: string | null;
  /** Brand Kit packaging (colours, fonts, logo, CTA, domain). */
  brand?: BrandStyle;
}): Promise<EditV2Result> {
  const look = input.brand ?? DEFAULT_STYLE;
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
    compare: s.compare ?? null,
  }));
  // Comparison frames: fetch the other side's image (stacked against ours in the shot).
  for (const s of input.segments) {
    const u = s.compare?.otherUrl;
    if (!u || input.sources.has(u)) continue;
    const file = path.join(dir, `cmp${input.sources.size}.img`);
    const res = await fetch(u, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (res?.ok) {
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      input.sources.set(u, file);
    }
  }
  // A licensed brand track: detect its beats and drop, start it so the drop
  // lands on the hook → body cut, and cut the edit on its real beats.
  let track: { file: string; startSec: number; beats: number[] } | null = null;
  if (look.musicUrl) {
    try {
      const file = path.join(dir, "v2track.audio");
      const res = await fetch(look.musicUrl, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`music download ${res.status}`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      const a = await detectBeats(file);
      const editSec = planInput.reduce((n, s) => n + s.length, 0);
      const hookSec = planInput.filter((s) => (s.segment ?? "").toUpperCase() === "HOOK").reduce((n, s) => n + s.length, 0) || 2;
      const startSec = trackWindowStart(a, hookSec, editSec);
      track = { file, startSec, beats: a.beats.map((b) => Math.round((b - startSec) * 1000) / 1000).filter((b) => b >= 0) };
    } catch (err) {
      console.warn(`[edit-v2] brand music unusable for ${input.runId}, using the generated bed:`, err instanceof Error ? err.message.slice(0, 160) : err);
      track = null;
    }
  }
  const plan = planEdit(planInput, {
    voiceovers: new Map(input.frames.map((f) => [f.frameNumber, f.voiceover ?? null])),
    hookStyle: input.hookStyle,
    hookText: input.hookText,
    beats: track?.beats,
  });
  const total = plan.durationSec;

  // 1b. Smart segments: each hook shot from a clip takes that clip's most dynamic window.
  const motionCache = new Map<string, Awaited<ReturnType<typeof motionScores>>>();
  let prevHook: { url: string; from: number; to: number } | null = null;
  for (const shot of plan.shots) {
    if (shot.segment !== "HOOK" || shot.kind !== "clip") {
      prevHook = null;
      continue;
    }
    const src = input.sources.get(shot.url);
    if (!src) continue;
    if (!motionCache.has(src)) motionCache.set(src, await motionScores(src).catch(() => ({ fps: 15, scores: [] })));
    const m = motionCache.get(src)!;
    const clipSec = m.scores.length / m.fps;
    const len = shot.frames / FPS;
    if (clipSec < len + 0.2) continue;
    if (prevHook && prevHook.url === shot.url) {
      // The punch-in continues the action instead of replaying it.
      shot.srcFrom = prevHook.to + len <= clipSec ? prevHook.to : Math.max(0, prevHook.from - len);
    } else {
      shot.srcFrom = bestWindow(m.scores, m.fps, len, clipSec, shot.srcFrom);
    }
    prevHook = { url: shot.url, from: shot.srcFrom, to: shot.srcFrom + len };
  }

  // 2. Shots, a few at a time.
  const shotFiles = await pMap(
    plan.shots,
    async (shot) => {
      const out = path.join(dir, `v2shot${String(shot.index).padStart(3, "0")}.mp4`);
      const src = input.sources.get(shot.url);
      if (!src) throw new Error(`Missing source for shot ${shot.index}`);
      const inArgs = shot.kind === "clip" ? ["-ss", f3(shot.srcFrom), "-i", src] : ["-loop", "1", "-t", f3(shot.frames / FPS + 0.5), "-i", src];
      let filter = shotFilter(shot, canvas, plan.grid.period);
      const otherFile = shot.compare ? input.sources.get(shot.compare.otherUrl) : undefined;
      if (shot.compare && otherFile) {
        // Stack the other side against ours, with labels (no generated collage).
        const labels = [
          path.join(dir, `cmpl${shot.index}o.png`),
          path.join(dir, `cmpl${shot.index}t.png`),
        ];
        await writeFile(labels[0], await comparisonLabelPng(shot.compare.labelOurs, canvas, look, true));
        await writeFile(labels[1], await comparisonLabelPng(shot.compare.labelOther, canvas, look, false));
        inArgs.push("-loop", "1", "-t", f3(shot.frames / FPS + 0.5), "-i", otherFile, "-i", labels[0], "-i", labels[1]);
        filter = compareFilter(filter, canvas);
      }
      await run(
        ff,
        ["-y", "-v", "error", ...inArgs, "-filter_complex", filter, "-map", "[v]", "-frames:v", String(shot.frames), "-an", "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", out],
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
    await writeFile(file, await kineticCaptionPng(groups[win.group].map((x) => x.text), win.word, canvas, look));
    overlays.push({ file, startSec: win.startSec, endSec: win.endSec, y: 0.7 });
  }
  for (const [i, card] of plan.cards.entries()) {
    const file = path.join(dir, `v2card${i}.png`);
    const png = card.role === "hook" ? await hookHeadlinePng(card.text, canvas, look) : card.role === "offer" ? await offerCardPng(card.text, canvas, look) : await claimChipPng(card.text, canvas, look);
    await writeFile(file, png);
    // A hook over a person sits in the lower half, off the face (AI director finding).
    const hookOverPerson = card.role === "hook" && input.frames.some((f) => (f.segment ?? "").toUpperCase() === "HOOK" && f.hasPerson);
    // During a comparison shot a claim belongs to our half (under its label), not over the other side.
    const overCompare = card.role === "claim" && plan.shots.some((s) => s.compare && s.startSec < card.endSec && s.endSec > card.startSec);
    overlays.push({ file, startSec: card.startSec, endSec: card.endSec, y: card.role === "claim" ? (overCompare ? 0.63 : 0.3) : hookOverPerson ? 0.52 : 0.22 });
  }
  if (plan.ctaButton) {
    const file = path.join(dir, "v2cta.png");
    await writeFile(file, await ctaButtonPng(input.brand ? look.ctaText : plan.ctaButton.text, canvas, look));
    overlays.push({ file, startSec: plan.ctaButton.startSec, endSec: total, y: 0.74 });
  }
  // End card branding: the logo lands with the CTA, the domain under the button.
  if (plan.ctaSec !== null) {
    const logo = look.logoUrl ? await logoPng(look.logoUrl, canvas) : null;
    if (logo) {
      const file = path.join(dir, "v2logo.png");
      await writeFile(file, logo);
      overlays.push({ file, startSec: plan.ctaSec, endSec: total, y: 0.1 });
    }
    if (look.domain) {
      const file = path.join(dir, "v2domain.png");
      await writeFile(file, await domainPng(look.domain, canvas, look));
      overlays.push({ file, startSec: plan.ctaButton?.startSec ?? plan.ctaSec, endSec: total, y: 0.8 });
    }
  }

  const musicFile = path.join(dir, "v2music.wav");
  if (track) {
    await run(ff, ["-y", "-v", "error", "-ss", f3(track.startSec), "-t", f3(total), "-i", track.file, "-af", `afade=t=out:st=${f3(Math.max(0, total - 0.4))}:d=0.4,aresample=44100`, "-ac", "2", musicFile], { timeout: 60_000 });
  } else {
    const music = synthesizeMusic({ durationSec: total, bpm: plan.grid.bpm, dropSec: plan.dropSec, breakdownSec: plan.breakdownSec, ctaSec: plan.ctaSec, energy: 0.8, seed: input.runId.length });
    await writeFile(musicFile, toWav(music.left, music.right));
  }
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
  // Cut timing is measured on the hard-cut layer (before light/blur envelopes),
  // where the content actually changes.
  measured.cutsSec = await measureCuts(body, dir).catch(() => measured.cutsSec);
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
