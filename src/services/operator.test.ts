import { describe, expect, it } from "vitest";
import { approveAllFrames, freeRunRefusal, operatorActionSchema, parseOperatorAction } from "./operator";

describe("approveAllFrames", () => {
  it("approves unapproved frames and records their prior state once each", () => {
    const r = approveAllFrames(
      [
        { frameNumber: 1, approved: true },
        { frameNumber: 2 },
        { frameNumber: 3, approved: false },
      ],
      []
    );
    expect(r.approved).toBe(2);
    expect(r.frames.every((f) => f.approved === true)).toBe(true);
    expect((r.history as { frameNumber: number }[]).map((h) => h.frameNumber)).toEqual([2, 3]);
  });
});

describe("freeRunRefusal", () => {
  it("only lets free server renders through", () => {
    expect(freeRunRefusal({ executor: "glm", creditsEstimated: 0, status: "awaiting_approval" }, true)).toBeNull();
    expect(freeRunRefusal({ executor: "glm", creditsEstimated: 12, status: "awaiting_approval" }, true)).toMatch(/credits/);
    expect(freeRunRefusal({ executor: "libtv", creditsEstimated: 0, status: "awaiting_approval" }, false)).toMatch(/Only server/);
  });

  it("lets a paid server render through only with allowPaid and a covering cap", () => {
    const run = { executor: "matrix", creditsEstimated: 190, status: "awaiting_approval" };
    expect(freeRunRefusal(run, true, { allowPaid: true })).toMatch(/creditCap/);
    expect(freeRunRefusal(run, true, { allowPaid: true, creditCap: 150 })).toMatch(/creditCap/);
    expect(freeRunRefusal(run, true, { allowPaid: true, creditCap: 200 })).toBeNull();
    expect(freeRunRefusal(run, true, { creditCap: 200 })).toMatch(/allowPaid/);
  });
});

describe("operatorActionSchema", () => {
  it("repair-keyframe: a keyframe node, an optional 0–1 box", () => {
    expect(operatorActionSchema.safeParse({ action: "repair-keyframe", projectId: "p", runId: "r", node: "K4", bbox: [0.19, 0.51, 0.54, 0.8], apply: true }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "repair-keyframe", projectId: "p", runId: "r", node: "K4E" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "repair-keyframe", projectId: "p", runId: "r", node: "V4" }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "repair-keyframe", projectId: "p", runId: "r", node: "K4", bbox: [0, 0, 2, 1] }).success).toBe(false);
  });
  it("rejects unknown actions and bad input", () => {
    expect(operatorActionSchema.safeParse({ action: "delete-project", projectId: "p" }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "approve-run", projectId: "p" }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "approve-frames", projectId: "p", storyboardId: "s" }).success).toBe(true);
  });
});

describe("batch + export-pack actions", () => {
  it("parses plan-batch with defaults and rejects a bad aspect", () => {
    const ok = operatorActionSchema.parse({ action: "plan-batch", projectId: "p", runId: "r" });
    expect(ok).toMatchObject({ design: "pairwise", maxVariants: 24, dims: {} });
    expect(operatorActionSchema.safeParse({ action: "plan-batch", projectId: "p", runId: "r", dims: { aspects: ["2:3"] } }).success).toBe(false);
    expect(operatorActionSchema.parse({ action: "render-batch", projectId: "p", runId: "r", batchId: "b1" })).toMatchObject({ limit: 1 });
    expect(operatorActionSchema.safeParse({ action: "export-pack", projectId: "p", runId: "r" }).success).toBe(true);
  });
});

describe("operatorActionSchema — performance agent + test plan", () => {
  it("accepts perf-ask and test-plan, rejects bad budgets", () => {
    expect(operatorActionSchema.safeParse({ action: "perf-ask", projectId: "p", question: "Which hook wins?" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "test-plan", projectId: "p", totalBudget: 5000, days: 14, baseline: { meta: { cpm: 11, ctr: 0.012 } } }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "test-plan", projectId: "p", totalBudget: -1, days: 14 }).success).toBe(false);
  });
});

describe("operatorActionSchema — clone-ad / localize-run", () => {
  it("accepts a clone from a teardown or a structure", () => {
    expect(operatorActionSchema.safeParse({ action: "clone-ad", projectId: "p", teardownId: "t" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "clone-ad", projectId: "p", structureId: "s", platform: "tiktok" }).success).toBe(true);
  });
  it("accepts supported locales only", () => {
    expect(operatorActionSchema.safeParse({ action: "localize-run", projectId: "p", runId: "r", locales: ["es-US", "ja-JP", "ar-SA"] }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "localize-run", projectId: "p", runId: "r", locales: ["en-GB"] }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "localize-run", projectId: "p", runId: "r", locales: [] }).success).toBe(false);
  });
});

describe("image-ads / preflight actions", () => {
  it("accept a static ad set request and a pre-flight score request", () => {
    expect(operatorActionSchema.safeParse({ action: "image-ads", projectId: "p", templates: ["hero-product"], formats: ["1080x1080"], promo: { pct: 26, label: "Black Friday" }, proof: { rating: 4.6, reviewCount: 120 } }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "image-ads", projectId: "p", proof: { rating: 7 } }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "preflight", projectId: "p", runId: "r", platform: "tiktok" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "preflight", projectId: "p" }).success).toBe(false);
  });
});

describe("parseOperatorAction (session routes)", () => {
  it("validates with the operator schema of one action and narrows the type", () => {
    const ok = parseOperatorAction("plan-batch", { projectId: "p", runId: "r", dims: { aspects: ["9:16", "1:1"] } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data).toMatchObject({ action: "plan-batch", design: "pairwise", maxVariants: 24, dims: { aspects: ["9:16", "1:1"] } });
  });

  it("the path's action wins over a body that names another one", () => {
    const r = parseOperatorAction("set-budget", { action: "approve-run", projectId: "p", usd: 25 });
    expect(r.ok && r.data.action).toBe("set-budget");
  });

  it("reports the first issue", () => {
    const bad = parseOperatorAction("localize-run", { projectId: "p", runId: "r", locales: ["xx-XX"] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/^Invalid locales/);
    expect(parseOperatorAction("set-budget", { projectId: "p", usd: 20_000 }).ok).toBe(false);
  });
});

describe("operatorActionSchema — covers / auto-fix", () => {
  it("accepts covers for a run (optionally forced) and an auto-fix with an optional platform", () => {
    expect(operatorActionSchema.safeParse({ action: "covers", projectId: "p", runId: "r" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "covers", projectId: "p", runId: "r", force: true }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "covers", projectId: "p" }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "auto-fix", projectId: "p", runId: "r", platform: "tiktok" }).success).toBe(true);
    expect(operatorActionSchema.safeParse({ action: "auto-fix", projectId: "p", runId: "r", platform: "myspace" }).success).toBe(false);
  });
});
