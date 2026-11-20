import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readBatches, BATCHES } from '../lib/batch.mjs';

test('batch without INDEX.csv: every top-level .mp4 becomes a completed run; the bdsmpub sets are registered', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vb-dir-'));
  await writeFile(path.join(dir, '01-obsidian-collar.mp4'), 'x'); await writeFile(path.join(dir, '02-feather.mp4'), 'x'); await writeFile(path.join(dir, 'README.md'), 'x');
  const r = await readBatches([{ id: 'noir', name: 'noir', brand: 'bdsmpub', dir }]);
  assert.equal(r.runs.length, 2);
  assert.deepEqual(r.runs.map((x) => x.hookType), ['obsidian-collar', 'feather']);
  assert.ok(r.runs.every((x) => x.status === 'completed' && x.finalPath?.startsWith(dir)));
  assert.equal(r.projects[0].id, 'batch:noir');
  assert.ok(['bdsmpub-noir', 'bdsmpub-slides'].every((id) => BATCHES.some((b) => b.id === id)));
});
