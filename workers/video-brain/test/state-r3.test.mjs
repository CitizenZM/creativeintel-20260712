// tests never message Barron or call the model
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { link, mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brainDirs } from './helpers/brain-dirs.mjs';
import { fileURLToPath } from 'node:url';
import { tick, acquireLock } from '../brain.mjs';
import { toRun } from '../lib/local.mjs';
import { FRESH_MS, readBatches } from '../lib/batch.mjs';
import { compare } from '../lib/verify.mjs';

const BRAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'brain.mjs');
const day = (now) => new Date(now).toISOString().slice(0, 10);
const baseState = (now, extra = {}) => ({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: new Date(now).toISOString(), patternsAt: new Date(now).toISOString(), syncHash: 'x', ...extra });
const observe = (runs = [], projects = [], stages = []) => ({ status: 200, policy: { autoApprove: true, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects, stages, runs });
const mkCall = (obsFn, seen = []) => async (a) => { seen.push(a); return a === 'observe' ? obsFn() : a === 'publish' ? { status: 200, ok: true, verified: true } : { status: 200, ok: true }; };
let mp4Cache;
async function mp4() {
  if (mp4Cache) return mp4Cache;
  const dir = await mkdtemp(path.join(tmpdir(), 'vb-r3-mp4-'));
  mp4Cache = path.join(dir, 'final.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=1080x1920:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4Cache]);
  return mp4Cache;
}

test('A17 default saveState replaces state.json by rename (a hard link to the old file keeps the old bytes)', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-a17-'));
  const now = Date.now();
  const f = path.join(home, 'state.json'); const old = JSON.stringify(baseState(now));
  await writeFile(f, old);
  await link(f, path.join(home, 'old-link.json'));
  await tick({ call: mkCall(() => observe()), now, home, ...brainDirs(home), local: async () => ({ projects: [], stages: [], runs: [] }), critic: null, strategist: null, notify: null, rulesPr: null, harvestDirs: null });
  assert.equal(await readFile(path.join(home, 'old-link.json'), 'utf8'), old, 'an in-place write would have changed the linked inode');
  assert.notEqual(await readFile(f, 'utf8'), old, 'state.json got the new state');
  assert.deepEqual((await readdir(home)).sort(), ['old-link.json', 'state.json'], 'no temp file left behind');
});

test('DR19 dry-run: state file bytes unchanged, no state dir created, no critic/strategist/digest/rules PR/harvest calls', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-dr19-'));
  const now = Date.now();
  const t = new Date(now - 3_600_000).toISOString();
  const f = path.join(home, 'state.json');
  await writeFile(f, JSON.stringify(baseState(now)));
  const before = await readFile(f);
  const used = [];
  const spy = (n) => async () => { used.push(n); throw new Error(`${n} must not run in dry-run`); };
  const done = ['setup', 'research', 'insights', 'creative', 'studio'].map((id) => ({ id, state: 'done', action: '' }));
  const failed = { id: 'f1', projectId: 'p9', status: 'failed', error: 'fetch failed: ETIMEDOUT', retries: 0, updatedAt: t, estUsd: 0 };
  const calls = [];
  const opts = { call: mkCall(() => observe([failed], [{ id: 'p9', name: 'P9', updatedAt: t }], [{ projectId: 'p9', stages: done }]), calls), dryRun: true, now, local: async () => ({ projects: [{ id: 'local:p', name: 'P', updatedAt: t }], stages: [], runs: [toRun('v1', { projectId: 'p' }, { state: 'done', finished: t }, await mp4())] }), critic: spy('critic'), strategist: spy('strategist'), notify: spy('notify'), verifyNotify: spy('verifyNotify'), rulesPr: spy('rulesPr'), harvestDirs: spy('harvest') };
  const r = await tick({ ...opts, home, ...brainDirs(home) });
  assert.equal(r.dryRun, true);
  assert.deepEqual(used, []);
  assert.deepEqual(calls, ['observe'], 'only the read-only observe call');
  assert.ok(Buffer.compare(before, await readFile(f)) === 0, 'state.json bytes unchanged');
  assert.deepEqual(await readdir(home), ['state.json']);
});

