// node --test workers/adstudio-worker - job.json mapping and plan extraction (no network, no pipeline)
import test from 'node:test';
import assert from 'node:assert/strict';
import { jobOf, planOf, jobIdOf } from './worker.mjs';

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
});
test('plan sent to Xark: hook options, coverage, frame map, shots with their storyboard frames', () => {
  const p = planOf({ concept: 'c', hook: { chosen: 'H', vo: 'v' }, hook_options: [{ caption: 'H', stop: 9 }], music: 'm', audio: { profile: 'warm_glass', voice: { name: 'Emma' } },
    shots: [{ dur: 2, caption: 'H', vo: 'v', visual: 'gen', src_frames: [1] }, { dur: 1.5, caption: 'x', vo: '', visual: 'text' }],
    xark: { coverage: { planned: 1, covered: 1, missing: [] }, frames: [{ frame: 1 }] } });
  assert.equal(p.hook.chosen, 'H'); assert.equal(p.hook.options.length, 1); assert.equal(p.coverage.covered, 1); assert.equal(p.frames.length, 1);
  assert.deepEqual(p.shots[1].src_frames, []); assert.equal(p.durationS, 3.5); assert.equal(p.audio.voice, 'Emma');
  assert.equal(planOf(null), undefined);
});
