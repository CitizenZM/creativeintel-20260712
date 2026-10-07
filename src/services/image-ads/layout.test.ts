import { describe, expect, it } from "vitest";
import { AD_FORMATS, formatById } from "./formats";
import { TEMPLATES, compactLayout, layoutFor } from "./templates";
import { IMAGE_ROLES, overlaps, resolveLayout, TEXT_ROLES } from "./layout";

describe("ad formats", () => {
  it("covers the seven delivery sizes, each with a safe rect inside the canvas", () => {
    expect(AD_FORMATS.map((f) => f.id)).toEqual(["1080x1080", "1080x1350", "1080x1920", "1200x628", "1000x1500", "300x250", "728x90"]);
    for (const f of AD_FORMATS) {
      expect(f.safe.x).toBeGreaterThanOrEqual(0);
      expect(f.safe.y).toBeGreaterThanOrEqual(0);
      expect(f.safe.x + f.safe.w).toBeLessThanOrEqual(f.w);
      expect(f.safe.y + f.safe.h).toBeLessThanOrEqual(f.h);
    }
  });
  it("keeps the 9:16 story clear of the Stories UI (top 14 %, bottom 20 %)", () => {
    const s = formatById("1080x1920");
    expect(s.safe.y).toBeGreaterThanOrEqual(260);
    expect(s.h - (s.safe.y + s.safe.h)).toBeGreaterThanOrEqual(380);
    expect(s.layout).toBe("portrait");
    expect(formatById("728x90").layout).toBe("banner");
    expect(formatById("300x250").layout).toBe("small");
    expect(formatById("1000x1500").layout).toBe("tall");
  });
});

describe("templates", () => {
  it("has at least the six styles", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(expect.arrayContaining(["hero-product", "split-benefit", "before-after", "testimonial-rating", "offer-burst", "gift-festive"]));
  });

  for (const t of TEMPLATES) {
    for (const f of AD_FORMATS) {
      it(`${t.id} @ ${f.id}: readable layers inside the safe rect, no overlaps, no text on the product`, () => {
        const boxes = resolveLayout(layoutFor(t, f.layout), f);
        const text = boxes.filter((b) => (TEXT_ROLES as string[]).includes(b.role));
        const imgs = boxes.filter((b) => (IMAGE_ROLES as string[]).includes(b.role));
        expect(text.length).toBeGreaterThan(1);
        expect(boxes.some((b) => b.role === "cta")).toBe(true);
        for (const b of text) {
          expect(b.x, `${b.role} left`).toBeGreaterThanOrEqual(f.safe.x - 0.5);
          expect(b.y, `${b.role} top`).toBeGreaterThanOrEqual(f.safe.y - 0.5);
          expect(b.x + b.w, `${b.role} right`).toBeLessThanOrEqual(f.safe.x + f.safe.w + 0.5);
          expect(b.y + b.h, `${b.role} bottom`).toBeLessThanOrEqual(f.safe.y + f.safe.h + 0.5);
          expect(b.w).toBeGreaterThan(0);
          expect(b.h).toBeGreaterThan(0);
        }
        for (let i = 0; i < text.length; i++) for (let j = i + 1; j < text.length; j++) expect(overlaps(text[i], text[j]), `${text[i].role} × ${text[j].role}`).toBe(false);
        for (const b of text.filter((x) => x.role !== "badge" && x.role !== "tag")) for (const im of imgs) expect(overlaps(b, im), `${b.role} over ${im.role}`).toBe(false);
      });
    }
  }

  it("compact layouts swap the badge slot for the template's compact role", () => {
    const testimonial = TEMPLATES.find((t) => t.id === "testimonial-rating")!;
    expect(compactLayout("banner", testimonial).rating).toBeDefined();
    expect(compactLayout("banner", testimonial).badge).toBeUndefined();
  });
});

describe("overlaps", () => {
  it("treats touching edges as clear", () => {
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
  });
});
