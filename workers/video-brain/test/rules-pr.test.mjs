// rules PR recovery: a failed attempt must not leave a branch that blocks every later attempt (`worktree add -b` →
// "already exists" was the cause of the stuck brain/rules-* branches), the worktree gets the deps the tests need, the PR
// is re-read before it counts as opened, and the brain stops retrying the same failing hash for 24 h.
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0'; process.env.VIDEO_BRAIN_HARVEST = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brainDirs } from './helpers/brain-dirs.mjs';
import { plan, hashOf, rulesFile, proposeRules } from '../lib/rules-pr.mjs';

const L = [{ id: 'L1', status: 'confirmed', scope: 'global', rule: 'a' }];

/** stateful fake shell: local branches, a scripted node --test result, a scripted gh pr view */
async function fakeShell({ adRoot, failTests = 1, view = null } = {}) {
  const branches = new Set(); const cmds = []; let tests = 0; let wt; const linkChecks = [];
  const gitDir = await mkdtemp(path.join(tmpdir(), 'vb-gitdir-'));
  const sh = async (cmd, args) => {
    cmds.push([cmd, ...args].join(' '));
    if (cmd === 'git' && args[2] === 'show') return { stdout: '{"rules":[]}' };
    if (cmd === 'git' && args[2] === 'worktree' && args[3] === 'add') {
      const [flag, branch, dir] = args.slice(5, 8);
      if (flag === '-b' && branches.has(branch)) throw Object.assign(new Error('Command failed'), { stderr: `fatal: a branch named '${branch}' already exists` });
      branches.add(branch); wt = dir;
      await mkdir(path.join(wt, 'pipeline'), { recursive: true }); await mkdir(path.join(wt, 'renderer'), { recursive: true });
      return { stdout: '' };
    }
    if (cmd === 'git' && args[2] === 'rev-parse') return { stdout: path.join(gitDir, 'info', 'exclude') + '\n' };
    if (cmd === 'git' && args[2] === 'branch' && args[3] === '-D') { branches.delete(args[4]); return { stdout: '' }; }
    if (cmd === 'node') {
      if (adRoot) for (const p of ['node_modules', path.join('renderer', 'node_modules')]) linkChecks.push([p, await lstat(path.join(wt, p)).then((s) => s.isSymbolicLink()).catch(() => false)]);
      if (++tests <= failTests) throw Object.assign(new Error('Command failed: node --test'), { stdout: 'not ok 1 - brain rules reach the prompt\n# fail 1\n' });
      return { stdout: 'ok' };
    }
    if (cmd === 'gh' && args[1] === 'create') return { stdout: 'https://github.com/x/pull/9\n' };
    if (cmd === 'gh' && args[1] === 'view') {
      const branch = [...branches].pop();
      return { stdout: JSON.stringify(view ?? { state: 'OPEN', headRefName: branch, files: [{ path: 'pipeline/brain-rules.json', additions: 3, deletions: 1 }] }) };
    }
    return { stdout: '' };
  };
  return { sh, cmds, branches, linkChecks, gitDir, get wt() { return wt; } };
}

test('(a)(b) a failed attempt deletes its unpushed branch; the retry is not blocked and returns opened', async () => {
  const f = await fakeShell();
  const hash = hashOf(rulesFile(L));
  const err = await proposeRules('/repo', L, {}, { sh: f.sh }).then(() => null, (e) => e);
  assert.ok(err, 'first attempt fails at node --test');
  assert.match(err.message, /node --test/); assert.match(err.message, /not ok 1 - brain rules reach the prompt/);
  assert.equal(err.hash, hash);
  const remove = f.cmds.findIndex((c) => c.includes('worktree remove')); const del = f.cmds.findIndex((c) => c === `git -C /repo branch -D brain/rules-${hash}`);
  assert.ok(remove >= 0 && del > remove, f.cmds.join('\n'));
  assert.ok(!f.branches.has(`brain/rules-${hash}`));
  // even a branch left over from an older version of the code (the real brain/rules-* leftovers) no longer blocks
  f.branches.add(`brain/rules-${hash}`);
  const r = await proposeRules('/repo', L, {}, { sh: f.sh });
  assert.equal(r.action, 'opened'); assert.equal(r.url, 'https://github.com/x/pull/9'); assert.equal(r.hash, hash);
  assert.ok(f.cmds.some((c) => c.includes(`worktree add -q -B brain/rules-${hash}`)));
  // pushed → the branch is kept (the PR needs it)
  assert.equal(f.cmds.filter((c) => c.includes('branch -D')).length, 1);
});

