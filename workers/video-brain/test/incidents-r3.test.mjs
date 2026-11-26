// R3 recovery resolves incidents; S4 provider-JSON signatures + re-key merge; SG10 killed-by-signal is transient
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, classify, signatureOf } from '../lib/incidents.mjs';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const at = (h) => new Date(NOW - h * 3_600_000).toISOString();

// real 401 (Anthropic) shape, two request ids
const AUTH_A = '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011ChMHAzEe8paV8cuKZ7MYQ"}';
const AUTH_B = '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CZZ9q8XyPLm2bT4rWvN0k"}';
// real 402 (OpenRouter) strings: ad-studio data/jobs/20261124-4t71d and xk-cmwbrjdl30007vrit4velbdl7 status.json
const OR_402_LONG = 'OpenRouter 402: {"error":{"message":"This request requires at least $1.00 in balance for image or video output. To increase, visit https://openrouter.ai/workspaces/default/keys/a40af14951259ad1cb28223d92246c444fdc8ce205e74bee971eadbb22e05373 and adjust the key\'s monthly limit","code":402,"metadata":{"limit_source":"openrouter_key_limit","remedy_hint":"Raise or remove this API key\'s usage limit at https://openrout';
const OR_402_SHORT = 'OpenRouter 402: {"error":{"message":"This request requires at least $1.00 in balance for image or video output","code":402,"metadata":{"limit_source":"openrouter_key_limit","remedy_hint":"Raise or remove this API key\'s usage limit at https://openrouter.ai/settings/keys, or use a key without a limit.","provider_name":null}},"user_id":"user_39vQn552mVjUU95dPAHVhXUrBW3"}';

// ---------- S4 ----------
test('signatureOf: two 401s differing only in request_id give one signature', () => {
  assert.equal(signatureOf(AUTH_A), signatureOf(AUTH_B));
  assert.match(signatureOf(AUTH_A), /invalid x-api-key/);
  assert.doesNotMatch(signatureOf(AUTH_A), /req_|request_id/);
});

test('signatureOf: the two real OpenRouter 402 strings (trailing text differs) give one signature', () => {
  assert.equal(signatureOf(OR_402_LONG), signatureOf(OR_402_SHORT));
  assert.match(signatureOf(OR_402_SHORT), /requires at least \$# in balance for image or video output/);
});

test('signatureOf: uuids, hex and amounts are normalized inside the extracted message', () => {
  const a = 'fal 422: {"detail":"job 3f2b9c1e-8a7d-4e6f-9b0a-1c2d3e4f5a6b failed: cost $0.50 exceeds cap"}';
  const b = 'fal 422: {"detail":"job 9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d failed: cost $12.75 exceeds cap"}';
  assert.equal(signatureOf(a), signatureOf(b));
  assert.equal(signatureOf('OpenRouter 500: {"error":{"message":"gen deadbeefcafe0123 crashed"}}'), signatureOf('OpenRouter 500: {"error":{"message":"gen 0123456789abcdef crashed"}}'));
});

test('signatureOf: different provider messages stay different incidents', () => {
  assert.notEqual(signatureOf(AUTH_A), signatureOf(OR_402_SHORT));
  assert.notEqual(signatureOf('OpenRouter 400: {"error":{"message":"bad prompt"}}'), signatureOf('OpenRouter 400: {"error":{"message":"image too large"}}'));
});

test('aggregate: new runs with the same 401 cause land in ONE incident regardless of request_id', () => {
  const m = aggregate({}, [{ id: 'a', status: 'failed', error: AUTH_A, updatedAt: at(2) }, { id: 'b', status: 'failed', error: AUTH_B, updatedAt: at(1) }], NOW);
  const list = Object.values(m);
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 2);
  assert.deepEqual(list[0].ids, ['a', 'b']);
});

