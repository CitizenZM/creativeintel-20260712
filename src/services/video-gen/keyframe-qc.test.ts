import { describe, expect, it } from "vitest";
import { shouldReroll } from "./keyframe-qc";

describe("shouldReroll", () => {
  it("re-rolls a rejected keyframe once, never an approved one or a failed review", () => {
    expect(shouldReroll({ ok: false, issues: ["six fingers on the left hand"] }, 0)).toBe(true);
    expect(shouldReroll({ ok: false, issues: ["six fingers on the left hand"] }, 1)).toBe(false);
    expect(shouldReroll({ ok: true, issues: [] }, 0)).toBe(false);
    expect(shouldReroll({ ok: false, issues: [] }, 0)).toBe(false);
    expect(shouldReroll(null, 0)).toBe(false);
  });
});
