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
  const stalled = loops.filter((l) => l.status === 'idle-defect' && !needBarron.includes(l));
  const failedProbes = (snap.probes || []).filter((p) => !p.ok);
  const human = (snap.incidents || []).filter((i) => i.kind === 'human' && i.status !== 'resolved');
  const badChecks = (snap.checks || []).filter((c) => !c.pass && c.renderedAt && Date.now() - Date.parse(c.renderedAt) < 7 * 86_400_000);
  const did = events24h.filter((e) => ['decide', 'call', 'fix'].includes(e.kind));
  const lines = [`【Video Brain 日报】${new Date(snap.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${loops.length} 个项目 · 今日花费 $${snap.spend?.todayUsd ?? 0}/$${snap.spend?.capUsd ?? 0}`];
  if (needBarron.length) { lines.push('', `需要你（${needBarron.length}）:`); for (const l of needBarron.slice(0, 8)) lines.push(`- ${l.name}: ${l.nextAction}`); }
  if (human.length) { lines.push('', '需要你处理的故障:'); for (const i of human.slice(0, 4)) lines.push(`- ${i.runbook}（${i.count} 次）`); }
  if (failedProbes.length) { lines.push('', '能力体检失败:'); for (const p of failedProbes) lines.push(`- ${p.name}: ${p.detail}`); }
  if (stalled.length) { lines.push('', `大脑在推进的停滞项目（${stalled.length}）:`); for (const l of stalled.slice(0, 6)) lines.push(`- ${l.name} @${l.step}: ${l.nextAction}`); }
  if (badChecks.length) lines.push('', `近 7 天成片二次复查未通过 ${badChecks.length} 条`);
  if (snap.rulesPr?.url) lines.push('', `待你审的规则 PR（合并=生效，关闭=否决）: ${snap.rulesPr.url}`);
  lines.push('', `过去 24 h 大脑执行 ${did.length} 个动作（批准/重试/修复）`, '详情: https://creative.xark.io/brain');
  return lines.join('\n');
}

export async function sendDigest(text, { importer = (p) => import(p) } = {}) {
  const n = await importer(NOTIFY_MODULE);
  const cfg = n.loadFeishuConfig();
  if (!cfg.ok) return { ok: false, reason: cfg.reason };
  const r = await n.sendVerifiedDM(cfg, text);
  return { ok: !!r.ok && !!r.verified, messageId: r.messageId || null, reasons: r.reasons || [] };
}
