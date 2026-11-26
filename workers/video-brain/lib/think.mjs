// The brain's thinking, pure: observation -> per-project loops, task lists, decisions. No IO here.
// Design: ad-studio-20261104/docs/VIDEO-BRAIN-ARCHITECTURE-20261117.md §2 (7 stages) and §3 (only 3 legal waits).
import { canAutoApprove, reserveUsd } from './policy.mjs';
import { classify } from './incidents.mjs';
import { PIPELINE_BASELINE } from './learn.mjs';

const M = 60_000, H = 60 * M;
export const LOOP_STAGES = ['strategy', 'project', 'gate', 'execute', 'verify', 'recover', 'learn'];
export const XARK_STEPS = ['setup', 'research', 'insights', 'creative', 'studio'];
const ACTIVE = ['queued', 'planning', 'awaiting_approval', 'approved', 'generating'];
const EXEC = ['queued', 'planning', 'approved', 'generating'];
export const IDLE_AFTER_H = 48;
export const AD_DATA_WAIT_H = 72;
export const STEP_AGENT = { setup: 'Researcher', research: 'Researcher', insights: 'Strategist', creative: 'Director', studio: 'Director', produce: 'Producer', deliver: 'Performance Analyst', measure: 'Strategist' };
const iso = (ms) => new Date(ms).toISOString();
const t = (d) => (d ? Date.parse(d) : 0);

/** which runs the brain approves this tick (oldest first, running day total) */
export function approvals(runs, policy, approvedTodayUsd, now) {
  let used = approvedTodayUsd; const out = [];
  for (const r of [...runs].filter((x) => x.status === 'awaiting_approval').sort((a, b) => t(a.updatedAt) - t(b.updatedAt))) {
    const v = r.managedBy === 'xark' ? { ok: false, reason: 'managed by Xark: approve or cancel it in Xark Studio' } : canAutoApprove(r, policy, used, now);
    out.push({ run: r, ...v });
    if (v.ok) used += v.reserveUsd;
  }
  return out;
}

/** failed runs the brain retries: transient cause, < 2 brain retries, failed within 24 h */
export function retries(runs, now) {
  return runs.filter((r) => !r.local && r.status === 'failed' && r.retries < 2 && now - t(r.updatedAt) < 24 * H && classify(r.error).retry);
}

export function gatesOf(run, policy, approvedTodayUsd, now) {
  const g = [];
  g.push({ gate: 'estimate', pass: run.estUsd > 0, detail: run.estUsd > 0 ? `$${run.estUsd.toFixed(2)} (reserve $${reserveUsd(run.estUsd).toFixed(2)})` : 'no estimate yet' });
  if (run.status === 'awaiting_approval') {
    const v = canAutoApprove(run, policy, approvedTodayUsd, now);
    g.push({ gate: 'autonomy', pass: v.ok, detail: v.ok ? `within caps $${policy.maxRunUsd}/run, $${policy.maxDayUsd}/day` : v.reason });
  }
  g.push({ gate: 'visual-mode', pass: true, detail: run.visualMode || 'video' });
  if (run.engine) g.push({ gate: 'engine', pass: true, detail: run.engine });
  return g;
}

const FIX_HINT = (field) => field === 'duration' ? 're-render with fitLength' : field === 'loudness' ? 're-run audio master' : /^critic/.test(field) ? 'review weak criteria and re-run from script' : 're-run from the failing step';

/** failing fields of a run's second check when it blocks the loop: rendered after the pipeline baseline and < 14 days ago
 *  (older failed checks are only reported, so the pre-baseline backlog never floods the loops); null otherwise */
export function blockingCheck(run, checks, now, baseline = PIPELINE_BASELINE) {
  const c = run && checks[run.id];
  if (!c || c.pass !== false) return null;
  const at = t(c.renderedAt || run.updatedAt);
  if (!at || at < t(baseline) || now - at >= 14 * 24 * H) return null;
  const bad = (c.fields || []).filter((f) => !f.pass);
  return bad.length ? bad : null;
}