test('B9 batch: an .mp4 written < 120 s ago is still generating; an older one is completed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vb-b9-'));
  await writeFile(path.join(dir, '01-new.mp4'), 'x'); await writeFile(path.join(dir, '02-old.mp4'), 'x');
  const old = new Date(Date.now() - 600_000); await utimes(path.join(dir, '02-old.mp4'), old, old);
  const r = await readBatches([{ id: 'b', name: 'b', dir }], { now: Date.now() + 1000 }); // explicit now: no dependence on sub-ms mtime rounding
  assert.deepEqual(r.runs.map((x) => [x.hookType, x.status]), [['new', 'generating'], ['old', 'completed']]);
});

test('B9c batch: mtime up to SKEW_MS ahead of now is jitter (generating) and exits to completed after FRESH_MS; a missing file is completed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vb-b9s-'));
  const fp = path.join(dir, '01-jit.mp4'); await writeFile(fp, 'x');
  const mt = Date.now(); await utimes(fp, new Date(mt), new Date(mt));
  const mtimeMs = (await stat(fp)).mtimeMs;
  const ahead = await readBatches([{ id: 'b', name: 'b', dir }], { now: mtimeMs - 500 }); // file mtime 500 ms in the future
  assert.equal(ahead.runs[0].status, 'generating');
  const later = await readBatches([{ id: 'b', name: 'b', dir }], { now: mtimeMs + FRESH_MS + 1 });
  assert.equal(later.runs[0].status, 'completed');
  await writeFile(path.join(dir, 'INDEX.csv'), 'file,product\n02-gone.mp4,gone\n');
  const gone = await readBatches([{ id: 'b', name: 'b', dir, index: 'INDEX.csv' }], { now: mtimeMs });
  assert.deepEqual(gone.runs.map((x) => [x.hookType, x.status, x.finalPath]), [['gone', 'completed', null]]);
});

test('B9 critic throws: the check is still stored and the critic quota is refunded', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-b9c-'));
  const now = Date.now(); const t = new Date(now - 3_600_000).toISOString();
  await writeFile(path.join(home, 'state.json'), JSON.stringify(baseState(now, { criticDay: { day: day(now), n: 4 } })));
  let n = 0;
  await tick({ call: mkCall(() => observe()), now, home, ...brainDirs(home), local: async () => ({ projects: [{ id: 'local:p', name: 'P', updatedAt: t }], stages: [], runs: [toRun('v1', { projectId: 'p' }, { state: 'done', finished: t }, await mp4())] }), critic: async () => { n += 1; throw new Error('HTTP 503'); } });
  const s = JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8'));
  assert.equal(n, 1);
  assert.ok(s.checks['local:v1'], 'check stored');
  assert.equal(s.criticDay.n, 4, 'quota refunded');
});

test('LU13 verify: audio present but loudness not measured is flagged; no audio is not', () => {
  const probe = { duration: 10, width: 1080, height: 1920, vcodec: 'h264', acodec: 'aac' };
  assert.equal(compare({ id: 'r', projectId: 'p' }, { file: { bytes: 9 }, probe }).loudnessMissing, true);
  assert.ok(!compare({ id: 'r', projectId: 'p' }, { file: { bytes: 9 }, probe, lufs: -14 }).loudnessMissing);
  assert.ok(!compare({ id: 'r', projectId: 'p' }, { file: { bytes: 9 }, probe: { ...probe, acodec: null } }).loudnessMissing);
});

