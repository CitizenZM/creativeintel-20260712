import { describe, expect, it } from "vitest";
import { buildManualScript } from "./manual-script";
import { scenesFromScript } from "./storyboard-grid";

describe("buildManualScript", () => {
  const input = {
    title: "TCL QM7L — cinema at home",
    hook: "Your living room just became a cinema.",
    lines: ["Wide shot of the QM7L on a living-room wall | Brighter than any TV you've owned.", "Close-up of a football match on screen"],
    cta: "Shop the QM7L today",
    totalDurationSec: 30,
  };

  it("builds hook, one beat per line and CTA that the storyboard grid can time", () => {
    const s = buildManualScript(input);
    expect(s.hook).toMatchObject({ text: input.hook });
    expect(s.bodyBeats).toHaveLength(2);
    expect(s.bodyBeats[0]).toMatchObject({ actorAction: "Wide shot of the QM7L on a living-room wall", voiceover: "Brighter than any TV you've owned." });
    // A line without "|" is both what we see and what is said.
    expect(s.bodyBeats[1]).toMatchObject({ actorAction: "Close-up of a football match on screen", voiceover: "Close-up of a football match on screen" });
    expect(s.cta).toMatchObject({ text: input.cta });
    const scenes = scenesFromScript({ hook: s.hook, bodyBeats: s.bodyBeats, cta: s.cta, totalDurationSec: 30 });
    expect(scenes.map((x) => x.segmentLabel)).toEqual(["HOOK", "BODY", "BODY", "CTA"]);
    expect(scenes.at(-1)!.endSec).toBe(30);
  });

  it("renders a readable body and marks the script as hand-written", () => {
    const s = buildManualScript(input);
    expect(s.template).toBe("MANUAL");
    expect(s.body).toMatch(/\[HOOK\] Your living room/);
    expect(s.body).toMatch(/\[CTA\] Shop the QM7L today/);
  });
});
