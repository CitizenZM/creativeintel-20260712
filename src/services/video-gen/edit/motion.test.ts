import { describe, expect, it } from "vitest";
import { bestWindow } from "./motion";

describe("bestWindow", () => {
  it("finds the most dynamic second, keeps the earliest on ties, falls back without motion", () => {
    // 10 fps, 4 s clip: idle first 2 s, action in 2.5–3.5 s
    const s = Array.from({ length: 40 }, (_, i) => (i >= 25 && i < 35 ? 0.2 : 0.01));
    expect(bestWindow(s, 10, 1, 4)).toBe(2.5);
    expect(bestWindow(Array(40).fill(0.05), 10, 1, 4)).toBe(0);
    expect(bestWindow(Array(40).fill(0), 10, 1, 4, 1.5)).toBe(1.5);
    expect(bestWindow([0.3, 0.3], 10, 1, 4, 0.7)).toBe(0.7);
  });
});
