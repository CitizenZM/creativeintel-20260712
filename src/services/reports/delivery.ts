/**
 * Scheduled report delivery — a weekly digest per project:
 *   spend vs budget · runs rendered · preflight scores · performance winners · hook trends ·
 *   next-round proposal · media-plan pacing vs actual
 * built from the campaign-report model (campaign-report.ts, no LLM narrative) and rendered as a
 * compact markdown card (Feishu) and an inline-styled HTML email body.
 *
 * Safety:
 *   - DRY-RUN by default: the payload is built and logged on a ReportDelivery row, nothing is sent.
 *   - Sending needs BOTH Project.reportDelivery.enabled AND env REPORT_DELIVERY_SEND=on.
 *   - Feishu goes to a user open_id (receive_id_type=open_id) only — never a chat_id. The two
 *     blocklisted group chats are refused on every channel, even if configured, before any network call.
 *   - A send is only "sent" after a read-back of the platform's own record matches (message id, type,
 *     not a blocklisted chat). Webhooks have no read-back: "sent-unverified".
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { spentOf, type SpendEntryRecord } from "@/services/ops/budget-guard";
import type { HookTrendReport } from "@/services/research/hook-trends";
import type { NextRoundProposal } from "@/services/performance/iterate";
import { CHANNELS, type MediaChannel, type MediaPlan } from "@/services/strategy/media-plan";
import type { CampaignReportModel } from "./campaign-report";
import { esc } from "./report-html";

/* ───────────────────────── config + guard ───────────────────────── */

export const REPORT_CHANNELS = ["feishu-dm", "email", "webhook"] as const;
export type ReportChannel = (typeof REPORT_CHANNELS)[number];

/** HARD RULE (owner): never deliver to these Feishu group chats, on any channel, even if configured. */
export const FEISHU_BLOCKED_CHAT_IDS: ReadonlySet<string> = new Set(["oc_b61cb610b6f673af89616b5851688960", "oc_c718a09070d66e060134430b66afa9ce"]);

const containsBlocked = (s: string | null | undefined) => !!s && [...FEISHU_BLOCKED_CHAT_IDS].some((id) => s.includes(id));
const FEISHU_HOST = /(^|\.)(feishu\.cn|larksuite\.com|larkoffice\.com|feishu-pre\.cn)$/i;

/** Why a destination is refused, or null when it's allowed. Checked before every send. */
export function targetRefusal(channel: ReportChannel | string, target: string | null | undefined): string | null {
  const t = (target ?? "").trim();
  if (containsBlocked(t)) return "Refused: target is a blocklisted Feishu group chat — digests never go there.";
  if (channel === "feishu-dm") {
    if (!/^ou_[A-Za-z0-9_-]{6,}$/.test(t)) return "Feishu delivery goes to a user open_id (ou_…) only — chat ids and other ids are refused.";
    return null;
  }
  if (channel === "email") return /^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(t) ? null : "Target is not a valid email address.";
  if (channel === "webhook") {
    let u: URL;
    try {
      u = new URL(t);
    } catch {
      return "Webhook target is not a URL.";
    }
    if (u.protocol !== "https:") return "Webhook target must be https.";
    if (FEISHU_HOST.test(u.hostname)) return "Feishu/Lark webhooks post to group chats — use channel feishu-dm with an open_id.";
    return null;
  }
  return `Unknown channel ${channel}.`;
}

const baseConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channel: z.enum(REPORT_CHANNELS),
  target: z.string().trim().min(3).max(500),
  schedule: z.enum(["weekly", "manual"]).default("weekly"),
});
export type ReportDeliveryConfig = z.infer<typeof baseConfigSchema>;

export function parseDeliveryConfig(raw: unknown): { ok: true; config: ReportDeliveryConfig } | { ok: false; error: string } {
  const p = baseConfigSchema.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    return { ok: false, error: i ? `Invalid ${i.path.join(".") || "config"}: ${i.message}` : "Invalid config" };
  }
  const refusal = targetRefusal(p.data.channel, p.data.target);
  return refusal ? { ok: false, error: refusal } : { ok: true, config: p.data };
}

type Env = Record<string, string | undefined>;

export function sendingEnabled(cfg: Partial<ReportDeliveryConfig>, env: Env = process.env): boolean {
  return cfg.enabled === true && env.REPORT_DELIVERY_SEND === "on";
}

