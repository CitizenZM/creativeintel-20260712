// Job registry for video work done outside Ad Studio (Claude sessions, scripts). One JSON file per job in
// ~/.config/xark-studio/jobs (XARK_JOBS_DIR). Video Brain turns every job folder into runs it second-checks and learns from.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSTREAMS_FILE = fileURLToPath(new URL('../workstreams.json', import.meta.url));
export const jobsDir = () => process.env.XARK_JOBS_DIR || path.join(homedir(), '.config', 'xark-studio', 'jobs');

export async function loadWorkstreams(file = WORKSTREAMS_FILE) {
  const j = JSON.parse(await readFile(file, 'utf8'));
  return { global: j.global || [], workstreams: j.workstreams || [] };
}

const stamp = (d) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function startJob({ workstream, name, dir, index = null, id = null, now = new Date(), root = jobsDir(), workstreams = null }) {
  const ws = workstreams || (await loadWorkstreams()).workstreams;
  if (!ws.some((w) => w.id === workstream)) throw new Error(`unknown workstream "${workstream}" (known: ${ws.map((w) => w.id).join(', ')})`);
  if (!dir) throw new Error('--dir is required (folder that holds the finished .mp4 files)');
  const job = { id: slug(id || `${workstream}-${stamp(now)}`), workstream, name: name || path.basename(dir), dir: path.resolve(dir), index, status: 'running', startedAt: now.toISOString(), finishedAt: null, note: null };
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, `${job.id}.json`), JSON.stringify(job, null, 2) + '\n');
  return job;
}

export async function finishJob(id, { status = 'done', note = null, now = new Date(), root = jobsDir() } = {}) {
  const f = path.join(root, `${slug(id)}.json`);
  const job = JSON.parse(await readFile(f, 'utf8'));
  Object.assign(job, { status, note, finishedAt: now.toISOString() });
  await writeFile(f, JSON.stringify(job, null, 2) + '\n');
  return job;
}

export async function listJobs(root = jobsDir()) {
  let files; try { files = (await readdir(root)).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files.sort()) { try { out.push(JSON.parse(await readFile(path.join(root, f), 'utf8'))); } catch { /* skip broken file */ } }
  return out;
}
