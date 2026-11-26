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
//   APP_URL               required (production: https://creative.account.xark.io) - no default, so a lab run never claims production work
//   WORKER_TOKEN          required (x-worker-token)
//   VERCEL_AUTOMATION_BYPASS_SECRET  optional, Deployment Protection bypass
//   AD_STUDIO_ROOT        default ~/Projects/ad-studio-20261104
//   ADSTUDIO_MEDIA_BASE   optional: serve results from this URL instead of uploading to Vercel Blob
//                         (local testing: http://localhost:5310/api/file/jobs)
//   ADSTUDIO_BUDGET_USD   per-video job budget for the frame-QA re-generation (default 6); after approval the job is
//                         capped at what Xark reserved (estimate x 1.3), never more
//   ADSTUDIO_CONCURRENCY  runs handled at once (default 3); a reference-video batch and a storyboard batch run side by side
//   POLL_INTERVAL_MS      default 20000, doubles while idle up to MAX_IDLE_POLL_MS (default 300000)
//   ADSTUDIO_API_TIMEOUT_MS  per-call timeout for /api/worker/adstudio (default 30000; the 'done' report gets 120000)
// Flags: --once (handle at most one claim, then exit)
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
export const ROOT = process.env.AD_STUDIO_ROOT || path.join(homedir(), 'Projects', 'ad-studio-20261104');
const MEDIA_BASE = (process.env.ADSTUDIO_MEDIA_BASE || '').replace(/\/+$/, '');
const BUDGET = Number(process.env.ADSTUDIO_BUDGET_USD || 6);
const POLL = Number(process.env.POLL_INTERVAL_MS || 20000);
const MAX_IDLE = Number(process.env.MAX_IDLE_POLL_MS || 300000);
const WORKER_ID = `${hostname()}-${process.pid}`;
const TICK_MS = Number(process.env.ADSTUDIO_TICK_MS || 5000);
const API_TIMEOUT = Number(process.env.ADSTUDIO_API_TIMEOUT_MS || 30000);
const BIG_API_TIMEOUT = 120000; // the 'done' report carries the whole review + log and the server does more work

export const jobIdOf = (runId) => `xk-${runId}`;
const jobDir = (id) => path.join(ROOT, 'data', 'jobs', id);
const STEPS = ['ingest', 'analyze', 'product', 'script', 'generate', 'voice', 'render', 'review'];
const readJSON = async (f) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };

