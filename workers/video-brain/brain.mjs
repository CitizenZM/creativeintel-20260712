#!/usr/bin/env node
// Video Brain — supervisor loop for Xark Studio (creative.xark.io) + Ad Studio (Mac worker).
// One tick: observe (DB via /api/worker/brain) -> think (lib/think.mjs) -> act (auto-approve within caps, retry transient
// failures) -> second check finished videos (ffprobe/loudness/URL/cost) -> incidents -> capability probes -> fix-pattern
// scan -> learnings (seed + harvest, synced to skills and the pipeline) -> publish the snapshot, then re-read it.
// Design: ~/Projects/ad-studio-20261104/docs/VIDEO-BRAIN-ARCHITECTURE-20261117.md
//
// Env: APP_URL, WORKER_TOKEN (same file as the adstudio worker: ~/.config/adstudio-worker/prod.env),
//      AD_STUDIO_ROOT (default ~/Projects/ad-studio-20261104), VIDEO_BRAIN_HOME (default ~/.config/video-brain),
//      VIDEO_BRAIN_SKILLS_DIR (default ~/.claude/skills)
// Flags: --once (one tick, default when run by launchd StartInterval) · --loop (tick every 5 min) · --dry-run (read-only:
//        no approve/retry/batch/publish/sync, no critic/strategist/digest/rules PR/harvest, no state write, no lock) · --learn "<rule>" --scope <s> --evidence <id> (add a learning and exit)
// Prints one __VIDEO_BRAIN__{json} line per tick. Exit 0 ok (or another live tick holds VIDEO_BRAIN_HOME/tick.pid) ·
// 1 publish failed/unverified · 2 observe failed.
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { think, approvals, retries, batchCandidates, fundsRetries } from './lib/think.mjs';
import { aggregate } from './lib/incidents.mjs';
import { secondCheck, LUFS_TRIES, loudnessNotMeasured } from './lib/verify.mjs';
import { runProbes } from './lib/probes.mjs';
import { scanRoots } from './lib/patterns.mjs';
import { SEED, harvest, idOf, syncAll } from './lib/learn.mjs';
import { pick, promptFor, runClaude, apply as applyStrategy, memoFor } from './lib/strategist.mjs';
import { readLocal } from './lib/local.mjs';
import { readBatches } from './lib/batch.mjs';
import { loadWorkstreams } from './lib/jobs.mjs';
import { harvestDirectives, loadDirectives } from './lib/knowledge.mjs';
import { proposeRules } from './lib/rules-pr.mjs';
import { buildDigest, digestDue, sendDigest, verifyDigest } from './lib/digest.mjs';
import { critique, withCritic, MAX_PER_DAY as CRITIC_PER_DAY } from './lib/critic.mjs';
import { envKey } from './lib/probes.mjs';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] ?? d : d; };
const HOME = process.env.VIDEO_BRAIN_HOME || path.join(homedir(), '.config', 'video-brain');
const ROOT = process.env.AD_STUDIO_ROOT || path.join(homedir(), 'Projects', 'ad-studio-20261104');
const SKILLS_DIR = process.env.VIDEO_BRAIN_SKILLS_DIR || path.join(homedir(), '.claude', 'skills');
export const SKILLS = ['ad-studio', 'video-shotcraft', 'hypit', 'video-use', 'video-ads-playbook', 'proposal-content-video'];
const PATTERN_ROOTS = [path.join(ROOT, 'pipeline'), path.join(ROOT, 'renderer', 'src'), path.join(homedir(), 'Projects', 'acw-bf-videos-20261116'), path.join(homedir(), 'Projects', 'motion-video-editing-repos-20261101'), path.join(homedir(), 'Projects', 'video short craft'), ...SKILLS.map((s) => path.join(SKILLS_DIR, s))];
const PROBE_EVERY_MS = 30 * 60_000, PATTERN_EVERY_MS = 6 * 3_600_000, CHECKS_PER_TICK = 3;
export const DIGEST_VERIFY_TRIES = 3, STALLED_REMIND_MS = 24 * 3_600_000;
export const CHECK_BUDGET_MS = Number(process.env.VIDEO_BRAIN_CHECK_BUDGET_MS || 120_000);
const log = (m) => console.error(`[video-brain ${new Date().toISOString()}] ${m}`);

