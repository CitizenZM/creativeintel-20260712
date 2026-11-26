// node --test workers/adstudio-worker - job.json mapping and plan extraction (no network, no pipeline)
import test from 'node:test';
import assert from 'node:assert/strict';
import { jobOf, planOf, jobIdOf, runLoop, resumeFrom, keyframeThumbs, alreadyDone, runPipeline, stopReason } from './worker.mjs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
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
