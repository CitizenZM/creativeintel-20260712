import { describe, expect, it } from "vitest";
import { parseCsv } from "@/services/performance/import";
import type { AdCopySet } from "./ad-copy";
import { buildUtmUrl, copyCsv, csvEscape, metaBulkCsv, META_COLUMNS, metaCtaType, tiktokBulkCsv, TIKTOK_COLUMNS, toCsv, type PackVariant } from "./bulk-export";

describe("csvEscape / toCsv (RFC 4180)", () => {
  it("quotes only when needed and doubles inner quotes", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("cr\rlf")).toBe('"cr\rlf"');
    expect(csvEscape(" padded ")).toBe('" padded "');
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(12.5)).toBe("12.5");
  });

  it("joins records with CRLF, ends with CRLF and round-trips through the importer's parser", () => {
    const rows = [
      ["Name", "Text"],
      ["a", 'He said "zero glare", twice'],
      ["b", "multi\nline 🔥"],
    ];
    const csv = toCsv(rows);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")[0]).toBe("Name,Text");
    expect(parseCsv(csv)).toEqual(rows);
  });
});

describe("buildUtmUrl", () => {
  it("adds encoded UTMs, keeps other params and the hash, replaces old UTMs", () => {
    const out = buildUtmUrl("https://shop.example.com/p/nxt?ref=x&utm_source=old#reviews", {
      source: "meta",
      medium: "paid_social",
      campaign: "TCL Q4 & Gifts",
      content: "TCL_Nxt_15s_HookH09_E04_4x5_VAndrew_MPop_CShopNow",
    });
    const u = new URL(out);
    expect(u.searchParams.get("ref")).toBe("x");
    expect(u.searchParams.getAll("utm_source")).toEqual(["meta"]);
    expect(u.searchParams.get("utm_campaign")).toBe("TCL Q4 & Gifts");
    expect(out).toContain("utm_campaign=TCL%20Q4%20%26%20Gifts");
    expect(u.searchParams.get("utm_content")).toBe("TCL_Nxt_15s_HookH09_E04_4x5_VAndrew_MPop_CShopNow");
    expect(u.hash).toBe("#reviews");
  });

  it("adds the term only when given and rejects a non-http URL", () => {
    expect(buildUtmUrl("https://a.com", { source: "tiktok", medium: "paid_social", campaign: "c", content: "x", term: "tv" })).toBe("https://a.com/?utm_source=tiktok&utm_medium=paid_social&utm_campaign=c&utm_content=x&utm_term=tv");
    expect(() => buildUtmUrl("javascript:alert(1)", { source: "s", medium: "m", campaign: "c", content: "x" })).toThrow(/http/);
  });
});

const variants: PackVariant[] = [
  { adName: "TCL_Nxt_20s_HookQ", fileName: "TCL_Nxt_20s_HookQ.mp4", url: "https://cdn/x/master.mp4", aspect: "9:16", durationSec: 20, kind: "master" },
  { adName: "TCL_Nxt_15s_HookC_E04_4x5_VAndrew_MPop_CShopNow", fileName: "TCL_Nxt_15s_HookC_E04_4x5_VAndrew_MPop_CShopNow.mp4", url: "https://cdn/x/v2.mp4", aspect: "4:5", durationSec: 15, kind: "batch", cta: "Get 20% off" },
  { adName: "TCL_Nxt_10s_HookP_E01_9x16_VJenny_MAuto_CShopNow", fileName: "TCL_Nxt_10s_HookP_E01_9x16_VJenny_MAuto_CShopNow.mp4", url: "https://cdn/x/v3.mp4", aspect: "9:16", durationSec: 10, kind: "batch" },
];
const copy: AdCopySet[] = [
  {
    channel: "meta",
    label: "Meta",
    platforms: ["meta_feed"],
    source: "llm",
    variants: [
      { angle: "a", fields: { primaryText: 'Zero glare, "paper" feel', headline: "Read in full sun", description: "Free returns" }, truncated: [] },
      { angle: "b", fields: { primaryText: "TÜV flicker-free", headline: "Easy on the eyes", description: "Shop now" }, truncated: ["headline"] },
    ],
  },
  { channel: "tiktok", label: "TikTok", platforms: ["tiktok"], source: "llm", variants: [{ angle: "a", fields: { adText: "POV: reading outside, no glare" }, truncated: [] }] },
];
const ctx = { campaignName: "TCL NXTPAPER Batch b1", landingUrl: "https://shop.example.com/nxt", brand: "TCL", defaultCta: "Shop now" };