/** replace a file by rename from a temp file in the same dir (a crash mid-write never leaves a truncated state.json) */
export async function writeAtomic(f, data) {
  const tmp = `${f}.${process.pid}.tmp`;
  try { await writeFile(tmp, data); await rename(tmp, f); } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** process start time ('' when unknown): a pid reused by another process after a reboot/SIGTERM has a different one */
const startOf = (pid) => { try { return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 5_000 }).trim(); } catch { return ''; } };
export const LOCK_MAX_AGE_MS = 15 * 60_000;
/**
 * one tick at a time per VIDEO_BRAIN_HOME: pidfile "<pid>\n<start time>", created atomically (O_EXCL). Another holder is
 * respected only while its pid is alive, its start time matches (when recorded) and the file is < 15 min old; otherwise
 * the file is moved aside and recreated with O_EXCL — losing that create to another process means it is theirs.
 * Synchronous so a signal handler can release it. Returns { ok, pid, release() }.
 */
export function acquireLock(home, { now = Date.now(), beforeCreate = null } = {}) {
  const f = path.join(home, 'tick.pid');
  mkdirSync(home, { recursive: true });
  const mine = `${process.pid}\n${startOf(process.pid)}`;
  const create = () => {
    try { const fd = openSync(f, 'wx'); try { writeSync(fd, mine); } finally { closeSync(fd); } } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
    return true;
  };
  const release = () => { try { if (readFileSync(f, 'utf8') === mine) unlinkSync(f); } catch { /* gone already */ } };
  const won = { ok: true, pid: process.pid, release };
  if (create()) return won;
  let held; let mtime;
  try { held = readFileSync(f, 'utf8'); mtime = statSync(f).mtimeMs; } catch { held = null; }
  if (held != null) {
    // empty and < 10 s old: the holder is between open('wx') and its write
    if (!held.trim() && now - mtime < 10_000) return { ok: false, pid: null };
    const [p, start = ''] = held.split('\n'); const pid = Number(p.trim());
    // stale by start time only when both are known and differ (ps failing or timing out must not steal a live lock)
    const s = pid > 0 && start.trim() ? startOf(pid) : '';
    const live = pid > 0 && alive(pid) && now - mtime < LOCK_MAX_AGE_MS && (!start.trim() || !s || s === start.trim());
    if (live) return { ok: false, pid };
    // stale: move it aside and check we moved the stale file, not a lock someone else just created
    const aside = `${f}.stale.${process.pid}`;
    try { renameSync(f, aside); } catch { return { ok: false, pid: null } }
    const moved = readFileSync(aside, 'utf8');
    if (moved !== held) { try { linkSync(aside, f); } catch { /* a third holder exists */ } unlinkSync(aside); return { ok: false, pid: null }; }
    unlinkSync(aside);
  }
  beforeCreate?.();
  return create() ? won : { ok: false, pid: null };
}

