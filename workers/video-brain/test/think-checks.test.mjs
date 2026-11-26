// A failed second check on a fresh, post-baseline render blocks the loop and opens a fix task (no retry/claim/generate).
// tests never message Barron or call the model
process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { think, loopOf } from '../lib/think.mjs';
import { PIPELINE_BASELINE } from '../lib/learn.mjs';

const H = 3_600_000;
const NOW = Date.parse('2026-11-25T12:00:00Z');
const policy = { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 };
const iso = (ms) => new Date(ms).toISOString();
const run = (o) => ({ id: 'r1', projectId: 'p1', status: 'completed', step: null, progress: 100, estUsd: 1, actualUsd: null, finalMp4Url: 'https://x/v.mp4', error: null, metrics: null, retries: 0, hookType: 'pain', engine: 'auto', ...o });
const project = { id: 'p1', name: 'Mixik', brandName: 'MIXIK', updatedAt: iso(NOW - 2 * H) };
const stages = { projectId: 'p1', stages: ['setup', 'research', 'insights', 'creative', 'studio'].map((id) => ({ id, state: 'done' })) };
const failCheck = (r) => ({ [r.id]: { runId: r.id, projectId: r.projectId, renderedAt: r.updatedAt, pass: false, fields: [{ field: 'duration', expected: '5-24.5 s', actual: '31.80 s', pass: false }, { field: 'aspect', expected: '9:16', actual: '1080x1920', pass: true }] } });
const passCheck = (r) => ({ [r.id]: { ...failCheck(r)[r.id], pass: true, fields: [] } });
const loop = (r, checks, now) => loopOf(project, stages, [r], [], 0, checks, policy, 0, now);
const obsOf = (r) => ({ policy, spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], projects: [project], stages: [stages], runs: [r] });

test('(a) fresh post-baseline failed check -> verify/blocked, Doctor, no legal wait, failing field in doing', () => {
  const r = run({ updatedAt: iso(NOW - H) });
  const l = loop(r, failCheck(r), NOW);
  assert.equal(l.stage, 'verify'); assert.equal(l.status, 'blocked'); assert.equal(l.waitingOn, null); assert.equal(l.agent, 'Doctor');
  assert.match(l.doing, /duration 31.80/);
  assert.equal(l.doing, 'second check failed: duration 31.80 s (want 5-24.5 s)');
  assert.equal(l.nextAction, 're-render with fitLength');
});

test('(a2) fix hint per field: loudness, critic, other', () => {
  const r = run({ updatedAt: iso(NOW - H) });
  const fields = [{ field: 'loudness', expected: '-14 LUFS', actual: '-20.0 LUFS', pass: false }, { field: 'critic (gemini)', expected: 'avg >= 6', actual: '4', pass: false }, { field: 'aspect', expected: '9:16', actual: '1920x1080', pass: false }];
  const l = loop(r, { r1: { renderedAt: r.updatedAt, pass: false, fields } }, NOW);
  assert.equal(l.nextAction, 're-run audio master; review weak criteria and re-run from script; re-run from the failing step');
});

test('(b) think() recovery gets one fix task for the newest completed run with a duration gate', () => {
  const r = run({ updatedAt: iso(NOW - H) });
  const old = run({ id: 'r0', updatedAt: iso(NOW - 5 * H) });
  const checks = { ...failCheck(r), ...failCheck(old) };
  const out = think({ ...obsOf(r), runs: [old, r] }, checks, NOW);
  const fix = out.recovery.filter((x) => x.kind === 'fix');
  assert.equal(fix.length, 1, 'newest run per loop only');
  assert.equal(fix[0].id, 'r1'); assert.equal(fix[0].status, 'failed'); assert.equal(fix[0].agent, 'QA Critic');
  assert.deepEqual(fix[0].gates, [{ gate: 'duration', pass: false, detail: '31.80 s vs 5-24.5 s' }]);
  assert.equal(out.loops[0].status, 'blocked');
});

test("(c) pre-baseline or 20-day-old failed checks keep today's behaviour", () => {
  const base = Date.parse(PIPELINE_BASELINE);
  const pre = run({ updatedAt: iso(base - 2 * H) });
  const now1 = base + 10 * H;
  const a = loop(pre, failCheck(pre), now1);
  assert.deepEqual(a, loop(pre, passCheck(pre), now1));
  assert.equal(a.step, 'deliver'); assert.equal(a.waitingOn, 'ad-data');
  assert.equal(think(obsOf(pre), failCheck(pre), now1).recovery.length, 0);

  const now2 = Date.parse('2026-12-20T12:00:00Z');
  const stale = run({ updatedAt: iso(now2 - 20 * 24 * H) });
  assert.ok(Date.parse(stale.updatedAt) > base, 'post-baseline but 20 days old');
  const b = loop(stale, failCheck(stale), now2);
  assert.deepEqual(b, loop(stale, passCheck(stale), now2));
  assert.equal(b.step, 'deliver');
  assert.equal(think(obsOf(stale), failCheck(stale), now2).recovery.length, 0);
});

test('(d) wiring: a full tick over a blocking failed check makes no retry/claim/generate calls and publishes the fix task', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-checks-'));
  const skills = path.join(home, 'skills'); await mkdir(skills, { recursive: true });
  const adRoot = path.join(home, 'ad'); await mkdir(adRoot, { recursive: true });
  process.env.VIDEO_BRAIN_SKILLS_DIR = skills; process.env.AD_STUDIO_ROOT = adRoot;
  const now = Date.now();
  const r = run({ updatedAt: iso(now - H) });
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: failCheck(r), incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: iso(now), patternsAt: iso(now), syncHash: 'x' }));
  const { tick } = await import('../brain.mjs?checks');
  const calls = []; let pub;
  const call = async (action, body = {}) => {
    calls.push(action);
    if (action === 'observe') return { status: 200, ...obsOf(r), projects: [{ ...project, updatedAt: iso(now - 2 * H) }], learnings: [], heartbeats: [] };
    if (action === 'publish') { pub = body.snapshot; return { status: 200, ok: true, verified: true }; }
    return { status: 200, ok: true };
  };
  const res = await tick({ call, now, home, local: async () => ({ projects: [], stages: [], runs: [] }) });
  assert.equal(res.ok, true);
  assert.deepEqual(calls.filter((a) => ['retry', 'claim', 'generate', 'approve', 'batch'].includes(a)), []);
  assert.equal(pub.loops[0].status, 'blocked');
  assert.ok(pub.recovery.some((x) => x.kind === 'fix' && x.id === 'r1'));
});