export class DeliveryError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/* ───────────────────────── digest model ───────────────────────── */

export interface PerfSpendRow {
  platform: string;
  spend: number;
  dateFrom?: Date | string | null;
  dateTo?: Date | string | null;
}

export interface DigestInputs {
  projectId: string;
  period: { from: Date; to: Date };
  report: CampaignReportModel;
  periodSpend: SpendEntryRecord[];
  hookTrends?: Pick<HookTrendReport, "rising" | "saturated" | "recommendations"> | null;
  nextRound?: Pick<NextRoundProposal, "mode" | "keep" | "kill" | "explore" | "cost" | "approval"> | null;
  mediaPlan?: MediaPlan | null;
  performance?: PerfSpendRow[];
}

export interface PacingRow {
  family: string;
  channels: MediaChannel[];
  plannedTotal: number;
  plannedToDate: number;
  actualToDate: number;
  variancePct: number | null;
  status: "on-pace" | "under" | "over" | "no-data";
}
export interface PacingReport {
  asOf: string;
  flight: { start: string; end: string };
  rows: PacingRow[];
  plannedToDate: number;
  actualToDate: number;
}

export interface Digest {
  version: 1;
  projectId: string;
  title: string;
  generatedAt: string;
  period: { from: string; to: string };
  spend: { periodUsd: number; totalUsd: number; budgetUsd: number | null; usedPct: number | null; remainingUsd: number | null; byKind: { label: string; usd: number }[] };
  runs: { rendered: number; list: { label: string; status: string; qcPct: number | null; preflight: number | null; masterUrl: string | null; variants: number }[] };
  preflight: { avg: number | null; scores: { label: string; score: number }[] };
  winners: { hookWinner: string | null; ctrWinner: string | null; keep: string[] } | null;
  hookTrends: { rising: { hookId: string; name: string; platform: string; share: number }[]; saturated: { hookId: string; name: string; platform: string; share: number }[]; recommendation: string | null } | null;
  nextRound: { mode: string; keep: string[]; kill: string[]; explore: string[]; costUsd: number | null; approval: string | null } | null;
  pacing: PacingReport | null;
  actions: string[];
}

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayOf = (d: Date | string | number) => Math.floor(new Date(d).getTime() / DAY) * DAY;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

function perfFamily(platform: string): string {
  const p = platform.toLowerCase();
  if (/meta|facebook|instagram/.test(p)) return "meta";
  if (/tiktok/.test(p)) return "tiktok";
  if (/youtube|google/.test(p)) return "youtube";
  if (/pinterest/.test(p)) return "pinterest";
  if (/snap/.test(p)) return "snapchat";
  return "other";
}

/**
 * Planned spend to date (whole days before `asOf`, from the weekly pacing) vs actual spend from the
 * imported results, per platform family (results are per platform, not placement). Rows spanning the
 * window edge are prorated by days.
 */
export function pacingVsActual(plan: MediaPlan | null | undefined, rows: PerfSpendRow[], asOf: Date): PacingReport | null {
  if (!plan?.allocations?.length || !plan.pacing?.weeks?.length) return null;
  const flightStart = dayOf(`${plan.flight.start}T00:00:00Z`);
  const flightEnd = dayOf(`${plan.flight.end}T00:00:00Z`);
  const lastDone = Math.min(flightEnd, dayOf(asOf) - DAY); // last completed day
  const families = new Map<string, MediaChannel[]>();
  for (const a of plan.allocations) {
    const fam = CHANNELS[a.channel]?.family ?? "other";
    families.set(fam, [...(families.get(fam) ?? []), a.channel]);
  }
  const out: PacingRow[] = [];
  for (const [family, chans] of families) {
    let plannedTotal = 0;
    let plannedToDate = 0;
    for (const w of plan.pacing.weeks) {
      const wk = chans.reduce((s, c) => s + (w.byChannel[c] ?? 0), 0);
      plannedTotal += wk;
      const ws = dayOf(`${w.start}T00:00:00Z`);
      const done = Math.max(0, Math.min(w.days, Math.floor((lastDone - ws) / DAY) + 1));
      plannedToDate += (wk * done) / w.days;
    }
    let actual = 0;
    let seen = false;
    for (const r of rows) {
      if (perfFamily(r.platform) !== family) continue;
      const a = r.dateFrom ? dayOf(r.dateFrom) : flightStart;
      const b = r.dateTo ? dayOf(r.dateTo) : a;
      const lo = Math.max(a, flightStart);
      const hi = Math.min(b, lastDone);
      if (hi < lo) continue;
      seen = true;
      actual += (r.spend * ((hi - lo) / DAY + 1)) / ((b - a) / DAY + 1);
    }
    const variancePct = plannedToDate > 0 ? Math.round(((actual - plannedToDate) / plannedToDate) * 1000) / 10 : null;
    const status: PacingRow["status"] = !seen ? "no-data" : variancePct === null ? "over" : Math.abs(variancePct) <= 15 ? "on-pace" : variancePct < 0 ? "under" : "over";
    out.push({ family, channels: chans, plannedTotal: r2(plannedTotal), plannedToDate: r2(plannedToDate), actualToDate: r2(actual), variancePct, status });
  }
  return {
    asOf: asOf.toISOString(),
    flight: { start: plan.flight.start, end: plan.flight.end },
    rows: out,
    plannedToDate: r2(out.reduce((s, r) => s + r.plannedToDate, 0)),
    actualToDate: r2(out.reduce((s, r) => s + r.actualToDate, 0)),
  };
}

