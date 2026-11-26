// Round 4 digest truth + learning hygiene (T2 T3 T4 T5 T10 T15 T16) and the rules-PR root/exclude fixes.
// tests never message Barron or call a model; every tick syncs learnings into temp dirs (brainDirs)
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brainDirs } from './helpers/brain-dirs.mjs';
import { buildDigest } from '../lib/digest.mjs';
import { harvest, idOf, SEED } from '../lib/learn.mjs';
import { promptFor } from '../lib/strategist.mjs';
import { proposeRules, rulesFile, hashOf } from '../lib/rules-pr.mjs';

const H = 3_600_000, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const policy = { autoApprove: false, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 };
const empty = async () => ({ projects: [], stages: [], runs: [] });
// 2026-11-26 06:00 PT (digest not due) and 08:00 PT (due)
const EARLY = Date.parse('2026-11-26T14:00:00Z'), DUE = Date.parse('2026-11-26T16:00:00Z');

async function home(state = {}, at = EARLY) {
  const h = await mkdtemp(path.join(tmpdir(), 'vb-r4-'));
  await writeFile(path.join(h, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: iso(at), patternsAt: iso(at), syncHash: 'x', budgetOut: false, ...state }));
  return h;
}
const caller = (obs, pubs = [], calls = []) => async (a, b = {}) => {
  calls.push(a);
  if (a === 'observe') return { status: 200, policy, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [], ...structuredClone(obs) };
  if (a === 'publish') { pubs.push(b.snapshot); return { status: 200, ok: true, verified: true }; }
  if (a === 'retry') return { status: 200, ok: true };
  return { status: 200, ok: true };
};

test('T2 an action of a non-digest tick is counted by the next day\'s digest', async () => {
  const { tick } = await import('../brain.mjs?t2');
  const h = await home({}, DUE); // probes/patterns stay fresh for both ticks
  const run = { id: 'cmrunretry000000000000001', projectId: 'p1', status: 'failed', error: 'fetch failed: ETIMEDOUT', retries: 0, updatedAt: iso(EARLY - H), estUsd: 1 };
  const call = caller({ runs: [run] });
  const sent = [];
  const notify = async (t) => { sent.push(t); return { ok: true }; };
  await tick({ call, now: EARLY, home: h, ...brainDirs(h), local: empty, notify });
  assert.equal(sent.length, 0, 'not due at 06:00 PT');
  const st = JSON.parse(await readFile(path.join(h, 'state.json'), 'utf8'));
  assert.equal(st.actions?.length, 1, 'the retry is persisted by the tick that made it');
  await tick({ call, now: DUE, home: h, ...brainDirs(h), local: empty, notify });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /过去 24 h 大脑执行 1 个动作/);
});

