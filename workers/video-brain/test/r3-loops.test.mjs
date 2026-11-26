// Round 3: X2 (xk-* mirrors skipped), LB11 (local done before ad-data wait; funds recovery waits), ST8 (memo step + deep link),
// SP16 (measure before stalled), DG15 (digest names failed checks and deliverables)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readLocal } from '../lib/local.mjs';
import { loopOf } from '../lib/think.mjs';
import { apply, pick, memoFor } from '../lib/strategist.mjs';
import { buildDigest } from '../lib/digest.mjs';

const H = 3_600_000;
const NOW = Date.parse('2026-11-26T16:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const policy = { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 };
const run = (o) => ({ id: 'r1', projectId: 'p1', status: 'completed', step: null, progress: 0, estUsd: 1, actualUsd: null, finalMp4Url: null, error: null, retries: 0, updatedAt: iso(NOW - H), hookType: 'pain', engine: 'auto', ...o });

test('X2 readLocal: Xark-managed mirrors (xk-*, suffixed, or source xark*) never come out; own jobs do', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vb-x2-'));
  const job = async (id, j, st) => { const d = path.join(root, 'data', 'jobs', id); await mkdir(d, { recursive: true }); await writeFile(path.join(d, 'job.json'), JSON.stringify(j)); await writeFile(path.join(d, 'status.json'), JSON.stringify(st)); };
  await job('xk-abc', { source: 'xark', projectId: 'xark' }, { state: 'running' });
  await job('xk-abc-p0', { source: 'xark', projectId: 'xark' }, { state: 'done' });
  await job('xk-abc-sld', { source: 'xark' }, { state: 'failed', error: 'x' });
  await job('xk-abc-vid', { projectId: 'p9' }, { state: 'done' });
  await job('ref1', { source: 'xark-ref', projectId: 'p2' }, { state: 'queued' });
  await job('own1', { projectId: 'p1' }, { state: 'done' });
  const r = await readLocal(root);
  assert.deepEqual(r.runs.map((x) => x.id), ['local:own1']);
  assert.ok(!r.runs.some((x) => /^local:xk-/.test(x.id)));
  assert.deepEqual(r.projects.map((p) => p.id), ['local:p1']);
});

test('LB11 local/batch loop with a delivered video is done at once (no 72 h ad-data wait)', () => {
  for (const id of ['local:p1', 'batch:b1']) {
    const l = loopOf({ id, name: 'L', updatedAt: iso(NOW - 2 * H) }, null, [run({ projectId: id, finalPath: '/x.mp4' })], [], 0, { r1: { pass: true, fields: [] } }, policy, 0, NOW);
    assert.equal(l.status, 'done'); assert.equal(l.waitingOn, null);
  }
  const s = loopOf({ id: 'p1', name: 'S', updatedAt: iso(NOW - 2 * H) }, null, [run({ finalMp4Url: 'https://x' })], [], 0, { r1: { pass: true, fields: [] } }, policy, 0, NOW);
  assert.equal(s.waitingOn, 'ad-data');
});

test('LB11 a recovery loop failed on 402/balance/credit waits on funds', () => {
  for (const error of ['OpenRouter 402 Payment Required', 'insufficient balance', 'out of credits']) {
    const l = loopOf({ id: 'p1', name: 'F', updatedAt: iso(NOW - H) }, null, [run({ status: 'failed', error })], [], 0, {}, policy, 0, NOW);
    assert.equal(l.stage, 'recover'); assert.equal(l.status, 'waiting'); assert.equal(l.waitingOn, 'funds'); assert.equal(l.nextAction, 'raise the OpenRouter key cap');
  }
  const other = loopOf({ id: 'p1', name: 'F', updatedAt: iso(NOW - H) }, null, [run({ status: 'failed', error: 'ffmpeg exited 1' })], [], 0, {}, policy, 0, NOW);
  assert.notEqual(other.waitingOn, 'funds');
});

const OUT = { hypothesis: 'h', nextAction: 'Run the teardown', verifyHow: 'v', checkpointHours: 6, owner: 'Strategist' };
test('ST8 apply: a memo applies only while its step matches; legacy memo without step still applies; deep link re-appended', () => {
  const loop = { projectId: 'a', step: 'insights', doing: 'd', agent: 'Researcher', nextAction: 'Run teardown → https://creative.xark.io/projects/a/insights' };
  const m = memoFor(loop, OUT);
  assert.equal(m.step, 'insights'); assert.deepEqual(m.out, OUT);
  const memo = { a: { ...m, at: iso(NOW - H) } };
  const out = apply([loop], memo, NOW)[0];
  assert.equal(out.nextAction, 'Run the teardown → https://creative.xark.io/projects/a/insights');
  assert.equal(apply([{ ...loop, step: 'creative' }], memo, NOW)[0].nextAction, loop.nextAction, 'step moved on: memo ignored');
  const legacy = { a: { at: iso(NOW - H), day: 'x', out: OUT } };
  assert.match(apply([{ ...loop, step: 'creative' }], legacy, NOW)[0].nextAction, /^Run the teardown/);
  const withLink = { a: { ...m, at: iso(NOW - H), out: { ...OUT, nextAction: 'Open https://creative.xark.io/projects/a/insights now' } } };
  assert.equal(apply([loop], withLink, NOW)[0].nextAction, 'Open https://creative.xark.io/projects/a/insights now');
  assert.equal(apply([{ ...loop, nextAction: 'plain' }], memo, NOW)[0].nextAction, 'Run the teardown');
});

