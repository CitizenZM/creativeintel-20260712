#!/usr/bin/env node
// Local Mac worker for Ad Studio runs (Studio tab → "Ad Studio · optimise this storyboard and generate").
// Claims an AdStudioRun over /api/worker/adstudio, turns it into an Ad Studio job (repo ad-studio-20261104,
// source "xark"), runs that pipeline, streams progress back and stops at the spend gate until the user approves
// in Xark. It never touches the database.
//
// Phases (decided by the server on claim):
//   plan       new job from the storyboard snapshot → run.mjs (re-analysis, hook, script, A/B key frames) → gate
//   copy_plan  same hook type, another engine: copy the leader's plan (clone.mjs) → price it for this engine → gate
//   generate   after approval: run.mjs <job> generate → voice → render → review (+1 auto-fix) → upload → done
//
// Env:
//   APP_URL               default https://creative.account.xark.io
//   WORKER_TOKEN          required (x-worker-token)
//   VERCEL_AUTOMATION_BYPASS_SECRET  optional, Deployment Protection bypass
//   AD_STUDIO_ROOT        default ~/Projects/ad-studio-20261104
//   ADSTUDIO_MEDIA_BASE   optional: serve results from this URL instead of uploading to Vercel Blob
//                         (local testing: http://localhost:5310/api/file/jobs)
//   ADSTUDIO_BUDGET_USD   per-video job budget for the frame-QA re-generation (default 6)
//   POLL_INTERVAL_MS      default 20000, doubles while idle up to MAX_IDLE_POLL_MS (default 300000)
// Flags: --once (handle at most one claim, then exit)
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const APP_URL = (process.env.APP_URL || 'https://creative.account.xark.io').replace(/\/+$/, '');
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
export const ROOT = process.env.AD_STUDIO_ROOT || path.join(homedir(), 'Projects', 'ad-studio-20261104');
const MEDIA_BASE = (process.env.ADSTUDIO_MEDIA_BASE || '').replace(/\/+$/, '');
const BUDGET = Number(process.env.ADSTUDIO_BUDGET_USD || 6);
const POLL = Number(process.env.POLL_INTERVAL_MS || 20000);
const MAX_IDLE = Number(process.env.MAX_IDLE_POLL_MS || 300000);
const WORKER_ID = `${hostname()}-${process.pid}`;
const TICK_MS = Number(process.env.ADSTUDIO_TICK_MS || 5000);

export const jobIdOf = (runId) => `xk-${runId}`;
const jobDir = (id) => path.join(ROOT, 'data', 'jobs', id);
const STEPS = ['ingest', 'analyze', 'product', 'script', 'generate', 'voice', 'render', 'review'];
const readJSON = async (f) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };

