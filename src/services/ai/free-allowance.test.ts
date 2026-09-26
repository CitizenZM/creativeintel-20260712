import { describe, expect, it } from "vitest";
import { estimateHourlyCeiling, FREE_MODEL_FACTS } from "./free-allowance";

describe("estimateHourlyCeiling", () => {
  it("is concurrency × (3600 / seconds per item)", () => {
    const e = estimateHourlyCeiling({ concurrency: 2, secondsPerItem: 120, secondsOfVideoPerItem: 5 });
    expect(e.itemsPerHour).toBe(60);
    expect(e.videoMinutesPerHour).toBe(5);
  });

  it("returns null when an input is unknown", () => {
    expect(estimateHourlyCeiling({ concurrency: 2, secondsPerItem: null }).itemsPerHour).toBeNull();
    expect(estimateHourlyCeiling({ concurrency: 0, secondsPerItem: 60 }).itemsPerHour).toBeNull();
  });
});

describe("FREE_MODEL_FACTS", () => {
  it("cites a docs.bigmodel.cn source for every fact", () => {
    for (const m of FREE_MODEL_FACTS) {
      for (const f of m.facts) expect(f.source).toMatch(/^https:\/\/(docs\.)?bigmodel\.cn\//);
    }
  });
});
