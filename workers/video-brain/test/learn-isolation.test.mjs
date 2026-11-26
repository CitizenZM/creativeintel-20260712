// R4 learn isolation: brain tests never write the live learning files, and the daemon repairs drifted files on its own.
process.env.VIDEO_BRAIN_DIGEST = '0'; process.env.VIDEO_BRAIN_HARVEST = '0'; process.env.VIDEO_BRAIN_STRATEGIST = '0'; process.env.VIDEO_BRAIN_RULES_PR = '0'; process.env.VIDEO_BRAIN_CRITIC = '0';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brainDirs } from './helpers/brain-dirs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = ['ad-studio', 'video-shotcraft', 'hypit', 'video-use', 'video-ads-playbook', 'proposal-content-video'];
const SENTINEL = '# sentinel\n<!-- video-brain:begin -->\nSENTINEL BLOCK\n<!-- video-brain:end -->\n';

test('isolation: the brain test files, run with HOME at a fake home, leave every managed file there untouched', async () => {
  const fake = await mkdtemp(path.join(tmpdir(), 'vb-fakehome-'));
  const skills = path.join(fake, '.claude', 'skills'), ad = path.join(fake, 'Projects', 'ad-studio-20261104');
  const files = [path.join(skills, '_shared', 'VIDEO-KNOWLEDGE.md'), ...SKILLS.flatMap((s) => [path.join(skills, s, 'LEARNINGS.md'), path.join(skills, s, 'SKILL.md')]), path.join(ad, 'docs', 'LEARNINGS.md'), path.join(ad, 'data', 'brain-learnings.json')];
  for (const f of files) { await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, f.endsWith('.json') ? '{"sentinel":true}\n' : SENTINEL); }
  const tests = (await readdir(HERE)).filter((f) => f.endsWith('.test.mjs') && f !== path.basename(fileURLToPath(import.meta.url))).map((f) => path.join(HERE, f));
  const env = { ...process.env, HOME: fake };
  for (const k of ['NODE_TEST_CONTEXT', 'VIDEO_BRAIN_SKILLS_DIR', 'AD_STUDIO_ROOT', 'VIDEO_BRAIN_HOME']) delete env[k];
  const r = spawnSync(process.execPath, ['--test', ...tests], { env, encoding: 'utf8', timeout: 540_000 });
  const changed = [];
  for (const f of files) if ((await readFile(f, 'utf8')) !== (f.endsWith('.json') ? '{"sentinel":true}\n' : SENTINEL)) changed.push(path.relative(fake, f));
  assert.deepEqual(changed, [], `test run (exit ${r.status}) wrote managed files under HOME`);
});

test('guard: under a test, syncAll refuses the HOME default skills dir and Ad Studio clone before writing anything', async () => {
  process.env.NODE_ENV = 'test'; // also when the file is run without node --test
  const { syncAll } = await import('../lib/learn.mjs');
  const tmp = await mkdtemp(path.join(tmpdir(), 'vb-guard-'));
  await assert.rejects(syncAll([], { skillsDir: path.join(homedir(), '.claude', 'skills'), skills: [], adStudioRoot: null, at: 'x' }), /refusing/);
  await assert.rejects(syncAll([], { skillsDir: tmp, skills: [], adStudioRoot: path.join(homedir(), 'Projects', 'ad-studio-20261104'), at: 'x' }), /refusing/);
  assert.deepEqual(await readdir(tmp), [], 'nothing written to the temp skills dir either');
});

test('drift: an edited on-disk block with an unchanged hash is re-synced on the next tick; no drift = no write', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vb-drift-'));
  const dirs = brainDirs(home);
  process.env.VIDEO_BRAIN_SKILLS_DIR = dirs.skillsDir; process.env.AD_STUDIO_ROOT = dirs.adStudioRoot;
  process.env.XARK_JOBS_DIR = path.join(home, 'jobs'); process.env.XARK_DIRECTIVES_FILE = path.join(home, 'directives.json');
  await mkdir(path.join(dirs.skillsDir, 'ad-studio'), { recursive: true }); await writeFile(path.join(dirs.skillsDir, 'ad-studio', 'SKILL.md'), '---\nname: ad-studio\n---\n# body\n');
  const now = Date.now();
  await writeFile(path.join(home, 'state.json'), JSON.stringify({ checks: {}, incidents: {}, probes: [], patterns: [], loopStatus: {}, acted: {}, probesAt: new Date(now).toISOString(), patternsAt: new Date(now).toISOString() }));
  const { tick } = await import('../brain.mjs?drift');
  const call = async (a) => a === 'observe' ? { status: 200, policy: { autoApprove: false, maxRunUsd: 3, maxDayUsd: 20, maxRunAgeH: 24 }, learnings: [], spend: { autoApprovedTodayUsd: 0, byProject7d: {} }, perf: [], heartbeats: [], projects: [], stages: [], runs: [] } : { status: 200, ok: true, verified: true };
  const opts = { call, home, ...dirs, local: async () => ({ projects: [], stages: [], runs: [] }), strategist: null, notify: null, verifyNotify: null, critic: null, rulesPr: null, harvestDirs: null };
  await tick({ ...opts, now });
  const shared = path.join(dirs.skillsDir, '_shared', 'VIDEO-KNOWLEDGE.md'), skill = path.join(dirs.skillsDir, 'ad-studio', 'LEARNINGS.md'), json = path.join(dirs.adStudioRoot, 'data', 'brain-learnings.json'), doc = path.join(dirs.adStudioRoot, 'docs', 'LEARNINGS.md');
  const good = Object.fromEntries(await Promise.all([shared, skill, json, doc].map(async (f) => [f, await readFile(f, 'utf8')])));
  // what the test leak did: a fixture learning inside the block, a stale JSON
  await writeFile(shared, good[shared].replace('### Candidates — watch, not yet rules', '### Candidates — watch, not yet rules\n- [pipeline:render] Second check: "loudness" failed on 2 finished videos — local:v1, local:v2'));
  await writeFile(skill, good[skill].replace(/synced [^;]+;/, 'synced 2000-01-01T00:00:00.000Z;'));
  await writeFile(json, '{"at":"stale","rules":[]}\n');
  const r = await tick({ ...opts, now: now + 300_000 });
  for (const f of [shared, skill, json, doc]) assert.equal(await readFile(f, 'utf8'), good[f], `${path.relative(home, f)} repaired`);
  assert.ok(r.snapshot.events.some((e) => e.agent === 'Librarian' && /repaired/.test(e.summary)), 'a Librarian event names the repair');
  const m = (await stat(shared)).mtimeMs;
  await tick({ ...opts, now: now + 600_000 });
  assert.equal((await stat(shared)).mtimeMs, m, 'no drift: nothing rewritten');
  assert.equal(await readFile(shared, 'utf8'), good[shared]);
});
