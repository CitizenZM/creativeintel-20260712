import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ project: { findUnique: vi.fn(), update: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { operatorActionSchema } from "@/services/operator";
import {
  allocateBudget,
  audienceFit,
  buildMediaPlan,
  channelCurve,
  forecastChannel,
  responseValue,
  writeMediaPlanNarrative,
  type ChannelCurve,
  type MediaPlanInput,
} from "./media-plan";
import { createMediaPlan, MediaPlanError } from "./media-plan.store";

const NOW = new Date("2026-10-07T12:00:00Z");
const cents = (n: number) => Math.round(n * 100);

const base = (over: Partial<MediaPlanInput> = {}): MediaPlanInput => ({
  productTitle: "Glow Serum",
  brand: "Glow",
  brief: { audience: { primary: "Women 25-44 who want visible skincare results", secondary: ["busy moms"] } },
  goal: "sales",
  totalBudget: 60_000,
  flight: { start: "2026-11-02", end: "2026-11-29" },
  aov: 48,
  targetCpa: 40,
  markets: ["US"],
  now: NOW,
  ...over,
});

/** A synthetic curve: conversions = eff × S/cpa × (1 − e^(−s/S)). */
const curve = (channel: string, cpa: number, capacity: number, minFlight = 0): ChannelCurve =>
  ({
    ...channelCurve("meta_feed", { goal: "sales", days: 28, markets: ["US"] }),
    channel: channel as never,
    efficiency: 1,
    capacityUsd: capacity,
    cpa0: cpa,
    minDailyUsd: minFlight / 28,
    minFlightUsd: minFlight,
  }) as ChannelCurve;

describe("response curve", () => {
  it("is concave: each extra $1,000 buys fewer conversions", () => {
    const c = channelCurve("tiktok", { goal: "sales", days: 28, markets: ["US"] });
    const gains = [0, 1, 2, 3, 4, 5].map((k) => responseValue(c, (k + 1) * 1000, "sales") - responseValue(c, k * 1000, "sales"));
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeLessThan(gains[i - 1]);
    expect(gains.every((g) => g > 0)).toBe(true);
  });

  it("forecasts conversions consistent with the curve and low ≤ expected ≤ high", () => {
    const c = channelCurve("meta_feed", { goal: "sales", days: 28, markets: ["US"] });
    const f = forecastChannel(c, 10_000, { goal: "sales", aov: 50 });
    expect(f.conversions.expected).toBeCloseTo(responseValue(c, 10_000, "sales"), 1);
    for (const k of ["impressions", "clicks", "conversions", "cpa", "roas"] as const) {
      const m = f[k]!;
      expect(m.low).toBeLessThanOrEqual(m.expected);
      expect(m.expected).toBeLessThanOrEqual(m.high);
    }
    expect(f.cpa.expected).toBeCloseTo(10_000 / f.conversions.expected, 1);
  });
});

describe("allocateBudget (greedy marginal return)", () => {
  it("allocates the budget to the cent", () => {
    const r = allocateBudget([curve("a", 30, 20_000), curve("b", 40, 40_000)], { totalCents: cents(12_345.67), stepCents: 5_000, goal: "sales" });
    expect([...r.allocations.values()].reduce((s, x) => s + x, 0)).toBe(cents(12_345.67));
  });

  it("puts a small budget on the best channel, then moves $ to the next when its marginal return is higher", () => {
    const a = curve("a", 20, 2_000); // cheap but saturates fast
    const b = curve("b", 30, 10_000_000); // dearer, near-linear
    const small = allocateBudget([a, b], { totalCents: cents(500), stepCents: 1_000, goal: "sales" });
    expect(small.allocations.get("a")).toBe(cents(500));
    expect(small.allocations.get("b") ?? 0).toBe(0);

    const big = allocateBudget([a, b], { totalCents: cents(20_000), stepCents: 1_000, goal: "sales" });
    const sa = big.allocations.get("a")! / 100;
    const sb = big.allocations.get("b")! / 100;
    expect(sb).toBeGreaterThan(0);
    // a's marginal fell to b's level: e^(−s/S)/20 ≈ 1/30 → s ≈ S·ln(1.5) ≈ $811 (± one $10 step)
    expect(sa).toBeGreaterThan(780);
    expect(sa).toBeLessThan(850);
    // at the optimum the marginals are within one step of each other
    const ma = (responseValue(a, sa + 10, "sales") - responseValue(a, sa, "sales")) / 10;
    const mb = (responseValue(b, sb + 10, "sales") - responseValue(b, sb, "sales")) / 10;
    expect(Math.abs(ma - mb) / mb).toBeLessThan(0.05);
  });

  it("drops channels whose minimum viable budget does not fit, with a reason", () => {
    const r = allocateBudget([curve("a", 30, 20_000), curve("b", 20, 50_000, 5_000)], { totalCents: cents(3_000), stepCents: 1_000, goal: "sales" });
    expect(r.allocations.get("b") ?? 0).toBe(0);
    expect(r.dropped.find((d) => d.channel === "b")?.reason).toMatch(/minimum viable/i);
  });
});

describe("buildMediaPlan", () => {
  it("sums allocations, weekly pacing and per-channel pacing exactly", () => {
    const plan = buildMediaPlan(base({ totalBudget: 48_321.37 }));
    const total = plan.allocations.reduce((s, a) => s + cents(a.budget), 0);
    expect(total).toBe(cents(48_321.37));
    for (const a of plan.allocations) {
      expect(plan.pacing.weeks.reduce((s, w) => s + cents(w.byChannel[a.channel] ?? 0), 0)).toBe(cents(a.budget));
    }
    expect(plan.pacing.weeks.reduce((s, w) => s + cents(w.total), 0)).toBe(cents(48_321.37));
    expect(plan.flight.days).toBe(28);
    expect(plan.pacing.weeks).toHaveLength(4);
    expect(plan.allocations.reduce((s, a) => s + a.share, 0)).toBeCloseTo(1, 6);
  });

  it("drops channels below their learning-phase minimum with a reason and states the thresholds", () => {
    // $1,200 over 28 days ≈ $43/day: TikTok's $50/day campaign minimum can't be met.
    const plan = buildMediaPlan(base({ totalBudget: 1_200 }));
    expect(plan.allocations.map((a) => a.channel)).not.toContain("tiktok");
    const tk = plan.dropped.find((d) => d.channel === "tiktok");
    expect(tk?.reason).toMatch(/minimum viable/i);
    expect(tk?.minDailyUsd).toBeGreaterThanOrEqual(50);
    expect(plan.assumptions.join(" ")).toMatch(/50 conversions/);
    expect(plan.allocations.reduce((s, a) => s + cents(a.budget), 0)).toBe(cents(1_200));
  });

  it("optimises for a proxy event when the purchase learning threshold can't be funded, or drops when proxies are off", () => {
    const withProxy = buildMediaPlan(base({ totalBudget: 4_000 }));
    expect(withProxy.allocations.length).toBeGreaterThan(0);
    expect(withProxy.allocations.some((a) => a.optimizationEvent === "add_to_cart")).toBe(true);
    const strict = buildMediaPlan(base({ totalBudget: 4_000, allowProxyEvent: false }));
    expect(strict.allocations).toHaveLength(0);
    expect(strict.dropped.every((d) => /learning|minimum viable/i.test(d.reason))).toBe(true);
    expect(strict.warnings.join(" ")).toMatch(/below every/i);
  });

  it("favours audience-fit channels (Snapchat's 13–24 core vs a 45–64 audience)", () => {
    const older = { audience: { primary: "Men and women 45-64, homeowners" } };
    const snap = audienceFit("snapchat", older);
    const feed = audienceFit("meta_feed", older);
    expect(feed).toBeGreaterThan(snap);
    const plan = buildMediaPlan(base({ brief: older, totalBudget: 80_000 }));
    const share = (c: string) => plan.allocations.find((a) => a.channel === c)?.share ?? 0;
    expect(share("meta_feed")).toBeGreaterThan(share("snapchat"));
  });

  it("orders scenarios conservative < base < aggressive on spend and conversions", () => {
    const plan = buildMediaPlan(base());
    const [c, b, a] = plan.scenarios;
    expect(plan.scenarios.map((s) => s.name)).toEqual(["conservative", "base", "aggressive"]);
    expect(c.budget).toBeLessThan(b.budget);
    expect(b.budget).toBeLessThan(a.budget);
    expect(c.conversions).toBeLessThan(b.conversions);
    expect(b.conversions).toBeLessThan(a.conversions);
    expect(b.budget).toBe(60_000);
  });

  it("lists creative requirements per channel tied to the campaign plan, and a measurement plan", () => {
    const plan = buildMediaPlan(
      base({
        channels: ["tiktok", "meta_feed"],
        totalBudget: 100_000,
        campaignPlan: { platforms: [{ platform: "tiktok", hookVariants: [{ hookId: "H01" }, { hookId: "H07" }], endCard: { id: "E01" }, endCardAlternates: [] }] } as never,
      })
    );
    const tk = plan.creative.find((c) => c.channel === "tiktok");
    expect(tk).toBeDefined();
    expect(tk!.aspects).toContain("9:16");
    expect(tk!.variants.round1).toBeGreaterThanOrEqual(2);
    expect(tk!.variants.total).toBeGreaterThanOrEqual(tk!.variants.round1);
    expect(tk!.planHooks).toEqual(["H01", "H07"]);
    for (const a of plan.allocations) {
      const m = plan.measurement.channels.find((x) => x.channel === a.channel)!;
      expect(m.utm).toMatch(/utm_source=/);
      expect(m.utm).toMatch(/utm_campaign=/);
      expect(m.attribution).toBeTruthy();
    }
    expect(plan.measurement.naming.campaign).toMatch(/Glow/);
    expect(plan.measurement.holdout.method).toBeTruthy();
  });

  it("awareness plans optimise reach with platform floors only (no conversion learning)", () => {
    const plan = buildMediaPlan(base({ goal: "awareness", totalBudget: 20_000 }));
    expect(plan.allocations.length).toBeGreaterThan(1);
    expect(plan.allocations.every((a) => a.optimizationEvent === "reach")).toBe(true);
    expect(plan.totals.impressions.expected).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(buildMediaPlan(base())).toEqual(buildMediaPlan(base()));
  });
});

describe("narrative", () => {
  it("uses the (mocked) model and falls back to a scaffold", async () => {
    const plan = buildMediaPlan(base());
    const llm = vi.fn().mockResolvedValue({ narrative: "Lead with Meta feed." });
    expect(await writeMediaPlanNarrative(plan, llm)).toEqual({ narrative: "Lead with Meta feed.", source: "llm" });
    expect(llm).toHaveBeenCalledTimes(1);
    const bad = await writeMediaPlanNarrative(plan, vi.fn().mockRejectedValue(new Error("down")));
    expect(bad.source).toBe("scaffold");
    expect(bad.narrative).toMatch(/\$/);
  });
});

describe("createMediaPlan (store) + operator action", () => {
  beforeEach(() => {
    db.project.findUnique.mockReset();
    db.project.update.mockReset();
  });

  it("builds from the stored brief + plan and saves Project.mediaPlan / mediaPlanAt", async () => {
    db.project.findUnique.mockResolvedValue({ id: "p1", name: "P", brandName: "Glow", productName: "Serum", productBrief: { audience: { primary: "women 25-44" }, product: { price: "$48" } }, campaignPlan: null });
    db.project.update.mockResolvedValue({});
    const plan = await createMediaPlan("p1", { goal: "sales", totalBudget: 30_000, flightStart: "2026-11-02", flightEnd: "2026-11-29", narrative: false, now: NOW });
    expect(plan.aov).toBe(48);
    const data = db.project.update.mock.calls[0][0].data;
    expect(data.mediaPlan.allocations.length).toBeGreaterThan(0);
    expect(data.mediaPlanAt).toBeInstanceOf(Date);
  });

  it("404s a missing project and 400s a bad flight", async () => {
    db.project.findUnique.mockResolvedValue(null);
    await expect(createMediaPlan("x", { goal: "sales", totalBudget: 1000, flightStart: "2026-11-02", flightEnd: "2026-11-09" })).rejects.toMatchObject({ status: 404 });
    db.project.findUnique.mockResolvedValue({ id: "p1", name: "P", brandName: "B", productBrief: null, campaignPlan: null });
    await expect(createMediaPlan("p1", { goal: "sales", totalBudget: 1000, flightStart: "2026-11-09", flightEnd: "2026-11-02" })).rejects.toBeInstanceOf(MediaPlanError);
  });

  it("parses the media-plan operator action", () => {
    expect(operatorActionSchema.safeParse({ action: "media-plan", projectId: "p", goal: "sales", totalBudget: 5000, flightStart: "2026-11-02", flightEnd: "2026-11-29" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "media-plan", projectId: "p", goal: "fame", totalBudget: 5000, flightStart: "2026-11-02", flightEnd: "2026-11-29" }).success).toBe(false);
  });
});
