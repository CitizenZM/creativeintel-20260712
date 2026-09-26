import { describe, expect, it } from "vitest";
import { findUnsourcedSocialProof, scriptV2Schema } from "./script-schema";

describe("findUnsourcedSocialProof", () => {
  it("flags invented press mentions and review counts", () => {
    expect(findUnsourcedSocialProof("Featured in: TechCrunch, Forbes, Bloomberg", "a16z speedrun accelerator")).toHaveLength(1);
    expect(findUnsourcedSocialProof("Thousands of five-star reviews and counting!", "vegan leather travel sets")).toHaveLength(2);
    expect(findUnsourcedSocialProof("The #1 corporate card", "Ramp corporate card")).toEqual(["#1"]);
  });
  it("allows social proof the brand's sources state", () => {
    const source = "As seen in Forbes and TechCrunch. Rated five-star by thousands of customers.";
    expect(findUnsourcedSocialProof("Featured in Forbes and TechCrunch", source)).toEqual([]);
    expect(findUnsourcedSocialProof("five-star rated", source)).toEqual([]);
    expect(findUnsourcedSocialProof("Join thousands of customers", source)).toEqual([]);
  });
  it("ignores ordinary copy", () => {
    expect(findUnsourcedSocialProof("Pack smarter with multiple compartments.", "")).toEqual([]);
  });
});

describe("predictedScore", () => {
  it("rescales a 0-10 answer to the 0-100 scale", () => {
    const parsed = scriptV2Schema.shape.predictedScore.parse(8.5);
    expect(parsed).toBe(85);
    expect(scriptV2Schema.shape.predictedScore.parse(78)).toBe(78);
  });
});
