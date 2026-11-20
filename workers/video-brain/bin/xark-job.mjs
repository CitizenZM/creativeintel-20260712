#!/usr/bin/env node
// xark-job — register video work done in Claude sessions/scripts so Video Brain second-checks and learns from it.
//   xark-job workstreams                                   list workstreams (brand x purpose) and their rules
//   xark-job start --workstream <id> --dir <folder> [--name "<title>"] [--index INDEX.csv] [--id <jobId>]
//   xark-job finish <jobId> [--status done|failed] [--note "<text>"]
//   xark-job list                                          registered jobs
//   xark-job backfill                                      register the pre-CLI batch folders (acw, bdsmpub) as jobs
//   xark-job directives [--harvest [--days N]]                      harvested instructions (candidates first)
//   xark-job directive confirm|reject <id> [--workstream <id>]   (an unassigned rule needs --workstream to be confirmed)
// Env: XARK_JOBS_DIR (~/.config/xark-studio/jobs), XARK_DIRECTIVES_FILE (~/.config/xark-studio/directives.json)
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { finishJob, listJobs, loadWorkstreams, startJob } from '../lib/jobs.mjs';
import { BATCHES } from '../lib/batch.mjs';
import { harvestDirectives, loadDirectives, setStatus } from '../lib/knowledge.mjs';

const opt = (argv, k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] ?? d : d; };

export async function main(argv, out = console.log) {
  const [cmd, a1, a2] = argv;
  if (cmd === 'workstreams') {
    const { global, workstreams } = await loadWorkstreams();
    for (const w of workstreams) out(`${w.id}\t${w.mode}\t${w.compliance}\t$${w.budgetUsdPerVideo}/video\t${(w.directives || []).length} directive(s)`);
    out(`global rules: ${global.length}`);
    return 0;
  }
  if (cmd === 'start') {
    const job = await startJob({ workstream: opt(argv, 'workstream'), dir: opt(argv, 'dir'), name: opt(argv, 'name'), index: opt(argv, 'index'), id: opt(argv, 'id') });
    out(job.id);
    return 0;
  }
  if (cmd === 'finish') {
    if (!a1) throw new Error('usage: xark-job finish <jobId>');
    const job = await finishJob(a1, { status: opt(argv, 'status', 'done'), note: opt(argv, 'note') });
    out(`${job.id} ${job.status}`);
    return 0;
  }
  if (cmd === 'list') {
    for (const j of await listJobs()) out(`${j.id}\t${j.workstream}\t${j.status}\t${j.dir}`);
    return 0;
  }
  if (cmd === 'backfill') {
    const have = new Set((await listJobs()).map((j) => j.id));
    for (const b of BATCHES) {
      if (have.has(b.id)) { out(`${b.id} already registered`); continue; }
      const st = await stat(b.dir).catch(() => null);
      if (!st) { out(`${b.id} skipped: ${b.dir} missing`); continue; }
      const j = await startJob({ id: b.id, workstream: b.workstream, dir: b.dir, name: b.name, index: b.index || null, now: st.mtime });
      await finishJob(j.id, { status: 'done', note: 'backfilled (made before xark-job existed)', now: st.mtime });
      out(`${b.id} registered`);
    }
    return 0;
  }
  if (cmd === 'directives') {
    if (argv.includes('--harvest')) out(`new candidates: ${(await harvestDirectives({ workstreams: (await loadWorkstreams()).workstreams, days: Number(opt(argv, 'days', 3)) })).length}`);
    const list = await loadDirectives();
    for (const d of [...list].sort((x, y) => (x.status === 'candidate' ? -1 : 1) - (y.status === 'candidate' ? -1 : 1))) out(`${d.id}\t${d.status}\t${d.workstream}\t${d.rule}`);
    return 0;
  }
  if (cmd === 'directive' && (a1 === 'confirm' || a1 === 'reject') && a2) {
    const d = await setStatus(a2, a1 === 'confirm' ? 'confirmed' : 'rejected', undefined, opt(argv, 'workstream'));
    out(`${d.id} ${d.status}`);
    return 0;
  }
  out('usage: xark-job workstreams | start --workstream <id> --dir <folder> | finish <jobId> | list | backfill | directives [--harvest] | directive confirm|reject <id>');
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`xark-job: ${e.message}`); process.exit(1); });
}
