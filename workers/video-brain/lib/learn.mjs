// Shared brain (design §5): one learning store (AppSetting brain:learnings), projected into every video skill/agent and
// into the Ad Studio pipeline. candidate -> confirmed (seen twice / data) -> promoted (lives in code) -> retired.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { renderDirectives, rulesByWorkstream } from './knowledge.mjs';

export const BEGIN = '<!-- video-brain:begin -->';
export const END = '<!-- video-brain:end -->';
export const idOf = (scope, rule) => 'L' + createHash('sha1').update(`${scope}|${rule}`).digest('hex').slice(0, 10);
const L = (scope, rule, evidence, status, promotedTo = null, at = '2026-11-17T00:00:00.000Z') => ({ id: idOf(scope, rule), at, who: 'ad-studio production', scope, rule, evidence, status, promotedTo });

/** rules already proven in production (ad-studio docs/OPERATOR-SKILL.md, REVIEW-AND-REMEDIATION-20261107, PLAN-20261117) */
export const SEED = [
  L('pipeline:script', 'Sell, do not copy: sales voice-over, own music/voice/SFX per video; fidelity to the reference is informational only.', ['docs/REVIEW-AND-REMEDIATION-20261107.md'], 'promoted', 'pipeline/playbook.mjs PLAYBOOK'),
  L('pipeline:script', "The hook doctor's shot-1 caption and line are locked; copy fit, scrub and auto-fix never rewrite shot 1.", ['playbook.mjs lockHook'], 'promoted', 'pipeline/playbook.mjs lockHook'),
  L('pipeline:render', 'Runtime <= 24 s with voice-over (body <= 20.5 s + 3.5 s closing card); shrink silent shots, then shorten VO, then speed delivery.', ['OPERATOR-SKILL rule 3'], 'promoted', 'pipeline/playbook.mjs fitLength'),
  L('pipeline:review', 'Self-scores are inflated (script self-graded hooks 31-34/40, independent review 5.2/10): judge with a model that did not write it.', ['PLAN-20261117 hook'], 'promoted', 'pipeline/agents.mjs judgeHooks'),
  L('pipeline:render', 'Hook: headline at frame 0, sound at 0 s, first cut <= 1.5 s, no fade from black/white flash on frame 0.', ['PLAN-20261117 hook measurements'], 'promoted', 'pipeline/render.mjs + measure.mjs'),
  L('pipeline:render', 'All audio was 48 ms late (Remotion AAC priming 43 ms + limiter 5 ms): shift by the measured encoder delay; place SFX by their peak, not file start.', ['research-20261117/03-sync.md'], 'promoted', 'pipeline/render.mjs'),
  L('pipeline:audio', 'Master -14 LUFS / -1.5 dBTP, voice 6-8 dB over music, music lifts at the product reveal and stops before the closing card.', ['research-20261117/04-audio.md'], 'promoted', 'pipeline/audio.mjs'),
  L('pipeline:captions', 'Captions follow the spoken words (2-3 words per page, current word highlighted), inside the TikTok safe zone.', ['research-20261117/05-captions-fx.md'], 'promoted', 'renderer captions'),
  L('pipeline:prompts', 'Do not ask video models for "label clearly readable": they invent text. Say "no text except the product label".', ['prompts.mjs lintScene'], 'promoted', 'pipeline/prompts.mjs'),
  L('pipeline:generate', 'Generate an empty location plate first and reuse it for every shot in that place, or people/products leak between shots (6 times in 4 jobs).', ['CAPABILITIES-20261117 §2'], 'promoted', 'pipeline/prompts.mjs location plates'),
  L('model:bytedance/seedance-1-5-pro', 'seedance-1-5-pro was retired from OpenRouter: route b-roll to seedance-2.0; probe /videos/models daily.', ['generate.mjs ROUTES 2026-11-17'], 'promoted', 'pipeline/generate.mjs ROUTES + brain probe'),
  L('pipeline:estimate', 'Estimates covered clips only (actual 1.7-1.8x): include key frames, cast stills and re-generations in the estimate.', ['PLAN-20261117 design'], 'retired'),
  L('pipeline:estimate', 'The spend gate reserves the clip estimate x 1.3 (RESERVE_FACTOR); key frames ($0.04 each) are generated before the gate and booked apart, so a run may cost up to reservation + key frames.', ['lib/policy.mjs RESERVE_FACTOR', 'lib/verify.mjs cost field'], 'promoted', 'policy.ts/policy.mjs RESERVE_FACTOR + verify.mjs cost', '2026-11-26T00:00:00.000Z'),
  L('brain:patterns', 'Fix-pattern fingerprints must match the final output only: per-stem -16 LUFS normalising and 30 ms anti-pop fades were all false positives on the first scan.', ['2026-11-18 first scan: 6 of 6 hits false'], 'confirmed', null, '2026-11-18T08:50:00.000Z'),
  L('global', 'Never claim audio quality was checked by ear: the model cannot listen; report measured numbers (LUFS, LU, ms).', ['OPERATOR-SKILL rule 6'], 'promoted', 'measure.mjs'),
];

