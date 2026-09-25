import { describe, expect, it, vi } from "vitest";
import { isExpiringThumbnail, resolveThumbnail } from "./thumbnails";

const FB = "https://scontent-lax3-1.xx.fbcdn.net/v/t39/abc.jpg?stp=dst&oh=sig&oe=66F1";
const BLOB = "https://store.public.blob.vercel-storage.com/thumbnails/abc.jpg";

describe("isExpiringThumbnail", () => {
  it("flags signed social CDNs but not stable hosts", () => {
    expect(isExpiringThumbnail(FB)).toBe(true);
    expect(isExpiringThumbnail("https://p16-sign-va.tiktokcdn.com/obj/x.jpeg?x-expires=1")).toBe(true);
    expect(isExpiringThumbnail("https://scontent.cdninstagram.com/v/x.jpg")).toBe(true);
    expect(isExpiringThumbnail("https://i.ytimg.com/vi/abc/hqdefault.jpg")).toBe(false);
    expect(isExpiringThumbnail(BLOB)).toBe(false);
    expect(isExpiringThumbnail("")).toBe(false);
  });
});

describe("resolveThumbnail", () => {
  it("passes stable URLs through without mirroring", async () => {
    const mirror = vi.fn();
    expect(await resolveThumbnail("https://i.ytimg.com/vi/a/hq.jpg", null, mirror)).toBe(
      "https://i.ytimg.com/vi/a/hq.jpg"
    );
    expect(mirror).not.toHaveBeenCalled();
  });

  it("keeps an already-mirrored thumbnail instead of re-uploading", async () => {
    const mirror = vi.fn();
    expect(await resolveThumbnail(FB, BLOB, mirror)).toBe(BLOB);
    expect(mirror).not.toHaveBeenCalled();
  });

  it("mirrors an expiring URL to storage", async () => {
    const mirror = vi.fn().mockResolvedValue(BLOB);
    expect(await resolveThumbnail(FB, null, mirror)).toBe(BLOB);
    expect(mirror).toHaveBeenCalledWith(FB);
  });

  it("falls back to the original URL when mirroring fails", async () => {
    const mirror = vi.fn().mockRejectedValue(new Error("403"));
    expect(await resolveThumbnail(FB, FB, mirror)).toBe(FB);
  });
});
