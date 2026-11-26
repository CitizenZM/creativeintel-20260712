// Daily digest to Barron (Feishu DM to his open_id ONLY — the Affiliate OS notifier enforces open_id + the group blocklist
// and re-reads the message as its second check). Lists only what waits on Barron and what the brain did; ≤ 1 per day.
import { homedir } from 'node:os';
import path from 'node:path';
import { FUNDS_INCIDENT } from './incidents.mjs';

export const DIGEST_HOUR_PT = 7.5; // 07:30 Pacific
export const NOTIFY_MODULE = process.env.VIDEO_BRAIN_NOTIFY_MODULE || path.join(homedir(), 'Projects', 'affiliate-os-dashboard-20260907', 'tools', 'lib', 'notify.mjs');

const ptParts = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return { day: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour) + Number(p.minute) / 60 }; };

/** due once per Pacific day after 07:30 */
export function digestDue(lastDay, now = Date.now()) { const p = ptParts(now); return p.h >= DIGEST_HOUR_PT && lastDay !== p.day ? p.day : null; }

const DAY = 86_400_000;
// stale local mirrors of Xark runs (the server copy is authoritative) are not reported or learned from
export const STALE_MIRROR = /^local:(xk-|xark-lab$)/;
export const SETUP_ARCHIVE_DAYS = 14;
/** failing fields that count: advisory fields (e.g. 'pipeline review') are information, never a failure */
export const hardFails = (c) => (c.fields || []).filter((f) => !f.pass && !f.advisory);
/** a check fails on a non-advisory field (or says pass:false with no field detail) */
export const isBad = (c) => hardFails(c).length > 0 || (!c.pass && !(c.fields || []).some((f) => !f.pass));

