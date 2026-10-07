import { describe, expect, it } from "vitest";
import { estimateSize, fitLoop, shortenText } from "./fit";

/** A fake pango: glyphs are 0.5·size wide, lines 1.2·size tall, wrapping at word boundaries. */
function fakeRender(text: string, boxW: number) {
  return async (size: number) => {
    const words = text.split(" ");
    const cw = size * 0.5;
    const lines: string[] = [];
    for (const w of words) {
      const last = lines[lines.length - 1];
      if (last !== undefined && (last.length + 1 + w.length) * cw <= boxW) lines[lines.length - 1] = `${last} ${w}`;
      else lines.push(w);
    }
    return { width: Math.max(...lines.map((l) => l.length * cw)), height: lines.length * size * 1.2 };
  };
}

describe("estimateSize", () => {
  it("fills a wide box on one line", () => {
    // natural one-line width 1000 at ref 100 → 10 px per size unit; box 500 wide → size ≈ 50 on one line
    const s = estimateSize({ width: 1000, height: 120, ref: 100 }, { w: 500, h: 60 }, 3, 200);
    expect(s).toBeGreaterThan(40);
    expect(s).toBeLessThanOrEqual(50);
  });
  it("wraps into more lines when the box is tall", () => {
    const one = estimateSize({ width: 1000, height: 120, ref: 100 }, { w: 500, h: 60 }, 1, 400);
    const three = estimateSize({ width: 1000, height: 120, ref: 100 }, { w: 500, h: 600 }, 3, 400);
    expect(three).toBeGreaterThan(one * 1.4);
  });
  it("never exceeds the cap", () => {
    expect(estimateSize({ width: 100, height: 120, ref: 100 }, { w: 2000, h: 2000 }, 3, 90)).toBe(90);
  });
});

describe("fitLoop", () => {
  const text = "A FULL A4 PAGE WITH ZERO GLARE";
  it("shrinks until the text fits the box and the line limit", async () => {
    const box = { w: 400, h: 200 };
    const r = await fitLoop(fakeRender(text, box.w), (m, s) => Math.round(m.height / (s * 1.2)), { box, maxLines: 2, maxSize: 300, minSize: 10 }, 120);
    expect(r.fits).toBe(true);
    expect(r.width).toBeLessThanOrEqual(box.w);
    expect(r.height).toBeLessThanOrEqual(box.h);
    expect(Math.round(r.height / (r.size * 1.2))).toBeLessThanOrEqual(2);
    expect(r.size).toBeGreaterThan(30);
  });
  it("grows a timid first guess", async () => {
    const box = { w: 400, h: 400 };
    const r = await fitLoop(fakeRender(text, box.w), (m, s) => Math.round(m.height / (s * 1.2)), { box, maxLines: 3, maxSize: 300, minSize: 10 }, 20);
    expect(r.fits).toBe(true);
    expect(r.size).toBeGreaterThan(35);
  });
  it("reports a miss at the minimum size", async () => {
    const box = { w: 40, h: 10 };
    const r = await fitLoop(fakeRender(text, box.w), (m, s) => Math.round(m.height / (s * 1.2)), { box, maxLines: 1, maxSize: 100, minSize: 12 }, 50);
    expect(r.fits).toBe(false);
    expect(r.size).toBe(12);
  });
});

describe("shortenText", () => {
  it("drops the last word and adds an ellipsis", () => {
    expect(shortenText("Sound by Bang & Olufsen")).toBe("Sound by Bang…");
    expect(shortenText("Sound by Bang…")).toBe("Sound…"); // no dangling "by"
    expect(shortenText("One")).toBe("One");
  });
});
