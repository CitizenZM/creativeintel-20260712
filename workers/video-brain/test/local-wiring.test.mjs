// tests never message Barron or call the model
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('tick wiring: local Ad Studio jobs join the loops; own jobs approved via the local API, Xark-managed held', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-local-'));
  process.env.VIDEO_BRAIN_SKILLS_DIR = path.join(home, 'skills'); process.env.AD_STUDIO_ROOT = path.join(home, 'ad');
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: new Date(now).toISOString(), patternsAt: new Date(now).toISOString() }));
  const { tick } = await import('../brain.mjs?local');
  const { toRun } = await import('../lib/local.mjs');
  const t = new Date(now - 3_600_000).toISOString();
  const own = toRun('own1', { projectId: 'p1' }, { state: 'approval', started: t, estimate: { usd: 1 } }, null);
  const xk = toRun('xk-1', { source: 'xark' }, { state: 'approval', started: t, estimate: { usd: 1 } }, null);
  const local = async () => ({ projects: [{ id: 'local:p1', name: 'Moneta (Ad Studio local)', updatedAt: t }, { id: 'local:xark-lab', name: 'Xark lab', updatedAt: t }], stages: [], runs: [own, xk, toRun('done1', { projectId: 'p1' }, { state: 'done', finished: t }, '/nonexistent/final.mp4')] });
  const approved = [];
  const approveLocal = async (id) => { approved.push(id); return { ok: true, state: 'running' }; };
  const calls = [];
  const call = async (action, body = {}) => {
    calls.push(action);
    if (action === 'observe') return { status: 200, policy: { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [] };
    if (action === 'publish') return { status: 200, ok: true, verified: true, snapshot: body.snapshot };
    return { status: 200, ok: true };
  };
  let published;
  const wrapped = async (a, b) => { const r = await call(a, b); if (a === 'publish') published = b.snapshot; return r; };
  const critiqued = [];
  const critic = async (v, d) => { critiqued.push([v, d]); return { model: 'google/x', scores: { first_frame: 3, product_clear: 3, consistency: 3, no_garbled_text: 2, sells: 3, issues: ['garbled label'] }, avg: 2.8, pass: false }; };
  const r = await tick({ call: wrapped, now, home, strategist: null, local, approveLocal, critic });
  assert.equal(r.ok, true);
  assert.deepEqual(approved, ['own1']);
  assert.ok(!calls.includes('approve'), 'local jobs never go to the server approve');
  assert.equal(published.loops.length, 2);
  assert.ok(published.events.some((e) => /managed by Xark/.test(e.summary)));
  assert.equal(published.spend.autoApprovedTodayUsd, 1.3);
  assert.ok(!calls.includes('batch'), 'local projects never get a server batch');
  // local finished videos get the second check too (regression: only URL runs were checked)
  assert.equal(published.checks.length, 1); assert.equal(published.checks[0].runId, 'local:done1'); assert.equal(published.checks[0].pass, false);
  // the critic only runs when the file probed (no duration for a missing file)
  assert.equal(critiqued.length, 0);
});

test('readLocal skips xk-* job dirs by name before reading any of their files', async () => {
  const { createRequire, syncBuiltinESMExports } = await import('node:module');
  const fsp = createRequire(import.meta.url)('node:fs/promises');
  const root = await mkdtemp(path.join(tmpdir(), 'vb-xk-'));
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(root, 'data', 'jobs', 'xk-abc'), { recursive: true });
  await writeFile(path.join(root, 'data', 'jobs', 'xk-abc', 'job.json'), '{not json');
  await mkdir(path.join(root, 'data', 'jobs', 'own1'), { recursive: true });
  await writeFile(path.join(root, 'data', 'jobs', 'own1', 'job.json'), JSON.stringify({ projectId: 'p1' }));
  await writeFile(path.join(root, 'data', 'jobs', 'own1', 'status.json'), JSON.stringify({ state: 'done' }));
  const orig = fsp.readFile; const xkReads = [];
  fsp.readFile = (f, ...a) => { if (/[\\/]xk-/.test(String(f))) xkReads.push(String(f)); return orig(f, ...a); };
  syncBuiltinESMExports();
  try {
    const { readLocal } = await import('../lib/local.mjs?xk-skip');
    const r = await readLocal(root);
    assert.deepEqual(xkReads, [], 'no file of an xk-* job is read');
    assert.deepEqual(r.runs.map((x) => x.id), ['local:own1']);
  } finally { fsp.readFile = orig; syncBuiltinESMExports(); }
});
