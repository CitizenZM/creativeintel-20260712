import { describe, expect, it } from "vitest";
import { campaignToPlatform, creativeBlock, goalFromText } from "./prompt-blocks";
import { finalizeBrief } from "./product-brief";

const brief = finalizeBrief({
  category: "tv",
  bigIdea: { proposition: "Bright enough for noon", alternates: ["Hangs like art"] },
  audience: { primary: "families upgrading for the holidays", awarenessStage: "solution_aware" },
  primaryJob: { statement: "When the sun hits the living room, I want a picture that still pops" },
  sellingPoints: [
    { id: "sp1", claim: "3,000 nits peak", benefit: "picture holds in a sunlit room", proofVisual: { device: "split_screen", shot: "sun-glare split vs old TV", overlayText: "3,000 NITS", durationSec: 3 }, sourceEvidence: [{ type: "spec", quote: "up to 3,000 nits" }], evidenceStrength: "measured_spec", compliance: { claimType: "objective_spec", riskLevel: "medium", safeWording: "up to 3,000 nits peak", requiredDisclosure: "Peak brightness on a 10% window" } },
  ],
  objections: [{ objection: "Wall mount is hard", answer: "Free installation", bustingVisual: "installers mount it in 1 s" }],
  keywords: [{ term: "black friday tv deal", placement: ["hook_text"] }],
});

describe("prompt blocks", () => {
  it("maps campaign platforms and goals", () => {
    expect(campaignToPlatform("instagram")).toBe("instagram_reels");
    expect(campaignToPlatform("tvc")).toBe("youtube_instream_skippable");
    expect(campaignToPlatform(undefined)).toBe("tiktok");
    expect(goalFromText("Black Friday sale")).toBe("promo");
    expect(goalFromText("brand launch")).toBe("awareness");
  });

  it("carries the platform rules, the ranked proof shots with their facts, the playbook and the chosen hooks + end card", () => {
    const { text, choice, platform } = creativeBlock({ brief, platform: "tiktok", goalText: "Black Friday deal", runDate: "2026-11-27T12:00:00Z" });
    expect(platform).toBe("tiktok");
    expect(text).toContain("PLATFORM tiktok");
    expect(text).toContain("proof shot: sun-glare split vs old TV");
    expect(text).toContain('fact: "up to 3,000 nits"');
    expect(text).toContain("bust it with: installers mount it in 1 s");
    expect(text).toMatch(/OPENING HOOKS[\s\S]*1\. H\d\d/);
    expect(text).toContain(`END CARD: ${choice!.endCard.id}`);
    expect(text).toContain("sale pitch");
    expect(text).toContain("CATEGORY PLAYBOOK — TVs");
    expect(text).toContain("Sale pitch (first 3 s)");
    expect(text).toMatch(/sell hard/i);
    // Compliance off by default: no safe wording, disclosures or compliance lines.
    expect(text).not.toMatch(/safe wording|disclosure:|COMPLIANCE|compliance still win/);
    expect(text.length).toBeLessThan(9000);
  });

  it("strict mode restores safe wording, disclosures and the compliance header", () => {
    const { text } = creativeBlock({ brief, platform: "tiktok", goalText: "Black Friday deal", runDate: "2026-11-27T12:00:00Z", strictCompliance: true });
    expect(text).toContain("safe wording: up to 3,000 nits peak");
    expect(text).toContain("disclosure: Peak brightness on a 10% window");
    expect(text).toContain("brand truth and compliance still win");
  });

  it("still gives platform rules without a brief", () => {
    const { text, choice } = creativeBlock({ platform: "youtube" });
    expect(choice).toBeNull();
    expect(text).toContain("PLATFORM youtube_instream_skippable");
  });
});