/** checks: every stored check (state.checks), not only the newest 40 the snapshot carries */
export function buildDigest(snap, events24h = [], checks = snap.checks || []) {
  const loops = snap.loops || [];
  const nowMs = Date.parse(snap.at) || Date.now();
  const needBarron = loops.filter((l) => l.waitingOn === 'budget' || l.agent === 'Barron' || (l.status === 'idle-defect' && l.step === 'setup'));
  // setup projects nobody touched for >= 14 d: one archive line, not one ask each every day
  const idleDays = (l) => (nowMs - Date.parse(l.idleSince || l.lastActivityAt || '')) / DAY;
  const archivable = needBarron.filter((l) => l.status === 'idle-defect' && l.step === 'setup' && idleDays(l) >= SETUP_ARCHIVE_DAYS);
  const asksNamed = needBarron.filter((l) => !archivable.includes(l));
  // runs held only because the provider funds are out: one ask, not one per project ('estimate' is free brain work, not listed)
  const funds = loops.filter((l) => l.waitingOn === 'funds');
  const balance = (snap.probes || []).find((p) => p.name === 'openrouter balance' && !p.ok);
  const fundsOut = funds.length > 0 || !!snap.budget?.out;
  const stalled = loops.filter((l) => l.status === 'idle-defect' && !needBarron.includes(l));
  // when funds are the cause, the balance probe, the 402 incident and the budget line fold into the one ask; other failures stay
  const failedProbes = (snap.probes || []).filter((p) => !p.ok && !(fundsOut && p === balance));
  const human = (snap.incidents || []).filter((i) => i.kind === 'human' && i.status !== 'resolved' && !(fundsOut && FUNDS_INCIDENT.test(`${i.signature || ''} ${i.runbook || ''}`)));
  const badChecks = checks.filter((c) => isBad(c) && !STALE_MIRROR.test(c.projectId || '') && c.renderedAt && nowMs - Date.parse(c.renderedAt) < 7 * DAY);
  const nameOf = (id) => loops.find((l) => l.projectId === id)?.name || id;
  // only server projects (cuid ids) link to their deliver page; local/batch jobs have no web page
  const linkOf = (id) => (/^c[a-z0-9]{20,30}$/.test(id || '') ? ` → https://creative.xark.io/projects/${id}/deliver` : '');
  const did = events24h.filter((e) => ['decide', 'call', 'fix'].includes(e.kind));
  const lines = [`【Video Brain 日报】${new Date(snap.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${loops.length} 个项目 · 今日花费 $${snap.spend?.todayUsd ?? 0}/$${snap.spend?.capUsd ?? 0}`];
  const asks = asksNamed.length + (fundsOut ? 1 : 0) + (archivable.length ? 1 : 0);
  if (asks) {
    lines.push('', `需要你（${asks}）:`);
    if (fundsOut) {
      const how = balance?.detail || funds[0]?.nextAction || snap.budget?.detail || 'raise the OpenRouter key cap';
      const parts = [funds.length ? `${funds.length} 个项目的运行在等` : null, snap.budget?.out ? '新任务暂做 $0 幻灯片视频' : null].filter(Boolean);
      lines.push(`- ${/OpenRouter/.test(how) ? '' : 'OpenRouter '}模型额度用尽${parts.length ? '，' + parts.join('，') : ''}: ${how}`);
    }
    for (const l of asksNamed.slice(0, 8)) lines.push(`- ${l.name}: ${l.nextAction}`);
    if (archivable.length) lines.push(`- ${archivable.length} 个项目 ≥${SETUP_ARCHIVE_DAYS} 天无动静（可归档）→ https://creative.xark.io/brain`);
  }
  if (human.length) { lines.push('', '需要你处理的故障:'); for (const i of human.slice(0, 4)) lines.push(`- ${i.runbook}（${i.count} 次）`); }
  if (failedProbes.length) { lines.push('', '能力体检失败:'); for (const p of failedProbes) lines.push(`- ${p.name}: ${p.detail}`); }
  if (stalled.length) { lines.push('', `大脑在推进的停滞项目（${stalled.length}）:`); for (const l of stalled.slice(0, 6)) lines.push(`- ${l.name} @${l.step}: ${l.nextAction}`); }
  if (badChecks.length) {
    lines.push('', `近 7 天成片二次复查未通过 ${badChecks.length} 条`);
    // one line per project: how many, and the first failing field with its value (from the newest failing check)
    const per = new Map();
    for (const c of [...badChecks].sort((a, b) => (a.at < b.at ? 1 : -1))) { const g = per.get(c.projectId) || { n: 0, c }; g.n += 1; per.set(c.projectId, g); }
    for (const [id, { n, c }] of [...per].slice(0, 6)) {
      const f = hardFails(c)[0];
      const what = f ? `${f.field}${f.actual != null ? ' ' + f.actual : ''}`.slice(0, 60) : '?';
      lines.push(`- ${nameOf(id)}（${n} 条）: ${what}${linkOf(id)}`);
    }
  }
  const deliverable = checks.filter((c) => !isBad(c) && c.at && !STALE_MIRROR.test(c.projectId || '') && nowMs - Date.parse(c.at) < DAY);
  if (deliverable.length) {
    lines.push('', `可交付（复查通过，24 h 内）${deliverable.length} 条`);
    const per = new Map(); for (const c of deliverable) per.set(c.projectId, (per.get(c.projectId) || 0) + 1);
    for (const [id, n] of [...per].filter(([id]) => linkOf(id)).slice(0, 3)) lines.push(`- ${nameOf(id)}（${n} 条）${linkOf(id)}`);
  }
  if (!snap.budget?.out && snap.upgradable?.length) lines.push('', `可升级为纯视频（需你在 Studio 批准）: ${snap.upgradable.length} 条预算期间的幻灯片视频`);
  if (snap.rulesPr?.url) lines.push('', `待你审的规则 PR（合并=生效，关闭=否决）: ${snap.rulesPr.url}`);
  lines.push('', `过去 24 h 大脑执行 ${did.length} 个动作（批准/重试/修复）`, '详情: https://creative.xark.io/brain');
  return lines.join('\n');
}

export async function sendDigest(text, { importer = (p) => import(p) } = {}) {
  const n = await importer(NOTIFY_MODULE);
  const cfg = n.loadFeishuConfig();
  if (!cfg.ok) return { ok: false, reason: cfg.reason };
  const r = await n.sendVerifiedDM(cfg, text);
  // sent: the DM went out (a messageId exists) even when the read-back did not verify; the brain never re-sends it
  return { ok: !!r.ok && !!r.verified, sent: !!r.ok && !!r.messageId, messageId: r.messageId || null, reasons: r.reasons || [] };
}

/** read-only second check of a digest already sent (no send) → { ok, reasons } */
export async function verifyDigest(messageId, text, { importer = (p) => import(p) } = {}) {
  const n = await importer(NOTIFY_MODULE);
  const cfg = n.loadFeishuConfig();
  if (!cfg.ok) return { ok: false, reasons: [cfg.reason] };
  const v = await n.verifyFeishuDM(cfg, messageId, text);
  return { ok: !!v.verified, reasons: v.reasons || [] };
}