/** seeds retired in code: they stay retired even when the server store still holds an older confirmed copy (applied after
 *  the server merge in brain.mjs). 2026-11-26: the 1.7-1.8x estimate note steered the strategist to 1.75x budgets; policy is 1.3x. */
export const RETIRED_SEEDS = new Set([idOf('pipeline:estimate', 'Estimates covered clips only (actual 1.7-1.8x): include key frames, cast stills and re-generations in the estimate.')]);

/** videos rendered before this pipeline baseline (2026-11-17 sync/loudness/hook fixes) are reported but not learned from */
export const PIPELINE_BASELINE = process.env.VIDEO_BRAIN_BASELINE || '2026-11-17T20:00:00.000Z';

/** new candidate/confirmed learnings from what the brain saw this tick */
export function harvest({ incidents, checks, now = new Date().toISOString(), baseline = PIPELINE_BASELINE }) {
  const out = [];
  // stale local mirrors of Xark runs (local:xk-*, local:xark-lab) are not learned from (the server copy is checked)
  checks = Object.fromEntries(Object.entries(checks || {}).filter(([, c]) => !/^local:(xk-|xark-lab$)/.test(c.projectId || '')));
  for (const i of Object.values(incidents || {})) {
    if (i.count < 2 || i.status === 'resolved' || Date.parse(now) - Date.parse(i.lastSeen) > 7 * 86_400_000) continue;
    const rule = `Recurring failure (${i.kind}) "${i.signature}": ${i.runbook}`;
    out.push({ id: idOf('incident', i.signature), at: now, who: 'brain', scope: `ops:${i.kind}`, rule, evidence: i.runs.slice(-5), status: i.count >= 3 ? 'confirmed' : 'candidate', promotedTo: null });
  }
  const failed = {};
  for (const c of Object.values(checks || {})) if (!c.renderedAt || c.renderedAt >= baseline) for (const f of c.fields || []) if (!f.pass && !f.advisory) (failed[f.field] = failed[f.field] || []).push(c.runId);
  for (const [field, runs] of Object.entries(failed)) {
    if (runs.length < 2) continue;
    out.push({ id: idOf('check', field), at: now, who: 'QA Critic', scope: 'pipeline:render', rule: `Second check: "${field}" failed on ${runs.length} finished videos; the pipeline's own QA passed them — tighten measure.mjs for ${field}.`, evidence: runs.slice(-5), status: runs.length >= 3 ? 'confirmed' : 'candidate', promotedTo: null });
  }
  return out;
}

export function renderBlock(learnings, at, extra = '') {
  const live = learnings.filter((l) => l.status !== 'retired');
  const group = (s) => live.filter((l) => l.status === s);
  const line = (l) => `- [${l.scope}] ${l.rule}${l.promotedTo ? ` _(in code: ${l.promotedTo})_` : ''}${l.evidence?.length ? ` — evidence: ${l.evidence.slice(0, 3).join(', ')}` : ''}`;
  return [BEGIN, `## Video Brain shared learnings (synced ${at}; source: creative.xark.io /brain, do not edit inside this block)`, '',
    '### Confirmed — follow these', ...group('confirmed').map(line), '', '### In code already (promoted) — keep them when editing', ...group('promoted').map(line), '',
    '### Candidates — watch, not yet rules', ...(group('candidate').length ? group('candidate').map(line) : ['- (none)']), '',
    ...(extra ? [extra, ''] : []),
    'Add a learning: `node ~/Projects/creativeintel-20260712/workers/video-brain/brain.mjs --learn "<rule>" --scope <scope> --evidence <runId>`', END].join('\n');
}

