// tests never message Barron or call the model
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brainDirs } from './helpers/brain-dirs.mjs';
import { aggregate } from '../lib/incidents.mjs';
import * as brain from '../brain.mjs';
import { tick, pruneState, PRUNE_AFTER_MS } from '../brain.mjs';

const H = 3_600_000;
const E402 = 'OpenRouter 402: {"error":{"message":"This request requires more credits. You requested up to 4096 tokens","code":402}}';
const ECONN = 'fetch failed: ECONNRESET';
const failed = (id, error, at) => ({ id, status: 'failed', error, updatedAt: new Date(at).toISOString() });

test('V2 aggregate: a funds incident quiet for > 72 h stays open while funds are out; resolves once funds are back', () => {
  const now = Date.now();
  const inc = aggregate({}, [failed('r1', E402, now - 80 * H), failed('r2', ECONN, now - 80 * H)], now - 79 * H);
  const out = aggregate(inc, [], now, { fundsOut: true });
  const byKind = Object.fromEntries(Object.values(out).map((v) => [v.kind, v.status]));
  assert.equal(byKind.human, 'open', 'the 402 incident stays open while the balance probe fails');
  assert.equal(byKind.platform, 'resolved', 'other incidents still resolve on the 72 h rule');
  assert.equal(Object.values(aggregate(inc, [], now)).find((v) => v.kind === 'human').status, 'resolved', 'funds back: 72 h rule applies');
});

const observe = () => ({ status: 200, policy: { autoApprove: false, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [] });
const rig = async (now, state) => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-r5-'));
  // probesAt is fresh: runProbes (live balance/model calls) never runs; the stored probe result is the stub
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, patterns: [], loopStatus: {}, acted: {}, probesAt: new Date(now).toISOString(), patternsAt: new Date(now).toISOString(), syncHash: 'x', ...state }));
  let pub; const call = async (a, b = {}) => (a === 'observe' ? observe() : a === 'publish' ? ((pub = b.snapshot), { status: 200, ok: true, verified: true }) : { status: 200, ok: true });
  return { home, call, snap: () => pub, state: async () => JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8')) };
};

test('V2 wiring: tick keeps the 402 incident open past 72 h while the stubbed balance probe fails', async () => {
  const now = Date.now();
  const incidents = aggregate({}, [failed('r1', E402, now - 80 * H)], now - 79 * H);
  for (const [ok, want] of [[false, 'open'], [true, 'resolved']]) {
    const r = await rig(now, { incidents, probes: [{ name: 'openrouter balance', ok, detail: ok ? '$5.00 left' : '$0.00 left' }] });
    await tick({ call: r.call, now, home: r.home, ...brainDirs(r.home), local: async () => ({ projects: [], stages: [], runs: [] }) });
    assert.equal(Object.values((await r.state()).incidents)[0].status, want, `balance ok=${ok}`);
  }
});

test('V7 pruneState: batch entries are kept like local ones when the local read failed', () => {
  const now = Date.now(); const old = new Date(now - PRUNE_AFTER_MS - H).toISOString();
  const mk = () => ({ checks: { 'local:j1': { at: old }, 'batch:acw-bf:a.mp4': { at: old }, srv1: { at: old } }, acted: {}, actedAt: {} });
  const s = mk(); pruneState(s, [], now, { localOk: false });
  assert.deepEqual(Object.keys(s.checks).sort(), ['batch:acw-bf:a.mp4', 'local:j1']);
  const s2 = mk(); pruneState(s2, [], now); assert.deepEqual(Object.keys(s2.checks), []);
});

test('V7 defaultLocal: a failing jobs read keeps the batch runs (and vice versa) and names the failed source', async () => {
  assert.equal(typeof brain.defaultLocal, 'function');
  const part = (id) => ({ projects: [{ id }], stages: [], runs: [{ id: `${id}:r` }] });
  const a = await brain.defaultLocal({ readJobs: async () => { throw new Error('EACCES jobs'); }, readBatch: async () => part('batch:x') });
  assert.deepEqual(a.runs.map((r) => r.id), ['batch:x:r']); assert.match(a.failed.join(), /local: EACCES jobs/);
  const b = await brain.defaultLocal({ readJobs: async () => part('local:j'), readBatch: async () => { throw new Error('bad csv'); } });
  assert.deepEqual(b.runs.map((r) => r.id), ['local:j:r']); assert.match(b.failed.join(), /batch: bad csv/);
  await assert.rejects(brain.defaultLocal({ readJobs: async () => { throw new Error('x'); }, readBatch: async () => { throw new Error('y'); } }));
});

test('V7 wiring: a partial local read (failed listed) keeps old batch checks through the prune', async () => {
  const now = Date.now(); const old = new Date(now - PRUNE_AFTER_MS - H).toISOString();
  const r = await rig(now, { probes: [], checks: { 'batch:acw-bf:a.mp4': { runId: 'batch:acw-bf:a.mp4', projectId: 'batch:acw-bf', at: old, pass: true, fields: [] } } });
  await tick({ call: r.call, now, home: r.home, ...brainDirs(r.home), local: async () => ({ projects: [], stages: [], runs: [], failed: ['batch: bad csv'] }) });
  assert.ok((await r.state()).checks['batch:acw-bf:a.mp4'], 'kept: its run is missing this tick, not gone');
});

test('V4 label: batch runs are named by file (no "le.mp4"); other ids keep their last 6 chars; event text uses it', async () => {
  assert.equal(typeof brain.label, 'function');
  assert.equal(brain.label('batch:acw-bf:03-cozy-throw.mp4'), '03-cozy-throw');
  assert.equal(brain.label('batch:noir:sub/clip.MP4'), 'clip');
  assert.equal(brain.label('cmabcdefghijklmnopqrst'), 'opqrst');
  const src = await readFile(new URL('../brain.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\.id\.slice\(-6\)/, 'every event uses label()');
});
