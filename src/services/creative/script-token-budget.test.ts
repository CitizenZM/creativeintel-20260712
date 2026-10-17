import { describe, expect, it } from "vitest";
import { scriptOutputTokenCap } from "./script-token-budget";

describe("scriptOutputTokenCap", () => {
  it("bounds short scripts while retaining the long-form ceiling", () => {
    expect(scriptOutputTokenCap(5)).toBe(4500);
    expect(scriptOutputTokenCap(10)).toBe(5000);
    expect(scriptOutputTokenCap(15)).toBe(6250);
    expect(scriptOutputTokenCap(30)).toBe(8000);
    expect(scriptOutputTokenCap(Number.NaN)).toBe(8000);
  });
});
