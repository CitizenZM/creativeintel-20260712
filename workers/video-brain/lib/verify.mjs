// Second check (二次复查): re-read the finished video itself and compare it field by field with what was promised.
// The pipeline's own "done" does not count. Targets: ad-studio docs/OPERATOR-SKILL.md + PLAN-20261117 (≤24 s, 9:16,
// audio present, −14 LUFS ±1.5, URL serves an mp4, spend ≤ reservation).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { reserveUsd } from './policy.mjs';

const pexec = promisify(execFile);
export const TARGETS = { maxSec: 24.5, minSec: 5, lufs: -14, lufsTol: 1.5, ratio: 9 / 16, ratioTol: 0.02 };

export const KF_USD = 0.04;
/** key frames generated before the gate: two A/B sets of one per scene (6 scenes when unknown) */
export const keyframeAllowance = (scenes) => +(((Number(scenes) > 0 ? Number(scenes) : 6) * 2 * KF_USD)).toFixed(2);

/** pure comparison from probe facts */
export function compare(run, facts) {
  const f = [];
  const add = (field, expected, actual, pass, source, extra) => f.push({ field, expected, actual: String(actual), pass: !!pass, source, ...extra });
  if (facts.file) add('file', 'exists, > 0 bytes', facts.file.bytes ? `${(facts.file.bytes / 1e6).toFixed(1)} MB` : 'missing', facts.file.bytes > 0, 'fs');
  else add('url', 'HTTP 200 video/mp4', facts.http ? `${facts.http.status} ${facts.http.type || ''}`.trim() : 'unreachable', facts.http?.status === 200 && /video|octet/.test(facts.http.type || ''), 'http');
  if (facts.probe) {
    const p = facts.probe;
    add('duration', `${TARGETS.minSec}–${TARGETS.maxSec} s`, `${p.duration.toFixed(2)} s`, p.duration >= TARGETS.minSec && p.duration <= TARGETS.maxSec, 'ffprobe');
    add('aspect', '9:16', `${p.width}x${p.height}`, p.height > 0 && Math.abs(p.width / p.height - TARGETS.ratio) <= TARGETS.ratioTol, 'ffprobe');
    add('video codec', 'h264', p.vcodec, p.vcodec === 'h264', 'ffprobe');
    add('audio track', 'present', p.acodec || 'none', !!p.acodec, 'ffprobe');
  } else add('probe', 'readable mp4', facts.probeError || 'not probed', false, 'ffprobe');
  // frame 0 uniform (black/white/flat flash): narrow luma spread and no bright detail. Calibrated 0/256 false positives on
  // finished videos; a title card with text passes (its text is far above p90). Probe error -> no field (never fails on it)
  if (facts.firstFrame) {
    const { p10, p90, max } = facts.firstFrame;
    add('first frame', 'not a blank/uniform frame', `luma p10 ${p10} p90 ${p90} max ${max}`, !(p90 - p10 < 4 && max - p90 < 40), 'ffmpeg frame 0');
  }
  if (facts.lufs != null) add('loudness', `${TARGETS.lufs} LUFS ±${TARGETS.lufsTol}`, `${facts.lufs.toFixed(1)} LUFS`, Math.abs(facts.lufs - TARGETS.lufs) <= TARGETS.lufsTol, 'ffmpeg ebur128');
  // the reservation covers clips (estimate x 1.3); key frames (A/B, $0.04 each) are generated BEFORE the gate and booked apart
  const allowance = keyframeAllowance(run.estimateScenes);
  const cap = reserveUsd(run.estUsd || 0) + allowance;
  if (run.estUsd > 0 && run.actualUsd != null) add('cost', `≤ clip reservation + key frames $${cap.toFixed(2)}`, `$${Number(run.actualUsd).toFixed(2)}`, run.actualUsd <= cap + 0.01, 'db vs estimate');
  // the pipeline's own review (Ad Studio st.review): advisory only, never flips pass (blocking/digest/learnings ignore it)
  const sc = run.review?.scores;
  if (sc) {
    const keys = ['hook', 'sell'].filter((k) => typeof sc[k] === 'number');
    if (keys.length) add('pipeline review', 'hook & sell ≥ 5', keys.map((k) => `${k} ${sc[k]}`).join(' · '), keys.every((k) => sc[k] >= 5), 'pipeline review', { advisory: true });
  }
  const rt = Number(run.metrics?.runtime ?? run.metrics?.duration ?? NaN);
  if (Number.isFinite(rt) && facts.probe) add('runtime matches report', `${rt.toFixed(2)} s (worker metrics)`, `${facts.probe.duration.toFixed(2)} s`, Math.abs(rt - facts.probe.duration) <= 0.5, 'metrics vs file');
  // audio present but ebur128 gave no reading: the caller retries next tick instead of storing a check without loudness
  const loudnessMissing = !!facts.probe?.acodec && facts.lufs == null;
  return { runId: run.id, projectId: run.projectId, at: new Date().toISOString(), renderedAt: run.updatedAt ? new Date(run.updatedAt).toISOString() : null, pass: f.every((x) => x.pass || x.advisory), fields: f, ...(loudnessMissing ? { loudnessMissing: true } : {}) };
}

