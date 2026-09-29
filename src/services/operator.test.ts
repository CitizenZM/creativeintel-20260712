import { describe, expect, it } from "vitest";
import { approveAllFrames, freeRunRefusal, operatorActionSchema } from "./operator";

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
  it("rejects unknown actions and bad input", () => {
    expect(operatorActionSchema.safeParse({ action: "delete-project", projectId: "p" }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "approve-run", projectId: "p" }).success).toBe(false);
    expect(operatorActionSchema.safeParse({ action: "approve-frames", projectId: "p", storyboardId: "s" }).success).toBe(true);
  });
});