export function buildDigest(inputs: DigestInputs, now: Date = new Date()): Digest {
  const m = inputs.report;
  const from = inputs.period.from.getTime();
  const to = inputs.period.to.getTime();
  const inPeriod = (d: string | Date | null | undefined) => {
    const t = d ? new Date(d).getTime() : NaN;
    return t >= from && t <= to;
  };
  const periodRuns = m.production.runs.filter((r) => inPeriod(r.createdAt));
  const scores = periodRuns.filter((r) => r.preflight).map((r) => ({ label: r.label, score: r.preflight!.score }));
  const nr = inputs.nextRound;
  const ht = inputs.hookTrends;
  const trendRow = (h: { hookId: string; name: string; platform: string; share: number }) => ({ hookId: h.hookId, name: h.name, platform: String(h.platform), share: h.share });
  return {
    version: 1,
    projectId: inputs.projectId,
    title: m.project.title,
    generatedAt: now.toISOString(),
    period: { from: inputs.period.from.toISOString(), to: inputs.period.to.toISOString() },
    spend: {
      periodUsd: r2(inputs.periodSpend.reduce((s, e) => s + spentOf(e), 0)),
      totalUsd: r2(m.spend.totalUsd),
      budgetUsd: m.spend.budgetUsd,
      usedPct: m.spend.usedPct === null ? null : Math.round(m.spend.usedPct),
      remainingUsd: m.spend.budgetUsd == null ? null : r2(m.spend.budgetUsd - m.spend.totalUsd),
      byKind: m.spend.byKindLabelled.map((b) => ({ label: b.label, usd: r2(b.usd) })),
    },
    runs: {
      rendered: periodRuns.filter((r) => r.status === "completed").length,
      list: periodRuns.map((r) => ({ label: r.label, status: r.status, qcPct: r.qc ? Math.round(r.qc.pct) : null, preflight: r.preflight?.score ?? null, masterUrl: r.masterUrl, variants: r.variants.length })),
    },
    preflight: { avg: scores.length ? Math.round(scores.reduce((s, x) => s + x.score, 0) / scores.length) : null, scores },
    winners:
      m.performance || nr?.keep?.length
        ? { hookWinner: m.performance?.hookWinner ?? null, ctrWinner: m.performance?.ctrWinner ?? null, keep: (nr?.keep ?? []).map((k) => k.id) }
        : null,
    hookTrends: ht ? { rising: (ht.rising ?? []).slice(0, 3).map(trendRow), saturated: (ht.saturated ?? []).slice(0, 3).map(trendRow), recommendation: ht.recommendations?.[0] ?? null } : null,
    nextRound: nr
      ? { mode: nr.mode, keep: (nr.keep ?? []).map((k) => k.id), kill: (nr.kill ?? []).map((k) => k.id), explore: (nr.explore ?? []).map((e) => e.hookId), costUsd: nr.cost?.totalUsd ?? null, approval: nr.approval?.note ?? null }
      : null,
    pacing: pacingVsActual(inputs.mediaPlan, inputs.performance ?? [], now),
    actions: m.nextActions.slice(0, 3),
  };
}