test('T2 the fix-pattern scan is a check event, not an action', async () => {
  const src = await readFile(new URL('../brain.mjs', import.meta.url), 'utf8');
  assert.match(src, /ev\('Doctor', 'check', `fix-pattern scan:/);
});

const C = (n) => `cmproj${String(n).padStart(19, '0')}`;
test('T3 the digest counts every failing check of 7 days (not only the newest 40), one line per project with the first failing value', async () => {
  const { tick } = await import('../brain.mjs?t3');
  const checks = {};
  const add = (i, projectId, pass, ageH) => { const id = `run${i}`; checks[id] = { runId: id, projectId, at: iso(DUE - ageH * H), renderedAt: iso(DUE - ageH * H), pass, fields: [{ field: 'url', pass: true, actual: 'ok' }, ...(pass ? [] : [{ field: 'duration', expected: '5–24.5 s', actual: `${24 + i / 100} s and a very long explanation that goes on and on and on`, pass: false }])] }; };
  // newest 40: 36 passing + 4 failing (project 1); older (outside the newest 40, still < 7 d): 5 failing (projects 2 and 3)
  for (let i = 0; i < 36; i++) add(i, C(9), true, 1 + i / 10);
  for (let i = 36; i < 40; i++) add(i, C(1), false, 1 + i / 10);
  for (let i = 40; i < 43; i++) add(i, C(2), false, 30 + i);
  for (let i = 43; i < 45; i++) add(i, 'local:20261120-abcde', false, 30 + i);
  // stale xk mirror and an 8-day-old failure are not reported
  add(90, 'local:xk-cmw7achmt0002vritoqg6xh4d', false, 5); add(91, C(1), false, 8 * 24);
  const h = await home({ checks, digestDay: null }, DUE);
  const sent = [];
  const pubs = [];
  const call = caller({ projects: [{ id: C(1), name: 'Nike', updatedAt: iso(DUE) }, { id: C(2), name: 'TCL', updatedAt: iso(DUE) }] }, pubs);
  await tick({ call, now: DUE, home: h, ...brainDirs(h), local: empty, notify: async (t) => { sent.push(t); return { ok: true }; }, check: async () => { throw new Error('no re-check expected'); } });
  assert.equal(pubs[0].checks.length, 40, 'the snapshot still carries the newest 40');
  const text = sent[0];
  assert.match(text, /近 7 天成片二次复查未通过 9 条/);
  const lines = text.split('\n').filter((l) => /^- .*（\d+ 条）: duration/.test(l));
  assert.equal(lines.length, 3, text);
  assert.match(text, new RegExp(`- Nike（4 条）: duration 24\\.\\d+ s and a .* → https://creative\\.xark\\.io/projects/${C(1)}/deliver`));
  assert.match(text, /- TCL（3 条）: /);
  assert.match(text, /- local:20261120-abcde（2 条）: /);
  for (const l of lines) assert.ok(l.split(': ')[1].split(' → ')[0].length <= 60, l);
  assert.ok(!/xk-/.test(text));
});

test('T3 the 7-day window is measured from the snapshot time, not the wall clock', () => {
  const at = '2026-01-10T00:00:00.000Z';
  const c = { runId: 'r', projectId: 'p', at, renderedAt: '2026-01-09T00:00:00.000Z', pass: false, fields: [{ field: 'loudness', actual: '-20 LUFS', pass: false }] };
  assert.match(buildDigest({ at, checks: [c] }), /未通过 1 条/);
});

test('T4 funds out: one OpenRouter line in 需要你 carries the probe detail; other failures stay', () => {
  const funds = (name) => ({ projectId: name, name, status: 'waiting', step: 'produce', agent: 'Producer', waitingOn: 'funds', nextAction: 'raise the OpenRouter key cap first' });
  const snap = {
    at: '2026-11-26T16:00:00Z', loops: [funds('A'), funds('B')],
    probes: [{ name: 'openrouter balance', ok: false, detail: '$0.26 spendable (key monthly cap $60): raise the key limit on openrouter.ai/settings/keys' }, { name: 'fal key', ok: false, detail: 'HTTP 401' }],
    incidents: [{ kind: 'human', status: 'open', signature: 'openrouter #: 402 this request requires at least $# in balance', runbook: 'budget/credit/provider balance: top up (OpenRouter credits) or raise the cap - Barron', count: 7 }, { kind: 'human', status: 'open', signature: '401 x', runbook: 'credential rejected (401): rotate the key', count: 2 }],
    budget: { out: true, detail: '$0.26 spendable' },
  };
  const text = buildDigest(snap);
  assert.equal((text.match(/OpenRouter/g) || []).length, 1, text);
  assert.match(text, /需要你（1）:\n- .*OpenRouter.*\$0\.26 spendable/);
  assert.match(text, /2 个项目/);
  assert.ok(!/openrouter balance:/.test(text), 'probe line folded into the ask');
  assert.ok(!/模型预算用尽：/.test(text), 'budget line folded into the ask');
  assert.match(text, /fal key: HTTP 401/);
  assert.match(text, /credential rejected \(401\)/);
});

test('T4 without funds/budget-out the balance probe and incidents are listed as before', () => {
  const text = buildDigest({ at: '2026-11-26T16:00:00Z', loops: [], probes: [{ name: 'openrouter balance', ok: false, detail: '$1 left' }], incidents: [{ kind: 'human', status: 'open', runbook: 'budget/credit: top up (OpenRouter credits)', count: 2 }] });
  assert.match(text, /openrouter balance: \$1 left/);
  assert.match(text, /top up \(OpenRouter credits\)/);
});

test('T5 setup projects idle >= 14 d collapse into one line; fresher setup asks stay', () => {
  const now = Date.parse('2026-11-26T16:00:00Z');
  const setup = (i, idleDays) => ({ projectId: `p${i}`, name: `Old ${i}`, status: 'idle-defect', step: 'setup', agent: 'Researcher', nextAction: 'Confirm the product details', idleSince: iso(now - idleDays * D) });
  const text = buildDigest({ at: iso(now), loops: [...[1, 2, 3, 4, 5, 6].map((i) => setup(i, 15 + i)), setup(7, 2)] });
  assert.match(text, /需要你（2）/);
  assert.match(text, /- 6 个项目 ≥14 天无动静（可归档）→ https:\/\/creative\.xark\.io\/brain/);
  assert.match(text, /- Old 7: Confirm the product details/);
  assert.ok(!/Old [1-6]/.test(text));
});

test('T10 a re-rendered local run is checked again (critic once per render); a server run is not', async () => {
  const { tick } = await import('../brain.mjs?t10');
  const old = iso(EARLY - 10 * H), fresh = iso(EARLY - H);
  const prev = (id, projectId) => ({ runId: id, projectId, at: old, renderedAt: old, pass: false, fields: [{ field: 'duration', expected: '5–24.5 s', actual: '26 s', pass: false }] });
  const h = await home({ checks: { 'local:j1': prev('local:j1', 'local:p'), srv1: prev('srv1', 'p1') } });
  const loc = { id: 'local:j1', local: true, projectId: 'local:p', status: 'completed', finalPath: '/x/final.mp4', updatedAt: fresh, estUsd: 0 };
  const srv = { id: 'srv1', projectId: 'p1', status: 'completed', finalMp4Url: 'https://x/y.mp4', updatedAt: fresh, estUsd: 0 };
  const checked = []; const critiqued = [];
  const check = async (r) => { checked.push(r.id); return { runId: r.id, projectId: r.projectId, at: iso(EARLY), renderedAt: iso(Date.parse(r.updatedAt)), pass: true, fields: [{ field: 'duration', expected: '5–24.5 s', actual: '20.00 s', pass: true }] }; };
  const critic = async () => { critiqued.push(1); return { model: 'x/critic', avg: 8, pass: true, scores: { issues: [] } }; };
  const call = caller({ runs: [loc, srv] });
  for (const t of [EARLY, EARLY + 5 * 60_000]) await tick({ call, now: t, home: h, ...brainDirs(h), local: empty, check, critic });
  assert.deepEqual(checked, ['local:j1'], 'local re-render checked once; server run untouched');
  assert.equal(critiqued.length, 1, 'critic billed once for the render');
  const st = JSON.parse(await readFile(path.join(h, 'state.json'), 'utf8'));
  assert.equal(st.checks['local:j1'].pass, true);
  assert.equal(st.checks.srv1.pass, false);
});

const OLD_ESTIMATE = 'Estimates covered clips only (actual 1.7-1.8x): include key frames, cast stills and re-generations in the estimate.';
test('T15 the obsolete 1.7-1.8x estimate seed is retired even when the server copy says confirmed; the 1.3x rule replaces it', async () => {
  const { tick } = await import('../brain.mjs?t15');
  const oldId = idOf('pipeline:estimate', OLD_ESTIMATE);
  const h = await home();
  const pubs = [];
  const serverCopy = { id: oldId, at: '2026-11-17T00:00:00.000Z', who: 'ad-studio production', scope: 'pipeline:estimate', rule: OLD_ESTIMATE, evidence: [], status: 'confirmed', promotedTo: null };
  const call = caller({ learnings: [serverCopy] }, pubs);
  await tick({ call, now: EARLY, home: h, ...brainDirs(h), local: empty });
  const ls = pubs[0].learnings;
  assert.equal(ls.find((l) => l.id === oldId).status, 'retired');
  const neu = ls.find((l) => l.scope === 'pipeline:estimate' && /1\.3/.test(l.rule));
  assert.ok(neu && neu.id !== oldId && neu.status !== 'retired', 'new 1.3x seed under a new id');
  assert.ok(SEED.some((l) => l.id === neu.id));
  const prompt = promptFor({ projectId: 'p', name: 'P', step: 'produce', status: 'blocked', nextAction: 'x' }, { runs: [], stages: [], perf: [] }, ls);
  assert.ok(!prompt.includes('1.7'), prompt);
  const block = await readFile(path.join(brainDirs(h).skillsDir, '_shared', 'VIDEO-KNOWLEDGE.md'), 'utf8');
  assert.ok(!block.includes('1.7-1.8x'), 'retired rule not projected into the skills');
});

test('T16 harvest ignores stale Xark mirror checks (local:xk-*, local:xark-lab)', () => {
  const bad = (id, projectId) => ({ runId: id, projectId, renderedAt: '2026-11-20T00:00:00.000Z', fields: [{ field: 'loudness', pass: false }] });
  const checks = Object.fromEntries([['a', 'local:xk-cmw1'], ['b', 'local:xk-cmw2'], ['c', 'local:xark-lab'], ['d', 'local:xark-lab']].map(([id, p]) => [id, bad(id, p)]));
  assert.equal(harvest({ incidents: {}, checks }).length, 0);
  assert.equal(harvest({ incidents: {}, checks: { ...checks, e: bad('e', 'cmproj1'), f: bad('f', 'local:p') } }).length, 1);
});

test('T16 checks and acted entries are pruned only when > 30 d old AND the run is gone; a listed run is not re-checked', async () => {
  const { tick } = await import('../brain.mjs?t16');
  const old = iso(EARLY - 40 * D), recent = iso(EARLY - 2 * D);
  const c = (id, at) => ({ runId: id, projectId: 'local:p', at, renderedAt: at, pass: false, fields: [{ field: 'duration', pass: false }] });
  const h = await home({
    checks: { 'local:gone-old': c('local:gone-old', old), 'local:kept-listed': c('local:kept-listed', old), 'local:gone-recent': c('local:gone-recent', recent) },
    acted: { 'approve:local:gone-old': 'held', 'fundsretry:legacy': 'tried', 'approve:local:kept-listed': 'held' },
    actedAt: { 'approve:local:gone-old': old, 'approve:local:kept-listed': old },
  });
  const listed = { id: 'local:kept-listed', local: true, projectId: 'local:p', status: 'completed', finalPath: '/x.mp4', updatedAt: old, estUsd: 0 };
  const checked = [];
  await tick({ call: caller({}), now: EARLY, home: h, ...brainDirs(h), local: async () => ({ projects: [], stages: [], runs: [listed] }), check: async (r) => { checked.push(r.id); throw new Error('x'); } });
  const st = JSON.parse(await readFile(path.join(h, 'state.json'), 'utf8'));
  assert.deepEqual(Object.keys(st.checks).sort(), ['local:gone-recent', 'local:kept-listed']);
  assert.deepEqual(checked, [], 'a listed run keeps its check: no re-check');
  assert.deepEqual(Object.keys(st.acted).sort(), ['approve:local:kept-listed', 'fundsretry:legacy']);
  assert.ok(Date.parse(st.actedAt['fundsretry:legacy']) === EARLY, 'a legacy entry is stamped now (pruned 30 d later)');
});

test('T16 a failed local read never prunes local checks', async () => {
  const { tick } = await import('../brain.mjs?t16b');
  const old = iso(EARLY - 40 * D);
  const h = await home({ checks: { 'local:j': { runId: 'local:j', projectId: 'local:p', at: old, renderedAt: old, pass: true, fields: [] } } });
  await tick({ call: caller({}), now: EARLY, home: h, ...brainDirs(h), local: async () => { throw new Error('disk gone'); } });
  const st = JSON.parse(await readFile(path.join(h, 'state.json'), 'utf8'));
  assert.ok(st.checks['local:j']);
});

test('rules PR: the default proposer uses tick({ adStudioRoot }), not the module ROOT', async () => {
  const modRoot = await mkdtemp(path.join(tmpdir(), 'vb-modroot-'));
  const optRoot = await mkdtemp(path.join(tmpdir(), 'vb-optroot-'));
  process.env.AD_STUDIO_ROOT = path.join(modRoot, 'not-a-repo');
  const { tick } = await import('../brain.mjs?rootopt');
  delete process.env.VIDEO_BRAIN_RULES_PR;
  try {
    const h = await home();
    // both paths are not git repos: git -C <root> fetch fails at once (no network, no PR); the stored error names the root used
    await tick({ call: caller({}), now: EARLY, home: h, skillsDir: path.join(optRoot, 'skills'), adStudioRoot: path.join(optRoot, 'ad'), local: empty });
    const st = JSON.parse(await readFile(path.join(h, 'state.json'), 'utf8'));
    assert.match(st.rulesPr?.error || '', new RegExp(path.join(optRoot, 'ad').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(!(st.rulesPr?.error || '').includes(modRoot));
  } finally { process.env.VIDEO_BRAIN_RULES_PR = '0'; delete process.env.AD_STUDIO_ROOT; }
});

test('rules PR: .git/info/exclude gets each node_modules line once, however many attempts', async () => {
  const adRoot = await mkdtemp(path.join(tmpdir(), 'vb-ad-'));
  await mkdir(path.join(adRoot, 'node_modules')); await mkdir(path.join(adRoot, 'renderer', 'node_modules'), { recursive: true });
  const gitDir = await mkdtemp(path.join(tmpdir(), 'vb-gitdir-'));
  await mkdir(path.join(gitDir, 'info')); await writeFile(path.join(gitDir, 'info', 'exclude'), '# git ls-files --others --exclude-from=.git/info/exclude\n');
  const L = [{ id: 'L1', status: 'confirmed', scope: 'global', rule: 'a' }];
  let n = 0;
  const sh = async (cmd, args) => {
    if (cmd === 'git' && args[2] === 'show') return { stdout: '{"rules":[]}' };
    if (cmd === 'git' && args[2] === 'worktree' && args[3] === 'add') { await mkdir(path.join(args[7], 'pipeline'), { recursive: true }); await mkdir(path.join(args[7], 'renderer'), { recursive: true }); return { stdout: '' }; }
    if (cmd === 'git' && args[2] === 'rev-parse') return { stdout: path.join(gitDir, 'info', 'exclude') + '\n' };
    if (cmd === 'node' && ++n <= 3) throw Object.assign(new Error('Command failed'), { stdout: 'not ok 1' });
    if (cmd === 'gh' && args[1] === 'create') return { stdout: 'https://github.com/x/pull/9\n' };
    if (cmd === 'gh' && args[1] === 'view') return { stdout: JSON.stringify({ state: 'OPEN', headRefName: `brain/rules-${hashOf(rulesFile(L))}`, files: [{ path: 'pipeline/brain-rules.json' }] }) };
    return { stdout: '' };
  };
  for (let i = 0; i < 3; i++) await assert.rejects(proposeRules(adRoot, L, {}, { sh }));
  assert.equal((await proposeRules(adRoot, L, {}, { sh })).action, 'opened');
  const ex = await readFile(path.join(gitDir, 'info', 'exclude'), 'utf8');
  assert.equal((ex.match(/^\/node_modules$/gm) || []).length, 1, ex);
  assert.equal((ex.match(/^\/renderer\/node_modules$/gm) || []).length, 1, ex);
  assert.match(ex, /^# git ls-files/m, 'existing lines kept');
});

test('advisory fields (pipeline review) never count as a failure in the digest or the check event', async () => {
  const at = '2026-11-26T16:00:00.000Z';
  const adv = { field: 'pipeline review', name: 'pipeline review', expected: '>= 7', actual: '3/10', pass: false, advisory: true };
  const onlyAdv = { runId: 'a', projectId: C(1), at, renderedAt: at, pass: true, fields: [{ field: 'url', pass: true }, adv] };
  const mixed = { runId: 'b', projectId: C(2), at, renderedAt: at, pass: false, fields: [adv, { field: 'duration', actual: '26 s', pass: false }] };
  const text = buildDigest({ at, loops: [], checks: [onlyAdv, mixed] });
  assert.match(text, /未通过 1 条/);
  assert.ok(!/pipeline review/.test(text), text);
  assert.match(text, /（1 条）: duration 26 s/);
  assert.match(text, /可交付（复查通过，24 h 内）1 条/);
  const { tick } = await import('../brain.mjs?advisory');
  const h = await home();
  const pubs = [];
  const run = { id: 'local:adv', local: true, projectId: 'local:p', status: 'completed', finalPath: '/x.mp4', updatedAt: iso(EARLY - H), estUsd: 0 };
  await tick({ call: caller({}, pubs), now: EARLY, home: h, ...brainDirs(h), local: async () => ({ projects: [], stages: [], runs: [run] }), check: async (r) => ({ runId: r.id, projectId: r.projectId, at: iso(EARLY), renderedAt: r.updatedAt, pass: false, fields: [adv, { field: 'loudness', actual: '-20 LUFS', pass: false }] }) });
  const e = pubs[0].events.find((x) => /second check FAILED/.test(x.summary));
  assert.ok(e && /loudness -20 LUFS/.test(e.summary) && !/pipeline review/.test(e.summary), e?.summary);
});
