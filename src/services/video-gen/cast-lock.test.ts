import { describe, expect, it } from "vitest";
import { lockCast, type CompiledJobDraft } from "./libtv-compile";
import { lockedEditPrompt } from "@/services/ai/matrix";

const draft = (nodeName: string, prompt: string, extra: Partial<CompiledJobDraft> = {}): CompiledJobDraft => ({
  shotIndex: 0,
  kind: "image",
  nodeName,
  leftRefs: ["PROD-1"],
  prompt,
  modelName: "Qwen-Image (Matrix)",
  settings: { frameNumber: Number(nodeName.slice(1)) || 0 },
  sourceUrl: null,
  creditsEstimated: 2,
  ...extra,
});

describe("lockCast", () => {
  it("adds one CAST reference first; person shots edit from it, product shots from the packshot", () => {
    const drafts: CompiledJobDraft[] = [
      { ...draft("PROD-1", ""), kind: "upload", shotIndex: -1 },
      draft("K1", "A man in his 30s, grey sweater, sits on a sofa watching the TV"),
      draft("K3", "Macro close-up of the TV's ultra-thin edge on a walnut console"),
      draft("K5", "The same man laughs, remote in hand"),
      draft("K9", "Packshot", { settings: { compositeLocally: true } }),
      { ...draft("V1", "push in"), kind: "video", leftRefs: ["K1"] },
    ];
    lockCast(drafts, "Qwen-Image (Matrix)");
    expect(drafts[0]).toMatchObject({ nodeName: "CAST", kind: "image", shotIndex: -1, leftRefs: [] });
    expect(drafts[0].prompt).toContain("grey sweater");
    const by = Object.fromEntries(drafts.map((d) => [d.nodeName, d]));
    expect(by.K1.leftRefs).toEqual(["CAST"]);
    expect(by.K5.leftRefs).toEqual(["CAST"]);
    expect(by.K3.leftRefs).toEqual(["PROD-1"]);
    expect([by.K1.settings.editFrom, by.K3.settings.editFrom]).toEqual(["cast", "product"]);
    expect(by.K9.leftRefs).toEqual(["PROD-1"]); // the end card stays the real packshot
    expect(by.V1.leftRefs).toEqual(["K1"]);
  });

  it("adds no CAST when no shot has a person", () => {
    const drafts = [draft("K1", "Macro of the TV edge"), draft("K3", "Wide shot of the TV in an empty loft")];
    lockCast(drafts, "Qwen-Image (Matrix)");
    expect(drafts.some((d) => d.nodeName === "CAST")).toBe(false);
    expect(drafts.every((d) => d.settings.editFrom === "product")).toBe(true);
  });
});

describe("lockedEditPrompt", () => {
  it("tells the edit model to keep the identity and only change the shot", () => {
    expect(lockedEditPrompt("cast", "He laughs on the sofa")).toMatch(/^Keep this exact person unchanged.*New shot: He laughs on the sofa$/);
    expect(lockedEditPrompt("product", "On a walnut console")).toMatch(/^Keep this exact product unchanged/);
  });
});
