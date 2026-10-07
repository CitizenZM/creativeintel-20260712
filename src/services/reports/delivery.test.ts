import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  project: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  reportDelivery: { create: vi.fn(), findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
const loaders = vi.hoisted(() => ({ loadDigestInputs: vi.fn() }));

import { operatorActionSchema } from "@/services/operator";
import { buildMediaPlan } from "@/services/strategy/media-plan";
import type { CampaignReportModel } from "./campaign-report";
import {
  buildDigest,
  deliver,
  digestPayload,
  FEISHU_BLOCKED_CHAT_IDS,
  pacingVsActual,
  parseDeliveryConfig,
  renderDigestHtml,
  renderDigestMarkdown,
  runProjectDigest,
  sendingEnabled,
  targetRefusal,
  updateDeliveryConfig,
  type DigestInputs,
} from "./delivery";

const NOW = new Date("2026-11-16T12:00:00Z");
const ON = { REPORT_DELIVERY_SEND: "on", FEISHU_APP_ID: "cli_x", FEISHU_APP_SECRET: "s", RESEND_API_KEY: "re_x", REPORT_EMAIL_FROM: "reports@example.com" };
const BLOCKED = ["oc_b61cb610b6f673af89616b5851688960", "oc_c718a09070d66e060134430b66afa9ce"];
const OPEN_ID = "ou_7d8a6e6df7621556ce0d21922b676706ccs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function feishuFetch(opts: { readBackId?: string; readBackChat?: string } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("tenant_access_token")) return json({ code: 0, tenant_access_token: "t-123", expire: 7200 });
    if (u.includes("/im/v1/messages?")) return json({ code: 0, data: { message_id: "om_1", chat_id: "oc_dm_1" } });
    if (u.includes("/im/v1/messages/om_1")) return json({ code: 0, data: { items: [{ message_id: opts.readBackId ?? "om_1", msg_type: "interactive", chat_id: opts.readBackChat ?? "oc_dm_1" }] } });
    throw new Error(`unexpected ${u} ${init?.method}`);
  });
}

const report = (over: Partial<CampaignReportModel> = {}): CampaignReportModel =>
  ({
    generatedAt: NOW.toISOString(),
    project: { id: "p1", name: "P", brandName: "Glow", productName: "Serum", title: "Glow Serum", budgetUsd: 50 },
    keyNumbers: [],
    executiveSummary: { text: "", source: "template", cited: [] },
    brief: null,
    plan: null,
    production: {
      runs: [
        { id: "r1", label: "Run 1", status: "completed", createdAt: "2026-11-12T10:00:00.000Z", masterUrl: "https://x/m.mp4", qc: { passed: 9, total: 10, pct: 90, failed: [] }, preflight: { score: 78, label: "Preflight" }, variants: [{ hookStyle: "c" }] },
        { id: "r0", label: "Run 0", status: "completed", createdAt: "2026-10-01T10:00:00.000Z", masterUrl: null, qc: null, preflight: { score: 60, label: "Preflight" }, variants: [] },
      ],
      totals: { runs: 2, completed: 2, failed: 0, variants: 1, avgQcPct: 90, keyframeQcPassPct: null },
    },
    spend: { totalUsd: 41.5, openReservedUsd: 0, calls: 3, byKind: [], byModel: [], byRun: [], projectBudgetUsd: 50, remainingUsd: 8.5, budgetUsd: 50, usedPct: 83, byKindLabelled: [{ label: "Video clips", usd: 40, calls: 2 }] },
    performance: { styles: [], hookWinner: "contrast", ctrWinner: null, totals: null },
    nextActions: ["Set a project budget"],
    ...over,
  }) as unknown as CampaignReportModel;

const mediaPlan = () => buildMediaPlan({ productTitle: "Glow", brand: "Glow", goal: "sales", totalBudget: 28_000, flight: { start: "2026-11-02", end: "2026-11-29" }, channels: ["meta_feed", "tiktok"], aov: 48, now: NOW });