export function api(appUrl, token) {
  return async (action, body = {}) => {
    const r = await fetch(`${appUrl.replace(/\/+$/, '')}/api/worker/brain`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-worker-token': token, ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) }, body: JSON.stringify({ action, ...body }), signal: AbortSignal.timeout(90_000) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  };
}

const readJSON = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
const ev = (agent, kind, summary, projectId = null, ref = null) => ({ at: new Date().toISOString(), agent, kind, summary, projectId, ref });

/** second-family critic with the Ad Studio OpenRouter key (null when no key) */
export async function defaultCritic(video, durationSec) {
  const key = process.env.OPENROUTER_API_KEY || (await envKey(path.join(ROOT, '.env.local'), 'OPENROUTER_API_KEY'));
  if (!key) throw new Error('no OPENROUTER_API_KEY');
  return critique(video, durationSec, key);
}

/** approve a local Ad Studio job at its spend gate (same caps; the local API books it in data/spend.json) */
export async function localApprove(jobId, base = process.env.AD_STUDIO_URL || 'http://127.0.0.1:5310') {
  const r = await fetch(`${base}/api/jobs/${encodeURIComponent(jobId)}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approve: true }), signal: AbortSignal.timeout(30_000) });
  const back = await fetch(`${base}/api/jobs/${encodeURIComponent(jobId)}`, { signal: AbortSignal.timeout(30_000) }).then((x) => x.json()).catch(() => null);
  return { ok: r.ok && back?.status?.state !== 'approval', status: r.status, state: back?.status?.state ?? null };
}

export async function tick({ call, dryRun = false, now = Date.now(), home = HOME, skillsDir = SKILLS_DIR, adStudioRoot = ROOT, strategist = process.env.VIDEO_BRAIN_STRATEGIST === '0' ? null : runClaude, local = async () => { const [a, b] = await Promise.all([readLocal(ROOT), readBatches()]); return { projects: [...a.projects, ...b.projects], stages: [...a.stages, ...b.stages], runs: [...a.runs, ...b.runs] }; }, approveLocal = localApprove, notify = process.env.VIDEO_BRAIN_DIGEST === '0' ? null : sendDigest, verifyNotify = process.env.VIDEO_BRAIN_DIGEST === '0' ? null : verifyDigest, critic = process.env.VIDEO_BRAIN_CRITIC === '0' ? null : defaultCritic, rulesPr = process.env.VIDEO_BRAIN_RULES_PR === '0' ? null : (l, s, d) => proposeRules(ROOT, l, s, { directives: d }), harvestDirs = process.env.VIDEO_BRAIN_HARVEST === '0' ? null : (ws) => harvestDirectives({ workstreams: ws }), saveState = (f, s) => writeAtomic(f, JSON.stringify(s)), check = secondCheck } = {}) {
  if (!dryRun) await mkdir(home, { recursive: true }); // dry-run never writes the state dir
  const stateFile = path.join(home, 'state.json');
  const state = await readJSON(stateFile, { checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, syncHash: null });
  const events = [];
  // per-phase wall time (integer ms) for the __VIDEO_BRAIN__ line
  const phaseMs = {}; let mark = Date.now();
  const lap = (k) => { const t = Date.now(); phaseMs[k] = (phaseMs[k] || 0) + (t - mark); mark = t; };
  const obs = await call('observe');
  if (obs.status !== 200 || !Array.isArray(obs.projects)) throw new Error(`observe: HTTP ${obs.status} ${obs.error || ''}`);
  // local Ad Studio jobs join the observation (Xark-managed xk-* jobs are grouped as the lab project)
  const loc = await local().catch((e) => { log(`local jobs: ${e.message}`); return { projects: [], stages: [], runs: [] }; });
  obs.projects = [...obs.projects, ...loc.projects]; obs.stages = [...obs.stages, ...loc.stages]; obs.runs = [...obs.runs, ...loc.runs];
  const today = new Date(now).toISOString().slice(0, 10);
  state.localApproved = state.localApproved?.day === today ? state.localApproved : { day: today, usd: 0 };
  obs.spend.autoApprovedTodayUsd = (obs.spend.autoApprovedTodayUsd || 0) + state.localApproved.usd;
  lap('observe');

  // ACT 1 — gate: approve within the autonomy caps (server re-checks); never wait silently on our own gate
  let approvedNow = 0;
  for (const a of approvals(obs.runs, obs.policy, obs.spend.autoApprovedTodayUsd || 0, now)) {
    const key = `approve:${a.run.id}`;
    if (state.acted[key] === 'approved') continue;
    if (!a.ok) { if (!state.acted[key]) { events.push(ev('Producer', 'wait', `run ${a.run.id.slice(-6)} held at the gate: ${a.reason}`, a.run.projectId, a.run.id)); state.acted[key] = 'held'; } continue; }
    if (dryRun) { events.push(ev('Producer', 'decide', `[dry-run] would approve ${a.run.id.slice(-6)} ($${a.reserveUsd})`, a.run.projectId, a.run.id)); continue; }
    const r = a.run.local ? await approveLocal(a.run.id.replace(/^local:/, '')).catch((e) => ({ ok: false, error: e.message })) : await call('approve', { runId: a.run.id, why: `brain: reservation $${a.reserveUsd} within caps` });
    if (r.ok && a.run.local) state.localApproved.usd += a.reserveUsd;
    if (r.ok) obs.spend.autoApprovedTodayUsd = (obs.spend.autoApprovedTodayUsd || 0) + a.reserveUsd; // this tick's approvals count in the snapshot
    events.push(ev('Producer', 'decide', r.ok ? `auto-approved run ${a.run.id.slice(-6)} · reserve $${a.reserveUsd} · re-read: approved` : `approve refused for ${a.run.id.slice(-6)}: ${r.reason || r.error}`, a.run.projectId, a.run.id));
    if (r.ok) approvedNow += 1;
    state.acted[key] = r.ok ? 'approved' : 'refused';
  }
  // ACT 2 — recover: retry transient failures once per run per day
  const fundsOk = !(state.probes || []).some((p) => p.name === 'openrouter balance' && !p.ok);
  // while the budget is out only $0 work is retried: budget-fallback slides (no model spend)
  for (const r of retries(obs.runs, now).filter((x) => fundsOk || x.fallback === 'budget')) {
    const key = `retry:${r.id}:${new Date(now).toISOString().slice(0, 10)}`;
    if (state.acted[key]) continue;
    if (dryRun) { events.push(ev('Producer', 'decide', `[dry-run] would retry ${r.id.slice(-6)}`, r.projectId, r.id)); continue; }
    state.acted[key] = 'tried';
    const out = await call('retry', { runId: r.id, why: `brain: transient failure: ${String(r.error).slice(0, 80)}` });
    events.push(ev('Producer', 'call', out.ok ? `retried failed run ${r.id.slice(-6)} → ${out.status}` : `retry refused ${r.id.slice(-6)}: ${out.error}`, r.projectId, r.id));
  }

  lap('act');
  // VERIFY — second check of finished videos (a few per tick, newest first)
  const toCheck = obs.runs.filter((r) => r.status === 'completed' && (r.finalMp4Url || r.finalPath) && !state.checks[r.id]).slice(0, CHECKS_PER_TICK);
  const tickStart = Date.now();
  state.lufsTries = state.lufsTries || {};
  if (!dryRun) { const seen = new Set(obs.runs.map((r) => r.id)); for (const id of Object.keys(state.lufsTries)) if (!seen.has(id)) delete state.lufsTries[id]; }
  for (const r of toCheck) {
    if (Date.now() - tickStart > CHECK_BUDGET_MS) { events.push(ev('QA Critic', 'wait', `second checks paused for this tick (time budget ${CHECK_BUDGET_MS / 1000}s); rest next tick`)); break; }
    try {
      let c = await check(r);
      if (c.loudnessMissing) {
        // audio present but not measured: retry next tick; after LUFS_TRIES store it with loudness 'not measured' failing
        const n = (state.lufsTries[r.id] || 0) + 1;
        if (n < LUFS_TRIES) { state.lufsTries[r.id] = n; log(`check ${r.id}: loudness not measured (try ${n}/${LUFS_TRIES}), retry next tick`); continue; }
        c = loudnessNotMeasured(c);
      }
      delete state.lufsTries[r.id];
      const day = new Date(now).toISOString().slice(0, 10);
      state.criticDay = state.criticDay?.day === day ? state.criticDay : { day, n: 0 };
      const dur = Number((c.fields.find((f) => f.field === 'duration')?.actual || '').replace(/[^0-9.]/g, ''));
      if (critic && !dryRun && dur > 0 && state.criticDay.n < CRITIC_PER_DAY) {
        state.criticDay.n += 1;
        try { const cr = await critic(r.finalMp4Url || r.finalPath, dur); c = withCritic(c, cr); events.push(ev('QA Critic', 'check', `${cr.model} on ${r.id.slice(-6)}: avg ${cr.avg}${cr.scores.issues?.length ? ' — ' + cr.scores.issues[0] : ''}`, r.projectId, r.id)); }
        catch (e) { state.criticDay.n -= 1; log(`critic ${r.id}: ${e.message} (quota refunded; check stored without the critic)`); }
      }
      state.checks[r.id] = c;
      const bad = c.fields.filter((f) => !f.pass).map((f) => `${f.field} ${f.actual}`);
      events.push(ev('QA Critic', 'check', c.pass ? `second check passed: run ${r.id.slice(-6)} (${c.fields.length} fields)` : `second check FAILED run ${r.id.slice(-6)}: ${bad.join('; ')}`, r.projectId, r.id));
    } catch (e) { log(`check ${r.id}: ${e.message}`); }
  }

  lap('checks');
  // INCIDENTS
  const before = Object.keys(state.incidents).length;
  state.incidents = aggregate(state.incidents, obs.runs, now); // all runs: a listed run seen completed resolves as 'recovered'
  if (Object.keys(state.incidents).length > before) events.push(ev('Doctor', 'think', `${Object.keys(state.incidents).length - before} new incident signature(s)`));

  // PROBES + PATTERNS (slower cadence)
  if (!state.probesAt || now - Date.parse(state.probesAt) > PROBE_EVERY_MS) {
    const prev = Object.fromEntries((state.probes || []).map((p) => [p.name, p.ok]));
    state.probes = await runProbes({ adStudioRoot: ROOT, obs });
    state.probesAt = new Date(now).toISOString();
    for (const p of state.probes) if (prev[p.name] !== p.ok) events.push(ev('Doctor', 'check', `capability ${p.name}: ${p.ok ? 'OK' : 'FAIL'} — ${p.detail}`));
  }

  // BUDGET (Barron 2026-11-18): the platform plans every new/queued run as $0 slides while the model budget is out, video when back
  const balance = (state.probes || []).find((p) => p.name === 'openrouter balance');
  const budgetOut = !!balance && !balance.ok;
  if (!dryRun) {
    const r = await call('budget', { out: budgetOut, detail: balance?.detail || '' });
    if (state.budgetOut !== budgetOut) events.push(ev('Producer', 'decide', budgetOut ? `model budget out (${balance?.detail}): new and queued runs are planned as $0 slides (fallback: budget)` : 'model budget back: new runs are video again; slides made during the outage are listed as "can upgrade to video"'));
    if (r.ok) state.budgetOut = budgetOut;
  }
  // runs that failed only for lack of funds are retried once: while the budget is out they come back as $0 slides, after it as video
  for (const r of dryRun ? [] : fundsRetries(obs.runs, now)) {
    const key = `fundsretry:${r.id}`; if (state.acted[key]) continue; state.acted[key] = 'tried';
    const out = await call('retry', { runId: r.id, why: budgetOut ? 'brain: model budget out - re-plan as $0 slides' : 'brain: model budget restored' });
    events.push(ev('Producer', 'call', out.ok ? `retried run ${r.id.slice(-6)} that failed for lack of funds → ${out.status}${budgetOut ? ' (will be $0 slides)' : ''}` : `retry refused ${r.id.slice(-6)}: ${out.error}`, r.projectId, r.id));
  }
  if (!state.patternsAt || now - Date.parse(state.patternsAt) > PATTERN_EVERY_MS) {
    state.patterns = await scanRoots(PATTERN_ROOTS);
    state.patternsAt = new Date(now).toISOString();
    events.push(ev('Doctor', 'fix', `fix-pattern scan: ${state.patterns.length} open hit(s) across ${PATTERN_ROOTS.length} roots`));
  }

  lap('probes');
  // LEARN — seed + harvest, merged with the server store; sync projections when anything changed
  const fresh = harvest({ incidents: state.incidents, checks: state.checks });
  const byId = new Map([...SEED, ...(obs.learnings || []), ...fresh].map((l) => [l.id, l]));
  for (const l of obs.learnings || []) byId.set(l.id, { ...byId.get(l.id), ...l }); // server edits win (status changes)
  const learnings = [...byId.values()];
  // workstream directives: config + Barron's instructions harvested once a day from session transcripts (candidates until confirmed)
  let directives = null;
  try {
    const config = await loadWorkstreams();
    if (harvestDirs && !dryRun && (!state.directivesAt || now - Date.parse(state.directivesAt) > 86_400_000)) {
      state.directivesAt = new Date(now).toISOString();
      const fresh = await harvestDirs(config.workstreams);
      if (fresh.length) events.push(ev('Librarian', 'learn', `${fresh.length} instruction(s) of Barron's harvested from sessions as candidates; confirm with xark-job directive confirm <id>`));
    }
    directives = { config, harvested: await loadDirectives() };
  } catch (e) { log(`directives: ${e.message}`); }
  const hash = createHash('sha1').update(JSON.stringify([learnings.map((l) => [l.id, l.status, l.rule]), directives])).digest('hex');
  let synced = state.synced || [];
  if (!dryRun) {
    // same hash: re-render with the last sync time so on-disk blocks that drifted (hand edits, a stray writer) are repaired;
    // matching files are not rewritten. No syncAt yet (older state): full sync.
    const newHash = hash !== state.syncHash || !state.syncAt;
    const at = newHash ? new Date(now).toISOString() : state.syncAt;
    const r = await syncAll(learnings, { skillsDir, skills: SKILLS, adStudioRoot, at, directives });
    synced = r.synced; state.syncHash = hash; state.syncAt = at; state.synced = synced;
    if (newHash) events.push(ev('Librarian', 'learn', `learnings synced (${learnings.length}) → ${synced.length} targets`));
    else if (r.changed.length) events.push(ev('Librarian', 'learn', `learnings repaired: ${r.changed.length} file(s) drifted from the brain's block and were re-synced (${r.changed.map((f) => path.basename(path.dirname(f)) + '/' + path.basename(f)).join(', ')})`));
  }
  for (const l of learnings) l.syncedTo = synced;
  // rules that change the script prompt go through a PR on the Ad Studio repo (Barron merges or vetoes)
  if (rulesPr && !dryRun && (!state.rulesCheckedAt || now - Date.parse(state.rulesCheckedAt) > 3_600_000)) {
    state.rulesCheckedAt = new Date(now).toISOString();
    try {
      const r = await rulesPr(learnings, state.rulesPr || {}, directives);
      if (r.action === 'opened') { state.rulesPr = { hash: r.hash, url: r.url }; events.push(ev('Librarian', 'learn', `rules PR opened for the script prompt: ${r.url}`)); }
      else if (r.action === 'none') state.rulesPr = {};
      // r.action === 'failed': this hash failed < 24 h ago; wait (plan retries it after a day)
    } catch (e) {
      log(`rules PR: ${e.message}`);
      const prev = state.rulesPr || {};
      const step = e.step || 'rules PR';
      // one event per new hash or failing step (test output tails carry timings, so the raw text differs on every run)
      if (prev.failedHash !== e.hash || prev.failedStep !== step) events.push(ev('Librarian', 'learn', `rules PR blocked: ${step} for ${e.hash || 'unknown'}`));
      state.rulesPr = { ...prev, failedHash: e.hash, failedStep: step, failedAt: new Date(now).toISOString(), error: String(e.message).slice(-400) };
    }
  }

  lap('learn');
  // THINK (rules first; the strategist model only for stalled or measuring projects, once a day each)
  const t = think(obs, state.checks, now, { budgetOut });
  state.strategy = state.strategy || {};
  if (strategist && !dryRun) {
    for (const l of pick(t.loops, state.strategy, now)) {
      try {
        const out = await strategist(promptFor(l, obs, learnings));
        state.strategy[l.projectId] = memoFor(l, out, now);
        events.push(ev('Strategist', 'think', `${l.name}: ${out.hypothesis} → ${out.nextAction} (check: ${out.verifyHow})`, l.projectId));
      } catch (e) { log(`strategist ${l.projectId}: ${e.message}`); state.strategy[l.projectId] = { at: new Date(now).toISOString(), day: new Date(now).toISOString().slice(0, 10), error: e.message }; }
    }
  }
  // ACT 3 — push: a ready storyboard with nothing produced gets one Ad Studio variant (it stops at the spend gate)
  state.batched = state.batched || {};
  for (const l of batchCandidates(t.loops, state.batched, now)) {
    if (dryRun) { events.push(ev('Producer', 'decide', `[dry-run] would start an Ad Studio batch for ${l.name}`, l.projectId)); continue; }
    state.batched[l.projectId] = new Date(now).toISOString();
    const r = await call('batch', { projectId: l.projectId, why: 'storyboard ready, nothing produced' });
    events.push(ev('Producer', 'call', r.ok ? `started an Ad Studio batch for ${l.name} (${budgetOut ? '$0 slides: model budget out' : '1 variant, Seedance 2.0 Fast; spend waits at the gate'}) · re-read: queued` : `batch not started for ${l.name}: ${r.reason || r.error || r.status}`, l.projectId, r.runs?.[0]?.id || null));
  }
  // slides made during a budget outage: "can upgrade to video" (a paid re-run needs approval; never automatic)
  const upgradable = obs.runs.filter((r) => !r.local && r.status === 'completed' && r.fallback === 'budget');
  for (const r of upgradable) t.recovery.push({ id: r.id, projectId: r.projectId, kind: 'followup', title: `可升级为视频 (budget-fallback slides) · ${r.hookType || ''}`, status: budgetOut ? 'queued' : 'gated', step: null, progress: 100, estUsd: 0, actualUsd: r.actualUsd ?? null, gates: [{ gate: 'upgrade to video', pass: !budgetOut, detail: budgetOut ? 'model budget still out' : 'budget back: approve a video re-run in Studio' }], agent: 'Barron', updatedAt: new Date(r.updatedAt).toISOString() });
  t.loops = applyStrategy(t.loops, Object.fromEntries(Object.entries(state.strategy).filter(([, m]) => m.out)), now);
  for (const l of t.loops) {
    const k = `${l.step}|${l.stage}|${l.status}`;
    if (state.loopStatus[l.projectId] !== k) { events.push(ev(l.agent, 'think', `${l.name}: ${l.doing} → next: ${l.nextAction}`, l.projectId)); state.loopStatus[l.projectId] = k; }
  }
  const idle = t.loops.filter((l) => l.status === 'idle-defect');
  // one event when the stalled set changes, plus one reminder per 24 h (not every tick)
  const stalledKey = idle.map((l) => l.projectId).sort().join(',');
  const prevStalled = state.stalled || {};
  if (!idle.length) state.stalled = { key: '', at: null };
  else if (prevStalled.key !== stalledKey || !prevStalled.at || now - Date.parse(prevStalled.at) >= STALLED_REMIND_MS) {
    events.push(ev('Brain', 'think', `${idle.length} project(s) stalled without a legal wait: ${idle.slice(0, 4).map((l) => `${l.name} @${l.step}`).join(', ')}`));
    state.stalled = { key: stalledKey, at: new Date(now).toISOString() };
  }
  lap('think');

  const lastWorker = (obs.heartbeats || []).filter((h) => /adstudio/i.test(h.workerId)).map((h) => h.lastSeenAt).sort().pop() || null;
  const snapshot = {
    v: 1, at: new Date(now).toISOString(), tickMs: Date.now() - now, host: hostname(),
    stageCounts: t.stageCounts,
    spend: { todayUsd: Math.round((obs.spend.todayUsd || 0) * 100) / 100, capUsd: obs.policy.maxDayUsd, autoApprovedTodayUsd: Math.round((obs.spend.autoApprovedTodayUsd || 0) * 100) / 100 },
    worker: { lastSeenAt: lastWorker, ok: !!lastWorker && now - Date.parse(lastWorker) < 10 * 60_000 },
    loops: t.loops, queue: t.queue, executing: t.executing,
    checks: Object.values(state.checks).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40),
    recovery: t.recovery,
    incidents: Object.values(state.incidents).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1)).slice(0, 40),
    probes: state.probes, patterns: state.patterns.slice(0, 100), learnings, events, rulesPr: state.rulesPr?.url ? state.rulesPr : null, budget: { out: budgetOut, detail: balance?.detail || null }, upgradable: upgradable.map((r) => ({ runId: r.id, projectId: r.projectId })),
  };
  // prune local state
  for (const k of Object.keys(state.acted)) if (/^retry:/.test(k) && !k.endsWith(new Date(now).toISOString().slice(0, 10))) delete state.acted[k];
  if (dryRun) { lap('publish'); return { ok: true, dryRun: true, snapshot, approvedNow, phaseMs }; }
  await saveState(stateFile, state);
  // actions of the last 24 h for the daily digest
  state.actions = [...(state.actions || []), ...events.filter((e) => ['decide', 'call', 'fix'].includes(e.kind)).map((e) => ({ at: e.at, kind: e.kind }))].filter((a) => now - Date.parse(a.at) < 86_400_000);
  // daily digest, AT MOST ONCE per Pacific day: the day and a pending entry are persisted BEFORE the send; a pending entry
  // with a messageId is only read back (<= DIGEST_VERIFY_TRIES); one without (send threw, no message_id, crash) is never resent
  const pend = state.digestPending;
  if (pend && !pend.messageId) {
    events.push(ev('Brain', 'check', `daily digest send outcome unknown, not resent (${pend.day})`));
    delete state.digestPending;
    await saveState(stateFile, state);
  } else if (pend) {
    pend.tries = (pend.tries || 0) + 1;
    const v = verifyNotify ? await verifyNotify(pend.messageId, pend.text).catch((e) => ({ ok: false, reasons: [e.message] })) : { ok: false, reasons: ['no read-back available'] };
    if (v.ok) { events.push(ev('Brain', 'check', `daily digest read back: verified (${pend.day})`)); delete state.digestPending; }
    else if (!verifyNotify || pend.tries >= DIGEST_VERIFY_TRIES) { events.push(ev('Brain', 'check', `daily digest sent, unverified (${pend.day}) after ${pend.tries} read-back(s): ${(v.reasons || []).join('; ') || 'not found'} (not re-sent)`)); delete state.digestPending; }
    await saveState(stateFile, state);
  }
  const day = notify && digestDue(state.digestDay, now);
  if (day) {
    const text = buildDigest(snapshot, state.actions);
    const before = { digestDay: state.digestDay, digestPending: state.digestPending };
    state.digestDay = day; state.digestPending = { day, messageId: null, text, tries: 0, sending: true };
    // if this write fails nothing is sent (the error propagates; the tick reports it)
    try { await saveState(stateFile, state); } catch (e) { Object.assign(state, before); if (!before.digestPending) delete state.digestPending; throw e; }
    const d = await notify(text).catch((e) => ({ ok: false, reason: e.message }));
    if (d.ok) delete state.digestPending;
    else if (d.messageId) Object.assign(state.digestPending, { messageId: d.messageId, sending: false });
    else delete state.digestPending; // outcome unknown: reported now, never resent
    events.push(ev('Brain', 'call', d.ok ? `daily digest sent to Barron (Feishu DM, read back: verified)` : d.messageId ? `daily digest sent to Barron (Feishu DM); read-back not verified yet: ${(d.reasons || []).join('; ') || 'no detail'} — re-checking, no re-send` : `daily digest NOT delivered: ${d.reason || (d.reasons || []).join('; ') || 'no message id'} — send outcome unknown, not resent today`));
    await saveState(stateFile, state);
  }
  const pub = await call('publish', { snapshot });
  lap('publish');
  return { ok: !!pub.ok, verified: !!pub.verified, bytes: pub.bytes, error: pub.error, snapshot, approvedNow, phaseMs };
}

