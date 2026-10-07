/**
 * Realistic competitor / category ad rows for the hook-trend tests, typed with the generated Prisma
 * models (ContentAsset from the Meta Ad Library / TikTok Creative Center adapters, AdTeardown with the
 * includes the loaders use, AdStructure from the structure library). Clock: NOW (2026-10-07 12:00 UTC).
 *
 * TV category, TikTok:
 *   H08 POV           1 older ad + 3 launched this week            → rising, not saturated
 *   H16 deal slam     8 ads from 4 advertisers, long-running        → saturated
 *   H10 before/after  2 torn-down ads running ~90 days, high views  → longevity leader
 *   H28 stop scroll   3 ads launched 5–6 weeks ago, stopped         → fading
 *   H15 big number    4 ads, launches in line with the base → steady
 * (The saved structure has no run dates: it counts by its save date, outside the 28-day window.)
 * Meta: 3 deal ads + 3 "N reasons" listicles.
 */
import type { AdStructure, AdTeardown, ContentAsset } from "@/generated/prisma/client";

export const NOW = new Date("2026-10-07T12:00:00Z");
const DAY = 86_400_000;
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

let seq = 0;
export function contentAsset(p: Partial<ContentAsset> & { title: string }): ContentAsset {
  seq++;
  const id = p.id ?? `ca_${seq}`;
  const tiktok = /tiktok/i.test(p.platform ?? "TikTok");
  return {
    id,
    projectId: "proj_tv",
    competitorId: "comp_vivora",
    type: "VIDEO" as ContentAsset["type"],
    url: tiktok ? `https://www.tiktok.com/@brand/video/74100000000000${String(seq).padStart(5, "0")}` : `https://www.facebook.com/ads/library/?id=1200000000${seq}`,
    thumbnailUrl: null,
    description: null,
    publishedAt: null,
    platform: "TikTok",
    viewCount: null,
    likeCount: null,
    commentCount: null,
    engagementRate: null,
    metricsSource: "PUBLIC_WEB" as ContentAsset["metricsSource"],
    overallScore: null,
    hookStrength: null,
    productVisibility: null,
    storytellingArc: null,
    ctaQuality: null,
    emotionalAppeal: null,
    pacing: null,
    hookText: null,
    narrativeType: null,
    contentCategory: null,
    keyMessages: null,
    transcript: null,
    isBrandOwned: false,
    isPaidMedia: true,
    adSpendEstimate: null,
    adSource: tiktok ? "tiktok_cc" : "meta_ad_library",
    adEvidence: "ad_library",
    adConfidence: 0.95,
    advertiserName: "Vivora",
    advertiserId: null,
    adLibraryId: null,
    durationSec: 15,
    aspectRatio: "9:16",
    format: "vertical_short",
    videoUrl: null,
    landingUrl: null,
    firstSeenAt: null,
    lastSeenAt: null,
    frameUrls: null,
    rankInOwner: null,
    excluded: false,
    pinned: false,
    dataSource: "PUBLIC_WEB" as ContentAsset["dataSource"],
    rawData: null,
    createdAt: daysAgo(1),
    ...p,
  } as ContentAsset;
}

const tt = (title: string, first: number, last: number | null, extra: Partial<ContentAsset> = {}) =>
  contentAsset({ title, platform: "TikTok", firstSeenAt: daysAgo(first), lastSeenAt: last === null ? null : daysAgo(last), ...extra });
const meta = (title: string, first: number, last: number | null, extra: Partial<ContentAsset> = {}) =>
  contentAsset({ title, platform: "Facebook", firstSeenAt: daysAgo(first), lastSeenAt: last === null ? null : daysAgo(last), aspectRatio: "4:5", ...extra });

export const tiktokAds: ContentAsset[] = [
  // H08 POV — rising
  tt("POV: you finally see the screen at noon", 20, 2, { advertiserName: "Lumen TV", competitorId: "comp_lumen" }),
  tt("POV: your TV in a bright living room", 1, null, { advertiserName: "Lumen TV", competitorId: "comp_lumen", viewCount: 180000, likeCount: 9100, commentCount: 300 }),
  tt("pov: movie night with zero glare", 3, null, { advertiserName: "Brightline", competitorId: "comp_bright" }),
  tt("POV: you mounted it facing the window", 5, null, { advertiserName: "Novaview", competitorId: "comp_nova" }),
  // H16 deal slam — saturated (8 ads, 4 advertisers)
  tt("Prime Day: 40% off the 65\" QLED", 55, 1, { advertiserName: "Vivora" }),
  tt("$200 off this weekend only", 50, 2, { advertiserName: "Lumen TV", competitorId: "comp_lumen" }),
  tt("Price drop! Our 65\" TV is now $399", 48, null, { advertiserName: "Brightline", competitorId: "comp_bright" }),
  tt("30% off the brightest TV we make", 45, 3, { advertiserName: "Novaview", competitorId: "comp_nova" }),
  tt("Deal of the day: 55\" mini-LED", 40, null, { advertiserName: "Vivora" }),
  tt("Black Friday early access — 35% off", 35, null, { advertiserName: "Lumen TV", competitorId: "comp_lumen" }),
  tt("Flash sale: 25% off all QLEDs", 4, null, { advertiserName: "Brightline", competitorId: "comp_bright" }),
  tt("Was $899, now $599", 9, null, { advertiserName: "Novaview", competitorId: "comp_nova" }),
  // H28 stop scrolling — fading (launched 5–6 weeks ago, stopped 25 days ago)
  tt("Stop scrolling if your TV looks washed out", 42, 25, { advertiserName: "Vivora" }),
  tt("Don't scroll — your TV is lying to you", 40, 26, { advertiserName: "Brightline", competitorId: "comp_bright" }),
  tt("Wait, stop. Look at these blacks", 38, 25, { advertiserName: "Novaview", competitorId: "comp_nova" }),
  // H15 big number — steady
  tt("1,500 nits of brightness", 24, null, { advertiserName: "Vivora" }),
  tt("2,000 nits. Read that again.", 20, 1, { advertiserName: "Lumen TV", competitorId: "comp_lumen" }),
  tt("3,000 nits in a 55 inch TV", 30, null, { advertiserName: "Novaview", competitorId: "comp_nova" }),
  tt("5,000 nits peak — no joke", 10, null, { advertiserName: "Brightline", competitorId: "comp_bright" }),
];

