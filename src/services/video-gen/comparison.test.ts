import { describe, expect, it } from "vitest";
import { fallbackSplit, isComparisonPrompt, splitComparisonDrafts } from "./comparison";
import type { CompiledJobDraft } from "./libtv-compile";

describe("isComparisonPrompt", () => {
  it("spots comparison shots and leaves ordinary ones", () => {
    expect(isComparisonPrompt("Split screen: a washed-out old TV on the left, the QM7L on the right")).toBe(true);
    expect(isComparisonPrompt("Side-by-side of two TVs in daylight")).toBe(true);
    expect(isComparisonPrompt("Before and after: dull picture, then vivid")).toBe(true);
    expect(isComparisonPrompt("A man watches the QM7L on a sofa")).toBe(false);
  });
});

describe("splitComparisonDrafts", () => {
  const d = (nodeName: string, prompt: string, settings: Record<string, unknown> = {}): CompiledJobDraft => ({
    shotIndex: 4,
    kind: "image",
    nodeName,
    leftRefs: ["PROD-1"],
    prompt,
    modelName: "GLM CogView-3-Flash",
    settings: { frameNumber: 5, coversFrames: [5, 6], ...settings },
    sourceUrl: null,
    creditsEstimated: 0,
  });
  it("turns a comparison keyframe into ours + the other, paired for the edit", async () => {
    const drafts = [d("K3", "A man on a sofa"), d("K5", "Split screen comparison of an old TV and the QM7L"), { ...d("V5", "push in"), kind: "video" as const, leftRefs: ["K5"] }];
    const n = await splitComparisonDrafts(drafts, {
      product: "TCL QM7L",
      split: async () => ({ ours: "The QM7L glowing in a sunny room", other: "A generic dull TV in a sunny room", labelOurs: "TCL QM7L", labelOther: "OTHER TVs" }),
    });
    expect(n).toBe(1);
    expect(drafts.map((x) => x.nodeName)).toEqual(["K3", "K5", "K5X", "V5"]);
    expect(drafts[1]).toMatchObject({ prompt: "The QM7L glowing in a sunny room", settings: { comparison: { otherNode: "K5X", labelOurs: "TCL QM7L", labelOther: "OTHER TVs" } } });
    expect(drafts[2]).toMatchObject({ prompt: "A generic dull TV in a sunny room", leftRefs: [], settings: { comparisonOf: 5, frameNumber: null, coversFrames: [] } });
    expect(drafts[3].leftRefs).toEqual(["K5"]);
  });
  it("has a deterministic fallback with no comparison words left", () => {
    const s = fallbackSplit("Split screen: left half shows an old TV, the QM7L on the right in daylight", "TCL QM7L");
    expect(s.ours).not.toMatch(/split screen/i);
    expect([s.labelOurs, s.labelOther]).toEqual(["TCL QM7L", "OTHERS"]);
  });
});
