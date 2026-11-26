// Strategist (design §4): one judgement call per project per day, only where rules are not enough — a project stalled
// without a legal wait (idle-defect) or one with performance data to learn from (measure). Runs `claude -p` on the
// Claude subscription (Sonnet, no tools, structured output), at most MAX_PER_DAY calls. Output overrides the loop's
// nextAction / verifyHow / checkpoint for 24 h and becomes a "think" event.
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const MAX_PER_DAY = 8;
export const FRESH_MS = 24 * 3_600_000;
/** an errored call is retried sooner than a good memo is refreshed (still counts against MAX_PER_DAY) */
export const ERROR_RETRY_MS = 6 * 3_600_000;
export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['hypothesis', 'nextAction', 'verifyHow', 'checkpointHours', 'owner'],
  properties: { hypothesis: { type: 'string' }, nextAction: { type: 'string' }, verifyHow: { type: 'string' }, checkpointHours: { type: 'integer' }, owner: { type: 'string' } },
};
export const SYSTEM = `You are the strategist inside a video-ad production brain (Xark Studio + Ad Studio). For one project you get its step, the stage checks, run history, ad performance and the rules learned so far.
Decide the single most valuable next action that moves the project toward finished, selling short-form video ads and measured results. Be concrete (which stage, which input, which hook type or engine, what to test), never generic.
hypothesis: what you believe and why, max 30 words. nextAction: one imperative sentence, max 25 words. verifyHow: a measurable check with a number or a field, max 25 words.
checkpointHours: 1-72. owner: one of Researcher, Strategist, Director, Producer, Editor, QA Critic, Performance Analyst, Barron (Barron only for money above the caps, logins or client contact).`;

/** which loops need a strategist call now */
export function pick(loops, memo, now = Date.now(), max = MAX_PER_DAY) {
  const day = new Date(now).toISOString().slice(0, 10);
  const used = Object.values(memo || {}).filter((m) => m.day === day).length;
  const due = loops.filter((l) => (l.status === 'idle-defect' || l.step === 'measure') && !(memo?.[l.projectId] && now - Date.parse(memo[l.projectId].at) < (memo[l.projectId].error ? ERROR_RETRY_MS : FRESH_MS)));
  return due.slice(0, Math.max(0, max - used));
}

export function promptFor(loop, obs, learnings) {
  const st = (obs.stages || []).find((s) => s.projectId === loop.projectId)?.stages || [];
  const runs = obs.runs.filter((r) => r.projectId === loop.projectId).slice(0, 8).map((r) => `${r.status} hook=${r.hookType} engine=${r.engine} est=$${r.estUsd} ${r.error ? 'error=' + String(r.error).slice(0, 80) : ''}`);
  const perf = (obs.perf || []).find((p) => p.projectId === loop.projectId);
  return [`Project: ${loop.name} (brand ${loop.brand || '-'}) · step ${loop.step} · status ${loop.status} · last activity ${loop.lastActivityAt}`,
    `Stages: ${st.map((s) => `${s.id}=${s.state}${s.state !== 'done' ? ` (${s.action})` : ''}`).join('; ') || 'unknown'}`,
    `Runs: ${runs.join(' | ') || 'none'}`,
    `Performance: ${perf ? `${perf.rows} rows, impressions ${perf.impressions}, 3s views ${perf.views3s}, clicks ${perf.clicks}, spend $${perf.spend}, conversions ${perf.conversions}` : 'none'}`,
    `Rules learned: ${learnings.filter((l) => l.status === 'confirmed').slice(0, 8).map((l) => l.rule).join(' / ') || 'none'}`,
    `Rule-based next action so far: ${loop.nextAction}`].join('\n');
}

/** the real cause of a failed `claude -p`: its JSON result (stdout) and the stderr tail; the exec error only names the command line */
export function failureReason(stdout, stderr, err) {
  let r = null;
  try { r = JSON.parse(stdout); } catch { /* no JSON */ }
  const parsed = r && (r.is_error || err) ? [r.subtype, r.result].filter(Boolean).join(': ').slice(0, 200) : '';
  const tail = String(stderr || '').trim().slice(-300);
  return `claude -p: ${[parsed, tail].filter(Boolean).join(' | ') || String(err?.message || 'no output').slice(-300)}`;
}

export async function runClaude(prompt, { model = 'sonnet', timeoutMs = 240_000, exec = execFile } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vb-strat-'));
  const sys = path.join(dir, 'system.txt'); await writeFile(sys, SYSTEM);
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
  return new Promise((resolve, reject) => {
    const child = exec('claude', ['-p', prompt, '--output-format', 'json', '--model', model, '--effort', 'low', '--json-schema', JSON.stringify(SCHEMA), '--system-prompt-file', sys, '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '', '--no-session-persistence', '--max-turns', '3'], { cwd: dir, env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(failureReason(stdout, stderr, err)));
      try { const r = JSON.parse(stdout); if (r.is_error || !r.structured_output) return reject(new Error(r.is_error ? failureReason(stdout, stderr, null) : `claude -p: ${r.subtype || 'no output'}`)); resolve(r.structured_output); } catch (e) { reject(e); }
    });
    // the prompt is an argument: close stdin so claude does not wait for piped input ("no stdin data received in 3s")
    child?.stdin?.end();
  });
}

/** apply fresh strategist memos to loops (pure) */
export function apply(loops, memo, now = Date.now()) {
  return loops.map((l) => {
    const m = memo?.[l.projectId];
    if (!m || now - Date.parse(m.at) >= FRESH_MS) return l;
    return { ...l, agent: m.out.owner || l.agent, nextAction: m.out.nextAction, verifyHow: m.out.verifyHow, nextCheckpointAt: new Date(Date.parse(m.at) + Math.min(72, Math.max(1, m.out.checkpointHours)) * 3_600_000).toISOString(), doing: `${l.doing} · strategist: ${m.out.hypothesis}` };
  });
}