const inputs = (over: Partial<DigestInputs> = {}): DigestInputs => ({
  projectId: "p1",
  period: { from: new Date("2026-11-09T12:00:00Z"), to: NOW },
  report: report(),
  periodSpend: [
    { id: "s1", projectId: "p1", runId: "r1", jobId: null, kind: "video", model: "veo", estUsd: 10, actualUsd: 12, createdAt: new Date("2026-11-12T00:00:00Z") },
    { id: "s2", projectId: "p1", runId: "r1", jobId: null, kind: "llm", model: "glm", estUsd: 0.5, actualUsd: null, createdAt: new Date("2026-11-13T00:00:00Z") },
  ],
  hookTrends: { rising: [{ hookId: "H07", name: "POV", platform: "tiktok", share: 0.12 }], saturated: [{ hookId: "H01", name: "Question", platform: "meta", share: 0.31 }], recommendations: ["Test H07"] } as never,
  nextRound: { mode: "iterate", keep: [{ id: "H03" }], kill: [{ id: "H01" }], explore: [{ hookId: "H07" }], cost: { totalUsd: 4.2 }, approval: { required: true, note: "Approve before rendering" } } as never,
  mediaPlan: null,
  performance: [],
  ...over,
});

describe("target guard", () => {
  it("refuses both blocklisted Feishu group chat ids on every channel, even if configured", () => {
    expect([...FEISHU_BLOCKED_CHAT_IDS].sort()).toEqual([...BLOCKED].sort());
    for (const id of BLOCKED) {
      expect(targetRefusal("feishu-dm", id)).toMatch(/blocklist/i);
      expect(targetRefusal("webhook", `https://example.com/hook?chat=${id}`)).toMatch(/blocklist/i);
      expect(targetRefusal("email", `${id}@example.com`)).toMatch(/blocklist/i);
    }
  });

  it("Feishu goes to an open_id only — other chat ids are refused", () => {
    expect(targetRefusal("feishu-dm", "oc_0123456789abcdef")).toMatch(/open_id/);
    expect(targetRefusal("feishu-dm", OPEN_ID)).toBeNull();
  });

  it("webhooks must be https and may not be Feishu/Lark group-bot hooks; emails must look like emails", () => {
    expect(targetRefusal("webhook", "http://example.com/hook")).toMatch(/https/);
    expect(targetRefusal("webhook", "https://open.feishu.cn/open-apis/bot/v2/hook/abc")).toMatch(/Feishu/);
    expect(targetRefusal("webhook", "https://open.larksuite.com/open-apis/bot/v2/hook/abc")).toMatch(/Feishu/);
    expect(targetRefusal("webhook", "https://hooks.example.com/digest")).toBeNull();
    expect(targetRefusal("email", "not-an-email")).toMatch(/email/);
    expect(targetRefusal("email", "owner@example.com")).toBeNull();
  });

  it("config is disabled by default and rejects refused targets", () => {
    expect(parseDeliveryConfig({ channel: "feishu-dm", target: OPEN_ID })).toMatchObject({ ok: true, config: { enabled: false, schedule: "weekly" } });
    expect(parseDeliveryConfig({ channel: "feishu-dm", target: BLOCKED[0], enabled: true })).toMatchObject({ ok: false });
    expect(sendingEnabled({ enabled: true, channel: "email", target: "a@b.co", schedule: "weekly" }, {})).toBe(false);
    expect(sendingEnabled({ enabled: false, channel: "email", target: "a@b.co", schedule: "weekly" }, ON)).toBe(false);
    expect(sendingEnabled({ enabled: true, channel: "email", target: "a@b.co", schedule: "weekly" }, ON)).toBe(true);
  });
});

