/**
 * QC gate for a rendered master — nothing ships unmeasured. Thresholds come
 * from the libtv-video-ad skill's qc-gate.md (benchmarks measured on official
 * TCL / Hisense / Walmart TV ads), plus the attention checks a 15–30 s feed ad
 * lives or dies by. Measuring is one low-resolution decode plus one audio pass.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);

export interface QcCheck {
  key: string;
  label: string;
  value: number | null;
  target: string;
  pass: boolean;
}

export interface QcReport {
  engine: "edit-v2";
  durationSec: number;
  passed: number;
  total: number;
  checks: QcCheck[];
  cutsSec: number[];
  measuredAt: string;
  /** The master's hook style (q / c / p) — variants cover the other two. */
  hookStyle?: string;
}

export interface QcInput {
  durationSec: number;
  cutsSec: number[];
  freezes: { start: number; duration: number }[];
  loudnessLufs: number | null;
  truePeakDb: number | null;
  beats: number[];
  /** From the edit plan (what the viewer gets regardless of detection). */
  plannedCuts: number[];
  hookHeadline: boolean;
  captionCoverage: number | null;
  ctaSec: number | null;
}

/** Scene-change detections a transition produces in pairs: keep one per 0.2 s. */
export function mergeCuts(times: number[], window = 0.2): number[] {
  const out: number[] = [];
  for (const t of [...times].sort((a, b) => a - b)) if (!out.length || t - out[out.length - 1] > window) out.push(t);
  return out;
}

/**
 * Cut times from ffmpeg's metadata log. A transition produces several detections
 * a few frames apart; within 0.2 s the strongest scene change is the cut.
 */
export function parseCuts(metadataLog: string): number[] {
  const hits: { t: number; score: number }[] = [];
  let cur: { t: number; score: number } | null = null;
  for (const line of metadataLog.split("\n")) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) {
      cur = { t: Number(pts[1]), score: 0 };
      hits.push(cur);
      continue;
    }
    const sc = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (sc && cur) cur.score = Number(sc[1]);
  }
  const clusters: { t: number; score: number }[] = [];
  for (const h of hits.filter((x) => x.t > 0.05).sort((a, b) => a.t - b.t)) {
    const last = clusters[clusters.length - 1];
    if (last && h.t - last.t <= 0.2) {
      if (h.score > last.score) Object.assign(last, h);
    } else clusters.push({ ...h });
  }
  return clusters.map((c) => c.t);
}

