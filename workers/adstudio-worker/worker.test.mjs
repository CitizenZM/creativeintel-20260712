// node --test workers/adstudio-worker - job.json mapping and plan extraction (no network, no pipeline)
import test from 'node:test';
import assert from 'node:assert/strict';
import { jobOf, planOf, jobIdOf, runLoop, resumeFrom, keyframeThumbs, alreadyDone, runPipeline, stopReason } from './worker.mjs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

const run = { runId: 'r1', phase: 'plan', hookType: 'pain', engine: 'kling3', input: {
  project: { brandName: 'Moneta', brandUrl: 'https://drinkmoneta.com', productUrl: 'https://drinkmoneta.com/p', campaignGoal: 'sell' },
  storyboard: { id: 'sb1', title: 'Chalk', frameSeconds: 2, frames: [{ frameNumber: 1, textOverlay: 'x', productAction: 'pour' }] },
  script: { hook: { text: 'h' } }, brandKit: { claimsForbidden: ['weight loss'], offerText: 'Save 20%' }, offer: { text: 'Subscribe & Save', was: 150, now: 120 }, notes: 'lead with price', soundProfile: 'warm_glass' } };

test('job.json carries the whole storyboard, the picks and the offer, and never starts approved', () => {
  const j = jobOf(run);
  assert.equal(j.id, jobIdOf('r1')); assert.equal(j.source, 'xark'); assert.equal(j.engine, 'generate');
  assert.equal(j.videoModel, 'kling3'); assert.equal(j.hookType, 'pain'); assert.equal(j.audioProfile, 'warm_glass');
  assert.equal(j.approved, false);
  assert.deepEqual(j.xark.frames, run.input.storyboard.frames); assert.deepEqual(j.xark.brandKit.claimsForbidden, ['weight loss']);
  assert.equal(j.offerText, 'Subscribe & Save'); assert.equal(j.offerWas, 150); assert.equal(j.offerNow, 120);
  assert.equal(j.productUrl, 'https://drinkmoneta.com/p'); assert.equal(j.notes, 'lead with price');
  assert.equal(j.xark.context, null); // older runs without a context pack still map
});
test('typed logo, product photo, link and coupon reach the job fields', () => {
  const j = jobOf({ ...run, input: { ...run.input, offer: { text: 'Save 20%', code: 'GLOW20' }, branding: { logoUrl: 'https://x/l.png', productImageUrl: 'https://x/p.png', linkUrl: 'https://brand.com/offer' } } });
  assert.equal(j.logoUrl, 'https://x/l.png'); assert.deepEqual(j.productImages, ['https://x/p.png']); assert.equal(j.siteUrl, 'https://brand.com/offer'); assert.equal(j.offerCode, 'GLOW20');
  const plain = jobOf(run); assert.equal(plain.logoUrl, undefined); assert.equal(plain.productImages, undefined); assert.equal(plain.siteUrl, 'https://drinkmoneta.com');
});
test('job.json carries the pre-Studio context pack untouched', () => {
  const context = { v: 1, setup: { images: [{ url: 'https://x/p.jpg' }] }, research: { winningAds: [{ hookType: 'pain' }] }, suggestedHookTypes: ['pain'] };
  const j = jobOf({ ...run, input: { ...run.input, context } });
  assert.deepEqual(j.xark.context, context);
});
test('plan sent to Xark: hook options, coverage, frame map, shots with their storyboard frames', () => {
  const p = planOf({ concept: 'c', hook: { chosen: 'H', vo: 'v' }, hook_options: [{ caption: 'H', stop: 9 }], music: 'm', audio: { profile: 'warm_glass', voice: { name: 'Emma' } },
    shots: [{ dur: 2, caption: 'H', vo: 'v', visual: 'gen', src_frames: [1] }, { dur: 1.5, caption: 'x', vo: '', visual: 'text' }],
    xark: { coverage: { planned: 1, covered: 1, missing: [] }, frames: [{ frame: 1 }] } });
  assert.equal(p.hook.chosen, 'H'); assert.equal(p.hook.options.length, 1); assert.equal(p.coverage.covered, 1); assert.equal(p.frames.length, 1);
  assert.deepEqual(p.shots[1].src_frames, []); assert.equal(p.durationS, 3.5); assert.equal(p.audio.voice, 'Emma');
  assert.equal(planOf(null), undefined);
});

