import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRICES,
  estimateRunCost,
  expectedRerolls,
  imageCostUsd,
  llmCostUsd,
  mergePriceOverrides,
  qcCallUsd,
  videoCostUsd,
  type CostJob,
} from "./cost-model";

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe("price table", () => {
  it("records a source and date for every price", () => {
    for (const group of [DEFAULT_PRICES.video, DEFAULT_PRICES.image, DEFAULT_PRICES.llm, DEFAULT_PRICES.tts]) {
      for (const [id, p] of Object.entries(group)) {
        expect(p.source, id).toBeTruthy();
        expect(p.asOf, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("Kling bills anything under 5 s as 5 s", () => {
    const three = videoCostUsd(DEFAULT_PRICES, "kwaivgi/kling-v3.0-std", 3);
    const five = videoCostUsd(DEFAULT_PRICES, "kwaivgi/kling-v3.0-std", 5);
    expect(three.usd).not.toBeNull();
    close(three.usd!, five.usd!);
    expect(three.billedSec).toBe(5);
  });

  it("Veo 3.1 Lite snaps to its 4 / 6 / 8 s durations and prices 1080p higher", () => {
    expect(videoCostUsd(DEFAULT_PRICES, "google/veo-3.1-lite", 3).billedSec).toBe(4);
    expect(videoCostUsd(DEFAULT_PRICES, "google/veo-3.1-lite", 5).billedSec).toBe(6);
    expect(videoCostUsd(DEFAULT_PRICES, "google/veo-3.1-lite", 12).billedSec).toBe(8);
    close(videoCostUsd(DEFAULT_PRICES, "google/veo-3.1-lite", 4).usd!, 0.12);
    expect(videoCostUsd(DEFAULT_PRICES, "google/veo-3.1-lite", 4, "1080P").usd!).toBeGreaterThan(0.12);
  });

  it("resolves Studio catalogue names to their model ids", () => {
    close(videoCostUsd(DEFAULT_PRICES, "Veo 3.1 Lite 720p (OpenRouter)", 4).usd!, 0.12);
    close(imageCostUsd(DEFAULT_PRICES, "Seedream 5 Flash (OpenRouter)").usd!, 0.018);
  });

  it("free engines cost nothing; unknown paid models fall back to a conservative price with a warning", () => {
    expect(videoCostUsd(DEFAULT_PRICES, "GLM CogVideoX-Flash", 5).usd).toBe(0);
    expect(imageCostUsd(DEFAULT_PRICES, "GLM CogView-3-Flash").usd).toBe(0);
    const unknown = videoCostUsd(DEFAULT_PRICES, "acme/brand-new-video", 5);
    expect(unknown.usd!).toBeGreaterThan(0);
    expect(unknown.fallback).toBe(true);
  });

  it("prices text per 1k tokens and vision QC per call", () => {
    const ds = llmCostUsd(DEFAULT_PRICES, "deepseek/deepseek-v4-flash", 10_000, 2_000);
    expect(ds.usd!).toBeGreaterThan(0);
    const flash = qcCallUsd(DEFAULT_PRICES, "google/gemini-2.5-flash", 0, "expected");
    const pro = qcCallUsd(DEFAULT_PRICES, "google/gemini-2.5-pro", 0, "expected");
    expect(pro).toBeGreaterThan(flash);
    expect(qcCallUsd(DEFAULT_PRICES, "google/gemini-2.5-flash", 2, "expected")).toBeGreaterThan(flash);
    expect(qcCallUsd(DEFAULT_PRICES, "google/gemini-2.5-flash", 0, "high")).toBeGreaterThan(flash);
    expect(DEFAULT_PRICES.tts["msedge-tts"].perCall).toBe(0);
  });

  it("settings JSON overrides a price and keeps its own source", () => {
    const t = mergePriceOverrides(DEFAULT_PRICES, {
      image: { "bytedance-seed/seedream-5-0-flash": { perImage: 0.025, source: "invoice 2026-10", asOf: "2026-10-05" } },
      video: { "google/veo-3.1-lite": { perSec: 0.04 } },
      junk: 1,
    });
    close(imageCostUsd(t, "bytedance-seed/seedream-5-0-flash").usd!, 0.025);
    expect(t.image["bytedance-seed/seedream-5-0-flash"].source).toBe("invoice 2026-10");
    close(videoCostUsd(t, "google/veo-3.1-lite", 4).usd!, 0.16);
    expect(t.video["google/veo-3.1-lite"].source).toMatch(/override/);
    // the base table is untouched
    close(imageCostUsd(DEFAULT_PRICES, "bytedance-seed/seedream-5-0-flash").usd!, 0.018);
  });

  it("ignores malformed overrides", () => {
    const t = mergePriceOverrides(DEFAULT_PRICES, { image: { x: { perImage: "free" } }, video: "nope" });
    expect(t.image.x).toBeUndefined();
  });
});

describe("expectedRerolls", () => {
  it("is the sum of p^k up to the cap", () => {
    expect(expectedRerolls(0.25, 0)).toBe(0);
    close(expectedRerolls(0.25, 1), 0.25);
    close(expectedRerolls(0.25, 2), 0.3125);
  });
});

describe("estimateRunCost", () => {
  const seedream = { openrouterModel: "bytedance-seed/seedream-5-0-flash" };
  const jobs: CostJob[] = [
    { nodeName: "PROD-1", kind: "upload" },
    { nodeName: "CAST", kind: "image", modelName: "Seedream 5 Flash (OpenRouter)", settings: { ...seedream, castSheet: 1 } },
    { nodeName: "K1", kind: "image", modelName: "Seedream 5 Flash (OpenRouter)", settings: { ...seedream, editFrom: "cast" }, leftRefs: ["CAST"] },
    { nodeName: "K1E", kind: "image", modelName: "Seedream 5 Flash (OpenRouter)", settings: { ...seedream, editFrom: "end" }, leftRefs: ["K1", "CAST"] },
    { nodeName: "V1", kind: "video", modelName: "Veo 3.1 Lite 720p (OpenRouter)", settings: { openrouterModel: "google/veo-3.1-lite", duration: 4, anchorEnd: 1 } },
    { nodeName: "K2", kind: "image", modelName: "Seedream 5 Flash (OpenRouter)", settings: { ...seedream } },
    { nodeName: "V2", kind: "video", modelName: "Kling 3.0 Std 720p (OpenRouter)", settings: { openrouterModel: "kwaivgi/kling-v3.0-std", duration: 3 } },
    { nodeName: "K3", kind: "image", modelName: null, settings: { compositeLocally: true } },
  ];

  it("forecasts keyframes, end keyframes, rerolls, clips and QC with low <= expected <= high", () => {
    const f = estimateRunCost({ executor: "openrouter", clipDurationSec: 4, jobs }, { qc: { enabled: true, rerollRate: 0.25, maxRerolls: 1, model: "google/gemini-2.5-flash" } });
    expect(f.counts.keyframes).toBe(2);
    expect(f.counts.endKeyframes).toBe(1);
    expect(f.counts.castSheets).toBe(1);
    expect(f.counts.clips).toBe(2);
    // 4 generated images → 4 first-pass QC calls; reference-edited ones (K1, K1E) may reroll twice.
    expect(f.counts.qcCalls.low).toBe(4);
    expect(f.counts.rerolls.worst).toBe(1 + 2 + 2 + 1);
    expect(f.counts.qcCalls.high).toBe(4 + 6);
    expect(f.totals.low).toBeLessThanOrEqual(f.totals.expected);
    expect(f.totals.expected).toBeLessThanOrEqual(f.totals.high);
    // the clips alone: Veo 4 s = $0.12, Kling 3 s billed as 5 s = $0.416
    const clips = f.lines.filter((l) => l.kind === "video").reduce((s, l) => s + l.usd.expected, 0);
    close(clips, 0.12 + 0.416);
    // the local still costs nothing and is not counted
    expect(f.lines.some((l) => l.label.includes("K3"))).toBe(false);
    for (const k of ["keyframe", "end_keyframe", "reroll", "video", "qc"]) expect(f.lines.some((l) => l.kind === k), k).toBe(true);
  });

  it("skips QC lines when QC is off", () => {
    const f = estimateRunCost({ executor: "openrouter", jobs }, { qc: { enabled: false } });
    expect(f.lines.some((l) => l.kind === "qc" || l.kind === "reroll")).toBe(false);
  });

  it("only counts unfinished jobs with remainingOnly", () => {
    const done = jobs.map((j) => (j.nodeName === "V2" ? { ...j, status: "completed" } : j));
    const all = estimateRunCost({ executor: "openrouter", jobs: done }, { qc: { enabled: false } });
    const left = estimateRunCost({ executor: "openrouter", jobs: done }, { qc: { enabled: false }, remainingOnly: true });
    close(all.totals.expected - left.totals.expected, 0.416);
  });

  it("adds LLM lines (director review) and a free TTS line", () => {
    const f = estimateRunCost({ executor: "openrouter", jobs }, { qc: { enabled: false }, llm: [{ label: "Director review", model: "google/gemini-2.5-flash", inTokens: 4000, outTokens: 1500, calls: { low: 0, expected: 1, high: 1 } }] });
    const llm = f.lines.find((l) => l.kind === "llm")!;
    expect(llm.usd.low).toBe(0);
    expect(llm.usd.expected).toBeGreaterThan(0);
    expect(f.lines.find((l) => l.kind === "tts")!.usd.high).toBe(0);
  });

  it("estimates a locked script before it is compiled", () => {
    const f = estimateRunCost({
      lockedFrames: [
        { frameNumber: 1, startSec: 0, endSec: 3, segment: "HOOK", imagePrompt: "a", videoPrompt: "b", locked: { engine: "kling", refs: "none" } },
        { frameNumber: 2, startSec: 3, endSec: 5, segment: "BODY", imagePrompt: "c", videoPrompt: "d", locked: { engine: "veo", refs: "product", anchorEnd: false } },
        { frameNumber: 3, startSec: 5, endSec: 7, segment: "CTA", locked: { engine: "local" } },
      ],
      imageModel: "Seedream 5 Flash (OpenRouter)",
    }, { qc: { enabled: false } });
    expect(f.counts.clips).toBe(2);
    expect(f.counts.keyframes).toBe(2);
    expect(f.totals.expected).toBeGreaterThan(0.4);
  });

  it("warns when a LibTV run is priced in credits, not dollars", () => {
    const f = estimateRunCost({ executor: "libtv", jobs: [{ nodeName: "V1", kind: "video", modelName: "Hailuo 2.3 Fast", settings: { duration: 6 } }] }, { qc: { enabled: false } });
    expect(f.warnings.join(" ")).toMatch(/LibTV/);
  });
});

describe("storyboardJobs", () => {
  it("one keyframe + one clip per clip group; CTA frames are local", async () => {
    const { storyboardJobs } = await import("./cost-model");
    const sb = storyboardJobs({ frames: [{ segment: "HOOK" }, { segment: "BODY" }, { segment: "BODY" }, { segment: "BODY" }, { segment: "CTA" }], frameSeconds: 2, clipDurationSec: 4 });
    expect(sb.executor).toBe("openrouter");
    expect(sb.jobs.map((j) => j.nodeName)).toEqual(["K1", "V1", "K3", "V3"]);
    const f = estimateRunCost(sb, { qc: { enabled: false } });
    close(f.totals.expected, 2 * 0.018 + 2 * 0.12);
  });
});

describe("jobUnitUsd on free engines", () => {
  it("prices a GLM job by its paid model id only", async () => {
    const { jobUnitUsd } = await import("./cost-model");
    expect(jobUnitUsd(DEFAULT_PRICES, { nodeName: "K1", kind: "image", modelName: null }, "glm").usd).toBe(0);
    expect(jobUnitUsd(DEFAULT_PRICES, { nodeName: "K1", kind: "image", modelName: "x", settings: { openrouterModel: "bytedance-seed/seedream-5-0-flash" } }, "glm").usd).toBe(0.018);
  });
});

describe("estimateRunCost: clip drift QC, drift re-generations and clip retries", () => {
  const veo = { openrouterModel: "google/veo-3.1-lite", duration: 4 };
  const clipJobs: CostJob[] = [
    { nodeName: "K1", kind: "image", modelName: "Seedream 5 Flash (OpenRouter)", settings: { openrouterModel: "bytedance-seed/seedream-5-0-flash" } },
    { nodeName: "V1", kind: "video", modelName: "Veo 3.1 Lite 720p (OpenRouter)", settings: veo },
    { nodeName: "V2", kind: "video", modelName: "Veo 3.1 Lite 720p (OpenRouter)", settings: { ...veo, autoRegenOnDrift: 1 } },
  ];
  const qc = { enabled: false, model: "google/gemini-2.5-flash" };
  const driftLine = (f: ReturnType<typeof estimateRunCost>) => f.lines.find((l) => l.kind === "qc" && /drift/i.test(l.label));

  it("adds the clip drift check's 3 vision calls per clip when drift QC is on", () => {
    const off = estimateRunCost({ executor: "openrouter", jobs: clipJobs }, { qc, clips: { driftMode: "off" } });
    const on = estimateRunCost({ executor: "openrouter", jobs: clipJobs }, { qc, clips: { driftMode: "on" } });
    expect(driftLine(off)).toBeUndefined();
    const line = driftLine(on)!;
    expect(line.qty.low).toBe(6);
    // V2 auto-regenerates on drift: its second take is scored too (expected 20 % drift, worst case 1 re-generation).
    expect(line.qty.expected).toBeCloseTo(3 + 3 * 1.2, 6);
    expect(line.qty.high).toBe(3 + 3 * 2);
    expect(on.counts.qcCalls.high).toBe(9);
    close(line.usd.low, 6 * qcCallUsd(DEFAULT_PRICES, "google/gemini-2.5-flash", 2, "low"));
    expect(on.totals.low).toBeGreaterThan(off.totals.low);
  });

  it("prices drift re-generations for clips that auto-regenerate, in pixel mode too (no paid drift calls)", () => {
    const f = estimateRunCost({ executor: "openrouter", jobs: clipJobs }, { qc, clips: { driftMode: "pixel" } });
    expect(driftLine(f)).toBeUndefined();
    const regen = f.lines.find((l) => l.kind === "clip_regen")!;
    expect(regen.qty).toEqual({ low: 0, expected: 0.2, high: 1 });
    close(regen.usd.high, 0.12);
    // auto-regen for every clip (AUTO_REGEN_ON_DRIFT=on)
    const all = estimateRunCost({ executor: "openrouter", jobs: clipJobs }, { qc, clips: { driftMode: "pixel", autoRegen: true } });
    expect(all.lines.find((l) => l.kind === "clip_regen")!.qty.high).toBe(2);
    // no drift check, no drift re-generation
    expect(estimateRunCost({ executor: "openrouter", jobs: clipJobs }, { qc, clips: { driftMode: "off", autoRegen: true } }).lines.some((l) => l.kind === "clip_regen")).toBe(false);
  });

  it("adds billed clip retries: an expected share and a worst case", () => {
    const f = estimateRunCost({ executor: "openrouter", jobs: clipJobs }, { qc, clips: { driftMode: "off", retryRate: 0.05, retryHighRate: 0.25 } });
    const retry = f.lines.find((l) => l.kind === "clip_retry")!;
    expect(retry.qty).toEqual({ low: 0, expected: 0.1, high: 0.5 });
    close(retry.usd.high, 0.5 * 0.12);
    expect(f.totals.high).toBeGreaterThan(estimateRunCost({ executor: "openrouter", jobs: clipJobs }, { qc }).totals.high);
  });

  it("drift QC only runs on the OpenRouter engine's clips", () => {
    const f = estimateRunCost({ executor: "matrix", jobs: [{ nodeName: "V1", kind: "video", modelName: "Seedance", settings: { matrixModel: "seedance-2.0-fast", duration: 5 }, creditsEstimated: 25 }] }, { qc, clips: { driftMode: "on" } });
    expect(driftLine(f)).toBeUndefined();
  });
});