export function parseFreezes(stderr: string): { start: number; duration: number }[] {
  const starts = [...stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const durs = [...stderr.matchAll(/freeze_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((start, i) => ({ start, duration: durs[i] ?? 0 }));
}

export function parseLoudness(stderr: string): { lufs: number | null; peak: number | null } {
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const i = /I:\s+(-?[\d.]+) LUFS/.exec(summary);
  const p = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary);
  return { lufs: i ? Number(i[1]) : null, peak: p && p[1] !== "-inf" ? Number(p[1]) : null };
}

function nearest(list: number[], t: number): number {
  return list.reduce((b, c) => (Math.abs(c - t) < Math.abs(b - t) ? c : b), list[0] ?? 0);
}

/** Score the measurements against the gate. Pure. */
export function scoreQc(q: QcInput): QcReport {
  const d = Math.max(0.1, q.durationSec);
  // Density counts the edit's own cuts (punch-ins on one source fall under the
  // scene detector's threshold); beat timing is judged on the detected ones.
  const cuts = q.plannedCuts.length ? q.plannedCuts : q.cutsSec;
  const per15 = (cuts.length / d) * 15;
  const staticSec = q.freezes.reduce((n, f) => n + f.duration, 0);
  const longest = q.freezes.reduce((n, f) => Math.max(n, f.duration), 0);
  const offsets = q.cutsSec.map((t) => (t - nearest(q.beats, t)) * 1000);
  const bias = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : null;
  const worst = offsets.length ? Math.max(...offsets.map(Math.abs)) : null;
  const firstCut = q.plannedCuts.length ? Math.min(...q.plannedCuts) : null;
  const beatsWithCut = q.beats.filter((b) => q.plannedCuts.some((c) => Math.abs(c - b) < 0.02)).length;

  const r1 = (n: number | null, k = 10) => (n === null ? null : Math.round(n * k) / k);
  const checks: QcCheck[] = [
    { key: "first_cut_s", label: "First cut (hook pace)", value: r1(firstCut, 100), target: "≤ 1.5 s", pass: firstCut !== null && firstCut <= 1.5 },
    { key: "hook_headline", label: "Hook headline on screen in the first 2 s", value: q.hookHeadline ? 1 : 0, target: "yes", pass: q.hookHeadline },
    { key: "cuts_per_15s", label: "Cuts per 15 s", value: r1(per15), target: "≥ 8", pass: per15 >= 8 },
    { key: "avg_shot_s", label: "Average shot length", value: r1(d / (cuts.length + 1), 100), target: "≤ 1.7 s", pass: d / (cuts.length + 1) <= 1.7 },
    { key: "static_share", label: "Share of the ad that is frozen", value: r1(staticSec / d, 100), target: "≤ 0.42", pass: staticSec / d <= 0.42 },
    { key: "longest_static_s", label: "Longest frozen stretch", value: r1(longest, 100), target: "≤ 1.2 s", pass: longest <= 1.2 },
    { key: "beat_bias_ms", label: "Cuts vs beat — average offset", value: r1(bias), target: "within ±20 ms", pass: bias === null || Math.abs(bias) <= 20 },
    { key: "beat_max_ms", label: "Cuts vs beat — worst cut", value: r1(worst), target: "≤ 50 ms", pass: worst === null || worst <= 50 },
    { key: "beat_accent_pct", label: "Beats that carry a cut", value: r1((beatsWithCut / Math.max(1, q.beats.length)) * 100), target: "≥ 25 %", pass: beatsWithCut / Math.max(1, q.beats.length) >= 0.25 },
    { key: "caption_coverage", label: "Voiceover time with captions on screen", value: q.captionCoverage === null ? null : r1(q.captionCoverage * 100), target: "≥ 90 %", pass: q.captionCoverage === null || q.captionCoverage >= 0.9 },
    { key: "end_card_s", label: "End card (CTA) length", value: q.ctaSec === null ? null : r1(d - q.ctaSec), target: "1.5 – 5 s", pass: q.ctaSec !== null && d - q.ctaSec <= 5 && d - q.ctaSec >= 1.5 },
    { key: "loudness_lufs", label: "Loudness", value: r1(q.loudnessLufs), target: "−17 … −12 LUFS", pass: q.loudnessLufs !== null && q.loudnessLufs >= -17 && q.loudnessLufs <= -12 },
    { key: "true_peak_dbfs", label: "Peak level", value: r1(q.truePeakDb), target: "≤ −1.0 dBFS", pass: q.truePeakDb !== null && q.truePeakDb <= -1.0 },
  ];
  return {
    engine: "edit-v2",
    durationSec: r1(d, 100) ?? d,
    passed: checks.filter((c) => c.pass).length,
    total: checks.length,
    checks,
    cutsSec: q.cutsSec,
    measuredAt: new Date().toISOString(),
  };
}

/** Decode the master once at low resolution (cuts + freezes) and measure its audio. */
export async function measureMaster(file: string, dir: string): Promise<Pick<QcInput, "cutsSec" | "freezes" | "loudnessLufs" | "truePeakDb">> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available");
  const cutsLog = path.join(dir, "qc-cuts.txt");
  const video = await run(
    ffmpegPath,
    [
      "-hide_banner", "-nostats", "-i", file,
      "-filter_complex", `[0:v]scale=270:-2,split[a][b];[a]select='gt(scene,0.3)',metadata=print:file=${cutsLog}[o1];[b]freezedetect=n=-55dB:d=0.4[o2]`,
      "-map", "[o1]", "-f", "null", "-",
      "-map", "[o2]", "-f", "null", "-",
    ],
    { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 }
  ).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
  const audio = await run(ffmpegPath, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], {
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
  const log = await readFile(cutsLog, "utf8").catch(() => "");
  const loud = parseLoudness(String(audio.stderr));
  return { cutsSec: parseCuts(log), freezes: parseFreezes(String(video.stderr)), loudnessLufs: loud.lufs, truePeakDb: loud.peak };
}

/** Scene-change cut times of a file (low-resolution decode). */
export async function measureCuts(file: string, dir: string): Promise<number[]> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available");
  const log = path.join(dir, `qc-cuts-${path.basename(file)}.txt`);
  await run(ffmpegPath, ["-hide_banner", "-nostats", "-i", file, "-vf", `scale=270:-2,select='gt(scene,0.3)',metadata=print:file=${log}`, "-an", "-f", "null", "-"], {
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024,
  }).catch(() => null);
  return parseCuts(await readFile(log, "utf8").catch(() => ""));
}
