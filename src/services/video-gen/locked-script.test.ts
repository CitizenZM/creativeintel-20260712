import { describe, expect, it } from "vitest";
import { isLockedStoryboard, lockedDrafts, type LockedFrame } from "./locked-script";

const f = (n: number, locked: LockedFrame["locked"], seg = "BODY"): LockedFrame => ({
  frameNumber: n, startSec: (n - 1) * 1.5, endSec: n * 1.5, segment: seg, imagePrompt: `KF ${n}`, videoPrompt: `MO ${n}`, locked,
});
const video = (engine: string) => ({ modelName: engine === "kling" ? "Kling" : "Veo", settings: { duration: engine === "kling" ? 5 : 4, openrouterModel: engine }, credits: engine === "kling" ? 42 : engine === "veo1080" ? 20 : 12 });
const opts = { imageModel: "Seedream 5 Flash (OpenRouter)", imgSettings: { openrouterModel: "seedream", lockCharacter: 1 }, imageCredits: 2, video };

describe("locked scripts", () => {
  const frames = [
    f(1, { engine: "kling", refs: "none", castLock: "A Latino man in his late 30s." }, "HOOK"),
    f(2, { engine: "veo", refs: "none", speed: 4 }, "HOOK"),
    f(3, { engine: "veo1080", refs: "product", zoomHit: { x: 0.5, y: 0.3 }, compare: { other: "old TV", labelOurs: "QM7L", labelOther: "OLD TV" } }),
    f(4, { engine: "kling", refs: "cast+product" }),
    f(5, { engine: "local", localImageUrl: "https://x/end.jpg" }, "CTA"),
  ];
  const { drafts, castDescription } = lockedDrafts(frames, { ...opts, holdVideos: true });
  const by = (n: string) => drafts.find((d) => d.nodeName === n)!;

  it("is selected by the storyboard style", () => {
    expect(isLockedStoryboard("locked-script")).toBe(true);
    expect(isLockedStoryboard("cinematic")).toBe(false);
  });

  it("keeps extras off the lead's face: only frames asking for the cast are edited from CAST", () => {
    expect(castDescription).toBe("A Latino man in his late 30s.");
    expect(by("CAST").prompt).toContain("A Latino man in his late 30s.");
    expect(by("K1").leftRefs).toEqual([]);
    expect(by("K1").settings).not.toHaveProperty("editFrom");
    expect(by("K4")).toMatchObject({ leftRefs: ["CAST", "PROD-1"], settings: expect.objectContaining({ editFrom: "cast+product" }) });
    expect(by("K3")).toMatchObject({ leftRefs: ["PROD-1"], settings: expect.objectContaining({ editFrom: "product" }) });
  });

  it("uses the script's prompts verbatim and the engine named per shot", () => {
    expect(by("K2").prompt).toBe("KF 2");
    expect(by("V2")).toMatchObject({ prompt: "MO 2", modelName: "Veo", creditsEstimated: 12 });
    expect(by("V1")).toMatchObject({ modelName: "Kling", creditsEstimated: 42 });
    expect(by("V3").creditsEstimated).toBe(20);
  });

  it("carries speed and zoom-hit to the edit, and covers the sped-up source window", () => {
    expect(by("V2").settings).toMatchObject({ speed: 4, frameOffsetsSec: [{ frameNumber: 2, clipStartSec: 0, clipEndSec: 4 }] });
    expect(by("V3").settings).toMatchObject({ zoomHit: { x: 0.5, y: 0.3 }, speed: 1 });
  });

  it("builds the split-screen other side from the script, no LLM split", () => {
    expect(by("K3").settings).toMatchObject({ comparison: { otherNode: "K3X", labelOurs: "QM7L", labelOther: "OLD TV" } });
    expect(by("K3X")).toMatchObject({ prompt: "old TV", leftRefs: [], settings: expect.objectContaining({ comparisonOf: 3 }) });
  });

  it("renders local frames from their prepared still, and holds every clip for keyframe review", () => {
    expect(by("LOC-5")).toMatchObject({ kind: "upload", sourceUrl: "https://x/end.jpg" });
    expect(by("K5")).toMatchObject({ leftRefs: ["LOC-5"], settings: expect.objectContaining({ compositeLocally: true }) });
    expect(drafts.find((d) => d.nodeName === "V5")).toBeUndefined();
    expect(drafts.filter((d) => d.kind === "video").every((d) => (d.settings as { hold?: number }).hold === 1)).toBe(true);
  });
});

describe("locked scripts — per-shot product reference", () => {
  const frames = [
    f(1, { engine: "veo", refs: "product", refImageUrl: "https://x/front.jpg", castLock: "A man." }, "HOOK"),
    f(2, { engine: "kling", refs: "cast", refImageUrl: "https://x/art.jpg" }),
    f(3, { engine: "veo", refs: "none", refImageUrl: "https://x/front.jpg" }),
    f(4, { engine: "veo", refs: "product" }),
  ];
  const { drafts } = lockedDrafts(frames, opts);
  const by = (n: string) => drafts.find((d) => d.nodeName === n)!;

  it("uploads the shot's reference and edits from it instead of the kit packshot", () => {
    expect(by("REF-1")).toMatchObject({ kind: "upload", sourceUrl: "https://x/front.jpg" });
    expect(by("K1").leftRefs).toEqual(["REF-1"]);
    expect(by("K4").leftRefs).toEqual(["PROD-1"]);
  });

  it("adds the product to a cast-only or no-ref shot", () => {
    expect(by("K2").leftRefs).toEqual(["CAST", "REF-2"]);
    expect((by("K2").settings as Record<string, unknown>).editFrom).toBe("cast+product");
    expect(by("K3").leftRefs).toEqual(["REF-3"]);
    expect((by("K3").settings as Record<string, unknown>).editFrom).toBe("product");
  });
});