test('aggregate: stored incidents keyed by the OLD signature are re-keyed from their sample and merged (no duplicates)', () => {
  // the two live 402 incidents in state.json (old keys), one resolved, one open
  const k1 = 'openrouter #: {"error":{"message":"this request requires at least $# in balance for image or video output","code":#,"metadata":{"limit_sourc';
  const k2 = 'openrouter #: {"error":{"message":"this request requires at least $# in balance for image or video output. to increase, visit <url> and adju';
  const prev = {
    [k1]: { signature: k1, kind: 'human', runbook: 'x', sample: OR_402_SHORT.slice(0, 300), count: 6, firstSeen: at(80), lastSeen: at(75), status: 'resolved', resolvedBy: 'quiet', runs: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'], ids: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] },
    [k2]: { signature: k2, kind: 'human', runbook: 'x', sample: OR_402_LONG.slice(0, 300), count: 1, firstSeen: at(20), lastSeen: at(20), status: 'open', runs: ['r7'], ids: ['r7'] },
  };
  const m = aggregate(prev, [], NOW);
  const list = Object.values(m);
  assert.equal(list.length, 1, 'merged into one incident');
  const [inc] = list;
  assert.equal(inc.signature, signatureOf(OR_402_SHORT));
  assert.equal(Object.keys(m)[0], inc.signature);
  assert.equal(inc.count, 7);
  assert.deepEqual([...inc.ids].sort(), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
  assert.equal(inc.firstSeen, at(80));
  assert.equal(inc.lastSeen, at(20));
  assert.equal(inc.status, 'open', 'open wins over resolved');
  assert.equal(inc.resolvedBy, undefined);
  assert.equal(inc.kind, 'human');
  // a later failure with the same cause joins it, and re-running aggregate is stable
  const m2 = aggregate(m, [{ id: 'r8', status: 'failed', error: OR_402_LONG, updatedAt: at(1) }], NOW);
  assert.equal(Object.keys(m2).length, 1);
  assert.equal(Object.values(m2)[0].count, 8);
  assert.deepEqual(aggregate(m2, [], NOW), m2);
});

test('aggregate: the live 401 incident key (request_id in it) is re-keyed; old 401 + new 401 = one incident', () => {
  const old = '# {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_#chmhazee#pav#cukz#myq"}';
  const prev = { [old]: { signature: old, kind: 'human', runbook: 'x', sample: AUTH_A, count: 1, firstSeen: at(54), lastSeen: at(54), status: 'open', runs: ['local:20261124-yushl'], ids: ['local:20261124-yushl'] } };
  const m = aggregate(prev, [{ id: 'n1', status: 'failed', error: AUTH_B, updatedAt: at(1) }], NOW);
  assert.equal(Object.keys(m).length, 1);
  assert.equal(Object.values(m)[0].count, 2);
});

// ---------- R3 ----------
const AUTH_INC = (ids, status = 'open') => ({ [signatureOf(AUTH_A)]: { signature: signatureOf(AUTH_A), kind: 'human', runbook: 'x', sample: AUTH_A, count: ids.length, firstSeen: at(50), lastSeen: at(50), status, runs: [...ids], ids: [...ids] } });

test('aggregate(all runs): an open incident whose every run is now completed (not a budget fallback) is resolved: recovered', () => {
  const m = aggregate(AUTH_INC(['local:20261124-yushl']), [{ id: 'local:20261124-yushl', status: 'completed', fallback: null, updatedAt: at(1) }], NOW);
  const [inc] = Object.values(m);
  assert.equal(inc.status, 'resolved');
  assert.equal(inc.resolvedBy, 'recovered');
  assert.equal(inc.count, 1, 'a completed run is not counted as a failure');
});

test('aggregate(all runs): a 402 run re-planned as $0 slides (fallback: budget) does NOT resolve the funds incident', () => {
  const sig = signatureOf(OR_402_SHORT);
  const prev = { [sig]: { signature: sig, kind: 'human', runbook: 'x', sample: OR_402_SHORT, count: 1, firstSeen: at(5), lastSeen: at(5), status: 'open', runs: ['r402'], ids: ['r402'] } };
  const inc = aggregate(prev, [{ id: 'r402', status: 'completed', fallback: 'budget', updatedAt: at(1) }], NOW)[sig];
  assert.equal(inc.status, 'open');
  assert.equal(inc.resolvedBy, undefined);
});

test('aggregate(all runs): not resolved while any listed run is still failed or not visible', () => {
  const ids = ['a', 'b'];
  const stillFailed = aggregate(AUTH_INC(ids), [{ id: 'a', status: 'completed', updatedAt: at(1) }, { id: 'b', status: 'failed', error: AUTH_B, updatedAt: at(3) }], NOW);
  assert.equal(Object.values(stillFailed)[0].status, 'open');
  const notVisible = aggregate(AUTH_INC(ids), [{ id: 'a', status: 'completed', updatedAt: at(1) }], NOW);
  assert.equal(Object.values(notVisible)[0].status, 'open');
  const running = aggregate(AUTH_INC(['a']), [{ id: 'a', status: 'generating', updatedAt: at(1) }], NOW);
  assert.equal(Object.values(running)[0].status, 'open');
});

test('aggregate(all runs): only failed runs create incidents; completed/queued runs with a stale error field are ignored', () => {
  const m = aggregate({}, [{ id: 'c', status: 'completed', error: 'fetch failed', updatedAt: at(1) }, { id: 'q', status: 'queued', error: 'fetch failed', updatedAt: at(1) }, { id: 'f', status: 'failed', error: 'TypeError: boom', updatedAt: at(1) }], NOW);
  assert.deepEqual(Object.values(m).map((i) => i.ids), [['f']]);
});

test('aggregate(failed only, legacy callers): unchanged behaviour, including runs without a status field', () => {
  const m = aggregate({}, [{ id: 'x', error: 'fetch failed', updatedAt: at(1) }], NOW);
  assert.equal(Object.values(m)[0].count, 1);
  assert.equal(Object.values(m)[0].status, 'open');
});

test('aggregate: a recovered incident reopens when the same cause fails again', () => {
  const m = aggregate(AUTH_INC(['a']), [{ id: 'a', status: 'completed', updatedAt: at(2) }], NOW);
  const m2 = aggregate(m, [{ id: 'a', status: 'completed', updatedAt: at(2) }, { id: 'z', status: 'failed', error: AUTH_B, updatedAt: at(0.5) }], NOW);
  assert.equal(Object.values(m2)[0].status, 'reopened');
  assert.equal(Object.values(m2)[0].resolvedBy, undefined);
});

// ---------- SG10 ----------
test('classify: a pipeline killed by a signal is transient, retried once', () => {
  for (const e of ['/Users/x/node exited null: [render-node] bundled in 80s', 'pipeline killed by SIGKILL', 'render-node killed by SIGTERM', 'pipeline killed']) {
    const c = classify(e);
    assert.equal(c.kind, 'platform', e);
    assert.equal(c.retry, true, e);
  }
  assert.equal(classify('node exited 1: TypeError: x').kind, 'code');
});

// ---------- S4 follow-up: OpenRouter "Provider returned error" wrappers keep the HTTP code + metadata.raw ----------
const wrap = (code, raw, req = 'gen-1764000000-AbCdEfGhIjKlMnOp') => `OpenRouter ${code}: {"error":{"message":"Provider returned error","code":${code},"metadata":{"raw":${JSON.stringify(raw)},"provider_name":"Google"}},"user_id":"user_39vQn552mVjUU95dPAHVhXUrBW3","id":"${req}"}`;
const W429 = wrap(429, 'google/veo-3.1 is temporarily rate-limited upstream. Please retry shortly, or add your own key');
const W400 = wrap(400, '{"error":{"code":400,"message":"The prompt could not be submitted. Your prompt may violate our content safety policy.","status":"INVALID_ARGUMENT"}}');
const W502 = wrap(502, 'upstream connect error or disconnect/reset before headers. reset reason: connection timeout');

test('signatureOf: OpenRouter "Provider returned error" 429 / 400 safety / 502 stay three incidents', () => {
  const sigs = [W429, W400, W502].map(signatureOf);
  assert.equal(new Set(sigs).size, 3, sigs.join(' | '));
  assert.match(signatureOf(W429), /429/);
  assert.match(signatureOf(W429), /rate-limited upstream/);
  assert.match(signatureOf(W400), /prompt could not be submitted/);
  assert.match(signatureOf(W502), /upstream connect error/);
  // same wrapped cause, different generation id / amounts -> one incident
  assert.equal(signatureOf(W429), signatureOf(wrap(429, 'google/veo-3.1 is temporarily rate-limited upstream. Please retry shortly, or add your own key', 'gen-1764999999-ZzYyXxWwVvUuTtSs')));
  // two different raw causes under the same code stay apart
  assert.notEqual(signatureOf(W502), signatureOf(wrap(502, 'Bad gateway from provider Vertex')));
  const m = aggregate({}, [W429, W400, W502].map((error, i) => ({ id: `w${i}`, status: 'failed', error, updatedAt: at(1) })), NOW);
  assert.equal(Object.keys(m).length, 3);
});

test('signatureOf: the HTTP code stays in every provider JSON signature (401 vs 403, 402 vs 429 never merge)', () => {
  assert.notEqual(signatureOf(AUTH_A), signatureOf(AUTH_A.replace(/^401/, '403')));
  const or = (code) => `OpenRouter ${code}: {"error":{"message":"This request requires at least $1.00 in balance for image or video output","code":${code}}}`;
  assert.notEqual(signatureOf(or(402)), signatureOf(or(429)));
  assert.match(signatureOf(OR_402_SHORT), /402/);
  assert.match(signatureOf(AUTH_A), /401/);
});

test('aggregate: a run that recovered and then fails again under the same id reopens the incident', () => {
  const m = aggregate(AUTH_INC(['a']), [{ id: 'a', status: 'completed', updatedAt: at(2) }], NOW);
  assert.equal(Object.values(m)[0].resolvedBy, 'recovered');
  const m2 = aggregate(m, [{ id: 'a', status: 'failed', error: AUTH_B, updatedAt: at(0.5) }], NOW);
  const [inc] = Object.values(m2);
  assert.equal(inc.status, 'reopened');
  assert.equal(inc.resolvedBy, undefined);
  assert.equal(inc.lastSeen, at(0.5));
  assert.deepEqual(inc.ids, ['a']);
  // seen again next tick, still failed: no double count
  assert.equal(Object.values(aggregate(m2, [{ id: 'a', status: 'failed', error: AUTH_B, updatedAt: at(0.5) }], NOW))[0].count, inc.count);
});

test('aggregate: a recovered run seen failed again with an OLD timestamp is counted once, not every tick', () => {
  const m = aggregate(AUTH_INC(['a']), [{ id: 'a', status: 'completed', updatedAt: at(2) }], NOW);
  const old = [{ id: 'a', status: 'failed', error: AUTH_B, updatedAt: at(100) }];
  const m2 = aggregate(m, old, NOW);
  const m3 = aggregate(m2, old, NOW);
  assert.equal(Object.values(m3)[0].count, Object.values(m2)[0].count);
  assert.equal(Object.values(m3)[0].status, 'resolved');
});