function task(run, kind, status, agent, gates = []) {
  return { id: run.id, projectId: run.projectId, kind, title: `${run.hookType || 'run'} · ${run.engine || ''}`.trim(), status, step: run.step || null, progress: run.progress || 0, estUsd: run.estUsd || 0, actualUsd: run.actualUsd ?? null, gates, agent, updatedAt: iso(t(run.updatedAt)) };
}

export function tasksOf(obs, checks, now) {
  const policy = obs.policy; const used = obs.spend.autoApprovedTodayUsd || 0;
  const queue = []; const executing = []; const recovery = [];
  const retrySet = new Set(retries(obs.runs, now).map((r) => r.id));
  const newestDone = {};
  for (const r of obs.runs) if (r.status === 'completed' && (!newestDone[r.projectId] || t(r.updatedAt) > t(newestDone[r.projectId].updatedAt))) newestDone[r.projectId] = r;
  for (const r of obs.runs) {
    if (r.status === 'queued' || r.status === 'awaiting_approval') queue.push(task(r, r.status === 'queued' ? 'plan' : 'generate', r.status === 'queued' ? 'queued' : 'gated', 'Producer', gatesOf(r, policy, used, now)));
    else if (['planning', 'approved', 'generating'].includes(r.status)) executing.push(task(r, r.status === 'planning' ? 'plan' : 'generate', 'running', r.status === 'planning' ? 'Director' : 'Editor'));
    else if (r.status === 'failed' && now - t(r.updatedAt) < 7 * 24 * H) {
      const c = classify(r.error);
      recovery.push(task(r, 'fix', retrySet.has(r.id) ? 'retrying' : 'failed', c.retry ? 'Producer' : 'Doctor', [{ gate: 'cause', pass: c.retry, detail: `${c.kind}: ${c.runbook}` }, { gate: 'error', pass: false, detail: String(r.error || '').slice(0, 200) }]));
    } else if (r.status === 'completed' && (r.finalMp4Url || r.finalPath) && !checks[r.id] && now - t(r.updatedAt) < 14 * 24 * H) recovery.push(task(r, 'verify', 'verifying', 'QA Critic'));
    else if (r.status === 'completed' && newestDone[r.projectId] === r) {
      // shown only: brain.mjs never acts on recovery entries (retries come from retries()/fundsRetries() over failed runs)
      const bad = blockingCheck(r, checks, now);
      if (bad) recovery.push(task(r, 'fix', 'failed', 'QA Critic', bad.map((f) => ({ gate: f.field, pass: false, detail: `${f.actual} vs ${f.expected}` }))));
    }
  }
  return { queue, executing, recovery };
}