test('LU13 tick: unmeasured loudness is retried next tick; after 3 tries the check is stored with loudness "not measured" failing', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-lu13-'));
  const now = Date.now(); const t = new Date(now - 3_600_000).toISOString();
  await writeFile(path.join(home, 'state.json'), JSON.stringify(baseState(now)));
  const probe = { duration: 10, width: 1080, height: 1920, vcodec: 'h264', acodec: 'aac' };
  let probes = 0;
  const check = async (r) => { probes += 1; return compare(r, { file: { bytes: 9 }, probe }); };
  const run = { id: 'local:v1', local: true, projectId: 'local:p', status: 'completed', finalPath: '/x/final.mp4', estUsd: 0, actualUsd: null, retries: 0, updatedAt: t, createdAt: t };
  const opts = { call: mkCall(() => observe()), home, ...brainDirs(home), local: async () => ({ projects: [{ id: 'local:p', name: 'P', updatedAt: t }], stages: [], runs: [run] }), critic: null, check };
  const read = async () => JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8'));
  await tick({ ...opts, now });
  let s = await read();
  assert.equal(s.checks['local:v1'], undefined, 'tick 1: not stored');
  assert.equal(s.lufsTries?.['local:v1'], 1);
  await tick({ ...opts, now: now + 300_000 });
  s = await read(); assert.equal(s.checks['local:v1'], undefined, 'tick 2: not stored');
  await tick({ ...opts, now: now + 600_000 });
  s = await read();
  const c = s.checks['local:v1'];
  assert.ok(c, 'tick 3: stored');
  const lf = c.fields.find((x) => x.field === 'loudness');
  assert.equal(lf.actual, 'not measured'); assert.equal(lf.pass, false); assert.equal(c.pass, false);
  assert.equal(s.lufsTries['local:v1'], undefined, 'counter cleared once stored');
  await tick({ ...opts, now: now + 900_000 });
  assert.equal(probes, 3, 'no re-probe after storing');
});

// main(): spawned so the real lock, log and error line are exercised (observe goes to a just-closed local port)
const closedPort = await new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const spawnBrain = (home, args = []) => spawnSync(process.execPath, [BRAIN, '--once', ...args], { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, APP_URL: `http://127.0.0.1:${closedPort}`, WORKER_TOKEN: 'test', VIDEO_BRAIN_HOME: home, VIDEO_BRAIN_SKILLS_DIR: brainDirs(home).skillsDir, AD_STUDIO_ROOT: brainDirs(home).adStudioRoot, VIDEO_BRAIN_DIGEST: '0', VIDEO_BRAIN_STRATEGIST: '0', VIDEO_BRAIN_CRITIC: '0', VIDEO_BRAIN_RULES_PR: '0', VIDEO_BRAIN_HARVEST: '0', AD_STUDIO_URL: `http://127.0.0.1:${closedPort}` } });

test('LK18 lock: a live tick holding the pidfile → log and exit 0 without observing', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-lk18-'));
  await writeFile(path.join(home, 'tick.pid'), String(process.pid));
  const r = spawnBrain(home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, new RegExp(`another tick is running \\(pid ${process.pid}\\)`));
  assert.doesNotMatch(r.stdout, /__VIDEO_BRAIN__/);
  assert.equal(await readFile(path.join(home, 'tick.pid'), 'utf8'), String(process.pid), 'the holder keeps its lock');
});

test('LK18 lock: a stale pidfile is taken over and released at exit; dry-run ignores a live lock', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-lk18s-'));
  await writeFile(path.join(home, 'tick.pid'), '2147483646');
  const r = spawnBrain(home);
  assert.equal(r.status, 2, 'ran the tick (observe fails on the closed port)');
  await assert.rejects(stat(path.join(home, 'tick.pid')), /ENOENT/, 'released');
  await writeFile(path.join(home, 'tick.pid'), String(process.pid));
  const d = spawnBrain(home, ['--dry-run']);
  assert.equal(d.status, 2, 'dry-run ran anyway');
  assert.equal(await readFile(path.join(home, 'tick.pid'), 'utf8'), String(process.pid), 'dry-run did not touch the lock');
});

test('DR19 dry-run never creates the state dir (main + tick)', async () => {
  const fresh = path.join(await mkdtemp(path.join(tmpdir(), 'vb-dr19m-')), 'never-created');
  const d = spawnBrain(fresh, ['--dry-run']);
  assert.equal(d.status, 2, 'reached observe');
  await assert.rejects(stat(fresh), /ENOENT/);
});

