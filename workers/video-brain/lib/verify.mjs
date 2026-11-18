// Second check (二次复查): re-read the finished video itself and compare it field by field with what was promised.
// The pipeline's own "done" does not count. Targets: ad-studio docs/OPERATOR-SKILL.md + PLAN-20261117 (≤24 s, 9:16,
// audio present, −14 LUFS ±1.5, URL serves an mp4, spend ≤ reservation).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { reserveUsd } from './policy.mjs';

const pexec = promisify(execFile);
export const TARGETS = { maxSec: 24.5, minSec: 5, lufs: -14, lufsTol: 1.5, ratio: 9 / 16, ratioTol: 0.02 };

/** pure comparison from probe facts */
export function compare(run, facts) {
  const f = [];
  const add = (field, expected, actual, pass, source) => f.push({ field, expected, actual: String(actual), pass: !!pass, source });
  if (facts.file) add('file', 'exists, > 0 bytes', facts.file.bytes ? `${(facts.file.bytes / 1e6).toFixed(1)} MB` : 'missing', facts.file.bytes > 0, 'fs');
  else add('url', 'HTTP 200 video/mp4', facts.http ? `${facts.http.status} ${facts.http.type || ''}`.trim() : 'unreachable', facts.http?.status === 200 && /video|octet/.test(facts.http.type || ''), 'http');
  if (facts.probe) {
    const p = facts.probe;
    add('duration', `${TARGETS.minSec}–${TARGETS.maxSec} s`, `${p.duration.toFixed(2)} s`, p.duration >= TARGETS.minSec && p.duration <= TARGETS.maxSec, 'ffprobe');
    add('aspect', '9:16', `${p.width}x${p.height}`, p.height > 0 && Math.abs(p.width / p.height - TARGETS.ratio) <= TARGETS.ratioTol, 'ffprobe');
    add('video codec', 'h264', p.vcodec, p.vcodec === 'h264', 'ffprobe');
    add('audio track', 'present', p.acodec || 'none', !!p.acodec, 'ffprobe');
  } else add('probe', 'readable mp4', facts.probeError || 'not probed', false, 'ffprobe');
  if (facts.lufs != null) add('loudness', `${TARGETS.lufs} LUFS ±${TARGETS.lufsTol}`, `${facts.lufs.toFixed(1)} LUFS`, Math.abs(facts.lufs - TARGETS.lufs) <= TARGETS.lufsTol, 'ffmpeg ebur128');
  const reserve = reserveUsd(run.estUsd || 0);
  if (run.estUsd > 0 && run.actualUsd != null) add('cost', `≤ reservation $${reserve.toFixed(2)}`, `$${Number(run.actualUsd).toFixed(2)}`, run.actualUsd <= reserve + 0.01, 'db vs estimate');
  const rt = Number(run.metrics?.runtime ?? run.metrics?.duration ?? NaN);
  if (Number.isFinite(rt) && facts.probe) add('runtime matches report', `${rt.toFixed(2)} s (worker metrics)`, `${facts.probe.duration.toFixed(2)} s`, Math.abs(rt - facts.probe.duration) <= 0.5, 'metrics vs file');
  return { runId: run.id, projectId: run.projectId, at: new Date().toISOString(), renderedAt: run.updatedAt ? new Date(run.updatedAt).toISOString() : null, pass: f.every((x) => x.pass), fields: f };
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
  if (facts.probe?.acodec) {
    try {
      const { stderr } = await pexec('ffmpeg', ['-hide_banner', '-nostats', '-i', url, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
      const m = [...stderr.matchAll(/I:\s+(-?\d+(\.\d+)?) LUFS/g)].pop();
      if (m) facts.lufs = Number(m[1]);
    } catch { /* loudness optional */ }
  }
  return facts;
}

export async function secondCheck(run) { return compare(run, await probeUrl(run.finalMp4Url || run.finalPath)); }
