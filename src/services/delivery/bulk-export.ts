/**
 * Upload-ready bulk files for the export pack (until direct publishing is approved): a Meta Ads
 * Manager bulk-import CSV (one denormalised campaign / ad set / ad row per video, created PAUSED), a
 * TikTok Ads Manager bulk-create sheet layout (CSV), the ad-copy CSV, and a UTM builder
 * (utm_content = the variant's ad name, so results map straight back through parseAdName).
 *
 * Column names follow each Ads Manager's bulk template; the account's own export is the final word —
 * upload the videos to the media library first (file names = "Video File Name" / "Video Name").
 * CSV is RFC 4180: CRLF records, fields quoted when they hold a comma, quote, CR/LF or edge spaces.
 */
import { charCount, COPY_LIMITS, type AdCopySet, type CopyChannel } from "./ad-copy";

// ─── CSV ────────────────────────────────────────────────────────────────────

export function csvEscape(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

// ─── UTM ────────────────────────────────────────────────────────────────────

export interface Utm {
  source: string;
  medium: string;
  campaign: string;
  /** The variant's ad name. */
  content: string;
  term?: string;
}

/** Landing URL + UTMs (percent-encoded; existing utm_* replaced; other params and #hash kept). */
export function buildUtmUrl(base: string, utm: Utm): string {
  const u = new URL(base);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Landing URL must be http(s): ${base}`);
  const enc = (k: string, v: string) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  const keep = [...u.searchParams.entries()].filter(([k]) => !/^utm_/i.test(k)).map(([k, v]) => enc(k, v));
  const tags = [enc("utm_source", utm.source), enc("utm_medium", utm.medium), enc("utm_campaign", utm.campaign), enc("utm_content", utm.content)];
  if (utm.term) tags.push(enc("utm_term", utm.term));
  return `${u.origin}${u.pathname}?${[...keep, ...tags].join("&")}${u.hash}`;
}

// ─── Pack rows ──────────────────────────────────────────────────────────────

export interface PackVariant {
  adName: string;
  /** File name in the pack / media library (adName.mp4). */
  fileName: string;
  url: string;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  aspect: string;
  durationSec: number | null;
  kind: "master" | "hook-variant" | "export" | "batch";
  /** Button copy of this variant (batch CTA dimension). */
  cta?: string | null;
}

export interface BulkContext {
  campaignName: string;
  landingUrl: string;
  brand: string;
  defaultCta: string;
  dailyBudget?: number;
  countries?: string;
}

/** Meta CTA type from the button copy. */
export function metaCtaType(text: string | null | undefined): string {
  const t = (text ?? "").toLowerCase();
  if (/install|get the app/.test(t)) return "INSTALL_MOBILE_APP";
  if (/download/.test(t)) return "DOWNLOAD";
  if (/sign ?up|register|join/.test(t)) return "SIGN_UP";
  if (/subscribe/.test(t)) return "SUBSCRIBE";
  if (/learn|read|see why|explore|discover/.test(t)) return "LEARN_MORE";
  if (/order/.test(t)) return "ORDER_NOW";
  if (/book/.test(t)) return "BOOK_TRAVEL";
  if (/offer|deal|coupon|code|claim|% off|unlock|save/.test(t)) return "GET_OFFER";
  return "SHOP_NOW";
}

/** TikTok CTA label from the button copy. */
export function tiktokCta(text: string | null | undefined): string {
  const t = (text ?? "").toLowerCase();
  if (/install|download|get the app/.test(t)) return "Download";
  if (/sign ?up|register|join/.test(t)) return "Sign up";
  if (/learn|read|see why|explore|discover/.test(t)) return "Learn more";
  if (/order/.test(t)) return "Order now";
  if (/book/.test(t)) return "Book now";
  return "Shop now";
}

const PLACEMENT: Record<string, string> = { "9:16": "Reels & Stories", "4:5": "Feed", "1:1": "Feed", "16:9": "In-stream" };
const aspectToken = (a: string) => a.replace(":", "x");

function copyFor(sets: AdCopySet[], channel: CopyChannel, i: number): Record<string, string> {
  const set = sets.find((s) => s.channel === channel);
  if (!set?.variants.length) return {};
  return set.variants[i % set.variants.length].fields;
}

export const META_COLUMNS = [
  "Campaign Name",
  "Campaign Status",
  "Campaign Objective",
  "Buying Type",
  "Ad Set Name",
  "Ad Set Run Status",
  "Ad Set Daily Budget",
  "Optimization Goal",
  "Billing Event",
  "Countries",
  "Ad Name",
  "Ad Status",
  "Title",
  "Body",
  "Link Description",
  "Link",
  "Display Link",
  "Call to Action",
  "Video File Name",
] as const;

/** Meta Ads Manager bulk import: campaign → ad set per aspect (placement fit) → one ad per video. */
export function metaBulkCsv(variants: PackVariant[], copy: AdCopySet[], ctx: BulkContext): string {
  const display = new URL(ctx.landingUrl).hostname.replace(/^www\./, "");
  const rows = variants.map((v, i) => {
    const c = copyFor(copy, "meta", i);
    const cta = v.cta || ctx.defaultCta;
    const row: Record<(typeof META_COLUMNS)[number], string | number> = {
      "Campaign Name": ctx.campaignName,
      "Campaign Status": "PAUSED",
      "Campaign Objective": "Outcome Sales",
      "Buying Type": "AUCTION",
      "Ad Set Name": `${ctx.campaignName} | ${aspectToken(v.aspect)} ${PLACEMENT[v.aspect] ?? "Feed"}`,
      "Ad Set Run Status": "PAUSED",
      "Ad Set Daily Budget": ctx.dailyBudget ?? 20,
      "Optimization Goal": "OFFSITE_CONVERSIONS",
      "Billing Event": "IMPRESSIONS",
      Countries: ctx.countries ?? "US",
      "Ad Name": v.adName,
      "Ad Status": "PAUSED",
      Title: c.headline ?? ctx.brand,
      Body: c.primaryText ?? "",
      "Link Description": c.description ?? "",
      Link: buildUtmUrl(ctx.landingUrl, { source: "meta", medium: "paid_social", campaign: ctx.campaignName, content: v.adName }),
      "Display Link": display,
      "Call to Action": metaCtaType(cta),
      "Video File Name": v.fileName,
    };
    return META_COLUMNS.map((k) => row[k]);
  });
  return toCsv([[...META_COLUMNS], ...rows]);
}

export const TIKTOK_COLUMNS = [
  "Campaign Name",
  "Advertising Objective",
  "Campaign Budget Mode",
  "Ad Group Name",
  "Placement",
  "Location",
  "Optimization Goal",
  "Billing Event",
  "Ad Group Budget Mode",
  "Ad Group Budget",
  "Ad Name",
  "Ad Format",
  "Video Name",
  "Ad Text",
  "Call To Action",
  "Destination URL",
  "Display Name",
  "Status",
] as const;

/** TikTok Ads Manager bulk-create layout: vertical videos only, one ad group per campaign. */
export function tiktokBulkCsv(variants: PackVariant[], copy: AdCopySet[], ctx: BulkContext): string {
  const vertical = variants.filter((v) => v.aspect === "9:16");
  const rows = vertical.map((v, i) => {
    const c = copyFor(copy, "tiktok", i);
    const row: Record<(typeof TIKTOK_COLUMNS)[number], string | number> = {
      "Campaign Name": ctx.campaignName,
      "Advertising Objective": "Sales",
      "Campaign Budget Mode": "No limit",
      "Ad Group Name": `${ctx.campaignName} | 9x16`,
      Placement: "TikTok",
      Location: ctx.countries ?? "US",
      "Optimization Goal": "Conversion",
      "Billing Event": "OCPM",
      "Ad Group Budget Mode": "Daily",
      "Ad Group Budget": ctx.dailyBudget ?? 20,
      "Ad Name": v.adName,
      "Ad Format": "Single video",
      "Video Name": v.fileName,
      "Ad Text": c.adText ?? "",
      "Call To Action": tiktokCta(v.cta || ctx.defaultCta),
      "Destination URL": buildUtmUrl(ctx.landingUrl, { source: "tiktok", medium: "paid_social", campaign: ctx.campaignName, content: v.adName }),
      "Display Name": ctx.brand.slice(0, 40),
      Status: "Disable",
    };
    return TIKTOK_COLUMNS.map((k) => row[k]);
  });
  return toCsv([[...TIKTOK_COLUMNS], ...rows]);
}

/** Every copy field with its length against the platform limit. */
export function copyCsv(sets: AdCopySet[]): string {
  const rows: (string | number)[][] = [["Channel", "Platforms", "Variant", "Angle", "Field", "Text", "Chars", "Limit", "Truncated"]];
  for (const s of sets)
    s.variants.forEach((v, i) => {
      for (const f of COPY_LIMITS[s.channel].fields) {
        const text = v.fields[f.key] ?? "";
        rows.push([s.channel, s.platforms.join("|"), i + 1, v.angle, f.key, text, charCount(text), f.limit, v.truncated.includes(f.key) ? "yes" : "no"]);
      }
    });
  return toCsv(rows);
}