test('L7 log: ISO timestamp with date; the error line and log carry the fetch cause code', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-l7-'));
  const r = spawnBrain(home);
  assert.match(r.stderr, /\[video-brain \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.match(r.stderr, /ECONNREFUSED/);
  const line = r.stdout.split('\n').find((l) => l.startsWith('__VIDEO_BRAIN__'));
  assert.match(JSON.parse(line.slice('__VIDEO_BRAIN__'.length)).error, /ECONNREFUSED/);
});

test('integration (a) tick: a failed run that later shows completed resolves its incident with resolvedBy "recovered"', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-int-a-'));
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify(baseState(now)));
  const t = (ms) => new Date(now - ms).toISOString();
  let runs = [{ id: 'run-x1', projectId: 'p1', status: 'failed', error: 'Model returned no image returned for scene 2', retries: 2, updatedAt: t(600_000), estUsd: 0 }];
  const opts = { call: mkCall(() => observe(runs)), home, ...brainDirs(home), local: async () => ({ projects: [], stages: [], runs: [] }), critic: null, strategist: null };
  await tick({ ...opts, now });
  const read = async () => Object.values(JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8')).incidents);
  let inc = await read();
  assert.equal(inc.length, 1); assert.equal(inc[0].status, 'open');
  runs = [{ ...runs[0], status: 'completed', error: null, updatedAt: t(0) }];
  await tick({ ...opts, now: now + 300_000 });
  inc = await read();
  assert.equal(inc[0].status, 'resolved'); assert.equal(inc[0].resolvedBy, 'recovered');
});

test('integration (b) tick: a strategist memo carries the loop step', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-int-b-'));
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify(baseState(now)));
  const old = new Date(now - 100 * 3_600_000).toISOString();
  const st = ['setup', 'research', 'insights', 'creative', 'studio'].map((id) => ({ id, state: id === 'setup' ? 'done' : id === 'research' ? 'partial' : 'todo', action: `do ${id}` }));
  const out = { hypothesis: 'h', nextAction: 'n', verifyHow: 'v', checkpointHours: 6, owner: 'Director' };
  let asked = 0;
  await tick({ call: mkCall(() => observe([], [{ id: 'p7', name: 'Stalled', updatedAt: old }], [{ projectId: 'p7', stages: st }])), now, home, ...brainDirs(home), local: async () => ({ projects: [], stages: [], runs: [] }), critic: null, strategist: async () => { asked += 1; return out; } });
  const s = JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8'));
  assert.equal(asked, 1, 'the stalled loop reached the strategist');
  assert.ok(s.strategy.p7.step, 'memo carries the step');
  assert.deepEqual(s.strategy.p7.out, out);
});

// ---- lock / batch / loudness follow-ups (independent verification of PR #200) ----
test('LK18b lock: a pidfile older than 15 min is stale even when its pid is alive (pid reuse) and is taken over', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-lk18b-'));
  const f = path.join(home, 'tick.pid');
  await writeFile(f, String(process.pid));
  const old = new Date(Date.now() - 20 * 60_000); await utimes(f, old, old);
  const r = spawnBrain(home);
  assert.equal(r.status, 2, `took the lock and ran the tick: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /another tick is running/);
  await assert.rejects(stat(f), /ENOENT/, 'released at exit');
});

test('LK18b lock: a live pid whose recorded start time differs is stale; our own pidfile records pid and start time', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-lk18c-'));
  const f = path.join(home, 'tick.pid');
  await writeFile(f, `${process.pid}\nThu Jan  1 00:00:00 1970`);
  const l = acquireLock(home);
  assert.equal(l.ok, true);
  const [pid, start] = (await readFile(f, 'utf8')).split('\n');
  assert.equal(pid, String(process.pid));
  assert.equal(start, execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
  l.release();
  assert.equal(existsSync(f), false);
});

test('LK18b lock: takeover race — another process creates the lock between stale removal and our create → not ours, theirs kept', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-lk18d-'));
  const f = path.join(home, 'tick.pid');
  await writeFile(f, '2147483646');
  const l = acquireLock(home, { beforeCreate: () => execFileSync('sh', ['-c', `printf 4242 > '${f}'`]) });
  assert.equal(l.ok, false);
  assert.equal(await readFile(f, 'utf8'), '4242', 'the winner keeps its lock');
});

test('LK18b SIGTERM: a brain process killed mid-tick removes its own pidfile and exits 143', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-lk18e-'));
  const hang = createHttpServer(() => {}); await new Promise((res) => hang.listen(0, '127.0.0.1', res));
  const child = spawn(process.execPath, [BRAIN, '--once'], { env: { PATH: process.env.PATH, HOME: process.env.HOME, APP_URL: `http://127.0.0.1:${hang.address().port}`, WORKER_TOKEN: 'test', VIDEO_BRAIN_HOME: home, VIDEO_BRAIN_SKILLS_DIR: brainDirs(home).skillsDir, AD_STUDIO_ROOT: brainDirs(home).adStudioRoot, VIDEO_BRAIN_DIGEST: '0', VIDEO_BRAIN_STRATEGIST: '0', VIDEO_BRAIN_CRITIC: '0', VIDEO_BRAIN_RULES_PR: '0', VIDEO_BRAIN_HARVEST: '0' } });
  const f = path.join(home, 'tick.pid');
  const code = new Promise((res) => child.on('exit', (c, sig) => res(c ?? sig)));
  try {
    for (let i = 0; i < 100 && !existsSync(f); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(f), 'lock taken');
    await new Promise((r) => setTimeout(r, 300));
    child.kill('SIGTERM');
    assert.equal(await code, 143);
    assert.equal(existsSync(f), false, 'pidfile removed on SIGTERM');
  } finally { child.kill('SIGKILL'); hang.closeAllConnections(); hang.close(); }
});

