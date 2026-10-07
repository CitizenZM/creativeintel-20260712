import { describe, expect, it } from "vitest";
import { PLATFORM_PROFILES } from "@/services/creative/platforms.data";
import { captionStyleFor, NATIVE_CAPTION, nativeCaptionBox } from "./caption-style";

describe("caption style", () => {
  it("is native when the platform profile asks for creator / native captions", () => {
    const by = (id: string) => captionStyleFor(PLATFORM_PROFILES.find((p) => p.id === id)!.captionStyle);
    expect(by("tiktok")).toBe("native");
    expect(by("youtube_shorts")).toBe("native");
    expect(by("meta_feed")).toBe("kinetic");
    expect(by("youtube_instream_skippable")).toBe("kinetic");
    expect(captionStyleFor(undefined)).toBe("kinetic");
  });

  it("places the caption centred on y 0.62, inside the TikTok safe box (x 65–940, y 288–1220)", () => {
    const c = { w: 1080, h: 1920 };
    // A small one-liner sits on its 0.62 centre line, centred in the box (left of the right rail).
    const one = nativeCaptionBox(c, 400, 60);
    expect(one.y + 30).toBe(Math.round(0.62 * 1920));
    expect(Math.abs(one.x + 200 - (65 + 940) / 2)).toBeLessThanOrEqual(1);
    // A two-liner is pulled up so it never crosses y 1220; nothing ever leaves the box.
    for (const [w, h] of [[860, 190], [875, 240], [300, 120]] as const) {
      const b = nativeCaptionBox(c, w, h);
      expect(b.x).toBeGreaterThanOrEqual(NATIVE_CAPTION.safe.x0);
      expect(b.x + w).toBeLessThanOrEqual(NATIVE_CAPTION.safe.x1);
      expect(b.y).toBeGreaterThanOrEqual(NATIVE_CAPTION.safe.y0);
      expect(b.y + h).toBeLessThanOrEqual(NATIVE_CAPTION.safe.y1);
    }
    // Other canvases scale the box.
    const sq = nativeCaptionBox({ w: 1080, h: 1080 }, 400, 80);
    expect(sq.y + 80).toBeLessThanOrEqual(1080);
  });
});

describe("native captions inside the platform safe box", () => {
  const c = { w: 1080, h: 1920 };
  // A platform box narrower than the native box on the right (and a tighter bottom).
  const box = { left: 120, right: 880, top: 300, bottom: 1100 };

  it("bounds are the native box intersected with the platform box", async () => {
    const { nativeCaptionBounds } = await import("./caption-style");
    expect(nativeCaptionBounds(c, box)).toEqual({ x0: 120, x1: 880, y0: 300, y1: 1100 });
    expect(nativeCaptionBounds(c, null)).toEqual({ x0: 65, x1: 940, y0: 288, y1: 1220 });
  });

  it("centres the (downscaled) caption in that box and keeps it inside", async () => {
    const { nativeCaptionAt, nativeCaptionBounds } = await import("./caption-style");
    const b = nativeCaptionBounds(c, box);
    for (const [w, h] of [[400, 60], [760, 190], [700, 240]] as const) {
      const at = nativeCaptionAt(c, w, h, { box });
      expect(Math.abs(at.x + w / 2 - (b.x0 + b.x1) / 2)).toBeLessThanOrEqual(1);
      expect(at.x).toBeGreaterThanOrEqual(b.x0);
      expect(at.x + w).toBeLessThanOrEqual(b.x1);
      expect(at.y).toBeGreaterThanOrEqual(b.y0);
      expect(at.y + h).toBeLessThanOrEqual(b.y1);
    }
  });

  it("follows a moved centre line (off a hook headline), still clamped to the box", async () => {
    const { nativeCaptionAt } = await import("./caption-style");
    const at = nativeCaptionAt(c, 400, 60, { box, yCenter: 0.4 });
    expect(at.y + 30).toBe(Math.round(0.4 * 1920));
    const low = nativeCaptionAt(c, 400, 60, { box, yCenter: 0.9 });
    expect(low.y + 60).toBe(1100);
  });
});
