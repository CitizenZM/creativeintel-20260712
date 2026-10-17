import { describe, expect, it } from "vitest";
import { buildScriptWritingPrompt } from "./script-writing";
import { defaultTemplateBatch } from "./script-templates";

describe("script writing source guidance", () => {
  const template = defaultTemplateBatch("tiktok", 1)[0];
  const base = { brandName: "Moneta", template, videoType: template.videoType, platformId: "tiktok", totalDurationSec: 10 };

  it("does not turn campaign draft copy into claim evidence or require missing selling points", () => {
    const prompt = buildScriptWritingPrompt({ ...base, sellingPoints: [] });
    expect(prompt.user).toContain("NO VERIFIED SELLING POINTS");
    expect(prompt.user).toContain("Draft campaign-plan copy is not evidence");
    expect(prompt.user).not.toContain("each body beat must name exactly one of these");
    expect(prompt.system).toContain("otherwise name a visible product action");
  });

  it("keeps evidenced selling copy when supplied", () => {
    const prompt = buildScriptWritingPrompt({ ...base, sellingPoints: ["25g protein → daily protein"] });
    expect(prompt.user).toContain("VERIFIED SELLING POINTS");
    expect(prompt.user).toContain("25g protein → daily protein");
  });
});