/* ───────────────────────── renderers ───────────────────────── */

export function digestSubject(d: Digest): string {
  return `Weekly digest — ${d.title} (${d.period.from.slice(0, 10)} → ${d.period.to.slice(0, 10)})`;
}

const hookList = (xs: { hookId: string; name: string; platform: string }[]) => xs.map((h) => `${h.hookId} ${h.name} (${h.platform})`).join(", ");

/** Markdown without tables or # headings, so the same text works as a Feishu card. */
export function renderDigestMarkdown(d: Digest): string {
  const L: string[] = [];
  const s = d.spend;
  L.push(`**Spend** — ${usd(s.periodUsd)} this week, ${usd(s.totalUsd)} to date${s.budgetUsd != null ? ` of ${usd(s.budgetUsd)} (${s.usedPct ?? 0}% used, ${usd(s.remainingUsd ?? 0)} left)` : " (no budget cap set)"}`);
  if (s.byKind.length) L.push(`- ${s.byKind.slice(0, 4).map((k) => `${k.label} ${usd(k.usd)}`).join(" · ")}`);
  L.push("", `**Runs** — ${d.runs.rendered} rendered this week`);
  for (const r of d.runs.list.slice(0, 5)) L.push(`- ${r.label}: ${r.status}${r.qcPct !== null ? `, QC ${r.qcPct}%` : ""}${r.preflight !== null ? `, preflight ${r.preflight}` : ""}${r.variants ? `, ${r.variants} variant(s)` : ""}`);
  L.push("", `**Preflight** — ${d.preflight.avg !== null ? `average ${d.preflight.avg}/100 over ${d.preflight.scores.length} run(s)` : "no runs scored this week"}`);
  L.push("", "**Winners**");
  if (d.winners) {
    L.push(`- Hook rate: ${d.winners.hookWinner ?? "no significant winner"} · CTR: ${d.winners.ctrWinner ?? "no significant winner"}`);
    if (d.winners.keep.length) L.push(`- Keep: ${d.winners.keep.join(", ")}`);
  } else L.push("- No results imported yet");
  L.push("", "**Hook trends**");
  if (d.hookTrends) {
    L.push(`- Rising: ${hookList(d.hookTrends.rising) || "none"}`);
    L.push(`- Saturated: ${hookList(d.hookTrends.saturated) || "none"}`);
    if (d.hookTrends.recommendation) L.push(`- ${d.hookTrends.recommendation}`);
  } else L.push("- No competitor ads in the window");
  L.push("", "**Next round**");
  if (d.nextRound) {
    L.push(`- ${d.nextRound.mode}: keep ${d.nextRound.keep.join(", ") || "—"} · kill ${d.nextRound.kill.join(", ") || "—"} · explore ${d.nextRound.explore.join(", ") || "—"}${d.nextRound.costUsd !== null ? ` · est. ${usd(d.nextRound.costUsd)}` : ""}`);
    if (d.nextRound.approval) L.push(`- ${d.nextRound.approval}`);
  } else L.push("- No proposal yet (run next-round)");
  if (d.pacing) {
    L.push("", `**Pacing vs plan** — ${usd(d.pacing.actualToDate)} actual vs ${usd(d.pacing.plannedToDate)} planned to date`);
    for (const r of d.pacing.rows) L.push(`- ${r.family}: ${usd(r.actualToDate)} vs ${usd(r.plannedToDate)}${r.variancePct !== null ? ` (${r.variancePct > 0 ? "+" : ""}${r.variancePct}%)` : ""} — ${r.status}`);
  }
  if (d.actions.length) {
    L.push("", "**Next actions**");
    d.actions.forEach((a, i) => L.push(`${i + 1}. ${a}`));
  }
  return L.join("\n");
}

const TD = 'style="padding:6px 8px;border-bottom:1px solid #e3e3e0;text-align:left;vertical-align:top"';
const TH = 'style="padding:6px 8px;border-bottom:1px solid #e3e3e0;text-align:left;color:#6b6b70;font-size:12px;text-transform:uppercase"';
function htmlTable(head: string[], rows: (string | number)[][]): string {
  if (!rows.length) return "";
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;font-size:14px"><tr>${head.map((h) => `<th ${TH}>${esc(h)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td ${TD}>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
}
const H2 = 'style="font-size:16px;margin:22px 0 8px"';
const P = 'style="margin:6px 0"';