export const LUFS_TRIES = 3;
/** after LUFS_TRIES unmeasured tries the check is stored with a failing loudness field */
export function loudnessNotMeasured(check) {
  const c = { ...check }; delete c.loudnessMissing;
  return { ...c, pass: false, fields: [...c.fields, { field: 'loudness', expected: `${TARGETS.lufs} LUFS ±${TARGETS.lufsTol}`, actual: 'not measured', pass: false, source: 'ffmpeg ebur128' }] };
}

export async function probeUrl(url, { timeoutMs = 60_000 } = {}) {
  const facts = {};
  if (!/^https?:/.test(url)) { try { facts.file = { bytes: (await stat(url)).size }; } catch { facts.file = { bytes: 0 }; } }
  else try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
    facts.http = { status: r.status, type: r.headers.get('content-type'), bytes: Number(r.headers.get('content-length') || 0) };
  } catch (e) { facts.http = null; facts.httpError = e.message; }
  try {
    const { stdout } = await pexec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', url], { timeout: timeoutMs });
    const j = JSON.parse(stdout); const v = j.streams.find((s) => s.codec_type === 'video') || {}; const a = j.streams.find((s) => s.codec_type === 'audio');
    facts.probe = { duration: Number(j.format?.duration || 0), width: v.width || 0, height: v.height || 0, vcodec: v.codec_name || 'none', acodec: a?.codec_name || null };
  } catch (e) { facts.probeError = String(e.message).slice(0, 160); }
  if (facts.probe && facts.probe.vcodec !== 'none') {
    try { facts.firstFrame = await frameStats(url, timeoutMs); } catch { /* optional: no field */ }
  }
  if (facts.probe?.acodec) {
    try {
      const { stderr } = await pexec('ffmpeg', ['-hide_banner', '-nostats', '-i', url, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
      const m = [...stderr.matchAll(/I:\s+(-?\d+(\.\d+)?) LUFS/g)].pop();
      if (m) facts.lufs = Number(m[1]);
    } catch { /* loudness optional */ }
  }
  return facts;
}

const FW = 270, FH = 480;
/** luma stats of frame 0, scaled to 270x480 gray: p10/p90/max (0-255) */
async function frameStats(url, timeoutMs) {
  const { stdout } = await pexec('ffmpeg', ['-hide_banner', '-v', 'error', '-i', url, '-frames:v', '1', '-vf', `scale=${FW}:${FH},format=gray`, '-f', 'rawvideo', '-'], { timeout: Math.min(timeoutMs, 30_000), encoding: 'buffer', maxBuffer: 4 * FW * FH });
  if (stdout.length < FW * FH) throw new Error('short frame');
  const hist = new Array(256).fill(0); let max = 0;
  for (let i = 0; i < FW * FH; i++) { const v = stdout[i]; hist[v]++; if (v > max) max = v; }
  const pct = (q) => { let n = 0; const k = q * FW * FH; for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= k) return v; } return 255; };
  return { p10: pct(0.1), p90: pct(0.9), max };
}

export async function secondCheck(run) { return compare(run, await probeUrl(run.finalMp4Url || run.finalPath)); }