test('reference workflows: the reference video is the input, research rides along, "keep" means follow the reference', () => {
  const input = { ...run.input, workflow: 'replace', storyboard: { id: 'ref:https://t.co/v', title: 'Competitor', frames: [], reference: { url: 'https://t.co/v' } }, script: null, context: { v: 1 } };
  const j = jobOf({ ...run, hookType: 'keep', input });
  assert.equal(j.source, 'xark-ref'); assert.equal(j.refUrl, 'https://t.co/v'); assert.equal(j.replace, true);
  assert.equal(j.hookType, undefined); assert.deepEqual(j.xark.context, { v: 1 }); assert.equal(j.xark.frames, undefined);
  assert.equal(jobOf({ ...run, input: { ...input, workflow: 'reference' } }).replace, false);
});
test('stock remix, imitation style, house opening and its enforced style', () => {
  const input = { ...run.input, format: 'interview', opening: { id: 'H17', name: 'Creator Talking Head', keyframe: 'k', motion: 'm', style: 'ai_talk' } };
  const g = jobOf({ ...run, input });
  assert.equal(g.format, 'interview'); assert.equal(g.hookLib.id, 'H17'); assert.equal(g.hookStyle, 'ai_talk');
  const r = jobOf({ ...run, engine: 'remix', input });
  assert.equal(r.engine, 'remix'); assert.equal(r.videoModel, undefined);
  assert.equal(r.hookStyle, undefined); // a talking head needs AI footage: remix keeps it as a brief only
});
test('plan carries the replace list, timing check, opening and end card', () => {
  const p = planOf({ shots: [], replace_list: { our_product: 'Mist' }, replace_check: { locked: true }, hook_style: { lib: 'H09' }, end_card: 'E04', format: 'montage' });
  assert.equal(p.replace.our_product, 'Mist'); assert.equal(p.replaceCheck.locked, true); assert.equal(p.opening.lib, 'H09'); assert.equal(p.endCard, 'E04');
});

test('worker handles several runs at once (Mode 1 reference runs and Mode 2 storyboard runs together), never more than the cap, and a failing run does not stop the others', async () => {
  const queue = ['ref-a', 'sb-b', 'ref-c', 'sb-d', 'bad-e']; let now = 0, peak = 0; const done = [], failed = [];
  await runLoop({
    claim: async () => { const r = queue.shift(); return r ? { runId: r } : null; },
    handle: async (r) => { now++; peak = Math.max(peak, now); await new Promise((res) => setTimeout(res, 15)); now--; if (r.runId.startsWith('bad')) throw new Error('boom'); done.push(r.runId); },
    onError: async (r) => { failed.push(r.runId); }, conc: 2, exitWhenIdle: true, poll: 5, sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
  });
  assert.equal(peak, 2); assert.deepEqual(done.sort(), ['ref-a', 'ref-c', 'sb-b', 'sb-d']); assert.deepEqual(failed, ['bad-e']);
});
test('--once still handles exactly one claim', async () => {
  const queue = [{ runId: 'a' }, { runId: 'b' }]; const done = [];
  await runLoop({ claim: async () => queue.shift() ?? null, handle: async (r) => { done.push(r.runId); }, once: true, conc: 3 });
  assert.deepEqual(done, ['a']);
});