/** Inline-styled HTML email body (no scripts, no SVG — email clients strip them). */
export function renderDigestHtml(d: Digest): string {
  const s = d.spend;
  const parts: string[] = [];
  parts.push(`<h1 style="font-size:20px;margin:0 0 4px">${esc(digestSubject(d))}</h1>`);
  parts.push(`<h2 ${H2}>Spend vs budget</h2><p ${P}>${esc(usd(s.periodUsd))} this week · ${esc(usd(s.totalUsd))} to date${s.budgetUsd != null ? ` of ${esc(usd(s.budgetUsd))} (${esc(s.usedPct ?? 0)}% used)` : " · no budget cap set"}</p>`);
  parts.push(htmlTable(["Cost type", "USD"], s.byKind.map((k) => [k.label, usd(k.usd)])));
  parts.push(`<h2 ${H2}>Runs rendered</h2><p ${P}>${d.runs.rendered} completed this week · preflight ${d.preflight.avg !== null ? `${d.preflight.avg}/100 average` : "not scored"}</p>`);
  parts.push(htmlTable(["Run", "Status", "QC", "Preflight", "Variants"], d.runs.list.map((r) => [r.label, r.status, r.qcPct !== null ? `${r.qcPct}%` : "—", r.preflight ?? "—", r.variants])));
  parts.push(`<h2 ${H2}>Performance winners</h2><p ${P}>${d.winners ? `Hook rate: ${esc(d.winners.hookWinner ?? "no significant winner")} · CTR: ${esc(d.winners.ctrWinner ?? "no significant winner")}${d.winners.keep.length ? ` · keep ${esc(d.winners.keep.join(", "))}` : ""}` : "No results imported yet."}</p>`);
  if (d.hookTrends) {
    parts.push(`<h2 ${H2}>Hook trends</h2>`);
    parts.push(htmlTable(["Status", "Hook", "Platform", "Share"], [...d.hookTrends.rising.map((h) => ["rising", `${h.hookId} ${h.name}`, h.platform, `${Math.round(h.share * 100)}%`]), ...d.hookTrends.saturated.map((h) => ["saturated", `${h.hookId} ${h.name}`, h.platform, `${Math.round(h.share * 100)}%`])]));
    if (d.hookTrends.recommendation) parts.push(`<p ${P}>${esc(d.hookTrends.recommendation)}</p>`);
  }
  parts.push(`<h2 ${H2}>Next round</h2><p ${P}>${d.nextRound ? `${esc(d.nextRound.mode)} — keep ${esc(d.nextRound.keep.join(", ") || "—")}, kill ${esc(d.nextRound.kill.join(", ") || "—")}, explore ${esc(d.nextRound.explore.join(", ") || "—")}${d.nextRound.costUsd !== null ? `, est. ${esc(usd(d.nextRound.costUsd))}` : ""}. ${esc(d.nextRound.approval ?? "")}` : "No proposal yet."}</p>`);
  if (d.pacing) {
    parts.push(`<h2 ${H2}>Media-plan pacing vs actual</h2>`);
    parts.push(htmlTable(["Platform", "Planned to date", "Actual", "Variance", "Status"], d.pacing.rows.map((r) => [r.family, usd(r.plannedToDate), usd(r.actualToDate), r.variancePct !== null ? `${r.variancePct}%` : "—", r.status])));
  }
  if (d.actions.length) parts.push(`<h2 ${H2}>Next actions</h2><ol style="margin:6px 0;padding-left:20px">${d.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>`);
  return `<div style="font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1d1f;max-width:640px">${parts.join("")}<p style="margin-top:20px;color:#6b6b70;font-size:12px">CreativeIntel weekly digest · generated ${esc(d.generatedAt)}</p></div>`;
}

export function feishuCard(d: Digest): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: { template: "blue", title: { tag: "plain_text", content: digestSubject(d).slice(0, 120) } },
    elements: [{ tag: "markdown", content: renderDigestMarkdown(d).slice(0, 9000) }],
  };
}

export interface DigestPayload {
  subject: string;
  markdown: string;
  html: string;
  feishuCard: Record<string, unknown>;
  digest: Digest;
}

export function digestPayload(d: Digest): DigestPayload {
  return { subject: digestSubject(d), markdown: renderDigestMarkdown(d), html: renderDigestHtml(d), feishuCard: feishuCard(d), digest: d };
}