/** the one-line tick summary launchd logs (keys are stable; phaseMs added 2026-11-26) */
export function statusLine(r, started) {
  const s = r.snapshot;
  return `__VIDEO_BRAIN__${JSON.stringify({ ok: r.ok, verified: r.verified ?? null, dryRun: !!r.dryRun, ms: Date.now() - started, loops: s.loops.length, stages: s.stageCounts, queue: s.queue.length, executing: s.executing.length, recovery: s.recovery.length, checks: s.checks.length, incidents: s.incidents.length, probesFailing: s.probes.filter((p) => !p.ok).map((p) => p.name), patterns: s.patterns.length, learnings: s.learnings.length, events: s.events.length, approvedNow: r.approvedNow, bytes: r.bytes ?? null, error: r.error ?? null, phaseMs: r.phaseMs ?? null })}`;
}

async function main() {
  const appUrl = process.env.APP_URL; const token = process.env.WORKER_TOKEN;
  if (!appUrl || !token) { console.error('APP_URL and WORKER_TOKEN are required (source ~/.config/adstudio-worker/prod.env)'); return 2; }
  const call = api(appUrl, token);
  if (arg('learn')) {
    const rule = arg('learn'); const scope = arg('scope', 'global');
    const r = await call('learn', { learning: { id: idOf(scope, rule), at: new Date().toISOString(), who: arg('who', 'session'), scope, rule, evidence: arg('evidence') ? [arg('evidence')] : [], status: arg('status', 'candidate') } });
    console.log(`__VIDEO_BRAIN_LEARN__${JSON.stringify(r)}`); return r.ok ? 0 : 1;
  }
  const once = async () => {
    const started = Date.now();
    try {
      const r = await tick({ call, dryRun: flag('dry-run') });
      console.log(statusLine(r, started));
      return r.ok ? 0 : 1;
    } catch (e) {
      const cause = e.cause?.code || e.cause?.message;
      log(`${e.stack || e.message}${cause ? `\n  cause: ${cause}` : ''}`);
      console.log(`__VIDEO_BRAIN__${JSON.stringify({ ok: false, error: cause ? `${e.message} (${cause})` : e.message })}`);
      return 2;
    }
  };
  // one live tick per state dir (launchd StartInterval can overlap a slow tick); a dry-run reads only and needs no lock
  const lock = flag('dry-run') ? null : acquireLock(HOME);
  if (lock && !lock.ok) { log(lock.pid ? `another tick is running (pid ${lock.pid}); exiting` : 'another tick took the lock first; exiting'); return 0; }
  // launchd stops jobs with SIGTERM: drop our pidfile synchronously so the next tick is not blocked by it
  if (lock) for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130]]) process.once(sig, () => { lock.release(); process.exit(code); });
  const touch = () => { try { const t = new Date(); utimesSync(path.join(HOME, 'tick.pid'), t, t); } catch { /* released */ } };
  try {
    if (!flag('loop')) return await once();
    for (;;) { if (lock) touch(); await once(); await new Promise((r) => setTimeout(r, Number(process.env.VIDEO_BRAIN_TICK_MS || 300_000))); }
  } finally { lock?.release(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then((c) => process.exit(c));
