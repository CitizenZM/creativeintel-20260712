/**
 * Clip drift check: sample a generated clip at five points (ffmpeg,
 * locally, from the clip the engine already downloaded), score the ends and
 * the most suspicious interior sample
 * against the cast and product references, and check the clip's ends against
 * its start / end keyframes. A mid-clip sample that falls below the shot's
 * threshold — or well below the ends — flags the clip (`driftFlag`).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { frameSimilarity, type ImageSource } from "./pixel-metrics";
import { SHOT_THRESHOLDS, scoreFrame, type ConsistencyRefs, type ConsistencyScore, type ScoreOptions, type ShotType } from "./score";

const run = promisify(execFile);

async function ffmpegBin(): Promise<string> {
  const p = (await import("ffmpeg-static")).default as unknown as string | null;
  if (!p) throw new Error("ffmpeg is not available on this server");
  return p;
}

export async function clipDuration(file: string): Promise<number> {
  const { stderr } = await run(await ffmpegBin(), ["-hide_banner", "-i", file]).catch((e) => e as { stderr: string });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(stderr ?? ""));
  if (!m) throw new Error("could not read the clip duration");
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export interface ClipSample {
  /** Fraction of the clip, 0–1. */
  at: number;
  /** Seconds. */
  t: number;
  image: Buffer;
}