/* ───────────────────────── adapters ───────────────────────── */

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface DeliverDeps {
  fetch?: Fetch;
  env?: Env;
}
export interface DeliveryResult {
  status: "dry-run" | "sent" | "sent-unverified" | "failed" | "refused";
  reason?: string;
  verified?: boolean;
  response?: Record<string, unknown>;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Feishu bot → one user's DM by open_id, then a read-back of the message (二次复查). */
export async function sendFeishuDm(openId: string, payload: DigestPayload, deps: { fetch: Fetch; env: Env }): Promise<DeliveryResult> {
  const refusal = targetRefusal("feishu-dm", openId);
  if (refusal) return { status: "refused", reason: refusal };
  const { FEISHU_APP_ID: appId, FEISHU_APP_SECRET: secret } = deps.env;
  if (!appId || !secret) return { status: "failed", reason: "FEISHU_APP_ID / FEISHU_APP_SECRET not set" };
  const base = deps.env.FEISHU_DOMAIN === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
  const tok = await readJson(await deps.fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app_id: appId, app_secret: secret }) }));
  if (tok.code !== 0 || typeof tok.tenant_access_token !== "string") return { status: "failed", reason: `Feishu token: ${String(tok.msg ?? tok.code ?? "error")}` };
  const auth = { authorization: `Bearer ${tok.tenant_access_token}`, "content-type": "application/json; charset=utf-8" };
  // receive_id_type is fixed to open_id: this adapter can't address a chat.
  const sent = await readJson(await deps.fetch(`${base}/open-apis/im/v1/messages?receive_id_type=open_id`, { method: "POST", headers: auth, body: JSON.stringify({ receive_id: openId, msg_type: "interactive", content: JSON.stringify(payload.feishuCard) }) }));
  const data = (sent.data ?? {}) as Record<string, unknown>;
  const messageId = typeof data.message_id === "string" ? data.message_id : null;
  if (sent.code !== 0 || !messageId) return { status: "failed", reason: `Feishu send: ${String(sent.msg ?? sent.code ?? "error")}`, response: { code: sent.code } };
  const back = await readJson(await deps.fetch(`${base}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`, { method: "GET", headers: auth }));
  const item = (((back.data ?? {}) as Record<string, unknown>).items as Record<string, unknown>[] | undefined)?.[0];
  const response = { messageId, readBack: item ? { message_id: item.message_id, msg_type: item.msg_type, chat_id: item.chat_id } : null };
  if (back.code !== 0 || !item) return { status: "failed", reason: "Sent, but the read-back of the message failed — not confirmed", verified: false, response };
  if (containsBlocked(String(item.chat_id ?? ""))) return { status: "failed", reason: "Read-back shows a blocklisted chat — treat as an incident", verified: false, response };
  if (item.message_id !== messageId || item.msg_type !== "interactive") return { status: "failed", reason: "Read-back does not match the sent message", verified: false, response };
  return { status: "sent", verified: true, response };
}

/** Email via the Resend HTTP API (RESEND_API_KEY + REPORT_EMAIL_FROM), with a read-back of the email record. */
export async function sendEmail(to: string, payload: DigestPayload, deps: { fetch: Fetch; env: Env }): Promise<DeliveryResult> {
  const refusal = targetRefusal("email", to);
  if (refusal) return { status: "refused", reason: refusal };
  const key = deps.env.RESEND_API_KEY;
  const from = deps.env.REPORT_EMAIL_FROM;
  if (!key || !from) return { status: "failed", reason: "No email provider configured — set RESEND_API_KEY and REPORT_EMAIL_FROM" };
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  const res = await deps.fetch("https://api.resend.com/emails", { method: "POST", headers, body: JSON.stringify({ from, to: [to], subject: payload.subject, html: payload.html, text: payload.markdown }) });
  const out = await readJson(res);
  const id = typeof out.id === "string" ? out.id : null;
  if (!res.ok || !id) return { status: "failed", reason: `Email send: ${String(out.message ?? res.status)}` };
  const back = await readJson(await deps.fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, { method: "GET", headers }));
  const toList = Array.isArray(back.to) ? back.to.map(String) : [];
  const ok = back.id === id && toList.includes(to) && back.subject === payload.subject;
  return ok ? { status: "sent", verified: true, response: { id } } : { status: "failed", reason: "Sent, but the read-back of the email does not match — not confirmed", verified: false, response: { id } };
}

