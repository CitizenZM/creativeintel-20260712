/**
 * Delivery sizes for static ads, each with the rect readable layers must stay inside:
 *   1080×1080  feed square            5 % margins
 *   1080×1350  Meta / IG feed 4:5     5 % margins
 *   1080×1920  Stories / Reels static the Stories profile's UI bands (top 269, bottom 384, sides 65)
 *   1200×628   link ads / Demand Gen  40 px
 *   1000×1500  Pinterest 2:3          50 px, 100 px at the bottom (save / visit chips)
 *   300×250    display MREC           10 px
 *   728×90     display leaderboard    6 / 10 px
 */
import { platformProfile } from "@/services/creative/library";
import type { AdFormat, FormatId } from "./types";

const margin = (w: number, h: number, l: number, t: number, r = l, b = t) => ({ x: l, y: t, w: w - l - r, h: h - t - b });

const story = platformProfile("instagram_stories").safeZone;

export const AD_FORMATS: AdFormat[] = [
  { id: "1080x1080", label: "Square 1:1", w: 1080, h: 1080, safe: margin(1080, 1080, 54, 54), layout: "square", placements: ["meta_feed", "instagram_feed", "carousel"] },
  { id: "1080x1350", label: "Feed 4:5", w: 1080, h: 1350, safe: margin(1080, 1350, 54, 54), layout: "portrait", placements: ["meta_feed", "instagram_feed"] },
  { id: "1080x1920", label: "Story 9:16", w: 1080, h: 1920, safe: margin(1080, 1920, story.left, story.top, story.right, story.bottom), layout: "portrait", placements: ["instagram_stories", "facebook_stories", "snapchat"] },
  { id: "1200x628", label: "Landscape 1.91:1", w: 1200, h: 628, safe: margin(1200, 628, 40, 40), layout: "wide", placements: ["facebook_link", "google_demand_gen", "linkedin"] },
  { id: "1000x1500", label: "Pinterest 2:3", w: 1000, h: 1500, safe: margin(1000, 1500, 50, 50, 50, 100), layout: "tall", placements: ["pinterest"] },
  { id: "300x250", label: "Display MREC", w: 300, h: 250, safe: margin(300, 250, 10, 10), layout: "small", placements: ["google_display"] },
  { id: "728x90", label: "Display leaderboard", w: 728, h: 90, safe: margin(728, 90, 10, 6), layout: "banner", placements: ["google_display"] },
];

export const FORMAT_IDS = AD_FORMATS.map((f) => f.id);

export function formatById(id: FormatId | string): AdFormat {
  const f = AD_FORMATS.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown image ad format ${id}`);
  return f;
}
