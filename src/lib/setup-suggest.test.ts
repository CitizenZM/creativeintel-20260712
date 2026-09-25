import { describe, expect, it } from "vitest";
import { applySuggestions, inferGoalTypeFromText, isEmptyField, campaignFieldKey } from "./setup-suggest";

describe("isEmptyField", () => {
  it("treats null, undefined and blank strings as empty", () => {
    expect(isEmptyField(null)).toBe(true);
    expect(isEmptyField(undefined)).toBe(true);
    expect(isEmptyField("")).toBe(true);
    expect(isEmptyField("   ")).toBe(true);
  });

  it("treats a filled string as non-empty", () => {
    expect(isEmptyField("Sell more vacuums")).toBe(false);
  });
});

describe("inferGoalTypeFromText", () => {
  it("defaults to hybrid with no signal", () => {
    expect(inferGoalTypeFromText(null)).toBe("hybrid");
    expect(inferGoalTypeFromText("")).toBe("hybrid");
    expect(inferGoalTypeFromText("A great new product launch")).toBe("hybrid");
  });

  it("detects storytelling from awareness language", () => {
    expect(inferGoalTypeFromText("We want brand awareness and a memorable story")).toBe("storytelling");
  });

  it("detects conversion from sales language", () => {
    expect(inferGoalTypeFromText("Drive purchases with a discount promo, focus on ROAS")).toBe("conversion");
  });

  it("falls back to hybrid when both signals are present", () => {
    expect(inferGoalTypeFromText("Brand awareness campaign that also drives ROAS and sales")).toBe("hybrid");
  });
});

describe("applySuggestions", () => {
  it("fills only empty fields and marks them suggested", () => {
    const { projectData, statusPatch } = applySuggestions(
      { campaignGoal: null, goalType: null },
      { campaignGoal: "Grow awareness for Q4 launch", goalType: "storytelling", platform: "tiktok", targetAudience: "Busy parents" }
    );
    expect(projectData).toEqual({ campaignGoal: "Grow awareness for Q4 launch", goalType: "storytelling" });
    expect(statusPatch).toEqual({ campaignGoal: "suggested", goalType: "suggested" });
  });

  it("never overwrites an existing value", () => {
    const { projectData, statusPatch } = applySuggestions(
      { campaignGoal: "Existing goal", goalType: "conversion" },
      { campaignGoal: "AI guess", goalType: "storytelling", platform: null, targetAudience: null }
    );
    expect(projectData).toEqual({});
    expect(statusPatch).toEqual({});
  });

  it("skips fields the AI declined to suggest", () => {
    const { projectData, statusPatch } = applySuggestions(
      { campaignGoal: null, goalType: null },
      { campaignGoal: null, goalType: null, platform: null, targetAudience: null }
    );
    expect(projectData).toEqual({});
    expect(statusPatch).toEqual({});
  });
});

describe("campaignFieldKey", () => {
  it("prefixes campaign selection field names for the shared fieldStatus map", () => {
    expect(campaignFieldKey("platform")).toBe("campaign.platform");
  });
});

describe("AISuggestionSchema tolerance", () => {
  it("normalises case and trims instead of rejecting the whole answer", async () => {
    const { AISuggestionSchema } = await import("./setup-suggest");
    const out = AISuggestionSchema.parse({
      campaignGoal: "x".repeat(400),
      goalType: "Hybrid",
      platform: "YouTube",
      targetAudience: 42,
    });
    expect(out.campaignGoal).toHaveLength(280);
    expect(out.goalType).toBe("hybrid");
    expect(out.platform).toBe("youtube");
    expect(out.targetAudience).toBeNull();
  });
});