/** Generic https webhook: JSON {subject, markdown, html, digest}. No read-back possible. */
export async function sendWebhook(url: string, payload: DigestPayload, deps: { fetch: Fetch }): Promise<DeliveryResult> {
  const refusal = targetRefusal("webhook", url);
  if (refusal) return { status: "refused", reason: refusal };
  const res = await deps.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: payload.subject, markdown: payload.markdown, html: payload.html, digest: payload.digest }), redirect: "error" });
  return res.ok
    ? { status: "sent-unverified", verified: false, reason: "Webhook accepted (HTTP 2xx); no read-back — the receiver must confirm", response: { httpStatus: res.status } }
    : { status: "failed", reason: `Webhook HTTP ${res.status}`, response: { httpStatus: res.status } };
}

/** Refusal first, then the dry-run gate, then the channel adapter. */
export async function deliver(cfg: ReportDeliveryConfig, payload: DigestPayload, deps: DeliverDeps = {}): Promise<DeliveryResult> {
  const refusal = targetRefusal(cfg.channel, cfg.target);
  if (refusal) return { status: "refused", reason: refusal };
  const env = deps.env ?? process.env;
  if (!sendingEnabled(cfg, env)) {
    return { status: "dry-run", reason: !cfg.enabled ? "Destination not enabled (reportDelivery.enabled = false)" : "REPORT_DELIVERY_SEND is not 'on'" };
  }
  const f = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  try {
    if (cfg.channel === "feishu-dm") return await sendFeishuDm(cfg.target, payload, { fetch: f, env });
    if (cfg.channel === "email") return await sendEmail(cfg.target, payload, { fetch: f, env });
    return await sendWebhook(cfg.target, payload, { fetch: f });
  } catch (err) {
    return { status: "failed", reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}

/* ───────────────────────── DB ───────────────────────── */

export async function loadDigestInputs(projectId: string, period: { from: Date; to: Date }): Promise<DigestInputs | null> {
  const { buildCampaignReportModel, loadReportInputs } = await import("./campaign-report");
  const data = await loadReportInputs(projectId);
  if (!data) return null;
  const report = await buildCampaignReportModel(data, { narrator: null, now: period.to });
  const [extra, performance, hookTrends] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { nextRound: true, mediaPlan: true } }),
    prisma.adPerformance.findMany({ where: { projectId }, select: { platform: true, spend: true, dateFrom: true, dateTo: true } }).catch(() => [] as PerfSpendRow[]),
    import("@/services/research/hook-trends").then((m) => m.hookTrendReport(projectId, { now: period.to })).catch(() => null),
  ]);
  const from = period.from.getTime();
  const to = period.to.getTime();
  return {
    projectId,
    period,
    report,
    periodSpend: data.spend.filter((e) => {
      const t = new Date(e.createdAt).getTime();
      return t >= from && t <= to;
    }),
    hookTrends,
    nextRound: (extra?.nextRound ?? null) as DigestInputs["nextRound"],
    mediaPlan: (extra?.mediaPlan ?? null) as MediaPlan | null,
    performance,
  };
}

function periodOf(now: Date, since?: string): { from: Date; to: Date } {
  const s = since ? new Date(since) : null;
  if (s && Number.isNaN(s.getTime())) throw new DeliveryError("since must be an ISO date", 400);
  return { from: s ?? new Date(now.getTime() - 7 * DAY), to: now };
}

/** Operator `report-preview`: the digest payload, built and returned — never sent, never logged. */
export async function previewDigest(projectId: string, opts: { since?: string; now?: Date; load?: typeof loadDigestInputs } = {}): Promise<DigestPayload> {
  const now = opts.now ?? new Date();
  const inputs = await (opts.load ?? loadDigestInputs)(projectId, periodOf(now, opts.since));
  if (!inputs) throw new DeliveryError("Project not found", 404);
  return digestPayload(buildDigest(inputs, now));
}