export const metaAds: ContentAsset[] = [
  meta("Save $300 on the Vivora QLED — today only", 30, null),
  meta("40% off every OLED this week", 20, 2, { advertiserName: "Lumen TV", competitorId: "comp_lumen" }),
  meta("Big deal: the 65\" is $200 off", 15, null, { advertiserName: "Brightline", competitorId: "comp_bright" }),
  meta("3 reasons gamers switch to mini-LED", 6, null, { advertiserName: "Novaview", competitorId: "comp_nova" }),
  meta("5 things nobody tells you about QLED", 4, null),
  meta("Three ways a brighter TV changes movie night", 2, null, { advertiserName: "Lumen TV", competitorId: "comp_lumen" }),
];

/** Assets behind the torn-down before/after ads (H10), long-running with strong engagement. */
export const teardownAssets: ContentAsset[] = [
  tt("Old TV vs Vivora — side by side", 92, 1, { id: "ca_ba_1", viewCount: 2_400_000, likeCount: 150_000, commentCount: 4200, engagementRate: 6.4 }),
  tt("Before / after: the glare test", 88, 2, { id: "ca_ba_2", advertiserName: "Lumen TV", competitorId: "comp_lumen", viewCount: 1_100_000, likeCount: 61_000, commentCount: 1900, engagementRate: 5.7 }),
];

type TeardownRow = AdTeardown & { competitor: { name: string } | null; contentAsset: ContentAsset };

export function teardown(asset: ContentAsset, p: Partial<TeardownRow>): TeardownRow {
  return {
    id: `td_${asset.id}`,
    projectId: asset.projectId,
    contentAssetId: asset.id,
    competitorId: asset.competitorId,
    rank: 1,
    hookType: "before_after",
    hookText: "Before / after",
    hookVisual: "Split screen: washed-out old TV on the left, vivid QLED on the right",
    beats: [
      { startSec: 0, endSec: 1.5, role: "hook", visual: "Before/after split screen, old TV vs new", vo: "Same movie, two TVs.", onScreenText: "BEFORE / AFTER" },
      { startSec: 1.5, endSec: 6, role: "demo", visual: "Macro of the panel in sunlight", vo: "No glare, even at noon.", onScreenText: "NO GLARE" },
      { startSec: 6, endSec: 9, role: "cta", visual: "End card, logo and button", vo: "Shop now.", onScreenText: "SHOP NOW" },
    ],
    sellingPoints: [{ point: "anti-glare panel", evidenceTimestamp: "2s" }],
    proofDevices: [{ type: "demo", description: "split-screen comparison", timestamp: "0s" }],
    ctaText: "Shop now",
    ctaPlacement: "end_card",
    offer: null,
    landingUrl: null,
    whyItWorks: "The split screen proves the claim in frame 1.",
    evidenceLevel: "vision_transcript",
    confidence: "high",
    promptVersion: 1,
    createdAt: daysAgo(10),
    updatedAt: daysAgo(10),
    competitor: { name: asset.advertiserName ?? "Vivora" },
    contentAsset: asset,
    ...p,
  } as TeardownRow;
}

export const teardowns: TeardownRow[] = [teardown(teardownAssets[0], {}), teardown(teardownAssets[1], { hookText: "Before and after the glare test", competitor: { name: "Lumen TV" } })];

export const structure: AdStructure = {
  id: "st_1",
  sourceProjectId: "proj_other",
  name: "Brightline — before after · 3 beats",
  category: "TVs",
  goalType: "conversion",
  sourceTitle: "Brightline glare test",
  sourceOwner: "Brightline",
  sourceUrl: "https://www.tiktok.com/@brightline/video/7410000000000099999",
  sourceViews: 900000,
  hookType: "before_after",
  hookText: "Before vs after in direct sun",
  durationSec: 12,
  beats: [
    { startSec: 0, endSec: 2, role: "hook", visual: "Before/after split", onScreenText: "BEFORE / AFTER" },
    { startSec: 2, endSec: 12, role: "cta", visual: "End card", onScreenText: "SHOP" },
  ],
  proofDevices: null,
  whyItWorks: "Proof first.",
  timesUsed: 0,
  sourceTeardownId: null,
  createdAt: daysAgo(30),
} as AdStructure;

/** Openings the rules can't place (no formula words, no visual): the LLM fallback's job. */
export const vagueAds: ContentAsset[] = Array.from({ length: 45 }, (_, k) => tt(`The new Vivora ${k + 1} is here`, 6 + (k % 10), null, { id: `ca_vague_${k}` }));