test('(c)(d) the worktree gets symlinked node_modules, excluded from git; only brain-rules.json is added', async () => {
  const adRoot = await mkdtemp(path.join(tmpdir(), 'vb-ad-'));
  await mkdir(path.join(adRoot, 'node_modules')); await mkdir(path.join(adRoot, 'renderer', 'node_modules'), { recursive: true });
  const f = await fakeShell({ adRoot, failTests: 0 });
  const r = await proposeRules(adRoot, L, {}, { sh: f.sh });
  assert.equal(r.action, 'opened');
  assert.deepEqual(f.linkChecks, [['node_modules', true], [path.join('renderer', 'node_modules'), true]]);
  const ex = await readFile(path.join(f.gitDir, 'info', 'exclude'), 'utf8');
  assert.match(ex, /^\/node_modules$/m); assert.match(ex, /^\/renderer\/node_modules$/m);
  const adds = f.cmds.filter((c) => / add /.test(c) && !c.includes('worktree add'));
  assert.deepEqual(adds.map((c) => c.split(' add ')[1]), ['pipeline/brain-rules.json']);
  assert.ok(!f.cmds.some((c) => /npm|pnpm/.test(c)), 'never installs');
});

test('(e) second check: the PR as re-read must be OPEN, on the branch, touching only brain-rules.json', async () => {
  for (const view of [{ state: 'OPEN', headRefName: 'x', files: [{ path: 'pipeline/brain-rules.json' }] }, { state: 'CLOSED', headRefName: null, files: [{ path: 'pipeline/brain-rules.json' }] }, { state: 'OPEN', headRefName: null, files: [{ path: 'x' }] }]) {
    const f = await fakeShell({ failTests: 0, view: view.headRefName === null ? { ...view, headRefName: `brain/rules-${hashOf(rulesFile(L))}` } : view });
    await assert.rejects(proposeRules('/repo', L, {}, { sh: f.sh }), /rules PR second check failed/);
  }
});

test('(f) plan: the same failing hash waits 24 h; a new hash or an expired failure opens again', () => {
  const desired = rulesFile(L); const now = Date.now();
  const failed = { failedHash: hashOf(desired), failedAt: new Date(now).toISOString(), error: 'x' };
  assert.deepEqual(plan('', desired, failed, now), { action: 'failed', hash: hashOf(desired) });
  assert.equal(plan('', rulesFile([...L, { id: 'L2', status: 'confirmed', scope: 'global', rule: 'b' }]), failed, now).action, 'open');
  assert.equal(plan('', desired, { ...failed, failedAt: new Date(now - 25 * 3_600_000).toISOString() }, now).action, 'open');
});

test('tick wiring: a rules PR failure is stored with its hash and reported once, not every hour', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-rp-'));
  const { tick } = await import('../brain.mjs?rules-pr');
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: new Date(now).toISOString(), patternsAt: new Date(now).toISOString() }));
  const pubs = [];
  const call = async (a, b = {}) => {
    if (a === 'observe') return { status: 200, policy: { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [] };
    if (a === 'publish') { pubs.push(b.snapshot); return { status: 200, ok: true, verified: true }; }
    return { status: 200, ok: true };
  };
  const seen = [];
  const rulesPr = async (l, s) => { seen.push(s); throw Object.assign(new Error('node --test failed: not ok 1'), { hash: 'abcd1234', step: 'node --test' }); };
  const empty = async () => ({ projects: [], stages: [], runs: [] });
  for (const t of [now, now + 2 * 3_600_000]) await tick({ call, now: t, home, ...brainDirs(home), strategist: null, harvestDirs: null, local: empty, rulesPr });
  const st = JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8'));
  assert.equal(st.rulesPr.failedHash, 'abcd1234'); assert.match(st.rulesPr.error, /not ok 1/); assert.ok(Date.parse(st.rulesPr.failedAt) > 0);
  assert.equal(seen[1].failedHash, 'abcd1234', 'the stored failure reaches the next attempt (plan skips it for 24 h)');
  const blocked = pubs.flatMap((p) => p.events || []).filter((e) => /rules PR blocked/.test(e.summary));
  assert.equal(blocked.length, 1, JSON.stringify(blocked));
  assert.equal(blocked[0].summary, 'rules PR blocked: node --test for abcd1234');
});
