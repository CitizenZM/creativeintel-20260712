import { describe, expect, it } from "vitest";
import { buildBatchMatrix, type BatchMatrix } from "@/services/creative/batch-matrix";
import { summarizeSpend, type SpendEntryRecord } from "@/services/ops/budget-guard";
import type { RunCostForecast } from "@/services/ops/cost-model";
import { LOCALES } from "@/services/video-gen/localize";
import type { PreflightReport } from "@/services/video-gen/preflight/types";
import {
  budgetView,
  dimsPayload,
  EMPTY_DIMS,
  estimateMatrix,
  fmtRange,
  fmtUsd,
  forecastView,
  groupImageAds,
  groupLedger,
  LOCALE_OPTIONS,
  LOCALE_STALE_MS,
  localeRows,
  parseBudgetInput,
  parseList,
  phaseBars,
  preflightCards,
  reportUrl,
  summarizeBatch,
} from "./view-model";

describe("cost formatting", () => {
  it("formats dollars by magnitude", () => {
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtUsd(0.004)).toBe("<$0.01");
    expect(fmtUsd(1.234)).toBe("$1.23");
    expect(fmtUsd(1234.5)).toBe("$1,235");
    expect(fmtUsd(-2.5)).toBe("-$2.50");
    expect(fmtUsd(null)).toBe("—");
    expect(fmtUsd(Number.NaN)).toBe("—");
  });

  it("collapses a flat range", () => {
    expect(fmtRange({ low: 1, expected: 1, high: 1 })).toBe("$1.00");
    expect(fmtRange({ low: 1.2, expected: 2, high: 3.4 })).toBe("$1.20–$3.40");
    expect(fmtRange(null)).toBe("—");
  });

  it("turns a forecast into rows and totals", () => {
    const f: RunCostForecast = {
      lines: [
        { kind: "keyframe", label: "Keyframes", model: "glm-image", qty: { low: 6, expected: 6, high: 6 }, unitUsd: 0.015, usd: { low: 0.09, expected: 0.09, high: 0.09 }, source: "x" },
        { kind: "reroll", label: "QC rerolls", model: "glm-image", qty: { low: 0, expected: 1.5, high: 6 }, unitUsd: 0.015, usd: { low: 0, expected: 0.0225, high: 0.09 }, source: "x" },
      ],
      totals: { low: 0.09, expected: 0.1125, high: 0.18 },
      counts: { castSheets: 0, keyframes: 6, endKeyframes: 0, otherImages: 0, clips: 0, qcCalls: { low: 0, expected: 0, high: 0 }, rerolls: { expected: 1.5, worst: 6 } },
      warnings: ["w"],
      pricesAsOf: "2026-10-06",
    };
    const v = forecastView(f)!;
    expect(v.rows).toHaveLength(2);
    expect(v.rows[0]).toMatchObject({ qty: "6", unit: "$0.01", expected: "$0.09" });
    expect(v.rows[1].qty).toBe("0–6 (≈1.5)");
    expect(v.totals).toEqual({ low: "$0.09", expected: "$0.11", high: "$0.18", range: "$0.09–$0.18" });
    expect(v.free).toBe(false);
    expect(forecastView(null)).toBeNull();
  });
});

describe("budget", () => {
  it("shows tone by share of the cap", () => {
    expect(budgetView({ budgetUsd: null, spentUsd: 3 })).toMatchObject({ tone: "none", pct: null, spent: "$3.00" });
    expect(budgetView({ budgetUsd: 10, spentUsd: 2 })).toMatchObject({ tone: "ok", pct: 20, remaining: "$8.00" });
    expect(budgetView({ budgetUsd: 10, spentUsd: 8.5 })).toMatchObject({ tone: "warn", pct: 85 });
    expect(budgetView({ budgetUsd: 10, spentUsd: 12 })).toMatchObject({ tone: "over", pct: 100, remaining: "-$2.00" });
    expect(budgetView({ budgetUsd: 0, spentUsd: 0 })).toMatchObject({ tone: "ok", pct: 0 });
  });

  it("parses the set-budget field", () => {
    expect(parseBudgetInput("")).toEqual({ ok: true, usd: null });
    expect(parseBudgetInput(" $1,250.456 ")).toEqual({ ok: true, usd: 1250.46 });
    expect(parseBudgetInput("abc").ok).toBe(false);
    expect(parseBudgetInput("-5").ok).toBe(false);
    expect(parseBudgetInput("10001").ok).toBe(false);
  });
});