test('runLoop logs each run outcome with its duration and flags a duplicate claim of a run already active here', async () => {
  const queue = [{ runId: 'r1', phase: 'plan' }, { runId: 'r1', phase: 'plan' }]; const lines = [];
  await runLoop({
    claim: async () => queue.shift() ?? null,
    handle: async () => { await new Promise((res) => setTimeout(res, 20)); return { action: 'gate' }; },
    log: (...a) => lines.push(a.join(' ')), exitWhenIdle: true, poll: 5, sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
  });
  const out = lines.join('\n');
  assert.match(out, /\[adstudio\] plan r1 -> gate in \d+(\.\d+)?s/);
  assert.match(out, /duplicate claim of r1 \(already active here\)/);
});
test('runLoop logs a thrown run as an error outcome and still calls onError', async () => {
  const queue = [{ runId: 'x1', phase: 'generate' }]; const lines = []; const failed = [];
  await runLoop({
    claim: async () => queue.shift() ?? null, handle: async () => { throw new Error('boom'); },
    onError: async (r) => { failed.push(r.runId); }, log: (...a) => lines.push(a.join(' ')), exitWhenIdle: true, poll: 5, sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
  });
  assert.match(lines.join('\n'), /generate x1 -> error: boom in/); assert.deepEqual(failed, ['x1']);
});