describe("deliver", () => {
  const payload = digestPayload(buildDigest(inputs(), NOW));

  it("is a dry run unless the destination is enabled AND REPORT_DELIVERY_SEND=on", async () => {
    const fetch = vi.fn();
    expect(await deliver({ enabled: false, channel: "feishu-dm", target: OPEN_ID, schedule: "weekly" }, payload, { fetch, env: ON })).toMatchObject({ status: "dry-run" });
    expect(await deliver({ enabled: true, channel: "feishu-dm", target: OPEN_ID, schedule: "weekly" }, payload, { fetch, env: {} })).toMatchObject({ status: "dry-run" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses blocklisted chat ids even when enabled and the env flag is on — no network call", async () => {
    const fetch = feishuFetch();
    for (const id of BLOCKED) {
      const r = await deliver({ enabled: true, channel: "feishu-dm", target: id, schedule: "weekly" }, payload, { fetch, env: ON });
      expect(r.status).toBe("refused");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the Feishu DM with receive_id_type=open_id (never chat_id) and verifies it by read-back", async () => {
    const fetch = feishuFetch();
    const r = await deliver({ enabled: true, channel: "feishu-dm", target: OPEN_ID, schedule: "weekly" }, payload, { fetch, env: ON });
    expect(r).toMatchObject({ status: "sent", verified: true });
    const send = fetch.mock.calls.find((c) => String(c[0]).includes("/im/v1/messages?"))!;
    expect(String(send[0])).toContain("receive_id_type=open_id");
    expect(fetch.mock.calls.every((c) => !String(c[0]).includes("chat_id"))).toBe(true);
    const body = JSON.parse(String(send[1]!.body));
    expect(body.receive_id).toBe(OPEN_ID);
    expect(body.msg_type).toBe("interactive");
    expect(fetch.mock.calls.some((c) => String(c[0]).includes("/im/v1/messages/om_1"))).toBe(true);
  });

  it("reports failed when the read-back doesn't match, or lands in a blocklisted chat", async () => {
    expect(await deliver({ enabled: true, channel: "feishu-dm", target: OPEN_ID, schedule: "weekly" }, payload, { fetch: feishuFetch({ readBackId: "om_other" }), env: ON })).toMatchObject({ status: "failed" });
    expect(await deliver({ enabled: true, channel: "feishu-dm", target: OPEN_ID, schedule: "weekly" }, payload, { fetch: feishuFetch({ readBackChat: BLOCKED[1] }), env: ON })).toMatchObject({ status: "failed" });
  });

  it("sends email through Resend and a webhook as JSON", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === "https://api.resend.com/emails") return json({ id: "em_1" });
      if (u === "https://api.resend.com/emails/em_1") return json({ id: "em_1", to: ["owner@example.com"], subject: payload.subject });
      if (u === "https://hooks.example.com/digest") return new Response("ok");
      throw new Error(u);
    });
    expect(await deliver({ enabled: true, channel: "email", target: "owner@example.com", schedule: "weekly" }, payload, { fetch, env: ON })).toMatchObject({ status: "sent", verified: true });
    expect(await deliver({ enabled: true, channel: "webhook", target: "https://hooks.example.com/digest", schedule: "weekly" }, payload, { fetch, env: ON })).toMatchObject({ status: "sent-unverified" });
  });
});

describe("digest", () => {
  it("covers spend vs budget, runs, preflight, winners, trends, next round", () => {
    const d = buildDigest(inputs(), NOW);
    expect(d.spend).toMatchObject({ periodUsd: 12.5, totalUsd: 41.5, budgetUsd: 50 });
    expect(d.runs.rendered).toBe(1);
    expect(d.preflight.avg).toBe(78);
    expect(d.winners?.hookWinner).toBe("contrast");
    expect(d.hookTrends?.rising[0].hookId).toBe("H07");
    expect(d.nextRound).toMatchObject({ keep: ["H03"], kill: ["H01"], explore: ["H07"], costUsd: 4.2 });
    const md = renderDigestMarkdown(d);
    for (const s of ["Spend", "Runs", "Preflight", "Winners", "Hook trends", "Next round"]) expect(md).toContain(s);
    const html = renderDigestHtml(d);
    expect(html).toContain("<table");
    expect(html).not.toContain("<script");
  });

  it("escapes HTML in the email body", () => {
    const d = buildDigest(inputs({ report: report({ project: { id: "p1", name: "P", brandName: "<b>x</b>", title: "<img src=x onerror=alert(1)>", budgetUsd: null } as never }) }), NOW);
    expect(renderDigestHtml(d)).not.toContain("<img src=x");
  });

  it("compares media-plan pacing with actual spend to date", () => {
    const plan = mediaPlan();
    const rows = [
      { platform: "meta", spend: 3_000, dateFrom: new Date("2026-11-02T00:00:00Z"), dateTo: new Date("2026-11-15T00:00:00Z") },
      { platform: "tiktok", spend: 100, dateFrom: new Date("2026-11-02T00:00:00Z"), dateTo: new Date("2026-11-15T00:00:00Z") },
    ];
    const p = pacingVsActual(plan, rows, NOW)!;
    const meta = p.rows.find((r) => r.family === "meta")!;
    const planned = plan.pacing.weeks.slice(0, 2).reduce((s, w) => s + (w.byChannel.meta_feed ?? 0), 0);
    expect(meta.plannedToDate).toBeCloseTo(planned, 0);
    expect(meta.actualToDate).toBe(3_000);
    const tk = p.rows.find((r) => r.family === "tiktok");
    if (tk) expect(tk.status).toBe("under");
    const d = buildDigest(inputs({ mediaPlan: plan, performance: rows }), NOW);
    expect(d.pacing?.rows.length).toBeGreaterThan(0);
    expect(renderDigestMarkdown(d)).toContain("Pacing");
  });
});