/** one project's loop: where it is, who acts, what next, when we check and how */
export function loopOf(project, stages, runs, perf, spend7d, checks, policy, approvedTodayUsd, now) {
  const mine = runs.filter((r) => r.projectId === project.id);
  const active = mine.filter((r) => ACTIVE.includes(r.status));
  const awaiting = mine.filter((r) => r.status === 'awaiting_approval');
  const done = mine.filter((r) => r.status === 'completed');
  const failed = mine.filter((r) => r.status === 'failed');
  const lastRun = mine.reduce((m, r) => Math.max(m, t(r.updatedAt)), 0);
  const lastActivity = Math.max(t(project.updatedAt), lastRun);
  const base = { projectId: project.id, name: project.name, brand: project.brandName || null, runs: { active: active.length, awaiting: awaiting.length, done: done.length, failed: failed.length }, spendUsd7d: Math.round((spend7d || 0) * 100) / 100, lastActivityAt: lastActivity ? iso(lastActivity) : null, idleSince: null, waitingOn: null };
  const at = (ms) => iso(now + ms);

  if (active.length) {
    const exec = active.filter((r) => EXEC.includes(r.status));
    if (exec.length) {
      const r = exec[0];
      return { ...base, step: 'produce', stage: r.status === 'queued' ? 'gate' : 'execute', status: 'active', agent: r.status === 'planning' ? 'Director' : 'Editor', doing: `${r.status} ${r.step || ''} ${r.progress ? r.progress + '%' : ''}`.replace(/\s+/g, ' ').trim() + ` (${exec.length} run${exec.length > 1 ? 's' : ''})`, nextAction: 'watch the worker heartbeat and step progress', nextCheckpointAt: at(15 * M), verifyHow: 'run status advances and heartbeatAt < 2 min old; stuck > 2 min is requeued (requeueStale)' };
    }
    const decisions = awaiting.map((r) => canAutoApprove(r, policy, approvedTodayUsd, now));
    if (decisions.some((d) => d.ok)) return { ...base, step: 'produce', stage: 'gate', status: 'active', agent: 'Producer', doing: `approving ${decisions.filter((d) => d.ok).length} run(s) within the autonomy caps`, nextAction: 'auto-approve, then the Mac worker generates', nextCheckpointAt: at(5 * M), verifyHow: 're-read the run: status approved with a spend reservation' };
    return { ...base, step: 'produce', stage: 'gate', status: 'waiting', waitingOn: 'budget', agent: 'Producer', doing: `${awaiting.length} run(s) over the autonomy cap: ${decisions[0]?.reason || ''}`, nextAction: 'Barron approves in Studio (free preparation already done)', nextCheckpointAt: at(24 * H), verifyHow: 'run leaves awaiting_approval; reminder after 24 h' };
  }

  const lastFailed = failed.sort((a, b) => t(b.updatedAt) - t(a.updatedAt))[0];
  const lastDone = done.sort((a, b) => t(b.updatedAt) - t(a.updatedAt))[0];
  if (lastFailed && (!lastDone || t(lastFailed.updatedAt) > t(lastDone.updatedAt)) && now - t(lastFailed.updatedAt) < 7 * 24 * H) {
    const c = classify(lastFailed.error);
    return { ...base, step: 'produce', stage: 'recover', status: c.retry && lastFailed.retries < 2 ? 'active' : 'blocked', agent: c.retry ? 'Producer' : 'Doctor', doing: `last run failed (${c.kind}): ${String(lastFailed.error || '').slice(0, 90)}`, nextAction: c.retry && lastFailed.retries < 2 ? 'retry from the failed step' : c.runbook, nextCheckpointAt: at(c.retry ? 15 * M : 6 * H), verifyHow: 'the retried run reaches completed; the incident does not recur within 72 h' };
  }

  if (lastDone) {
    const bad = blockingCheck(lastDone, checks, now);
    if (bad) return { ...base, step: 'deliver', stage: 'verify', status: 'blocked', waitingOn: null, agent: 'Doctor', doing: 'second check failed: ' + bad.map((f) => `${f.field} ${f.actual} (want ${f.expected})`).join('; '), nextAction: [...new Set(bad.map((f) => FIX_HINT(f.field)))].join('; '), nextCheckpointAt: at(6 * H), verifyHow: 'a re-rendered run passes every field of the second check' };
    const unchecked = done.filter((r) => (r.finalMp4Url || r.finalPath) && !checks[r.id]);
    if (unchecked.length) return { ...base, step: 'deliver', stage: 'verify', status: 'active', agent: 'QA Critic', doing: `second check of ${unchecked.length} finished video(s)`, nextAction: 'ffprobe + loudness + URL + cost reconcile', nextCheckpointAt: at(10 * M), verifyHow: 'every field of the check passes; a failing field opens a fix task' };
    const p = perf.find((x) => x.projectId === project.id);
    const doneAt = t(lastDone.updatedAt);
    if (p && p.rows > 0 && t(p.lastUpdatedAt) >= doneAt) return { ...base, step: 'measure', stage: 'learn', status: 'active', agent: 'Strategist', doing: `${p.rows} performance rows: hook rate ${p.impressions ? Math.round((p.views3s / p.impressions) * 100) : 0}%, CTR ${p.impressions ? ((p.clicks / p.impressions) * 100).toFixed(2) : 0}%`, nextAction: 'score elements (hook/end card/voice) and plan the next round', nextCheckpointAt: at(24 * H), verifyHow: 'next round plan has a hypothesis and a success metric; new runs created from it' };
    if (now - doneAt < AD_DATA_WAIT_H * H) return { ...base, step: 'deliver', stage: 'recover', status: 'waiting', waitingOn: 'ad-data', agent: 'Performance Analyst', doing: `video delivered ${Math.round((now - doneAt) / H)} h ago; ad data matures at 72 h`, nextAction: 'import Meta/TikTok results (AdPerformance) at 72 h', nextCheckpointAt: iso(doneAt + AD_DATA_WAIT_H * H), verifyHow: 'AdPerformance rows exist for the run ad names; hook rate and CTR computed' };
    return { ...base, step: 'deliver', stage: 'recover', status: 'waiting', waitingOn: 'client', agent: 'Performance Analyst', doing: 'no performance data after 72 h', nextAction: 'ask the client for the ad results (CSV import) or confirm the ads are live', nextCheckpointAt: at(48 * H), verifyHow: 'AdPerformance rows appear; otherwise remind again' };
  }

  const st = stages?.stages || [];
  const gap = XARK_STEPS.map((id) => st.find((s) => s.id === id)).find((s) => s && s.state !== 'done');
  const step = gap ? gap.id : 'studio';
  const idle = now - lastActivity > IDLE_AFTER_H * H;
  const action = gap?.action || 'generate the first Ad Studio batch from the best storyboard';
  return { ...base, step, stage: 'project', status: idle ? 'idle-defect' : 'active', idleSince: idle ? iso(lastActivity) : null, agent: STEP_AGENT[step], doing: idle ? `stalled ${Math.round((now - lastActivity) / H)} h at ${step}: ${action}` : `${step}: ${action}`, nextAction: action, nextCheckpointAt: at(idle ? 6 * H : 24 * H), verifyHow: `project-stages: ${step} criteria all met` };
}

