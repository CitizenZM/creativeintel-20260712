import { describe, expect, it } from "vitest";
import { parseCsv } from "@/services/performance/import";
import type { AdCopySet } from "./ad-copy";
import { assemblePackFiles, collectPackVariants } from "./export-pack";

describe("collectPackVariants", () => {
  it("lists master, hook variants, exports and rendered batch variants once each", () => {
    const vs = collectPackVariants({
      masterUrl: "https://cdn/m.mp4",
      masterName: "TCL_Tv_20s_HookQ",
      aspect: "9:16",
      durationSec: 20,
      qc: {
        variants: [{ adName: "TCL_Tv_20s_HookC", hookStyle: "c", masterUrl: "https://cdn/c.mp4", previewUrl: null }],
        exports: [{ format: "4:5", adName: "TCL_Tv_20s_HookQ_4x5", masterUrl: "https://cdn/45.mp4", previewUrl: null, durationSec: 20 }],
        batches: [
          {
            variants: [
              { name: "TCL_Tv_15s_HookP_E01_1x1_VJenny_MAuto_CShopNow", status: "rendered", masterUrl: "https://cdn/b1.mp4", aspect: "1:1", durationSec: 15, cta: "Shop now" },
              { name: "TCL_Tv_15s_HookH20_E01_9x16_VJenny_MAuto_CShopNow", status: "needs_generation", aspect: "9:16", durationSec: 15, cta: "Shop now" },
            ],
          },
        ] as never,
      },
    });
    expect(vs.map((v) => [v.kind, v.aspect])).toEqual([
      ["master", "9:16"],
      ["hook-variant", "9:16"],
      ["export", "4:5"],
      ["batch", "1:1"],
    ]);
    expect(vs[3].fileName).toBe("TCL_Tv_15s_HookP_E01_1x1_VJenny_MAuto_CShopNow.mp4");
  });
});

describe("assemblePackFiles", () => {
  const copy: AdCopySet[] = [{ channel: "meta", label: "Meta", platforms: ["meta_feed"], source: "scaffold", variants: [{ angle: "a", fields: { primaryText: "p", headline: "h", description: "d" }, truncated: [] }] }];
  const videos = collectPackVariants({ masterUrl: "https://cdn/m.mp4", masterName: "TCL_Tv_20s_HookQ", aspect: "9:16", durationSec: 20, qc: null });

  it("writes copy, bulk sheets, video list and README when there is a landing URL", () => {
    const notes: string[] = [];
    const files = assemblePackFiles({ campaignName: "TCL Tv | CI", landingUrl: "https://shop.example.com/tv", brand: "TCL", defaultCta: "Shop now", videos, copy, notes });
    expect(files.map((f) => f.path)).toEqual(["copy.csv", "meta-bulk.csv", "tiktok-bulk.csv", "videos.txt", "README.md"]);
    const meta = parseCsv(files[1].body as string);
    expect(meta).toHaveLength(2);
    expect(String(files[4].body)).toMatch(/meta-bulk\.csv/);
    expect(notes).toEqual([]);
  });

  it("skips the bulk sheets without a landing URL and says so", () => {
    const notes: string[] = [];
    const files = assemblePackFiles({ campaignName: "c", landingUrl: null, brand: "TCL", defaultCta: "Shop now", videos, copy, notes });
    expect(files.map((f) => f.path)).toEqual(["copy.csv", "videos.txt", "README.md"]);
    expect(notes.join(" ")).toMatch(/product URL/);
  });
});