/** replace (or append) the marker block in a file; returns true when the file changed */
export async function writeBlock(file, block) {
  let text = ''; try { text = await readFile(file, 'utf8'); } catch { /* new */ }
  const next = text.includes(BEGIN) && text.includes(END) ? text.slice(0, text.indexOf(BEGIN)) + block + text.slice(text.indexOf(END) + END.length) : (text ? text.replace(/\s*$/, '\n\n') : '# Learnings\n\n') + block + '\n';
  if (next === text) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next);
  return true;
}

export const POINTER = '> Before acting, read `LEARNINGS.md` in this skill folder (Video Brain shared learnings, synced from creative.xark.io /brain).';

/** tests must never reach the live skills or Ad Studio clone (2026-11-26: a test fixture leaked into ~/.claude/skills and 38 auto-sync commits flip-flopped) */
export function assertNotLive({ skillsDir, adStudioRoot }) {
  if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) return;
  const live = [path.join(homedir(), '.claude', 'skills'), path.join(homedir(), 'Projects', 'ad-studio-20261104')];
  for (const p of [skillsDir, adStudioRoot].filter(Boolean).map((x) => path.resolve(x)))
    if (live.some((l) => p === l || p.startsWith(l + path.sep))) throw new Error(`video-brain: refusing to sync learnings into live ${p} from a test; pass tick({ skillsDir, adStudioRoot }) temp dirs`);
}

async function writeIfChanged(file, text) {
  let old = null; try { old = await readFile(file, 'utf8'); } catch { /* new */ }
  if (old === text) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return true;
}

/** sync to skills (LEARNINGS.md + a one-line pointer in SKILL.md), agents and the Ad Studio pipeline file.
 *  Writes only files whose content differs, so re-running with the same `at` repairs drift and is otherwise a no-op.
 *  Returns { synced: targets, changed: files rewritten }. */
export async function syncAll(learnings, { skillsDir, skills, adStudioRoot, at, directives = null }) {
  assertNotLive({ skillsDir, adStudioRoot });
  const block = renderBlock(learnings, at, directives ? renderDirectives(directives.config, directives.harvested) : '');
  const synced = [], changed = [];
  const put = async (file, ok) => { if (await ok) changed.push(file); };
  // one shared file every video skill/agent can read (P2 single source until the Neon tables land)
  await put(path.join(skillsDir, '_shared', 'VIDEO-KNOWLEDGE.md'), writeBlock(path.join(skillsDir, '_shared', 'VIDEO-KNOWLEDGE.md'), block));
  synced.push('skills:_shared/VIDEO-KNOWLEDGE.md');
  for (const s of skills) {
    const dir = path.join(skillsDir, s);
    let skill; try { skill = await readFile(path.join(dir, 'SKILL.md'), 'utf8'); } catch { continue; }
    if (!skill.includes(POINTER)) {
      const m = skill.match(/^---\n[\s\S]*?\n---\n/);
      await writeFile(path.join(dir, 'SKILL.md'), m ? skill.slice(0, m[0].length) + '\n' + POINTER + '\n' + skill.slice(m[0].length) : POINTER + '\n\n' + skill);
      changed.push(path.join(dir, 'SKILL.md'));
    }
    await put(path.join(dir, 'LEARNINGS.md'), writeBlock(path.join(dir, 'LEARNINGS.md'), block));
    synced.push(`skill:${s}`);
  }
  if (adStudioRoot) {
    const rules = learnings.filter((l) => l.status === 'confirmed').map((l) => ({ id: l.id, scope: l.scope, rule: l.rule }));
    const workstreams = directives ? rulesByWorkstream(directives.config, directives.harvested) : {};
    const json = path.join(adStudioRoot, 'data', 'brain-learnings.json');
    await put(json, writeIfChanged(json, JSON.stringify({ at, rules, workstreams }, null, 2) + '\n'));
    await put(path.join(adStudioRoot, 'docs', 'LEARNINGS.md'), writeBlock(path.join(adStudioRoot, 'docs', 'LEARNINGS.md'), block));
    synced.push('ad-studio:data/brain-learnings.json', 'ad-studio:docs/LEARNINGS.md');
  }
  return { synced, changed };
}