describe("runProjectDigest + config", () => {
  beforeEach(() => {
    for (const f of [db.project.findUnique, db.project.update, db.reportDelivery.create, db.reportDelivery.findFirst, loaders.loadDigestInputs]) f.mockReset();
    db.reportDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "rd1", ...data }));
    db.reportDelivery.findFirst.mockResolvedValue(null);
  });

  it("stores a dry-run row with the payload when disabled", async () => {
    db.project.findUnique.mockResolvedValue({ id: "p1", reportDelivery: { enabled: false, channel: "feishu-dm", target: OPEN_ID, schedule: "weekly" } });
    const fetch = vi.fn();
    const r = await runProjectDigest("p1", { now: NOW, fetch, env: ON, load: async () => inputs() });
    expect(r.status).toBe("dry-run");
    expect(fetch).not.toHaveBeenCalled();
    const data = db.reportDelivery.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ projectId: "p1", channel: "feishu-dm", status: "dry-run", dryRun: true });
    expect(data.payload.subject).toMatch(/Glow Serum/);
  });

  it("skips projects without a config and weeks already sent", async () => {
    db.project.findUnique.mockResolvedValue({ id: "p1", reportDelivery: null });
    expect((await runProjectDigest("p1", { now: NOW, load: async () => inputs() })).status).toBe("skipped");
    db.project.findUnique.mockResolvedValue({ id: "p1", reportDelivery: { enabled: true, channel: "email", target: "a@b.co", schedule: "weekly" } });
    db.reportDelivery.findFirst.mockResolvedValue({ id: "old", status: "sent" });
    expect((await runProjectDigest("p1", { now: NOW, env: ON, fetch: vi.fn(), load: async () => inputs() })).status).toBe("skipped");
    expect(db.reportDelivery.create).not.toHaveBeenCalled();
  });

  it("logs a refused row for a blocklisted target stored in the DB", async () => {
    db.project.findUnique.mockResolvedValue({ id: "p1", reportDelivery: { enabled: true, channel: "feishu-dm", target: BLOCKED[0], schedule: "weekly" } });
    const fetch = vi.fn();
    const r = await runProjectDigest("p1", { now: NOW, fetch, env: ON, load: async () => inputs() });
    expect(r.status).toBe("refused");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("updateDeliveryConfig merges, validates and stores", async () => {
    db.project.findUnique.mockResolvedValue({ id: "p1", reportDelivery: null });
    db.project.update.mockResolvedValue({});
    const r = await updateDeliveryConfig("p1", { channel: "feishu-dm", target: OPEN_ID }, {});
    expect(r).toMatchObject({ config: { enabled: false, channel: "feishu-dm", target: OPEN_ID }, willSend: false });
    expect(db.project.update.mock.calls[0][0].data.reportDelivery).toMatchObject({ enabled: false });
    await expect(updateDeliveryConfig("p1", { channel: "feishu-dm", target: BLOCKED[1], enabled: true }, ON)).rejects.toMatchObject({ status: 400 });
  });

  it("parses the report operator actions", () => {
    expect(operatorActionSchema.safeParse({ action: "report-preview", projectId: "p" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "report-delivery-config", projectId: "p", config: { channel: "feishu-dm", target: OPEN_ID } }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "report-delivery-config", projectId: "p", config: { channel: "sms", target: "x" } }).success).toBe(false);
  });
});

void loaders;
