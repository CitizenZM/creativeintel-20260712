// Shared brain (design §5): one learning store (AppSetting brain:learnings), projected into every video skill/agent and
// into the Ad Studio pipeline. candidate -> confirmed (seen twice / data) -> promoted (lives in code) -> retired.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

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
  L('pipeline:estimate', 'Estimates covered clips only (actual 1.7-1.8x): include key frames, cast stills and re-generations in the estimate.', ['PLAN-20261117 design'], 'confirmed'),
  L('brain:patterns', 'Fix-pattern fingerprints must match the final output only: per-stem -16 LUFS normalising and 30 ms anti-pop fades were all false positives on the first scan.', ['2026-11-18 first scan: 6 of 6 hits false'], 'confirmed', null, '2026-11-18T08:50:00.000Z'),
  L('global', 'Never claim audio quality was checked by ear: the model cannot listen; report measured numbers (LUFS, LU, ms).', ['OPERATOR-SKILL rule 6'], 'promoted', 'measure.mjs'),
];

/** new candidate/confirmed learnings from what the brain saw this tick */
export function harvest({ incidents, checks, now = new Date().toISOString() }) {
  const out = [];
  for (const i of Object.values(incidents || {})) {
    if (i.count < 2 || i.status === 'resolved') continue;
    const rule = `Recurring failure (${i.kind}) "${i.signature}": ${i.runbook}`;
    out.push({ id: idOf('incident', i.signature), at: now, who: 'brain', scope: i.kind === 'model' ? 'pipeline:generate' : 'global', rule, evidence: i.runs.slice(-5), status: i.count >= 3 ? 'confirmed' : 'candidate', promotedTo: null });
  }
  const failed = {};
  for (const c of Object.values(checks || {})) for (const f of c.fields || []) if (!f.pass) (failed[f.field] = failed[f.field] || []).push(c.runId);
  for (const [field, runs] of Object.entries(failed)) {
    if (runs.length < 2) continue;
    out.push({ id: idOf('check', field), at: now, who: 'QA Critic', scope: 'pipeline:render', rule: `Second check: "${field}" failed on ${runs.length} finished videos; the pipeline's own QA passed them — tighten measure.mjs for ${field}.`, evidence: runs.slice(-5), status: runs.length >= 3 ? 'confirmed' : 'candidate', promotedTo: null });
  }
  return out;
}

export function renderBlock(learnings, at) {
  const live = learnings.filter((l) => l.status !== 'retired');
  const group = (s) => live.filter((l) => l.status === s);
  const line = (l) => `- [${l.scope}] ${l.rule}${l.promotedTo ? ` _(in code: ${l.promotedTo})_` : ''}${l.evidence?.length ? ` — evidence: ${l.evidence.slice(0, 3).join(', ')}` : ''}`;
  return [BEGIN, `## Video Brain shared learnings (synced ${at}; source: creative.xark.io /brain, do not edit inside this block)`, '',
    '### Confirmed — follow these', ...group('confirmed').map(line), '', '### In code already (promoted) — keep them when editing', ...group('promoted').map(line), '',
    '### Candidates — watch, not yet rules', ...(group('candidate').length ? group('candidate').map(line) : ['- (none)']), '',
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

/** sync to skills (LEARNINGS.md + a one-line pointer in SKILL.md), agents and the Ad Studio pipeline file */
export async function syncAll(learnings, { skillsDir, skills, adStudioRoot, at }) {
  const block = renderBlock(learnings, at);
  const synced = [];
  for (const s of skills) {
    const dir = path.join(skillsDir, s);
    let skill; try { skill = await readFile(path.join(dir, 'SKILL.md'), 'utf8'); } catch { continue; }
    if (!skill.includes(POINTER)) {
      const m = skill.match(/^---\n[\s\S]*?\n---\n/);
      await writeFile(path.join(dir, 'SKILL.md'), m ? skill.slice(0, m[0].length) + '\n' + POINTER + '\n' + skill.slice(m[0].length) : POINTER + '\n\n' + skill);
    }
    await writeBlock(path.join(dir, 'LEARNINGS.md'), block);
    synced.push(`skill:${s}`);
  }
  if (adStudioRoot) {
    const rules = learnings.filter((l) => l.status === 'confirmed').map((l) => ({ id: l.id, scope: l.scope, rule: l.rule }));
    await mkdir(path.join(adStudioRoot, 'data'), { recursive: true });
    await writeFile(path.join(adStudioRoot, 'data', 'brain-learnings.json'), JSON.stringify({ at, rules }, null, 2) + '\n');
    await writeBlock(path.join(adStudioRoot, 'docs', 'LEARNINGS.md'), block);
    synced.push('ad-studio:data/brain-learnings.json', 'ad-studio:docs/LEARNINGS.md');
  }
  return synced;
}