describe("metaBulkCsv", () => {
  it("writes one denormalised campaign / ad set / ad row per video, paused, with UTM links and rotating copy", () => {
    const table = parseCsv(metaBulkCsv(variants, copy, ctx));
    expect(table[0]).toEqual(META_COLUMNS);
    expect(table).toHaveLength(4);
    const col = (r: string[], name: string) => r[META_COLUMNS.indexOf(name as never)];
    const [, r1, r2, r3] = table;
    expect(col(r1, "Campaign Name")).toBe("TCL NXTPAPER Batch b1");
    expect(col(r1, "Campaign Status")).toBe("PAUSED");
    expect(col(r1, "Ad Set Name")).toMatch(/9x16/);
    expect(col(r2, "Ad Set Name")).toMatch(/4x5/);
    expect(col(r1, "Ad Name")).toBe("TCL_Nxt_20s_HookQ");
    expect(col(r1, "Video File Name")).toBe("TCL_Nxt_20s_HookQ.mp4");
    expect(col(r1, "Body")).toBe('Zero glare, "paper" feel');
    expect(col(r2, "Body")).toBe("TÜV flicker-free");
    expect(col(r3, "Body")).toBe('Zero glare, "paper" feel');
    expect(col(r2, "Call to Action")).toBe("GET_OFFER");
    expect(col(r1, "Call to Action")).toBe("SHOP_NOW");
    expect(new URL(col(r2, "Link")).searchParams.get("utm_content")).toBe(variants[1].adName);
    expect(new URL(col(r2, "Link")).searchParams.get("utm_source")).toBe("meta");
  });
});

describe("tiktokBulkCsv", () => {
  it("takes the vertical videos only and uses the TikTok layout", () => {
    const table = parseCsv(tiktokBulkCsv(variants, copy, ctx));
    expect(table[0]).toEqual(TIKTOK_COLUMNS);
    expect(table).toHaveLength(3); // header + two 9:16 videos
    const col = (r: string[], name: string) => r[TIKTOK_COLUMNS.indexOf(name as never)];
    expect(col(table[1], "Video Name")).toBe("TCL_Nxt_20s_HookQ.mp4");
    expect(col(table[1], "Ad Text")).toBe("POV: reading outside, no glare");
    expect(col(table[1], "Display Name")).toBe("TCL");
    expect(new URL(col(table[2], "Destination URL")).searchParams.get("utm_source")).toBe("tiktok");
  });
});

describe("metaCtaType", () => {
  it("maps button copy to Meta CTA types", () => {
    expect(metaCtaType("Shop the sale")).toBe("SHOP_NOW");
    expect(metaCtaType("Learn more")).toBe("LEARN_MORE");
    expect(metaCtaType("Claim coupon")).toBe("GET_OFFER");
    expect(metaCtaType("Install now")).toBe("INSTALL_MOBILE_APP");
    expect(metaCtaType("Sign up")).toBe("SIGN_UP");
    expect(metaCtaType("anything")).toBe("SHOP_NOW");
  });
});

describe("copyCsv", () => {
  it("lists every field with its length and limit", () => {
    const table = parseCsv(copyCsv(copy));
    expect(table[0]).toEqual(["Channel", "Platforms", "Variant", "Angle", "Field", "Text", "Chars", "Limit", "Truncated"]);
    expect(table).toContainEqual(["meta", "meta_feed", "2", "b", "headline", "Easy on the eyes", "16", "40", "yes"]);
  });
});
