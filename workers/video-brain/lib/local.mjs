// Local Ad Studio jobs (~/Projects/ad-studio-20261104/data/jobs) as brain projects/runs (design §9 decision 4 = A:
// Xark projects + Ad Studio local jobs). Xark-managed jobs (xk-*) are mirrored by AdStudioRun in production, so
// readLocal skips them (toRun still maps them to the lab project for callers that pass them in); a job's local state maps onto the AdStudioRun status words.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const STATE = { done: 'completed', failed: 'failed', cancelled: 'cancelled', approval: 'awaiting_approval', running: 'generating', queued: 'queued' };
const readJSON = async (f) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };

export function toRun(id, job, st, finalPath) {
  const status = STATE[st?.state] || (st?.state ? 'generating' : 'queued');
  const updated = st?.finished || st?.started || job?.created || new Date(0).toISOString();
  return {
    id: `local:${id}`, local: true, managedBy: String(job?.source || '').startsWith('xark') ? 'xark' : 'local', projectId: localProjectId(job), status, step: st?.step || null, progress: 0,
    estUsd: Number(st?.estimate?.usd || 0), estimateScenes: Array.isArray(st?.estimate?.scenes) ? st.estimate.scenes.length : null, actualUsd: typeof st?.cost === 'number' ? st.cost : null,
    finalMp4Url: null, finalPath: status === 'completed' ? finalPath : null, error: st?.error ? String(st.error).slice(0, 400) : null,
    metrics: st?.result?.duration ? { runtime: st.result.duration } : null, retries: 0, hookType: job?.hookType || null, engine: job?.videoModel || job?.engine || null,
    updatedAt: updated, createdAt: job?.created || updated, visualMode: job?.visualMode || 'video', cancelRequested: false,
  };
}

export const localProjectId = (job) => `local:${job?.source === 'xark' || job?.projectId === 'xark' ? 'xark-lab' : job?.projectId || 'unfiled'}`;

export async function readLocal(root) {
  const projects = (await readJSON(path.join(root, 'data', 'projects.json'))) || [];
  const runs = [];
  let ids = []; try { ids = await readdir(path.join(root, 'data', 'jobs')); } catch { /* none */ }
  for (const id of ids) {
    const dir = path.join(root, 'data', 'jobs', id);
    const [job, st] = await Promise.all([readJSON(path.join(dir, 'job.json')), readJSON(path.join(dir, 'status.json'))]);
    if (!job && !st) continue;
    // Xark-managed mirrors (xk-<runId> and its -p0/-sld/-vid variants): the server AdStudioRun is authoritative and
    // observe() returns every active server run, so a local copy would only duplicate it
    if (/^xk-/.test(id) || toRun(id, job, st, null).managedBy === 'xark') continue;
    const fp = path.join(dir, 'final.mp4');
    let has = false; try { has = (await stat(fp)).size > 0; } catch { /* none */ }
    runs.push(toRun(id, job, st, has ? fp : null));
  }
  const byId = new Map(projects.map((p) => [`local:${p.id}`, { id: `local:${p.id}`, name: `${p.name} (Ad Studio local)`, brandName: p.brandName || null, updatedAt: p.created }]));
  for (const r of runs) {
    if (!byId.has(r.projectId)) byId.set(r.projectId, { id: r.projectId, name: r.projectId === 'local:xark-lab' ? 'Xark lab jobs (Ad Studio local)' : 'Unfiled Ad Studio jobs', brandName: null, updatedAt: r.updatedAt });
    const p = byId.get(r.projectId); if (r.updatedAt > (p.updatedAt || '')) p.updatedAt = r.updatedAt;
  }
  const used = new Set(runs.map((r) => r.projectId));
  // a local project is "done with production" when it has finished videos: its stages are all done (no Xark stage checks)
  const list = [...byId.values()].filter((p) => used.has(p.id));
  const stages = list.map((p) => ({ projectId: p.id, local: true, stages: ['setup', 'research', 'insights', 'creative', 'studio'].map((s) => ({ id: s, state: 'done', action: '' })), next: null }));
  return { projects: list, stages, runs };
}
