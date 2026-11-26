// own file: the API timeout is read from env at import time, so this env must not leak into worker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

test('a hung API call is aborted after ADSTUDIO_API_TIMEOUT_MS and rejects like any other error', { timeout: 5000 }, async () => {
  process.env.ADSTUDIO_API_TIMEOUT_MS = '50';
  process.env.APP_URL = 'http://worker-timeout.test';
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = (url, init = {}) => new Promise((_, reject) => {
    seen = init.signal;
    init.signal?.addEventListener('abort', () => reject(init.signal.reason));
  });
  try {
    const { api } = await import('./worker.mjs');
    const t0 = Date.now();
    await assert.rejects(api('claim'));
    assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
    assert.ok(seen?.aborted, 'the request carried an abort signal');
  } finally { globalThis.fetch = realFetch; }
});