export async function api(action, body = {}) {
  const headers = { 'content-type': 'application/json', 'x-worker-token': WORKER_TOKEN };
  if (BYPASS) headers['x-vercel-protection-bypass'] = BYPASS;
  const res = await fetch(`${APP_URL}/api/worker/adstudio`, { method: 'POST', headers, body: JSON.stringify({ action, workerId: WORKER_ID, ...body }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${action}: ${res.status} ${j.error || ''}`);
  return j;
}

/** the Ad Studio job.json for a run (see ad-studio pipeline/xark.mjs for what it reads) */
export function jobOf(run) {
  const i = run.input || {};
  const p = i.project || {}; const kit = i.brandKit || {}; const o = i.offer || {};
  return {
    id: jobIdOf(run.runId), projectId: 'xark', title: `${i.storyboard?.title || 'Storyboard'} · ${run.hookType} · ${run.engine}`,
    source: 'xark',
    xark: { runId: run.runId, storyboardId: i.storyboard?.id, title: i.storyboard?.title, frameSeconds: i.storyboard?.frameSeconds || 2, frames: i.storyboard?.frames || [], script: i.script || null, brandKit: kit },
    productUrl: p.productUrl, siteUrl: p.brandUrl || kit.landingUrl || '', brandName: p.brandName, goal: p.campaignGoal || 'drive purchases', notes: i.notes || '',
    offerText: o.text || kit.offerText || '', offerWas: o.was ?? undefined, offerNow: o.now ?? undefined, offerCode: o.code || '',
    voice: 'auto', music: 'auto', format: 'auto', engine: 'generate', videoModel: run.engine, budget: BUDGET, approved: false,
    hookType: run.hookType, audioProfile: i.soundProfile, pitch: true, maxScenes: 6, created: new Date().toISOString(),
  };
}

/** what Xark shows from the plan (spec.json) */
export function planOf(spec) {
  if (!spec) return undefined;
  return {
    concept: spec.concept, hook: { chosen: spec.hook?.chosen, vo: spec.hook?.vo, options: spec.hook_options || [] },
    coverage: spec.xark?.coverage, frames: spec.xark?.frames,
    audio: { profile: spec.audio?.profile, music: spec.music, voice: spec.audio?.voice?.name },
    shots: (spec.shots || []).map((s) => ({ dur: s.dur, caption: s.caption, vo: s.vo, visual: s.visual, src_frames: s.src_frames || [] })),
    durationS: +((spec.shots || []).reduce((a, s) => a + (+s.dur || 0), 0)).toFixed(2),
  };
}

const progressOf = (st) => {
  const done = STEPS.filter((s) => ['done', 'skipped'].includes(st?.steps?.[s])).length;
  return Math.round((done / STEPS.length) * 100);
};

/** run the pipeline as its own process group, report every tick, kill it when Xark says cancel */
export async function runPipeline(runId, id, args) {
  // a host Claude Code session's variables (CLAUDECODE, CLAUDE_CODE_*) make the pipeline's `claude -p` return an empty session
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE/.test(k)));
  const child = spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: 'ignore', env });
  let exited = null; child.on('exit', (code) => { exited = code ?? 0; });
  let cancelled = false;
  while (exited === null) {
    await sleep(TICK_MS);
    const st = await readJSON(path.join(jobDir(id), 'status.json'));
    const spec = await readJSON(path.join(jobDir(id), 'spec.json'));
    try {
      const r = await api('progress', { runId, step: st?.step, progress: progressOf(st), log: st?.log?.slice(-60), plan: planOf(spec) });
      if (r.cancel && !cancelled) { cancelled = true; try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } }
    } catch (e) { console.warn('[adstudio] progress failed:', e.message); }
  }
  return { cancelled, code: exited };
}

async function upload(id, file, contentType) {
  const f = path.join(jobDir(id), file);
  if (!existsSync(f)) return null;
  if (MEDIA_BASE) return `${MEDIA_BASE}/${id}/${file}`;
  const { upload: put } = await import('@vercel/blob/client');
  const headers = { 'x-worker-token': WORKER_TOKEN }; if (BYPASS) headers['x-vercel-protection-bypass'] = BYPASS;
  const res = await put(`creativeintel/adstudio/${id}/${file}`, await readFile(f), { access: 'public', contentType, handleUploadUrl: `${APP_URL}/api/worker/blob-upload`, headers });
  return res.url;
}

export async function handle(run) {
  const id = jobIdOf(run.runId); const dir = jobDir(id);
  const end = async (st, cancelled) => {
    if (cancelled) return api('failed', { runId: run.runId, error: 'cancelled by the user', cancelled: true, actualUsd: st?.cost, log: st?.log });
    return api('failed', { runId: run.runId, error: st?.error || 'pipeline stopped', actualUsd: st?.cost, log: st?.log });
  };
  if (run.phase === 'plan' || run.phase === 'copy_plan') {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'job.json'), JSON.stringify(jobOf(run), null, 1));
    let from = 'ingest';
    if (run.phase === 'copy_plan') {
      const c = await new Promise((resolve) => { const p = spawn(process.execPath, ['pipeline/clone.mjs', jobIdOf(run.planFromRunId), id], { cwd: ROOT, stdio: 'inherit' }); p.on('exit', resolve); });
      if (c !== 0) return api('failed', { runId: run.runId, error: `could not copy the plan of ${run.planFromRunId}` });
      from = 'generate';
    }
    const { cancelled } = await runPipeline(run.runId, id, ['pipeline/run.mjs', id, from]);
    const st = await readJSON(path.join(dir, 'status.json'));
    if (cancelled || st?.state !== 'approval') return end(st, cancelled);
    const spec = await readJSON(path.join(dir, 'spec.json'));
    return api('gate', { runId: run.runId, estimate: st.estimate, plan: planOf(spec), storyboardAB: spec?.storyboard ? { winner: spec.storyboard.winner, scores: spec.storyboard.scores, why: spec.storyboard.why } : undefined, preUsd: st.cost || 0, log: st.log });
  }
  if (run.phase === 'generate') {
    const job = await readJSON(path.join(dir, 'job.json'));
    if (!job) return api('failed', { runId: run.runId, error: 'job folder missing on this Mac' });
    await writeFile(path.join(dir, 'job.json'), JSON.stringify({ ...job, approved: true }, null, 1));
    const { cancelled } = await runPipeline(run.runId, id, ['pipeline/run.mjs', id, 'generate']);
    const st = await readJSON(path.join(dir, 'status.json'));
    if (cancelled || st?.state !== 'done') return end(st, cancelled);
    const spec = await readJSON(path.join(dir, 'spec.json'));
    const finalMp4Url = await upload(id, 'final.mp4', 'video/mp4');
    if (!finalMp4Url) return api('failed', { runId: run.runId, error: 'final.mp4 missing after render', actualUsd: st.cost });
    const posterUrl = await upload(id, 'poster.jpg', 'image/jpeg');
    return api('done', { runId: run.runId, finalMp4Url, posterUrl, review: st.review, metrics: st.review?.metrics, autofix: st.autofix, plan: planOf(spec), actualUsd: st.cost, log: st.log });
  }
  throw new Error(`unknown phase ${run.phase}`);
}

async function main() {
  if (!WORKER_TOKEN) { console.error('WORKER_TOKEN is required'); process.exit(1); }
  const once = process.argv.includes('--once');
  let wait = POLL;
  for (;;) {
    let run = null;
    try { run = (await api('claim')).run; } catch (e) { console.warn('[adstudio] claim failed:', e.message); }
    if (run) {
      console.log(`[adstudio] ${run.phase} ${run.runId} (${run.hookType} / ${run.engine})`);
      try { await handle(run); } catch (e) { console.error('[adstudio] run failed:', e); await api('failed', { runId: run.runId, error: String(e.message || e) }).catch(() => {}); }
      wait = POLL;
      if (once) return;
      continue;
    }
    if (once) return;
    await sleep(wait); wait = Math.min(MAX_IDLE, wait * 2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