test('wiring: every report carries the claim lease, uploads keep the heartbeat, the budget is held to the reservation, APP_URL has no production default', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
  const reports = src.match(/api\('(failed|gate|done|progress)', \{[^}]*/g) || [];
  assert.ok(reports.length >= 8, `found ${reports.length} reports`);
  for (const r of reports) assert.match(r, /claim/, `report without claim: ${r}`);
  assert.match(src, /setInterval\(\(\) => \{ api\('progress'[\s\S]*?upload\(id, 'final\.mp4'[\s\S]*?clearInterval\(beat\)/);
  assert.match(src, /Math\.min\(job\.budget \?\? BUDGET, run\.reserveUsd\)/);
  assert.doesNotMatch(src, /process\.env\.APP_URL \|\| 'https/);
  assert.match(src, /if \(!APP_URL\) \{[^}]*process\.exit\(1\)/);
});

test('a retried plan resumes at the failed step after the script; earlier failures and fresh folders start over', () => {
  const steps = (upTo) => Object.fromEntries(['ingest', 'analyze', 'product', 'script', 'generate', 'voice', 'render', 'review'].map((x, i) => [x, i < upTo ? 'done' : i === upTo ? 'failed' : 'pending']));
  assert.equal(resumeFrom(null), 'ingest');
  assert.equal(resumeFrom({ state: 'failed', steps: steps(4) }), 'generate'); // e.g. OpenRouter 402 while making key frames: keep the script
  assert.equal(resumeFrom({ state: 'failed', steps: steps(2) }), 'ingest');
  assert.equal(resumeFrom({ state: 'done', steps: steps(8) }), 'ingest');
});
test('approval card gets a small copy of each AI scene key frame (continued scenes have none)', async () => {
  const id = jobIdOf('kfthumbtest'); const dir = path.join(process.env.AD_STUDIO_ROOT || path.join(homedir(), 'Projects/ad-studio-20261104'), 'data/jobs', id);
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  for (const k of [0, 2]) execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=1080x1920', '-frames:v', '1', path.join(dir, 'assets', `kf_${k}.jpg`)]);
  const put = async (jid, file) => `https://media/${jid}/${file}`;
  try {
    const k = await keyframeThumbs(id, { gen_scenes: [{}, { continues: true }, {}] }, put);
    assert.deepEqual(k, [{ scene: 0, url: `https://media/${id}/assets/kfthumb_0.jpg` }, { scene: 2, url: `https://media/${id}/assets/kfthumb_2.jpg` }]);
    const w = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', path.join(dir, 'assets', 'kfthumb_0.jpg')]).toString().trim();
    assert.equal(w, '360');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('visual mode from Studio reaches the job; anything unknown means video', () => {
  assert.equal(jobOf(run).visualMode, 'video');
  assert.equal(jobOf({ ...run, input: { ...run.input, visualMode: 'slides' } }).visualMode, 'slides');
  assert.equal(jobOf({ ...run, input: { ...run.input, visualMode: 'nope' } }).visualMode, 'video');
});

test('budget fallback: a slides run marked zeroCost tells Ad Studio to build $0 key frames', () => {
  const base = { runId: 'cbudget1', hookType: 'keep', engine: 'seedance2fast', input: { storyboard: { id: 'sb', frames: [] }, project: { productUrl: 'https://x/p' } } };
  const j = jobOf({ ...base, input: { ...base.input, visualMode: 'slides', fallback: 'budget', zeroCost: true } });
  assert.equal(j.visualMode, 'slides'); assert.equal(j.zeroCost, true); assert.equal(j.fallback, 'budget');
  const v = jobOf(base);
  assert.equal(v.visualMode, 'video'); assert.equal(v.zeroCost, undefined);
});

test('a job finished on this Mac is uploaded, not re-run from ingest', () => {
  assert.equal(alreadyDone({ state: 'done' }, true), true);
  assert.equal(alreadyDone({ state: 'done' }, false), false);
  assert.equal(alreadyDone({ state: 'failed' }, true), false);
  assert.equal(resumeFrom({ state: 'done' }), 'ingest'); // why the shortcut is needed
});

test('a pipeline killed by a signal keeps the signal (not exit 0) and is reported as "pipeline killed by SIGx"', async () => {
  const fake = (js) => runPipeline('sigtest', jobIdOf('sigtest'), ['-e', js], 'c1', { tick: 10 });
  const killed = await fake("process.kill(process.pid, 'SIGKILL')");
  assert.equal(killed.code, null); assert.equal(killed.signal, 'SIGKILL'); assert.equal(killed.cancelled, false);
  const ok = await fake('process.exit(0)'); assert.equal(ok.code, 0); assert.equal(ok.signal, null);
  const bad = await fake('process.exit(3)'); assert.equal(bad.code, 3); assert.equal(bad.signal, null);
  assert.equal(stopReason({ state: 'running' }, 'SIGKILL'), 'pipeline killed by SIGKILL');
  assert.equal(stopReason({ state: 'failed', error: 'render failed' }, null), 'render failed');
  assert.equal(stopReason(null, null), 'pipeline stopped');
  const src = await (await import('node:fs/promises')).readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
  assert.match(src, /error: stopReason\(st, signal\)/); // handle() reports it
  assert.equal((src.match(/const \{ cancelled, signal \} = await runPipeline\(/g) || []).length, 2); // both phases pass the signal on
});

// ---- T12: a pipeline left running by a restarted worker is adopted, never started a second time ----
const FAKE_RUN = `import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
const [id, from] = process.argv.slice(2); const dir = 'data/jobs/' + id; mkdirSync(dir, { recursive: true });
appendFileSync('spawns.log', process.pid + ' ' + id + ' ' + from + '\\n');
const st = (o) => writeFileSync(dir + '/status.json', JSON.stringify({ pid: process.pid, steps: {}, ...o }));
st({ state: 'running', step: 'generate' });
setTimeout(() => { writeFileSync(dir + '/final.mp4', 'x'); st({ state: 'done', cost: 1.5, review: { score: 9 } }); process.exit(0); }, Number(process.env.FAKE_MS || 300));
`;
let adoptN = 0;
/** a fresh worker module on a temp Ad Studio root with a fake pipeline/run.mjs, and a fake Xark API that records every report */
async function adoptRig({ cancel = false, server } = {}) {
  const { mkdtemp, readFile } = await import('node:fs/promises'); const { tmpdir } = await import('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'adopt-'));
  await mkdir(path.join(root, 'pipeline'), { recursive: true }); await writeFile(path.join(root, 'pipeline', 'run.mjs'), FAKE_RUN);
  const env = { AD_STUDIO_ROOT: root, ADSTUDIO_MEDIA_BASE: 'http://media.test/jobs', APP_URL: 'http://adopt.test', ADSTUDIO_TICK_MS: '20' };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  let w; try { w = await import(`./worker.mjs?adopt=${adoptN++}`); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  const calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const b = JSON.parse(init.body); calls.push(b);
    const [status, body] = server?.(b) ?? [200, b.action === 'progress' ? { cancel } : { action: b.action }];
    return new Response(JSON.stringify(body), { status });
  };
  const spawns = async () => (await readFile(path.join(root, 'spawns.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const dir = (id) => path.join(root, 'data', 'jobs', id);
  const done = async () => { globalThis.fetch = realFetch; await rm(root, { recursive: true, force: true }); };
  return { w, root, calls, spawns, dir, done };
}
const { spawn: spawnChild } = await import('node:child_process');
/** the pipeline a previous worker started: detached, still running after that worker is gone */
async function orphan(root, id, ms) {
  const p = spawnChild(process.execPath, ['pipeline/run.mjs', id, 'generate'], { cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, FAKE_MS: String(ms) } });
  const f = path.join(root, 'data', 'jobs', id, 'status.json'); const { readFile } = await import('node:fs/promises');
  for (let i = 0; i < 200; i++) { const st = JSON.parse(await readFile(f, 'utf8').catch(() => '{}')); if (st.pid === p.pid) return p; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('orphan never started');
}

test('liveOwner: adopt only a live pid whose command is this job\'s pipeline/run.mjs; unknown command on a live pid is "busy"', async () => {
  const { w, done } = await adoptRig();
  try {
    const alive = () => true; const dead = () => { throw Object.assign(new Error('x'), { code: 'ESRCH' }); };
    const eperm = () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); };
    const ps = (cmd) => () => cmd; const st = { state: 'running', pid: 4242 };
    assert.equal(w.liveOwner(st, 'xk-r1', { kill: alive, ps: ps('/usr/bin/node pipeline/run.mjs xk-r1 generate') }), true);
    assert.equal(w.liveOwner(st, 'xk-r1', { kill: eperm, ps: ps('node pipeline/run.mjs xk-r1 ingest') }), true); // another user's process is still alive
    assert.equal(w.liveOwner(st, 'xk-r1', { kill: alive, ps: ps('node pipeline/run.mjs xk-r10 generate') }), false); // another job
    assert.equal(w.liveOwner(st, 'xk-r1', { kill: alive, ps: ps('/Applications/Safari.app/Contents/MacOS/Safari') }), false); // pid reused
    assert.equal(w.liveOwner(st, 'xk-r1', { kill: dead, ps: () => { throw new Error('ps must not run'); } }), false);
    assert.equal(w.liveOwner({ state: 'failed', pid: 4242 }, 'xk-r1', { kill: alive, ps: ps('node pipeline/run.mjs xk-r1 generate') }), false);
    assert.equal(w.liveOwner({ state: 'running' }, 'xk-r1', { kill: alive, ps: ps('node pipeline/run.mjs xk-r1 generate') }), false);
    assert.equal(w.liveOwner(null, 'xk-r1', { kill: alive, ps: ps('') }), false);
    assert.throws(() => w.liveOwner(st, 'xk-r1', { kill: alive, ps: () => { throw new Error('ps timed out'); } }), (e) => e.busy === true && /pipeline still running \(pid 4242\)/.test(e.message));
    let n = 0; // ps failed because the pid exited in between: nothing to adopt, a fresh run is fine
    assert.equal(w.liveOwner(st, 'xk-r1', { kill: () => { if (n++) dead(); return true; }, ps: () => { throw new Error('no such process'); } }), false);
  } finally { await done(); }
});

test('a live pipeline left by a restarted worker is adopted: no second run.mjs, progress keeps flowing, it finishes and uploads once', { timeout: 20000 }, async () => {
  const { w, root, calls, spawns, dir, done } = await adoptRig();
  const id = w.jobIdOf('adopt1');
  try {
    const p = await orphan(root, id, 500);
    const r = await w.handle({ runId: 'adopt1', phase: 'generate', claim: 'c9', reserveUsd: 3 });
    assert.equal(r.action, 'done');
    assert.deepEqual((await spawns()).map((l) => l.split(' ')[0]), [String(p.pid)], 'only the original pipeline ever ran');
    const acts = calls.map((c) => c.action);
    assert.ok(acts.includes('progress'), 'heartbeats while adopted');
    assert.equal(acts.filter((a) => a === 'done').length, 1); assert.equal(acts.includes('failed'), false);
    const d = calls.find((c) => c.action === 'done');
    assert.equal(d.claim, 'c9'); assert.equal(d.finalMp4Url, `http://media.test/jobs/${id}/final.mp4`); assert.equal(d.actualUsd, 1.5);
    assert.ok(calls.every((c) => c.claim === 'c9'));
    assert.equal(existsSync(path.join(dir(id), 'job.json')), false, 'the running job folder was left alone');
  } finally { await done(); }
});

test('a dead pid in status.json is not adopted: the pipeline is started normally', { timeout: 20000 }, async () => {
  const { w, calls, spawns, dir, done } = await adoptRig();
  const id = w.jobIdOf('adopt2');
  try {
    const gone = spawnChild(process.execPath, ['-e', '']); const deadPid = gone.pid; await new Promise((r) => gone.on('exit', r));
    await mkdir(dir(id), { recursive: true }); await writeFile(path.join(dir(id), 'status.json'), JSON.stringify({ state: 'running', pid: deadPid, steps: {} }));
    const r = await w.handle({ runId: 'adopt2', phase: 'plan', claim: 'c1', hookType: 'pain', engine: 'kling3', input: { storyboard: { frames: [] } } });
    assert.equal(r.action, 'done');
    const s = await spawns(); assert.equal(s.length, 1); assert.notEqual(s[0].split(' ')[0], String(deadPid)); assert.match(s[0], / ingest$/);
    assert.equal(calls.filter((c) => c.action === 'done').length, 1);
  } finally { await done(); }
});

test('a live pid whose command cannot be read: no second pipeline and no terminal failure; the lease lapses so the server retries later', async () => {
  const { w, calls, spawns, dir, done } = await adoptRig();
  const id = w.jobIdOf('adopt3');
  try {
    await mkdir(dir(id), { recursive: true }); await writeFile(path.join(dir(id), 'status.json'), JSON.stringify({ state: 'running', pid: process.pid, steps: {} }));
    const r = await w.handle({ runId: 'adopt3', phase: 'generate', claim: 'c1' }, { ps: () => { throw new Error('ps: timed out'); } });
    assert.equal(r.action, 'deferred'); assert.match(r.error, new RegExp(`pipeline still running \\(pid ${process.pid}\\)`));
    assert.deepEqual(await spawns(), []); assert.deepEqual(calls, []);
  } finally { await done(); }
});

test('cancel from Xark kills the adopted pipeline\'s process group and reports a cancelled run', { timeout: 20000 }, async () => {
  const { w, root, calls, spawns, done } = await adoptRig({ cancel: true });
  const id = w.jobIdOf('adopt4');
  try {
    const p = await orphan(root, id, 10000); const exited = new Promise((r) => p.on('exit', (code, signal) => r(signal)));
    const r = await w.handle({ runId: 'adopt4', phase: 'generate', claim: 'c1' });
    assert.equal(await exited, 'SIGTERM'); assert.equal((await spawns()).length, 1);
    assert.equal(r.action, 'failed'); const f = calls.find((c) => c.action === 'failed'); assert.equal(f.cancelled, true);
  } finally { await done(); }
});

test('the same worker reclaims its own still-running pipeline (missed heartbeats): handed to the existing watcher, never killed, done reported once', { timeout: 20000 }, async () => {
  // the server as in adstudio-queue.ts: a progress with an old claim answers {cancel:true,status:'reclaimed'}; reports with an old claim are 409
  let serverClaim = 'c1';
  const server = (b) => {
    if (b.action === 'progress') return [200, b.claim !== serverClaim ? { cancel: true, status: 'reclaimed' } : { cancel: false }];
    if (b.claim !== serverClaim) return [409, { error: "This claim is no longer the run's current one" }];
    return [200, { action: b.action }];
  };
  const { w, calls, spawns, dir, done } = await adoptRig({ server });
  const id = w.jobIdOf('reclaim1');
  try {
    await mkdir(dir(id), { recursive: true }); await writeFile(path.join(dir(id), 'job.json'), JSON.stringify({ id, budget: 6 }));
    process.env.FAKE_MS = '700';
    const first = w.handle({ runId: 'reclaim1', phase: 'generate', claim: 'c1', reserveUsd: 3 });
    for (let i = 0; i < 100 && (await spawns()).length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    delete process.env.FAKE_MS;
    await new Promise((r) => setTimeout(r, 100));
    serverClaim = 'c2'; // requeued after 2 min without heartbeats, claimed again by this same worker
    const second = await w.handle({ runId: 'reclaim1', phase: 'generate', claim: 'c2', reserveUsd: 3 });
    const r1 = await first;
    assert.equal((await spawns()).length, 1, 'one pipeline');
    const st = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(dir(id), 'status.json'), 'utf8'));
    assert.equal(st.state, 'done', 'the pipeline was not killed');
    const ok = calls.filter((c) => c.action === 'done');
    assert.equal(ok.length, 1, `one done report (${calls.map((c) => c.action + ':' + c.claim).join(' ')})`); assert.equal(ok[0].claim, 'c2');
    assert.equal(calls.some((c) => c.action === 'failed'), false);
    assert.equal([r1?.action, second?.action].filter((a) => a === 'done').length, 1);
  } finally { delete process.env.FAKE_MS; await done(); }
});

test('pid reuse while adopted: when the pid stops being this job\'s run.mjs the watch ends, status.json decides and the stranger is not killed', { timeout: 6000 }, async () => {
  const { w, root, calls, spawns, done } = await adoptRig();
  const id = w.jobIdOf('reuse1'); let p;
  try {
    p = await orphan(root, id, 8000);
    let n = 0; const ps = () => (n++ < 3 ? `${process.execPath} pipeline/run.mjs ${id} generate` : '/Applications/Safari.app/Contents/MacOS/Safari');
    const t0 = Date.now();
    const r = await w.handle({ runId: 'reuse1', phase: 'generate', claim: 'c1' }, { ps });
    assert.ok(Date.now() - t0 < 3000, `watch ended in ${Date.now() - t0} ms`);
    assert.equal(r.action, 'failed'); assert.equal(calls.find((c) => c.action === 'failed').cancelled, undefined);
    assert.equal(p.exitCode, null); assert.equal(p.signalCode, null); // the "stranger" was left alone
    assert.equal((await spawns()).length, 1);
  } finally { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } await done(); }
});

test('reclaimed by another worker: this watcher stops watching without killing the pipeline and sends no report', { timeout: 20000 }, async () => {
  const server = (b) => (b.action === 'progress' ? [200, { cancel: true, status: 'reclaimed' }] : [409, { error: 'stale' }]);
  const { w, root, calls, done } = await adoptRig({ server });
  const id = w.jobIdOf('reclaim2'); let p;
  try {
    p = await orphan(root, id, 8000);
    const r = await w.handle({ runId: 'reclaim2', phase: 'generate', claim: 'c1' });
    assert.equal(r.action, 'reclaimed'); assert.equal(p.exitCode, null); assert.equal(p.signalCode, null);
    assert.deepEqual(calls.map((c) => c.action).filter((a) => a !== 'progress'), []);
  } finally { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } await done(); }
});
