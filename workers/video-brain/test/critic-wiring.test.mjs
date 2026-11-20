// tests never message Barron or call the model
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('tick wiring: a probed finished video gets the second-family critic, capped per day', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-critic-'));
  const mp4 = path.join(home, 'final.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1080x1920:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4]);
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: new Date(now).toISOString(), patternsAt: new Date(now).toISOString(), syncHash: 'x', criticDay: { day: new Date(now).toISOString().slice(0, 10), n: 9 } }));
  const { tick } = await import('../brain.mjs?critic');
  const { toRun } = await import('../lib/local.mjs');
  const t = new Date(now - 3_600_000).toISOString();
  const runs = [toRun('v1', { projectId: 'p' }, { state: 'done', finished: t }, mp4), toRun('v2', { projectId: 'p' }, { state: 'done', finished: t }, mp4)];
  const seen = [];
  const critic = async (v, d) => { seen.push(d); return { model: 'google/x', scores: { first_frame: 8, product_clear: 8, consistency: 8, no_garbled_text: 9, sells: 7, issues: [] }, avg: 8, pass: true }; };
  let pub;
  const call = async (a, b = {}) => a === 'observe' ? { status: 200, policy: { autoApprove: false, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [] } : a === 'publish' ? ((pub = b.snapshot), { status: 200, ok: true, verified: true }) : { status: 200 };
  await tick({ call, now, home, local: async () => ({ projects: [{ id: 'local:p', name: 'P', updatedAt: t }], stages: [], runs }), critic });
  assert.equal(seen.length, 1, 'day cap 10: one call left');
  assert.ok(Math.abs(seen[0] - 6) < 0.2);
  const withC = pub.checks.filter((c) => c.fields.some((f) => /^critic/.test(f.field)));
  assert.equal(withC.length, 1); assert.equal(withC[0].fields.find((f) => /^critic/.test(f.field)).pass, true);
  assert.ok(pub.events.some((e) => /google\/x on/.test(e.summary)));
});