/** runs that failed only because the provider balance/key cap was spent: retried once funds are back */
export function fundsRetries(runs, now = Date.now()) {
  return runs.filter((r) => !r.local && r.status === 'failed' && r.retries < 2 && now - t(r.updatedAt) < 72 * H && /\b402\b|balance|credit/i.test(String(r.error || '')));
}

/** server projects whose storyboard is ready but nothing was ever produced: the brain starts one variant (≤ 1 per tick) */
export function batchCandidates(loops, state = {}, now = Date.now()) {
  return loops.filter((l) => !/^(local|batch):/.test(l.projectId) && l.step === 'studio' && l.stage === 'project' && l.runs.active + l.runs.done + l.runs.failed === 0 && !(state[l.projectId] && now - Date.parse(state[l.projectId]) < 24 * H)).slice(0, 1);
}

/** while the provider balance is out: ready projects with nothing produced and only funds failures get a FREE stock remix */
export function freeCandidates(loops, runs, state = {}, now = Date.now()) {
  return loops.filter((l) => {
    if (/^(local|batch):/.test(l.projectId) || !['studio', 'produce'].includes(l.step) || l.runs.active + l.runs.done > 0) return false;
    if (state[l.projectId] && now - Date.parse(state[l.projectId]) < 24 * H) return false;
    return runs.filter((r) => r.projectId === l.projectId && r.status === 'failed').every((r) => /\b402\b|balance|credit/i.test(String(r.error || '')));
  }).slice(0, 1);
}

export function think(obs, checks, now = Date.now()) {
  const used = obs.spend.autoApprovedTodayUsd || 0;
  const stagesBy = Object.fromEntries((obs.stages || []).map((s) => [s.projectId, s]));
  const loops = obs.projects.map((p) => loopOf(p, stagesBy[p.id], obs.runs, obs.perf || [], obs.spend.byProject7d?.[p.id], checks, obs.policy, used, now));
  const order = { 'idle-defect': 0, blocked: 1, active: 2, waiting: 3, done: 4 };
  loops.sort((a, b) => order[a.status] - order[b.status] || (a.nextCheckpointAt < b.nextCheckpointAt ? -1 : 1));
  const stageCounts = Object.fromEntries(LOOP_STAGES.map((s) => [s, loops.filter((l) => l.stage === s).length]));
  return { loops, stageCounts, ...tasksOf(obs, checks, now) };
}
