import { describe, expect, it } from "vitest";
import { framesFromScript, isScriptSource, scriptIdOf } from "./adstudio-script-frames";

describe("framesFromScript (P3: start from a script without a storyboard)", () => {
  it("uses the shot list when the script has scenes, keeping its timings", () => {
    const f = framesFromScript({
      scenes: [
        { sceneNumber: 1, startSec: 0, endSec: 3, segmentLabel: "Hook", shotType: "CU", cameraMovement: "push in", location: "airport", voiceover: "Dry skin mid-flight?", textOverlay: "Flight skin" },
        { sceneNumber: 2, startSec: 3, endSec: 9, segmentLabel: "Demo", productAction: "spray mist", voiceover: "One spray." },
        { sceneNumber: 3, segmentLabel: "CTA", textOverlay: "Shop now" },
      ],
    });
    expect(f.map((x) => [x.frameNumber, x.segment, x.startSec, x.endSec])).toEqual([[1, "HOOK", 0, 3], [2, "BODY", 3, 9], [3, "CTA", 9, 11]]);
    expect(f[0]).toMatchObject({ shotType: "CU", cameraMove: "push in", scene: "airport", voiceover: "Dry skin mid-flight?", textOverlay: "Flight skin" });
    expect(f[1].productAction).toBe("spray mist");
  });
  it("falls back to hook → beats → CTA, carrying each beat's selling point", () => {
    const f = framesFromScript({
      hook: { text: "Your toner is lying", visual: "toner pours", durationSec: 2 },
      bodyBeats: [{ sellingPoint: "hydrates in 3 s", voiceover: "Three seconds.", startSec: 2, endSec: 6 }],
      cta: { text: "Get yours", offer: "20% off", durationSec: 3 },
    });
    expect(f.map((x) => x.segment)).toEqual(["HOOK", "BODY", "CTA"]);
    expect(f[1]).toMatchObject({ sellingPoint: "hydrates in 3 s", startSec: 2, endSec: 6 });
    expect(f[2]).toMatchObject({ sellingPoint: "20% off", endSec: 9 });
  });
  it("old scripts: picked hook variant + body + picked CTA; an empty script gives no frames", () => {
    const f = framesFromScript({ hookVariants: ["A", { text: "B" }], selectedHookIdx: 1, body: "Long body", ctaVariants: ["Buy"], selectedCtaIdx: 0 });
    expect(f.map((x) => x.textOverlay ?? x.voiceover)).toEqual(["B", "Long body", "Buy"]);
    expect(framesFromScript({})).toEqual([]);
  });
  it("script sources are addressed as script:<id>", () => {
    expect(isScriptSource("script:abc")).toBe(true);
    expect(scriptIdOf("script:abc")).toBe("abc");
    expect(scriptIdOf("cmu0dmym6")).toBeNull();
  });
});
