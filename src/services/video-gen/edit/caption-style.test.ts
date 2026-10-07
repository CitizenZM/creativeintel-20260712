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