/** a hung request is aborted after `timeoutMs` and throws like any other error, so a run never stalls on the network */
export async function api(action, body = {}, opts = {}) {
  const headers = { 'content-type': 'application/json', 'x-worker-token': WORKER_TOKEN };
  if (BYPASS) headers['x-vercel-protection-bypass'] = BYPASS;
  const res = await fetch(`${APP_URL}/api/worker/adstudio`, { method: 'POST', headers, body: JSON.stringify({ action, workerId: WORKER_ID, ...body }), signal: AbortSignal.timeout(opts.timeoutMs ?? API_TIMEOUT) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${action}: ${res.status} ${j.error || ''}`);
  return j;
}

/** the Ad Studio job.json for a run (see ad-studio pipeline/xark.mjs for what it reads) */
export function jobOf(run) {
  const i = run.input || {};
  const p = i.project || {}; const kit = i.brandKit || {}; const o = i.offer || {}; const br = i.branding || {};
  const wf = i.workflow || 'storyboard'; const ref = wf === 'reference' || wf === 'replace';
  const remix = run.engine === 'remix';
  // the house hook library opening (H01-H35) as a brief, plus the Ad Studio style it maps to (enforced on shot 1)
  const opening = i.opening ? { hookLib: i.opening, ...(i.opening.style && !(remix && i.opening.style === 'ai_talk') ? { hookStyle: i.opening.style } : {}) } : {};
  const common = {
    productUrl: p.productUrl, siteUrl: br.linkUrl || p.brandUrl || kit.landingUrl || '', logoUrl: br.logoUrl || undefined, productImages: br.productImageUrl ? [br.productImageUrl] : undefined, brandName: p.brandName, goal: p.campaignGoal || 'drive purchases', notes: i.notes || '',
    offerText: o.text || kit.offerText || '', offerWas: o.was ?? undefined, offerNow: o.now ?? undefined, offerCode: o.code || '',
    visualMode: ['video', 'slides', 'mixed'].includes(i.visualMode) ? i.visualMode : 'video', // asked in Studio before generation
    ...(i.zeroCost ? { zeroCost: true } : {}), ...(i.fallback ? { fallback: i.fallback } : {}), // budget fallback: $0 slides (adstudio-budget.ts)
    voice: 'auto', music: 'auto', format: i.format || 'auto', engine: remix ? 'remix' : 'generate', videoModel: remix ? undefined : run.engine, budget: BUDGET, approved: false,
    audioProfile: i.soundProfile, pitch: true, maxScenes: 6, created: new Date().toISOString(), ...opening,
  };
  if (ref) {
    // a reference video is the input (Ad Studio's own remake); Xark's research rides along as context
    return {
      id: jobIdOf(run.runId), projectId: 'xark', title: `${wf === 'replace' ? 'Imitate + replace' : 'Imitate'} · ${i.storyboard?.title || 'reference'} · ${run.hookType} · ${run.engine}`,
      source: 'xark-ref', refUrl: i.storyboard?.reference?.url || '', replace: wf === 'replace',
      xark: { runId: run.runId, brandKit: kit, context: i.context || null },
      ...common, hookType: run.hookType === 'keep' ? undefined : run.hookType,
    };
  }
  return {
    id: jobIdOf(run.runId), projectId: 'xark', title: `${i.storyboard?.title || 'Storyboard'} · ${run.hookType} · ${run.engine}`,
    source: 'xark',
    xark: { runId: run.runId, storyboardId: i.storyboard?.id, title: i.storyboard?.title, frameSeconds: i.storyboard?.frameSeconds || 2, frames: i.storyboard?.frames || [], script: i.script || null, brandKit: kit, context: i.context || null },
    ...common, hookType: run.hookType,
  };
}

/** what Xark shows from the plan (spec.json) */
export function planOf(spec) {
  if (!spec) return undefined;
  return {
    concept: spec.concept, hook: { chosen: spec.hook?.chosen, vo: spec.hook?.vo, options: spec.hook_options || [] },
    coverage: spec.xark?.coverage, frames: spec.xark?.frames,
    replace: spec.replace_list, replaceCheck: spec.replace_check, opening: spec.hook_style, endCard: spec.end_card || null, format: spec.format,
    audio: { profile: spec.audio?.profile, music: spec.music, voice: spec.audio?.voice?.name },
    shots: (spec.shots || []).map((s) => ({ dur: s.dur, caption: s.caption, vo: s.vo, visual: s.visual, src_frames: s.src_frames || [] })),
    durationS: +((spec.shots || []).reduce((a, s) => a + (+s.dur || 0), 0)).toFixed(2),
  };
}

/** the step a retried plan resumes at: the first step the last attempt did not finish (a plan already paid for is reused);
 *  a fresh folder or a failure before the script starts from the beginning */
/** a local job that already rendered and was reviewed: nothing left to run */
export const alreadyDone = (st, hasFinal) => st?.state === 'done' && !!hasFinal;

export function resumeFrom(st) {
  if (!st || st.state !== 'failed') return 'ingest';
  const s = STEPS.find((x) => !['done', 'skipped'].includes(st.steps?.[x]));
  return s && STEPS.indexOf(s) > STEPS.indexOf('script') ? s : 'ingest';
}

/** small copies of the AI scenes' key frames for the approval card (the user sees the first frames before paying for video) */
export async function keyframeThumbs(id, spec, put = upload) {
  const out = [];
  for (const [k, sc] of (spec?.gen_scenes || []).entries()) {
    if (sc.continues) continue; // continues the previous clip: no own key frame
    const src = path.join(jobDir(id), 'assets', `kf_${k}.jpg`); if (!existsSync(src)) continue;
    const file = `assets/kfthumb_${k}.jpg`;
    const ok = await new Promise((resolve) => { const p = spawn('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', 'scale=360:-2', '-q:v', '4', path.join(jobDir(id), file)]); p.on('exit', (c) => resolve(c === 0)); p.on('error', () => resolve(false)); });
    const url = ok ? await put(id, file, 'image/jpeg').catch(() => null) : null;
    if (url) out.push({ scene: k, url });
  }
  return out;
}

const progressOf = (st) => {
  const done = STEPS.filter((s) => ['done', 'skipped'].includes(st?.steps?.[s])).length;
  return Math.round((done / STEPS.length) * 100);
};

/** why a run that did not finish failed: a signal-killed pipeline (OOM, SIGKILL) wrote no error of its own */
export const stopReason = (st, signal) => signal ? `pipeline killed by ${signal}` : st?.error || 'pipeline stopped';

const killPid = (pid, sig) => process.kill(pid, sig);
const psCommand = (pid) => execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 });
const pidAlive = (pid, kill) => { try { kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; } };

/** is this job's pipeline still running from an earlier worker (run.mjs is spawned detached, so it outlives a worker restart)?
 *  true only when status.json says running, its pid is alive and that pid's command is `pipeline/run.mjs <jobId>`.
 *  A live pid whose command cannot be read throws (busy): neither adopt a stranger nor start a second paid pipeline. */
export function liveOwner(st, jobId, { kill = killPid, ps = psCommand } = {}) {
  if (st?.state !== 'running' || !Number.isInteger(st.pid) || st.pid <= 0) return false;
  if (!pidAlive(st.pid, kill)) return false;
  let cmd;
  try { cmd = String(ps(st.pid)); } catch {
    if (!pidAlive(st.pid, kill)) return false; // exited in between
    throw Object.assign(new Error(`pipeline still running (pid ${st.pid})`), { busy: true });
  }
  return isJobCommand(cmd, jobId);
}
const isJobCommand = (cmd, jobId) => cmd.includes('pipeline/run.mjs') && cmd.trim().split(/\s+/).includes(jobId);

/** pipelines this worker process is watching, by job id: { pid, claim }. A run requeued after missed heartbeats (API outage,
 *  Mac asleep > STALE_MS) and claimed again by this same process is handed to its watcher (new claim), never watched twice. */
const watching = new Map();

/** run the pipeline as its own process group, report every tick, kill it when Xark says cancel.
 *  `adopt` = the pid of this job's pipeline left running by an earlier worker: watch it instead of spawning a second one.
 *  Returns the exit code, or the signal when the pipeline was killed (code null); both null for an adopted pipeline. */
export async function runPipeline(runId, id, args, claim, { tick = TICK_MS, adopt, kill = killPid, ps = psCommand, watch } = {}) {
  const claimNow = () => watch?.claim ?? claim; // a reclaim by this process switches the claim mid-run
  let exited = null; let pid = adopt;
  if (!adopt) {
    // a host Claude Code session's variables (CLAUDECODE, CLAUDE_CODE_*) make the pipeline's `claude -p` return an empty session
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE/.test(k)));
    const child = spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: 'ignore', env });
    pid = child.pid; child.on('exit', (code, signal) => { exited = { code, signal }; });
  }
  if (watch) watch.pid = pid;
  // adopted: not our child, so watch the pid, and stop when it is no longer this job's run.mjs (pid reused); ps unknown = still ours
  const stillOurs = () => { try { return isJobCommand(String(ps(adopt)), id); } catch { return true; } };
  const running = () => (adopt ? pidAlive(adopt, kill) && stillOurs() : exited === null);
  let cancelled = false; let reclaimed = false;
  while (running()) {
    await sleep(tick);
    const st = await readJSON(path.join(jobDir(id), 'status.json'));
    const spec = await readJSON(path.join(jobDir(id), 'spec.json'));
    const sent = claimNow();
    try {
      const r = await api('progress', { runId, claim: sent, step: st?.step, progress: progressOf(st), log: st?.log?.slice(-60), plan: planOf(spec) });
      // 'reclaimed' is not a user cancel: never kill. Handed to this watcher meanwhile (claim switched) = keep going; else stop watching
      if (r.status === 'reclaimed') { if (sent === claimNow()) { reclaimed = true; break; } continue; }
      if (r.cancel && !cancelled) { cancelled = true; try { kill(-pid, 'SIGTERM'); } catch { /* gone */ } }
    } catch (e) {
      if (/^progress: 409\b/.test(e.message) && sent === claimNow()) { reclaimed = true; break; } // a stale claim, same rule
      console.warn('[adstudio] progress failed:', e.message);
    }
  }
  if (watch) watch.reclaimed = reclaimed;
  return { cancelled, reclaimed, code: exited?.code ?? null, signal: exited?.signal ?? null };
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

/** the run's Xark end card (E01-E12): layers rendered by Xark, saved into the job's assets for the renderer */
async function endCardFiles(runId, dir) {
  try {
    const { endCard, reason } = await api('endcard', { runId });
    if (!endCard?.layers?.length) return { skipped: reason || 'no layers' };
    await mkdir(path.join(dir, 'assets', 'endcard'), { recursive: true });
    const layers = [];
    for (const [k, l] of endCard.layers.entries()) {
      const file = `assets/endcard/l${k}.png`;
      await writeFile(path.join(dir, file), Buffer.from(l.png, 'base64'));
      layers.push({ file, y: l.y, delaySec: l.delaySec, durSec: l.durSec, anim: l.anim, role: l.role });
    }
    return { id: endCard.id, name: endCard.name, theme: endCard.theme, hideButton: endCard.hideButton, layers };
  } catch (e) { console.warn('[adstudio] end card skipped:', e.message); return { skipped: e.message }; }
}

/** upload the finished video and report it */
async function finish(run, id, st) {
  const spec = await readJSON(path.join(jobDir(id), 'spec.json'));
  // a big upload can outlast STALE_MS: keep the heartbeat going so the run is not requeued and generated twice
  const beat = setInterval(() => { api('progress', { runId: run.runId, claim: run.claim, step: 'review', progress: 99 }).catch(() => {}); }, TICK_MS);
  let finalMp4Url, posterUrl;
  try { finalMp4Url = await upload(id, 'final.mp4', 'video/mp4'); posterUrl = finalMp4Url ? await upload(id, 'poster.jpg', 'image/jpeg') : null; } finally { clearInterval(beat); }
  if (!finalMp4Url) return api('failed', { runId: run.runId, claim: run.claim, error: 'final.mp4 missing after render', actualUsd: st.cost });
  return api('done', { runId: run.runId, claim: run.claim, finalMp4Url, posterUrl, review: st.review, metrics: st.review?.metrics, autofix: st.autofix, plan: planOf(spec), actualUsd: st.cost, log: st.log }, { timeoutMs: BIG_API_TIMEOUT });
}

export async function handle(run, opts = {}) {
  const id = jobIdOf(run.runId);
  const mine = watching.get(id);
  if (mine) { // this process already runs or watches it: the new claim goes to that watcher, no second watcher
    console.log(`[adstudio] ${run.phase} ${run.runId}: reclaimed by this worker, handed to the running watcher (pid ${mine.pid ?? 'starting'})`);
    mine.claim = run.claim;
    return { action: 'handed-off' };
  }
  const watch = { pid: null, claim: run.claim };
  watching.set(id, watch);
  try { return await handleOnce(run, watch, opts); } finally { if (watching.get(id) === watch) watching.delete(id); }
}

async function handleOnce(run0, watch, { kill = killPid, ps = psCommand } = {}) {
  // every report goes out under the claim this watcher holds now (a reclaim by this process switches it)
  const run = { ...run0, get claim() { return watch.claim; } };
  const id = jobIdOf(run.runId); const dir = jobDir(id);
  // the server requeued this run (no heartbeat after a worker restart) while its pipeline is still running here: adopt it
  let adopt;
  try {
    const cur = await readJSON(path.join(dir, 'status.json'));
    if (liveOwner(cur, id, { kill, ps })) { adopt = cur.pid; console.log(`[adstudio] ${run.phase} ${run.runId}: adopting the running pipeline (pid ${adopt})`); }
  } catch (e) {
    if (!e?.busy) throw e;
    // no report: 'failed' is final on the server, and a lapsed lease is requeued after STALE_MS and checked again
    console.warn(`[adstudio] ${run.phase} ${run.runId}: ${e.message}, not starting a second one`);
    return { action: 'deferred', error: e.message };
  }
  const end = async (st, cancelled, signal) => {
    if (cancelled) return api('failed', { runId: run.runId, claim: run.claim, error: 'cancelled by the user', cancelled: true, actualUsd: st?.cost, log: st?.log });
    return api('failed', { runId: run.runId, claim: run.claim, error: stopReason(st, signal), actualUsd: st?.cost, log: st?.log });
  };
  if (run.phase === 'plan' || run.phase === 'copy_plan') {
    let from = 'ingest';
    if (!adopt) { // an adopted pipeline already has its job folder: leave job.json and the plan copy alone
      await mkdir(dir, { recursive: true });
      const job = jobOf(run);
      if (run.input?.endCard) { const ec = await endCardFiles(run.runId, dir); if (ec?.layers) job.endCard = ec; else job.endCardSkipped = `${run.input.endCard.id}: ${ec?.skipped}`; }
      await writeFile(path.join(dir, 'job.json'), JSON.stringify(job, null, 1));
      // finished on this Mac already (e.g. completed by hand after the platform ran out of retries): upload it, do not redo it
      const prev = await readJSON(path.join(dir, 'status.json'));
      if (run.phase === 'plan' && alreadyDone(prev, existsSync(path.join(dir, 'final.mp4')))) return finish(run, id, prev);
      // a retried run resumes where the last attempt failed (its script, key frames and gen.json are still in this folder)
      if (run.phase === 'plan') from = resumeFrom(await readJSON(path.join(dir, 'status.json')));
      if (run.phase === 'copy_plan') {
        const c = await new Promise((resolve) => { const p = spawn(process.execPath, ['pipeline/clone.mjs', jobIdOf(run.planFromRunId), id], { cwd: ROOT, stdio: 'inherit' }); p.on('exit', resolve); });
        if (c !== 0) return api('failed', { runId: run.runId, claim: run.claim, error: `could not copy the plan of ${run.planFromRunId}` });
        from = 'generate';
      }
    }
    const { cancelled, signal } = await runPipeline(run.runId, id, ['pipeline/run.mjs', id, from], run.claim, { adopt, kill, ps, watch });
    if (watch.reclaimed) return { action: 'reclaimed' }; // claimed elsewhere: stop watching, the pipeline is left running
    const st = await readJSON(path.join(dir, 'status.json'));
    if (!cancelled && st?.state === 'done') return finish(run, id, st); // free run (stock remix): rendered without an approval stop
    if (cancelled || st?.state !== 'approval') return end(st, cancelled, signal);
    const spec = await readJSON(path.join(dir, 'spec.json'));
    const estimate = { ...st.estimate, keyframes: await keyframeThumbs(id, spec).catch(() => []), warnings: st.warnings || [] };
    return api('gate', { runId: run.runId, claim: run.claim, estimate, plan: planOf(spec), storyboardAB: spec?.storyboard ? { winner: spec.storyboard.winner, scores: spec.storyboard.scores, why: spec.storyboard.why } : undefined, preUsd: st.cost || 0, log: st.log });
  }
  if (run.phase === 'generate') {
    if (!adopt) { // an adopted pipeline was approved and budgeted when it was started
      const job = await readJSON(path.join(dir, 'job.json'));
      if (!job) return api('failed', { runId: run.runId, claim: run.claim, error: 'job folder missing on this Mac' });
      // the frame-QA re-generation may spend up to max(budget, estimate x 1.3): hold it to what Xark reserved
      const budget = typeof run.reserveUsd === 'number' && run.reserveUsd > 0 ? Math.min(job.budget ?? BUDGET, run.reserveUsd) : job.budget;
      await writeFile(path.join(dir, 'job.json'), JSON.stringify({ ...job, approved: true, budget }, null, 1));
    }
    const { cancelled, signal } = await runPipeline(run.runId, id, ['pipeline/run.mjs', id, 'generate'], run.claim, { adopt, kill, ps, watch });
    if (watch.reclaimed) return { action: 'reclaimed' }; // claimed elsewhere: stop watching, the pipeline is left running
    const st = await readJSON(path.join(dir, 'status.json'));
    if (cancelled || st?.state !== 'done') return end(st, cancelled, signal);
    return finish(run, id, st);
  }
  throw new Error(`unknown phase ${run.phase}`);
}

/** how many runs one worker handles at once: a reference-video batch (Mode 1) and a Research→Creative batch (Mode 2) share this pool.
 *  Renders are capped separately by Ad Studio (2 Remotion renders at a time across jobs), so the extra runs wait there, not here. */
const CONC = Math.max(1, Number(process.env.ADSTUDIO_CONCURRENCY || 3));

/** claim and handle runs up to `conc` at a time. `claim` returns a run or null; `once` = handle at most one claim; `exitWhenIdle` = stop when nothing is left (tests).
 *  Logs each run's outcome and duration, and a second claim of a run that is still running here. */
export async function runLoop({ claim, handle: run1, conc = CONC, once = false, exitWhenIdle = false, poll = POLL, maxIdle = MAX_IDLE, sleep: nap = sleep, onError = async () => {}, log = console.log }) {
  const active = new Set(); const activeIds = new Set(); let wait = poll;
  for (;;) {
    if (active.size >= conc) { await Promise.race(active); continue; }
    let run = null;
    try { run = await claim(); } catch (e) { console.warn('[adstudio] claim failed:', e.message); }
    if (run) {
      if (activeIds.has(run.runId)) log(`[adstudio] duplicate claim of ${run.runId} (already active here)`);
      activeIds.add(run.runId); const t0 = Date.now();
      const took = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
      const p = (async () => {
        try { const result = await run1(run); log(`[adstudio] ${run.phase} ${run.runId} -> ${result?.action ?? result?.cancel ?? 'done'} in ${took()}`); }
        catch (e) { log(`[adstudio] ${run.phase} ${run.runId} -> error: ${e?.message || e} in ${took()}`); await onError(run, e); }
      })().finally(() => { active.delete(p); activeIds.delete(run.runId); });
      active.add(p); wait = poll;
      if (once) { await p; return; }
      continue;
    }
    if (once) return;
    if (active.size) { await Promise.race([...active, nap(poll)]); continue; } // keep claiming while others run
    if (exitWhenIdle) return;
    await nap(wait); wait = Math.min(maxIdle, wait * 2);
  }
}

async function main() {
  if (!WORKER_TOKEN) { console.error('WORKER_TOKEN is required'); process.exit(1); }
  if (!APP_URL) { console.error('APP_URL is required (e.g. http://localhost:3200 for the lab, https://creative.account.xark.io for production)'); process.exit(1); }
  await runLoop({
    claim: async () => { const run = (await api('claim')).run; if (run) console.log(`[adstudio] ${run.phase} ${run.runId} (${run.hookType} / ${run.engine})`); return run; },
    handle,
    once: process.argv.includes('--once'),
    onError: async (run, e) => {
      console.error('[adstudio] run failed:', e);
      const st = await readJSON(path.join(jobDir(jobIdOf(run.runId)), 'status.json')); // what was already spent is still booked
      await api('failed', { runId: run.runId, claim: run.claim, error: String(e.message || e), actualUsd: st?.cost, log: st?.log }).catch(() => {});
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