describe("ledger grouping", () => {
  const e = (id: string, kind: string, model: string, runId: string | null, estUsd: number, actualUsd: number | null): SpendEntryRecord => ({ id, projectId: "p", runId, jobId: null, kind, model, estUsd, actualUsd, createdAt: new Date(0) });
  const summary = summarizeSpend([
    e("1", "video", "kling", "runAAAAAAAAAAAA1", 1, 1.2),
    e("2", "video", "kling", "runAAAAAAAAAAAA1", 1, null),
    e("3", "llm", "deepseek", null, 0.1, 0.05),
    e("4", "image", "glm-image", "short", 0.5, 0.5),
  ]);

  it("groups by kind, model and run with shares, biggest first", () => {
    const groups = groupLedger(summary, { short: "Hero cut" });
    expect(groups.map((g) => g.id)).toEqual(["kind", "model", "run"]);
    const kind = groups[0].rows;
    expect(kind.map((r) => r.label)).toEqual(["Video clips", "Images (keyframes)", "Text model"]);
    expect(kind[0]).toMatchObject({ calls: 2, usd: "$2.20", estimate: "$2.00", share: 80 });
    expect(kind[2].estimate).toBe("$0.10");
    const run = groups[2].rows;
    expect(run.map((r) => r.label)).toEqual(["Run runA…AAAAA1", "Hero cut", "Project-level (no run)"]);
    expect(kind.reduce((s, r) => s + r.share, 0)).toBeGreaterThanOrEqual(99);
  });

  it("drops empty groups", () => {
    expect(groupLedger(summarizeSpend([]))).toEqual([]);
    expect(groupLedger(null)).toEqual([]);
  });
});

describe("matrix preview", () => {
  it("sizes full and pairwise designs and applies the cap", () => {
    const d = { ...EMPTY_DIMS, hooks: ["q", "c", "p"], endCards: ["E01", "E02"], aspects: ["9:16", "1:1", "4:5", "16:9"] };
    expect(estimateMatrix(d, "full", 100)).toMatchObject({ full: 24, pairwiseMin: 12, expected: 24, capped: false });
    expect(estimateMatrix(d, "pairwise", 100)).toMatchObject({ expected: 12, capped: false });
    expect(estimateMatrix(d, "full", 10)).toMatchObject({ expected: 10, capped: true });
    expect(estimateMatrix(EMPTY_DIMS, "pairwise", 24)).toMatchObject({ full: 1, expected: 1 });
  });

  it("the pairwise estimate is a lower bound of the real design", () => {
    const d = { ...EMPTY_DIMS, hooks: ["q", "c", "p"], endCards: ["E01", "E02", "E03"], aspects: ["9:16", "1:1"], durations: [10, 15] };
    const real = buildBatchMatrix({ source: { kind: "run", masterAspect: "9:16", masterDurationSec: 15, masterHookStyle: "q" }, dims: dimsPayload(d), design: "pairwise", maxVariants: 200 });
    expect(real.variants.length).toBeGreaterThanOrEqual(estimateMatrix(d, "pairwise", 200).pairwiseMin);
    expect(real.variants.length).toBeLessThanOrEqual(estimateMatrix(d, "full", 200).full);
  });

  it("sends only varied dims and parses CTA lists", () => {
    expect(dimsPayload({ ...EMPTY_DIMS, ctas: ["Shop now"] })).toEqual({ ctas: ["Shop now"] });
    expect(parseList("Shop now, Get yours,\nShop now, ")).toEqual(["Shop now", "Get yours"]);
  });

  it("summarizes a planned batch's progress and cost", () => {
    const b = buildBatchMatrix({ source: { kind: "run", masterAspect: "9:16", masterDurationSec: 15, masterHookStyle: "q" }, dims: { hooks: ["q", "c"], aspects: ["9:16", "1:1"] }, design: "full", maxVariants: 24 });
    const withStatus: BatchMatrix = {
      ...b,
      variants: b.variants.map((v, i) => ({ ...v, status: i === 0 ? "rendered" : i === 1 ? "pending" : i === 2 ? "failed" : v.status })),
      cost: { unit: "usd", reEditVariants: 4, needsGenerationVariants: 0, newHookClips: 0, perHookClipUsd: null, perHookClipCredits: 0, totalUsd: 0, totalCredits: 0, perVariant: [], models: { imageModel: "a", videoModel: "b", hookSec: 3 } },
    };
    const s = summarizeBatch(withStatus);
    expect(s).toMatchObject({ total: 4, renderable: 2, progress: 25, rendering: true, costLabel: "All 4 are free re-edits ($0)" });
    expect(s.byStatus).toMatchObject({ rendered: 1, pending: 1, failed: 1, planned: 1 });
  });
});

