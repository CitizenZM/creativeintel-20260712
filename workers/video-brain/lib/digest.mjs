// Daily digest to Barron (Feishu DM to his open_id ONLY — the Affiliate OS notifier enforces open_id + the group blocklist
// and re-reads the message as its second check). Lists only what waits on Barron and what the brain did; ≤ 1 per day.
import { homedir } from 'node:os';
import path from 'node:path';

export const DIGEST_HOUR_PT = 7.5; // 07:30 Pacific
export const NOTIFY_MODULE = process.env.VIDEO_BRAIN_NOTIFY_MODULE || path.join(homedir(), 'Projects', 'affiliate-os-dashboard-20260907', 'tools', 'lib', 'notify.mjs');

const ptParts = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return { day: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour) + Number(p.minute) / 60 }; };

/** due once per Pacific day after 07:30 */
export function digestDue(lastDay, now = Date.now()) { const p = ptParts(now); return p.h >= DIGEST_HOUR_PT && lastDay !== p.day ? p.day : null; }

export function buildDigest(snap, events24h = []) {
  const loops = snap.loops || [];
  const needBarron = loops.filter((l) => l.waitingOn === 'budget' || l.agent === 'Barron' || (l.status === 'idle-defect' && l.step === 'setup'));
  // runs held only because the provider funds are out: one ask, not one per project ('estimate' is free brain work, not listed)
  const funds = loops.filter((l) => l.waitingOn === 'funds');
  const stalled = loops.filter((l) => l.status === 'idle-defect' && !needBarron.includes(l));
  const failedProbes = (snap.probes || []).filter((p) => !p.ok);
  const human = (snap.incidents || []).filter((i) => i.kind === 'human' && i.status !== 'resolved');
  // stale local mirrors of Xark runs (the server copy is authoritative) are not reported
  const badChecks = (snap.checks || []).filter((c) => !c.pass && !/^local:(xk-|xark-lab$)/.test(c.projectId || '') && c.renderedAt && Date.now() - Date.parse(c.renderedAt) < 7 * 86_400_000);
  const nameOf = (id) => loops.find((l) => l.projectId === id)?.name || id;
  // only server projects (cuid ids) link to their deliver page; local/batch jobs have no web page
  const linkOf = (id) => (/^c[a-z0-9]{20,30}$/.test(id || '') ? ` → https://creative.xark.io/projects/${id}/deliver` : '');
  const did = events24h.filter((e) => ['decide', 'call', 'fix'].includes(e.kind));
  const lines = [`【Video Brain 日报】${new Date(snap.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${loops.length} 个项目 · 今日花费 $${snap.spend?.todayUsd ?? 0}/$${snap.spend?.capUsd ?? 0}`];
  const asks = needBarron.length + (funds.length ? 1 : 0);
  if (asks) {
    lines.push('', `需要你（${asks}）:`);
    if (funds.length) lines.push(`- 模型额度用尽，${funds.length} 个项目的运行在等: ${funds[0].nextAction}`);
    for (const l of needBarron.slice(0, 8)) lines.push(`- ${l.name}: ${l.nextAction}`);
  }
  if (human.length) { lines.push('', '需要你处理的故障:'); for (const i of human.slice(0, 4)) lines.push(`- ${i.runbook}（${i.count} 次）`); }
  if (failedProbes.length) { lines.push('', '能力体检失败:'); for (const p of failedProbes) lines.push(`- ${p.name}: ${p.detail}`); }
  if (stalled.length) { lines.push('', `大脑在推进的停滞项目（${stalled.length}）:`); for (const l of stalled.slice(0, 6)) lines.push(`- ${l.name} @${l.step}: ${l.nextAction}`); }
  if (badChecks.length) {
    lines.push('', `近 7 天成片二次复查未通过 ${badChecks.length} 条`);
    for (const c of badChecks.slice(0, 3)) lines.push(`- ${nameOf(c.projectId)}: ${(c.fields || []).filter((f) => !f.pass).map((f) => f.field).join(', ') || '?'}${linkOf(c.projectId)}`);
  }
  const nowMs = Date.parse(snap.at) || Date.now();
  const deliverable = (snap.checks || []).filter((c) => c.pass && c.at && nowMs - Date.parse(c.at) < 86_400_000);
  if (deliverable.length) {
    lines.push('', `可交付（复查通过，24 h 内）${deliverable.length} 条`);
    const per = new Map(); for (const c of deliverable) per.set(c.projectId, (per.get(c.projectId) || 0) + 1);
    for (const [id, n] of [...per].filter(([id]) => linkOf(id)).slice(0, 3)) lines.push(`- ${nameOf(id)}（${n} 条）${linkOf(id)}`);
  }
  if (snap.budget?.out) lines.push('', `模型预算用尽：新任务自动做成 $0 幻灯片视频（${snap.budget.detail || ''}）`);
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
