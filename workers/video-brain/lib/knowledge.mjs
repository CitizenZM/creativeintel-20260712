// Shared knowledge (P2, no DB yet): workstream directives + Barron's instructions harvested from session transcripts.
// Harvested lines are candidates until confirmed with `xark-job directive confirm <id>`; only confirmed ones reach skills
// and the Ad Studio pipeline. Store: ~/.config/xark-studio/directives.json (XARK_DIRECTIVES_FILE).
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

export const directivesFile = () => process.env.XARK_DIRECTIVES_FILE || path.join(homedir(), '.config', 'xark-studio', 'directives.json');
export const dirId = (scope, rule) => 'D' + createHash('sha1').update(`${scope}|${rule}`).digest('hex').slice(0, 10);

export async function loadDirectives(file = directivesFile()) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return []; } }
export async function saveDirectives(list, file = directivesFile()) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(list, null, 2) + '\n'); }

export async function setStatus(id, status, file = directivesFile()) {
  const list = await loadDirectives(file);
  const d = list.find((x) => x.id === id);
  if (!d) throw new Error(`no directive ${id}`);
  d.status = status; d.decidedAt = new Date().toISOString();
  await saveDirectives(list, file);
  return d;
}

// an instruction, not a question or a report: must / never / don't / only / always, in English or Chinese
const CUE = /(不要|别再|不准|禁止|必须|一定要|只用|只能|不能|always|never|don['’]t|do not|must|only use|stop using)/i;
// the Video Brain only keeps instructions about videos
const VIDEO = /(视频|画面|镜头|音乐|配乐|配音|字幕|幻灯片|开头|钩子|模特|video|music|voice|caption|slides?|footage|hook|shot|scene|clip)/i;
const SECRET = /(sk-[a-z0-9]|api[_-]?key|token|password|密码|secret|bearer\s)/i;
const WRAPPERS = /<(system-reminder|pasted_content|command-[a-z-]+|local-command-[a-z-]+)[^>]*>[\s\S]*?<\/\1>/g;

/** text Barron typed himself (origin human; not tool results, notifications, compaction summaries or meta lines),
 * with system reminders, pasted blocks and command wrappers removed */
export function userText(entry) {
  if (entry?.type !== 'user' || entry.message?.role !== 'user' || entry.origin?.kind !== 'human' || entry.isMeta || entry.isCompactSummary) return '';
  const c = entry.message.content;
  const parts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text) : [];
  return parts.join('\n').replace(WRAPPERS, ' ').replace(/<[^>]+>/g, ' ');
}

/** candidate directives from one transcript's lines: scoped to the workstream the sentence names, else to all work (global) */
export function extract(lines, { workstreams, source, at }) {
  const out = [];
  for (const line of lines) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    for (const sent of userText(e).split(/(?<=[。！!？?；;.\n])/)) {
      const s = sent.replace(/\s+/g, ' ').trim();
      if (s.length < 6 || s.length > 160 || !CUE.test(s) || !VIDEO.test(s) || SECRET.test(s) || /[?？]$/.test(s) || /^[-*★|#>\d]/.test(s) || /[`|]/.test(s)) continue;
      const ws = workstreams.find((w) => (w.keywords || [w.brand]).some((k) => s.toLowerCase().includes(k.toLowerCase())));
      const wid = ws ? ws.id : 'global';
      out.push({ id: dirId(`directive:${wid}`, s), scope: `directive:${wid}`, workstream: wid, rule: s, source, at: e.timestamp || at, status: 'candidate' });
    }
  }
  return out;
}

/** scan transcripts changed in the last `days` days; adds only new ids to the store; returns the new candidates */
export async function harvestDirectives({ workstreams, transcriptsDir = path.join(homedir(), '.claude', 'projects'), days = 3, now = Date.now(), file = directivesFile() }) {
  const store = await loadDirectives(file);
  const known = new Set(store.map((d) => d.id));
  const fresh = [];
  let dirs; try { dirs = await readdir(transcriptsDir); } catch { return []; }
  for (const d of dirs) {
    let files; try { files = (await readdir(path.join(transcriptsDir, d))).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const fp = path.join(transcriptsDir, d, f);
      const st = await stat(fp).catch(() => null);
      if (!st || now - st.mtimeMs > days * 86_400_000) continue;
      const lines = (await readFile(fp, 'utf8')).split('\n');
      for (const c of extract(lines, { workstreams, source: `session ${f.slice(0, 8)}`, at: st.mtime.toISOString() })) {
        if (known.has(c.id)) continue;
        known.add(c.id); fresh.push(c);
      }
    }
  }
  if (fresh.length) await saveDirectives([...store, ...fresh], file);
  return fresh;
}

/** confirmed rules per workstream: config directives + confirmed harvested ones; `global` applies everywhere */
export function rulesByWorkstream({ global = [], workstreams = [] }, harvested = []) {
  const confirmed = (id) => harvested.filter((d) => d.workstream === id && d.status === 'confirmed').map((d) => ({ rule: d.rule, source: d.source }));
  const out = { global: [...global.map((g) => ({ rule: g.rule, source: g.source })), ...confirmed('global')] };
  for (const w of workstreams) out[w.id] = [...(w.directives || []), ...confirmed(w.id)];
  return out;
}

export function renderDirectives(config, harvested = []) {
  const rules = rulesByWorkstream(config, harvested);
  const lines = ['### Workstream directives (Barron) — apply the section for the work you are doing', '', '**All work**', ...rules.global.map((r) => `- ${r.rule} _(${r.source})_`)];
  for (const w of config.workstreams) {
    lines.push('', `**${w.label || w.id}** (\`${w.id}\`) — mode ${w.mode}, compliance ${w.compliance}, ≤ $${w.budgetUsdPerVideo}/video, ${w.platforms.join('/')}, tone: ${w.tone}`);
    lines.push(...(rules[w.id].length ? rules[w.id].map((r) => `- ${r.rule} _(${r.source})_`) : ['- (none yet)']));
  }
  const pending = harvested.filter((d) => d.status === 'candidate').length;
  if (pending) lines.push('', `_${pending} harvested instruction(s) await confirmation: \`node ~/Projects/creativeintel-20260712/workers/video-brain/bin/xark-job.mjs directives\`_`);
  lines.push('', 'Register session-made videos so the Brain checks and learns from them: `xark-job start --workstream <id> --dir <folder>` … `xark-job finish <jobId>`.');
  return lines.join('\n');
}