describe("locale status mapping", () => {
  it("lists the same 11 locales as the service", () => {
    expect(LOCALE_OPTIONS.map((l) => l.id)).toEqual([...LOCALES]);
  });

  it("maps done / rendering / stalled / not started", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    const iso = (ms: number) => new Date(now - ms).toISOString();
    const rows = localeRows(
      {
        locales: [
          { locale: "es-US", masterUrl: "https://x/es.mp4", previewUrl: null, adName: "Ad_esUS", passed: 9, total: 10, fits: [{ ok: true }, { ok: false }] },
          { locale: "fr-FR", masterUrl: "https://x/fr.mp4", previewUrl: "https://x/fr-p.mp4" },
        ],
        localesPending: { "de-DE": iso(60_000), "ja-JP": iso(LOCALE_STALE_MS + 1), "fr-FR": iso(1000) },
      },
      now
    );
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(rows).toHaveLength(11);
    expect(by["es-US"]).toMatchObject({ status: "done", statusLabel: "Ready", masterUrl: "https://x/es.mp4", qc: "9/10 QC", overruns: 1 });
    expect(by["fr-FR"]).toMatchObject({ status: "rendering", statusLabel: "Re-rendering", previewUrl: "https://x/fr-p.mp4" });
    expect(by["de-DE"]).toMatchObject({ status: "rendering", statusLabel: "Rendering", masterUrl: null });
    expect(by["ja-JP"].status).toBe("stalled");
    expect(by["ko-KR"].status).toBe("not_started");
    expect(localeRows(null).every((r) => r.status === "not_started")).toBe(true);
  });
});

describe("pre-flight cards", () => {
  const report = (platform: string, score: number, verdict: PreflightReport["verdict"]): PreflightReport => ({
    version: 1,
    platform: platform as PreflightReport["platform"],
    score,
    verdict,
    checks: [
      { key: "a", label: "A", value: 1, target: "t", score: 1, weight: 5, pass: true },
      { key: "b", label: "B", value: 0, target: "t", score: 0, weight: 2, pass: false, fix: "fix b" },
      { key: "c", label: "C", value: null, target: "t", score: null, weight: 9, pass: null },
      { key: "d", label: "D", value: 0.5, target: "t", score: 0.5, weight: 3, pass: true },
    ],
    topFixes: ["fix b"],
    durationSec: 15,
    measuredAt: "2026-10-07T00:00:00Z",
    sources: ["plan"],
  });

  it("accepts one report, an array or a platform map, failing checks first", () => {
    const [c] = preflightCards(report("tiktok", 71.6, "fix first"));
    expect(c).toMatchObject({ platform: "tiktok", score: 72, tone: "warn" });
    expect(c.checks.map((x) => `${x.key}:${x.status}`)).toEqual(["b:fail", "d:partial", "c:n/a", "a:pass"]);
    expect(preflightCards([report("tiktok", 90, "ready"), { junk: true }]).map((x) => x.tone)).toEqual(["ok"]);
    expect(preflightCards({ meta_feed: report("meta_feed", 40, "rework") })[0].tone).toBe("bad");
    expect(preflightCards(null)).toEqual([]);
    expect(preflightCards("x")).toEqual([]);
  });
});

describe("image ads, test plan, reports", () => {
  it("groups image ads by format order", () => {
    const item = (format: string, template: string) => ({ template, format, w: 1, h: 1, url: `u/${format}/${template}`, bytes: 2048, notes: [] }) as never;
    const g = groupImageAds({ items: [item("1200x628", "a"), item("1080x1080", "a"), item("1080x1080", "b"), item("zzz", "a")] }, [
      { id: "1080x1080", label: "Square" },
      { id: "1200x628", label: "Landscape" },
    ]);
    expect(g.map((x) => `${x.label}:${x.items.length}`)).toEqual(["Square:2", "Landscape:1", "zzz:1"]);
    expect(groupImageAds(null)).toEqual([]);
  });

  it("lays phases out on the campaign timeline", () => {
    const bars = phaseBars(
      [
        { name: "test", startDay: 1, days: 4, budget: 400, dailyBudget: 100, goal: "g" },
        { name: "iterate", startDay: 5, days: 3, budget: 300, dailyBudget: 100, goal: "g" },
        { name: "scale", startDay: 8, days: 3, budget: 300, dailyBudget: 100, goal: "g" },
      ],
      10
    );
    expect(bars.map((b) => [b.left, b.width, b.days])).toEqual([
      [0, 40, "Days 1–4"],
      [40, 30, "Days 5–7"],
      [70, 30, "Days 8–10"],
    ]);
    expect(bars[0]).toMatchObject({ label: "Test", budget: "$400.00", daily: "$100.00/day" });
  });

  it("builds report links", () => {
    expect(reportUrl("p1", "docx", false)).toBe("/api/projects/p1/report?format=docx");
    expect(reportUrl("p1", "html", true)).toBe("/api/projects/p1/report?format=html&narrative=llm");
  });
});