test('B9b batch: an .mp4 with a future mtime (clock skew / copied file) is completed, not generating forever', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vb-b9f-'));
  await writeFile(path.join(dir, '01-future.mp4'), 'x');
  const fut = new Date(Date.now() + 3_600_000); await utimes(path.join(dir, '01-future.mp4'), fut, fut);
  const r = await readBatches([{ id: 'b', name: 'b', dir }]);
  assert.equal(r.runs[0].status, 'completed');
});

test('LU13b tick: lufsTries entries for runs no longer observed are dropped', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-lu13b-'));
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify(baseState(now, { lufsTries: { gone: 2 } })));
  await tick({ call: mkCall(() => observe()), now, home, ...brainDirs(home), local: async () => ({ projects: [], stages: [], runs: [] }), critic: null, strategist: null });
  const s = JSON.parse(await readFile(path.join(home, 'state.json'), 'utf8'));
  assert.deepEqual(s.lufsTries || {}, {});
});

// ---- second verification: ps failure must not steal a live lock; an empty pidfile is a writer mid-create ----
const spawnBrainEnv = (home, extra) => spawnSync(process.execPath, [BRAIN, '--once'], { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, APP_URL: `http://127.0.0.1:${closedPort}`, WORKER_TOKEN: 'test', VIDEO_BRAIN_HOME: home, VIDEO_BRAIN_SKILLS_DIR: brainDirs(home).skillsDir, AD_STUDIO_ROOT: brainDirs(home).adStudioRoot, VIDEO_BRAIN_DIGEST: '0', VIDEO_BRAIN_STRATEGIST: '0', VIDEO_BRAIN_CRITIC: '0', VIDEO_BRAIN_RULES_PR: '0', VIDEO_BRAIN_HARVEST: '0', ...extra } });
async function fakePs(body) {
  const bin = await mkdtemp(path.join(tmpdir(), 'vb-fakeps-'));
  await writeFile(path.join(bin, 'ps'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return `${bin}:${process.env.PATH}`;
}
for (const [name, body] of [['exits 1', 'exit 1'], ['hangs past the timeout', 'sleep 8']]) {
  test(`LK18c lock: ps ${name} → a live holder with a recorded start time and fresh mtime still blocks (exit 0)`, async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'vb-lk18f-'));
    const f = path.join(home, 'tick.pid');
    await writeFile(f, `${process.pid}\nWed Nov 26 01:02:03 2026`);
    const r = spawnBrainEnv(home, { PATH: await fakePs(body) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /another tick is running/);
    assert.equal(await readFile(f, 'utf8'), `${process.pid}\nWed Nov 26 01:02:03 2026`, 'holder keeps its lock');
  });
}

test('LK18c lock: an empty pidfile < 10 s old is a writer between create and write → blocked; 20 s old → taken over', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-lk18g-'));
  const f = path.join(home, 'tick.pid');
  await writeFile(f, '');
  const r = spawnBrainEnv(home, {});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(await readFile(f, 'utf8'), '', 'left alone');
  const old = new Date(Date.now() - 20_000); await utimes(f, old, old);
  const t = spawnBrainEnv(home, {});
  assert.equal(t.status, 2, `took over and ran the tick: ${t.stderr}`);
  await assert.rejects(stat(f), /ENOENT/, 'released at exit');
});
