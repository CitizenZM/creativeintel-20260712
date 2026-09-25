/**
 * Ad-library thumbnails from Meta/Instagram/TikTok are signed CDN URLs that
 * stop working within days, so hotlinking them leaves the Research page full
 * of broken images. Copy them into our own storage when the asset is saved.
 */
import { createHash } from "node:crypto";
import { uploadFromUrl } from "@/services/storage";

const EXPIRING_HOST = /(^|\.)(fbcdn\.net|cdninstagram\.com|tiktokcdn(-\w+)?\.com|ibyteimg\.com|byteimg\.com)$/i;

export function isExpiringThumbnail(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return EXPIRING_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * The thumbnail to store: stable URLs as-is; an expiring one is mirrored once
 * and the mirrored copy is kept on later runs. Mirroring failures fall back to
 * the original URL rather than dropping the thumbnail.
 */
export async function resolveThumbnail(
  incoming: string,
  existing: string | null | undefined,
  mirror: (url: string) => Promise<string> = mirrorThumbnail
): Promise<string> {
  if (!isExpiringThumbnail(incoming)) return incoming;
  if (existing && !isExpiringThumbnail(existing)) return existing;
  try {
    return await mirror(incoming);
  } catch {
    return incoming;
  }
}

async function mirrorThumbnail(url: string): Promise<string> {
  const name = createHash("sha1").update(url.split("?")[0]).digest("hex").slice(0, 20);
  const uploaded = await uploadFromUrl(url, { filename: `${name}.jpg`, folder: "ad-thumbnails" });
  // Without real storage the upload comes back as an inline data URI — not
  // something to write into every asset row.
  if (uploaded.provider === "inline") throw new Error("no asset storage configured");
  return uploaded.url;
}