test('SP16 pick: measure loops before stalled ones', () => {
  const loops = [{ projectId: 's1', status: 'idle-defect', step: 'setup' }, { projectId: 'm1', status: 'active', step: 'measure' }, { projectId: 's2', status: 'idle-defect', step: 'insights' }];
  assert.deepEqual(pick(loops, {}, NOW).map((l) => l.projectId), ['m1', 's1', 's2']);
  assert.deepEqual(pick(loops, {}, NOW, 1).map((l) => l.projectId), ['m1']);
});

const C1 = 'cmw7achmt0002vritoqg6xh4d', C3 = 'cmw6n5bnn000btkitkc73qxy4', C4 = 'cmw6n6agh000ctkit3byjpn7o';
test('DG15 digest names failed checks per project with links and lists deliverables of the last 24 h', () => {
  const at = iso(Date.now());
  const loops = [{ projectId: C1, name: 'Nike' }, { projectId: 'local:p2', name: 'Moneta (Ad Studio local)' }, { projectId: C3, name: 'TCL' }, { projectId: C4, name: 'Oufer' }];
  const bad = (projectId, field) => ({ runId: `r-${projectId}-${field}`, projectId, at, renderedAt: at, pass: false, fields: [{ field: 'url', pass: true }, { field, pass: false, actual: '1', expected: '2' }] });
  const ok = (projectId, h = 1) => ({ runId: `ok-${projectId}-${h}`, projectId, at: iso(Date.now() - h * H), renderedAt: at, pass: true, fields: [] });
  const checks = [bad(C1, 'duration'), bad('local:p2', 'loudness'), bad(C3, 'duration'), bad(C4, 'url'), ok(C1), ok('local:p2'), ok(C3), ok(C4), ok(C4, 30)];
  const text = buildDigest({ at, loops, checks });
  assert.match(text, /近 7 天成片二次复查未通过 4 条/);
  // round 4: one line per project with a count and the first failing value
  assert.match(text, new RegExp(`- Nike（1 条）: duration 1 → https://creative\\.xark\\.io/projects/${C1}/deliver`));
  assert.match(text, /- Moneta \(Ad Studio local\)（1 条）: loudness 1\n/);
  assert.ok(!/projects\/local:p2/.test(text));
  assert.match(text, /- Oufer（1 条）: url 1/, 'up to 6 projects named');
  assert.match(text, /可交付（复查通过，24 h 内）4 条/);
  assert.equal((text.match(/\/deliver/g) || []).length, 6, '3 failed-check links + 3 deliverable links');
  const plain = buildDigest({ at, loops: [], checks: [] });
  assert.ok(!/可交付/.test(plain), 'no line when nothing to deliver');
});

test('LB11b local/batch funds failure stays blocked (fundsRetries skips local runs) but names funds', () => {
  for (const id of ['local:20261105-ms1z7', 'batch:b1']) {
    const l = loopOf({ id, name: 'L', updatedAt: iso(NOW - H) }, null, [run({ projectId: id, local: true, status: 'failed', error: 'OpenRouter 402 Payment Required' })], [], 0, {}, policy, 0, NOW);
    assert.equal(l.status, 'blocked'); assert.equal(l.waitingOn, 'funds'); assert.equal(l.nextAction, 'raise the OpenRouter key cap, then re-run the job');
  }
});

test('DG15b deliver links only for server cuids', () => {
  const at = iso(Date.now());
  const bad = (projectId) => ({ runId: `r-${projectId}`, projectId, at, renderedAt: at, pass: false, fields: [{ field: 'duration', pass: false }] });
  const text = buildDigest({ at, loops: [], checks: [bad('p1'), bad('weird/../id'), bad(C1)] });
  assert.equal((text.match(/\/deliver/g) || []).length, 1);
  assert.match(text, new RegExp(`/projects/${C1}/deliver`));
});

test('DG15c deliverables one line per project with a video count; stale xk mirror checks skipped', () => {
  const at = iso(Date.now());
  const ok = (projectId, runId) => ({ runId, projectId, at, renderedAt: at, pass: true, fields: [] });
  const bad = (projectId) => ({ runId: `b-${projectId}`, projectId, at, renderedAt: at, pass: false, fields: [{ field: 'loudness', pass: false }] });
  const text = buildDigest({ at, loops: [{ projectId: C1, name: 'Nike' }], checks: [ok(C1, 'a'), ok(C1, 'b'), ok(C1, 'c'), ok(C3, 'd'), bad('local:xk-cmw7achmt0002vritoqg6xh4d'), bad('local:xark-lab'), bad(C4)] });
  assert.match(text, /可交付（复查通过，24 h 内）4 条/);
  assert.equal((text.match(new RegExp(`/projects/${C1}/deliver`, 'g')) || []).length, 1, 'one line per project');
  assert.match(text, /- Nike（3 条）/);
  assert.ok(!/xk-|xark-lab/.test(text), 'stale mirror checks not listed');
  assert.match(text, /近 7 天成片二次复查未通过 1 条/);
});
