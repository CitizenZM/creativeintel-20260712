// Batch video productions outside Ad Studio (design §9 decision 4 = A), e.g. the allcomfywear Black Friday set: each
// INDEX.csv row is a finished video that gets the second check and the critic like any Ad Studio run.
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const BATCHES = [
  { id: 'acw-bf', name: 'allcomfywear Black Friday videos (batch)', brand: 'allcomfywear', dir: path.join(homedir(), 'Projects', 'acw-bf-videos-20261116', 'all-videos-by-product'), index: 'INDEX.csv' },
  // session-made sets without an INDEX.csv: every top-level .mp4 in the folder is one finished video (P1 backfill)
  { id: 'bdsmpub-noir', name: 'bdsmpub noir split-screen BF videos (batch)', brand: 'bdsmpub', dir: path.join(homedir(), 'Projects', 'bdsm-ops-center-20261107', 'videos', 'bdsmpub-noir-20261119') },
  { id: 'bdsmpub-slides', name: 'bdsmpub slides videos (batch)', brand: 'bdsmpub', dir: path.join(homedir(), 'Projects', 'bdsm-ops-center-20261107', 'videos', 'bdsmpub-slides-20261118') },
];

/** rows for a batch: INDEX.csv when it has one, else one row per top-level .mp4 (product = file name without number prefix/extension) */
export async function batchRows(b) {
  if (b.index) { try { return parseCsv(await readFile(path.join(b.dir, b.index), 'utf8')); } catch { return null; } }
  try { return (await readdir(b.dir)).filter((f) => f.endsWith('.mp4')).sort().map((file) => ({ file, product: file.replace(/^\d+-/, '').replace(/\.mp4$/, '') })); } catch { return null; }
}

/** minimal RFC-4180 CSV (quoted fields with commas and "" escapes) */
export function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export async function readBatches(batches = BATCHES) {
  const projects = []; const stages = []; const runs = [];
  for (const b of batches) {
    const rows = await batchRows(b);
    if (!rows) continue;
    let latest = '';
    for (const row of rows) {
      if (!row.file) continue;
      const fp = path.join(b.dir, row.file);
      let st; try { st = await stat(fp); } catch { st = null; }
      const at = st ? st.mtime.toISOString() : new Date(0).toISOString();
      if (at > latest) latest = at;
      runs.push({ id: `batch:${b.id}:${row.file}`, local: true, managedBy: 'batch', projectId: `batch:${b.id}`, status: 'completed', step: null, progress: 100, estUsd: 0, actualUsd: null, finalMp4Url: null, finalPath: st && st.size > 0 ? fp : null, error: null, metrics: null, retries: 0, hookType: row.product || null, engine: 'batch', updatedAt: at, createdAt: at, visualMode: 'video', cancelRequested: false });
    }
    projects.push({ id: `batch:${b.id}`, name: b.name, brandName: b.brand, updatedAt: latest || new Date(0).toISOString() });
    stages.push({ projectId: `batch:${b.id}`, local: true, stages: ['setup', 'research', 'insights', 'creative', 'studio'].map((id) => ({ id, state: 'done', action: '' })), next: null });
  }
  return { projects, stages, runs };
}