/** Operator `report-delivery-config`: read, or merge + validate + store, Project.reportDelivery. */
export async function updateDeliveryConfig(projectId: string, patch: Partial<ReportDeliveryConfig> | undefined, env: Env = process.env): Promise<{ config: ReportDeliveryConfig | null; sendFlag: boolean; willSend: boolean }> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, reportDelivery: true } });
  if (!project) throw new DeliveryError("Project not found", 404);
  const current = (project.reportDelivery ?? null) as Partial<ReportDeliveryConfig> | null;
  if (!patch) {
    const parsed = current ? parseDeliveryConfig(current) : null;
    const config = parsed?.ok ? parsed.config : null;
    return { config, sendFlag: env.REPORT_DELIVERY_SEND === "on", willSend: !!config && sendingEnabled(config, env) };
  }
  const parsed = parseDeliveryConfig({ enabled: false, schedule: "weekly", ...(current ?? {}), ...patch });
  if (!parsed.ok) throw new DeliveryError(parsed.error, 400);
  await prisma.project.update({ where: { id: projectId }, data: { reportDelivery: parsed.config as object } });
  return { config: parsed.config, sendFlag: env.REPORT_DELIVERY_SEND === "on", willSend: sendingEnabled(parsed.config, env) };
}

export interface RunDigestOptions extends DeliverDeps {
  now?: Date;
  /** Run a "manual"-schedule project too. */
  force?: boolean;
  load?: typeof loadDigestInputs;
}
export interface RunDigestResult {
  projectId: string;
  status: DeliveryResult["status"] | "skipped";
  reason?: string;
  deliveryId?: string;
  verified?: boolean;
}

const SENT = ["sent", "sent-unverified"];

/** Build one project's digest, deliver it (or dry-run), and log a ReportDelivery row. */
export async function runProjectDigest(projectId: string, opts: RunDigestOptions = {}): Promise<RunDigestResult> {
  const now = opts.now ?? new Date();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, reportDelivery: true } });
  if (!project) return { projectId, status: "skipped", reason: "Project not found" };
  if (!project.reportDelivery) return { projectId, status: "skipped", reason: "No reportDelivery config" };
  const base = baseConfigSchema.safeParse(project.reportDelivery);
  if (!base.success) return { projectId, status: "skipped", reason: "Invalid reportDelivery config" };
  const cfg = base.data;
  if (cfg.schedule !== "weekly" && !opts.force) return { projectId, status: "skipped", reason: "Schedule is manual" };
  const recent = await prisma.reportDelivery.findFirst({ where: { projectId, status: { in: SENT }, createdAt: { gte: new Date(now.getTime() - 6 * DAY) } }, select: { id: true, status: true } });
  if (recent) return { projectId, status: "skipped", reason: "Already delivered in the last 6 days" };
  const period = periodOf(now);
  const inputs = await (opts.load ?? loadDigestInputs)(projectId, period);
  if (!inputs) return { projectId, status: "skipped", reason: "Project not found" };
  const payload = digestPayload(buildDigest(inputs, now));
  const result = await deliver(cfg, payload, { fetch: opts.fetch, env: opts.env });
  const row = await prisma.reportDelivery.create({
    data: {
      projectId,
      channel: cfg.channel,
      target: cfg.target,
      status: result.status,
      dryRun: result.status === "dry-run",
      reason: result.reason ?? null,
      periodFrom: period.from,
      periodTo: period.to,
      payload: { subject: payload.subject, markdown: payload.markdown, html: payload.html, feishuCard: payload.feishuCard } as object,
      response: (result.response ?? undefined) as object | undefined,
    },
    select: { id: true },
  });
  return { projectId, status: result.status, reason: result.reason, deliveryId: row.id, verified: result.verified };
}

/** Cron: every project with a weekly reportDelivery config, one after another within a time budget. */
export async function runDigestCron(opts: RunDigestOptions & { budgetMs?: number } = {}): Promise<RunDigestResult[]> {
  const started = Date.now();
  const { Prisma } = await import("@/generated/prisma/client");
  const projects = await prisma.project.findMany({ where: { reportDelivery: { not: Prisma.AnyNull } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 200 });
  const out: RunDigestResult[] = [];
  for (const p of projects) {
    if (Date.now() - started > (opts.budgetMs ?? 240_000)) {
      out.push({ projectId: p.id, status: "skipped", reason: "Time budget exhausted — next run" });
      continue;
    }
    try {
      out.push(await runProjectDigest(p.id, opts));
    } catch (err) {
      out.push({ projectId: p.id, status: "failed", reason: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
    }
  }
  return out;
}