/** Extract frames at the given fractions (1 = the true last frame). */
export async function sampleClipFrames(clip: Buffer | string, fractions: number[] = [0, 0.5, 1]): Promise<ClipSample[]> {
  const ff = await ffmpegBin();
  const dir = await mkdtemp(path.join(tmpdir(), "ci-drift-"));
  try {
    let file = typeof clip === "string" ? clip : path.join(dir, "clip.mp4");
    if (typeof clip !== "string") await writeFile(file, clip);
    const dur = await clipDuration(file);
    const out: ClipSample[] = [];
    for (const [i, at] of fractions.entries()) {
      const jpg = path.join(dir, `s${i}.jpg`);
      if (at >= 1) {
        // The last decoded frame: overwrite one file with every frame of the final half second.
        await run(ff, ["-y", "-v", "error", "-sseof", "-0.5", "-i", file, "-update", "1", "-q:v", "3", jpg], { timeout: 60_000 });
      } else {
        await run(ff, ["-y", "-v", "error", "-ss", (dur * at).toFixed(3), "-i", file, "-frames:v", "1", "-q:v", "3", jpg], { timeout: 60_000 });
      }
      // A seek past the last decodable frame (short clips, late fractions) writes nothing: take the last frame.
      const image = await readFile(jpg).catch(async () => {
        await run(ff, ["-y", "-v", "error", "-sseof", "-0.5", "-i", file, "-update", "1", "-q:v", "3", jpg], { timeout: 60_000 });
        return readFile(jpg);
      });
      out.push({ at, t: Math.round(dur * Math.min(1, at) * 1000) / 1000, image });
    }
    file = "";
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface DriftRefs extends ConsistencyRefs {
  /** The segment's end keyframe (K<n>E), when anchored. */
  end?: ImageSource;
}

export interface DriftOptions {
  shot: string;
  shotType?: ShotType;
  productSpec?: string;
  /** Mid-clip score below this flags drift (default: the shot type's pass − 0.08). */
  threshold?: number;
  /** Mid-clip score this far below the weaker end flags drift. */
  dropMargin?: number;
  /** Clip start vs start keyframe below this is reported. */
  boundaryMin?: number;
  /** Score the samples with the vision model too (default true); false = local pixel checks only. */
  vision?: boolean;
  deps?: {
    sample?: typeof sampleClipFrames;
    score?: (frame: ImageSource, refs: ConsistencyRefs, opts: ScoreOptions) => Promise<ConsistencyScore>;
    similarity?: typeof frameSimilarity;
    scoreDeps?: ScoreOptions["deps"];
  };
}

export interface DriftReport {
  driftFlag: boolean;
  reasons: string[];
  samples: { at: number; t: number; score: number | null; pass: boolean | null; defects: string[] }[];
  boundary: { start: number | null; end: number | null };
  mid: { vsStart: number | null; vsEnd: number | null };
}

export async function checkClipDrift(clip: Buffer | string, refs: DriftRefs, opts: DriftOptions): Promise<DriftReport> {
  const deps = opts.deps ?? {};
  const sim = deps.similarity ?? frameSimilarity;
  // 0.97, not 1: generated clips often dissolve or fade on their very last frames (a live talking-head clip's
  // tablet ghosted out in its last 0.1 s), which read as "product / cast missing" at the true last frame.
  const localSamples = await (deps.sample ?? sampleClipFrames)(clip, [0, 0.25, 0.5, 0.75, 0.97]);
  const first = localSamples[0];
  const last = localSamples[localSamples.length - 1];
  const interiors = localSamples.slice(1, -1);
  if (!first || !last || !interiors.length) throw new Error("clip drift check needs at least three frames");
  const candidates = await Promise.all(interiors.map(async (sample) => {
    const [vsStart, vsEnd] = await Promise.all([
      refs.start ? sim(sample.image, refs.start).catch(() => null) : Promise.resolve(null),
      refs.end ? sim(sample.image, refs.end).catch(() => null) : Promise.resolve(null),
    ]);
    return { sample, vsStart, vsEnd, similarity: Math.max(vsStart ?? -1, vsEnd ?? -1) };
  }));
  // If no anchor comparison works, use the true midpoint. Otherwise inspect the
  // interior frame least like either approved keyframe, at the same vision-call cost.
  const comparable = candidates.filter((item) => item.similarity >= 0);
  const chosen = comparable.length
    ? comparable.sort((a, b) => a.similarity - b.similarity)[0]
    : candidates[Math.floor(candidates.length / 2)];
  const mid = chosen.sample;
  const samples = [first, mid, last];
  const reasons: string[] = [];

  const scores: (ConsistencyScore | null)[] =
    opts.vision === false || (!refs.cast?.length && !refs.product?.length)
      ? samples.map(() => null)
      : await Promise.all(
          samples.map((s) =>
            (deps.score ?? scoreFrame)(s.image, refs, { shot: opts.shot, kind: "clip", shotType: opts.shotType, productSpec: opts.productSpec, deps: deps.scoreDeps }).catch(() => null)
          )
        );

  const boundary = {
    start: refs.start ? await sim(first.image, refs.start).catch(() => null) : null,
    end: refs.end ? await sim(last.image, refs.end).catch(() => null) : null,
  };
  const midSim = {
    vsStart: chosen.vsStart,
    vsEnd: chosen.vsEnd,
  };

  let drift = false;
  const m = scores[1];
  if (m?.reviewed) {
    const type = m.shotType;
    const threshold = opts.threshold ?? SHOT_THRESHOLDS[type].pass - 0.08;
    const ends = [scores[0], scores[2]].filter((s): s is ConsistencyScore => !!s?.reviewed).map((s) => s.score);
    const drop = ends.length ? Math.min(...ends) - m.score : 0;
    if (m.score < threshold) {
      drift = true;
      reasons.push(`mid-clip score at ${mid.t}s ${m.score} < ${Math.round(threshold * 1000) / 1000} (${type})`);
    }
    if (drop > (opts.dropMargin ?? 0.15)) {
      drift = true;
      reasons.push(`mid-clip score at ${mid.t}s drops ${Math.round(drop * 1000) / 1000} below the clip's ends`);
    }
    if (drift && m.defects.length) reasons.push(`mid-clip defects: ${m.defects.slice(0, 4).join("; ")}`);
    if (m.majorDefects && !drift) {
      drift = true;
      reasons.push(`mid-clip major defect at ${mid.t}s: ${m.defects.slice(0, 3).join("; ")}`);
    }
  } else if (midSim.vsStart !== null && midSim.vsEnd !== null && Math.max(midSim.vsStart, midSim.vsEnd) < 0.2) {
    // Pixel-only fallback: the middle of an anchored clip resembles neither anchor.
    drift = true;
    reasons.push(`mid-clip frame at ${mid.t}s resembles neither keyframe (similarity ${midSim.vsStart} / ${midSim.vsEnd})`);
  }
  if (boundary.start !== null && boundary.start < (opts.boundaryMin ?? 0.55)) reasons.push(`clip start departs from its start keyframe (similarity ${boundary.start})`);

  return {
    driftFlag: drift,
    reasons,
    samples: samples.map((s, i) => ({ at: s.at, t: s.t, score: scores[i]?.reviewed ? scores[i]!.score : null, pass: scores[i]?.reviewed ? scores[i]!.pass : null, defects: scores[i]?.defects.slice(0, 4) ?? [] })),
    boundary,
    mid: midSim,
  };
}

export interface ClipJobRefs {
  start?: string;
  end?: string;
  cast: string[];
  product: string[];
  shot: string;
  shotType?: string;
  productSpec?: string;
}

/** Auto re-generation on drift costs a second clip: off unless the job or AUTO_REGEN_ON_DRIFT asks for it. */
export function autoRegenOnDrift(settings: Record<string, unknown> | undefined): boolean {
  const v = settings?.autoRegenOnDrift;
  if (v === true || v === 1 || v === "on") return true;
  if (v === false || v === 0 || v === "off") return false;
  return process.env.AUTO_REGEN_ON_DRIFT === "on";
}

export const MAX_DRIFT_REGENS = 1;

/**
 * The drift check for one finished clip job, as the executor uses it. Never
 * throws: null when disabled or when the check itself failed.
 */
export async function clipDriftForJob(
  clip: Buffer | string,
  refs: ClipJobRefs | undefined,
  settings: Record<string, unknown> | undefined,
  opts: { mode: "on" | "pixel" | "off"; deps?: DriftOptions["deps"] }
): Promise<{ report: DriftReport; regenerate: boolean } | null> {
  if (opts.mode === "off" || !refs) return null;
  try {
    const { isShotType } = await import("./score");
    const report = await checkClipDrift(
      clip,
      { start: refs.start, end: refs.end, cast: refs.cast.map((image) => ({ image })), product: refs.product.map((image) => ({ image })) },
      { shot: refs.shot, shotType: isShotType(refs.shotType) ? refs.shotType : undefined, productSpec: refs.productSpec, vision: opts.mode === "on", deps: opts.deps }
    );
    const regenerate = report.driftFlag && autoRegenOnDrift(settings) && (Number(settings?.driftRegens) || 0) < MAX_DRIFT_REGENS;
    return { report, regenerate };
  } catch (err) {
    console.warn("[consistency] clip drift check failed:", err instanceof Error ? err.message.slice(0, 160) : err);
    return null;
  }
}
