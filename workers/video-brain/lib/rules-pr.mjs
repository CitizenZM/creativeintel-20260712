// Learnings -> rules through a PR (design §9 decision 3 = A): the Ad Studio script prompt reads only the tracked
// pipeline/brain-rules.json. When the confirmed script-side learnings differ from origin/main, the brain writes the file
// in a throw-away worktree (never the main clone: the auto-sync hook would commit it straight to main), runs the
// pipeline's rule tests there, and opens ONE PR per content hash. Barron merges or closes it (veto); nothing merges itself.
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { rulesByWorkstream } from './knowledge.mjs';

const pexec = promisify(execFile);
export const SCRIPT_SCOPES = /^(global|pipeline:(script|prompts|generate|captions|audio))$/;
export const REPO = 'CitizenZM/ad-studio-20261104';

/** the tracked file's content for these learnings (pure, stable order) */
export function rulesFile(learnings, directives = null) {
  const extra = {};
  if (directives) { // Barron's confirmed video rules, per workstream only (brand lets Ad Studio match a job by its brand)
    const r = rulesByWorkstream(directives.config, directives.harvested);
    extra.workstreams = Object.fromEntries(directives.config.workstreams.map((w) => [w.id, { brand: w.brand, rules: r[w.id].map((x) => ({ rule: x.rule })) }]));
  }
  const rules = learnings.filter((l) => l.status === 'confirmed' && SCRIPT_SCOPES.test(l.scope)).map((l) => ({ id: l.id, scope: l.scope, rule: l.rule, evidence: (l.evidence || []).slice(0, 3) })).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ about: 'Video Brain rules for the script prompt. Changed only by PR (brain/rules-*), reviewed by Barron; see pipeline/brain-rules.mjs.', rules, ...extra }, null, 1) + '\n';
}
export const hashOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 8);
const norm = (text) => { try { const j = JSON.parse(text); return JSON.stringify([j.rules.map((r) => [r.id, r.rule]), j.workstreams || null]); } catch { return null; } };

/** decide (pure): nothing to do, already proposed, or open a PR */
export function plan(current, desired, state = {}) {
  if (norm(current) === norm(desired)) return { action: 'none' };
  const h = hashOf(desired);
  if (state.hash === h) return { action: 'pending', hash: h, url: state.url };
  return { action: 'open', hash: h };
}

export async function proposeRules(adRoot, learnings, state = {}, { directives = null, sh = (cmd, args, opts) => pexec(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 300_000, ...opts }) } = {}) {
  await sh('git', ['-C', adRoot, 'fetch', '-q', 'origin', 'main']);
  const current = await sh('git', ['-C', adRoot, 'show', 'origin/main:pipeline/brain-rules.json']).then((r) => r.stdout).catch(() => '');
  const desired = rulesFile(learnings, directives);
  const p = plan(current, desired, state);
  if (p.action !== 'open') return p;
  const branch = `brain/rules-${p.hash}`;
  const wt = path.join(await mkdtemp(path.join(tmpdir(), 'vb-rules-')), 'wt');
  await sh('git', ['-C', adRoot, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main']);
  try {
    await writeFile(path.join(wt, 'pipeline', 'brain-rules.json'), desired);
    await sh('node', ['--test', 'pipeline/test_brain_rules.mjs'], { cwd: wt }); // CI: the rules file parses and reaches the prompt
    await sh('git', ['-C', wt, 'add', 'pipeline/brain-rules.json']);
    await sh('git', ['-C', wt, 'commit', '-q', '-m', `feat: Video Brain rules update ${p.hash} [video-brain]\n\nCo-Authored-By: WOZCODE <contact@withwoz.com>`]);
    await sh('git', ['-C', wt, 'push', '-q', '-u', 'origin', branch]);
    const body = `Confirmed learnings from the Video Brain that change the Ad Studio script prompt.\n\nMerge = the rules go live in the next script; close = veto (the brain will not re-propose this exact set).\n\n\`\`\`json\n${desired.slice(0, 6000)}\`\`\`\n\nTests: node --test pipeline/test_brain_rules.mjs passed in the PR worktree.\n\n🧙 Built with [WOZCODE](https://wozcode.com)`;
    const { stdout } = await sh('gh', ['pr', 'create', '--repo', REPO, '--base', 'main', '--head', branch, '--title', `Video Brain rules update ${p.hash}`, '--body', body]);
    return { action: 'opened', hash: p.hash, url: stdout.trim().split('\n').pop() };
  } finally {
    await sh('git', ['-C', adRoot, 'worktree', 'remove', '--force', wt]).catch(() => {});
  }
}
