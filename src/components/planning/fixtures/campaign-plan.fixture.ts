/**
 * Hand-built CampaignPlan for the NXTPAPER 14 brief (fixtures/nxt-brief.json) — used by the view-model
 * tests and the dev-only `?fixture=1` preview of the Planning tab. Not real planner output.
 */
import type { CampaignPlan, PlanBeat } from "@/services/creative/campaign-plan.types";

const body: PlanBeat[] = [
  { t0: 3, t1: 7, purpose: "proof", sellingPointId: "sp-03", visual: "Split screen, iPhone slow-mo: glossy tablet flickers, NXTPAPER 14 steady", shotType: "split_screen", vo: "Your tablet flickers. You just can't see it.", onScreenText: "Flicker vs no flicker" },
  { t0: 7, t1: 11, purpose: "benefit", sellingPointId: "sp-01", visual: "Desk lamp sweeps across both screens; matte stays readable", shotType: "comparison", vo: "Matte NXTPAPER kills the glare — even by the window.", onScreenText: "No glare. Even in sun." },
  { t0: 11, t1: 14, purpose: "objection", visual: "Macro slide: glossy reflection vs crisp matte text", shotType: "macro", vo: "Same sharp text, no grain.", onScreenText: "Same resolution, zero grain" },
  { t0: 14, t1: 18, purpose: "cta", visual: "End card E09 — product hero, 'Tap Shop Now ↓'", vo: "Save your eyes — tap to shop.", onScreenText: "Tap Shop Now ↓" },
];

const reelsBody: PlanBeat[] = [
  { t0: 2, t1: 6, purpose: "pitch", sellingPointId: "sp-01", visual: "Slow push-in on the 14-inch matte screen in warm window light", vo: "A 14-inch tablet that reads like paper.", onScreenText: "Reads like paper" },
  { t0: 6, t1: 10, purpose: "proof", sellingPointId: "sp-03", visual: "TÜV badge pops beside a flicker-free slow-mo split", shotType: "split_screen", onScreenText: "TÜV low blue light · flicker-free" },
  { t0: 10, t1: 13, purpose: "benefit", sellingPointId: "sp-02", visual: "Macro pan over text switching into Paper Mode", onScreenText: "Paper Mode" },
  { t0: 13, t1: 16, purpose: "cta", visual: "End card E06 — stars, quote card, pill button", onScreenText: "Shop the bestseller" },
];

export const CAMPAIGN_PLAN_FIXTURE: CampaignPlan = {
  version: 1,
  createdAt: "2026-10-06T12:00:00.000Z",
  productTitle: "TCL NXTPAPER 14",
  goal: "cold",
  bigIdea: "The 14-inch matte tablet that looks like paper, even in sunlight.",
  keywords: ["no glare tablet", "eye care tablet", "#booktok", "#studytok"],
  notes: ["H22 Torture Test dropped: torture-test claims need real footage", "AI-generated content label required on TikTok and Meta"],
  platforms: [
    {
      platform: "tiktok",
      label: "TikTok",
      durationSec: 18,
      aspect: "9:16",
      audience: "18-34, female-leaning; entertainment-led discovery",
      styleNotes: "UGC, POV, problem-solution demo, handheld",
      pacing: "0.8 cuts/s first 6 s, 0.5 after",
      voice: "casual first-person creator",
      captionStyle: "native white bold, 2–5 words per chunk",
      musicMood: "trending-style >120 BPM, beat-synced",
      hookVariants: [
        { hookId: "H09", name: "Problem Agitation POV", family: "demo", durationSec: 3, openingVisual: "POV: squinting at a glossy tablet by a sunny window", openingText: "Glare again?", openingVO: "If your tablet looks like a mirror by the window…" },
        { hookId: "H15", name: "Bold Number Claim", family: "claim", durationSec: 2.5, openingVisual: "Kinetic text over the matte screen", openingText: "0 glare. 0 flicker.", openingVO: "Zero glare, zero flicker." },
        { hookId: "H04", name: "Hands-in Reveal", family: "reveal", durationSec: 2, openingVisual: "Hands slide the tablet into frame under a harsh lamp", openingText: "Paper, not glass", openingVO: "This is NXTPAPER 14." },
      ],
      endCard: { id: "E09", name: "Tap-below pointer", button: "Tap Shop Now below", headline: "Save your eyes" },
      endCardAlternates: [
        { id: "E12", name: "Creator-native close (lo-fi caption)", button: "link's right there 👇" },
        { id: "E01", name: "Brand lockup + pill button", button: "Shop now" },
      ],
      beats: body,
      scripts: [
        { hookId: "H09", title: "Glare POV → flicker proof → tap", beats: [{ t0: 0, t1: 3, purpose: "hook", visual: "POV: squinting at a glossy tablet by a sunny window", vo: "If your tablet looks like a mirror by the window…", onScreenText: "Glare again?" }, ...body] },
        { hookId: "H15", title: "Zero glare claim → proof → tap", beats: [{ t0: 0, t1: 3, purpose: "hook", visual: "Kinetic text over the matte screen", vo: "Zero glare, zero flicker.", onScreenText: "0 glare. 0 flicker." }, ...body] },
        { hookId: "H04", title: "Hands-in reveal → proof → tap", beats: [{ t0: 0, t1: 3, purpose: "hook", visual: "Hands slide the tablet into frame under a harsh lamp", vo: "This is NXTPAPER 14.", onScreenText: "Paper, not glass" }, ...body] },
      ],
    },
    {
      platform: "instagram_reels",
      label: "Instagram Reels",
      durationSec: 16,
      aspect: "9:16",
      audience: "25-34, female-leaning; aesthetic inspiration",
      styleNotes: "polished, warm light, premium",
      pacing: "0.7 cuts/s first 6 s, 0.4 after",
      voice: "warm, confident narrator",
      captionStyle: "clean sans, lower-middle",
      musicMood: "chill lo-fi, soft beat",
      hookVariants: [
        { hookId: "H01", name: "Hero Turntable Reveal (360° spin)", family: "reveal", durationSec: 2, openingVisual: "Tablet turns on a linen podium, matte screen catching no light", openingText: "Paper, reinvented", openingVO: "" },
        { hookId: "H13", name: "Side-by-side claim", family: "claim", durationSec: 2, openingVisual: "Glossy vs matte under the same lamp", openingText: "Spot the glare", openingVO: "" },
      ],
      endCard: { id: "E06", name: "Rating + testimonial", button: "Shop the bestseller", data: { rating: 4.6, count: 1280 } },
      endCardAlternates: [{ id: "E01", name: "Brand lockup + pill button", button: "Shop now" }],
      beats: reelsBody,
      scripts: [
        { hookId: "H01", title: "Turntable reveal → proof → reviews", beats: [{ t0: 0, t1: 2, purpose: "hook", visual: "Turntable reveal on linen", onScreenText: "Paper, reinvented" }, ...reelsBody] },
        { hookId: "H13", title: "Spot the glare → proof → reviews", beats: [{ t0: 0, t1: 2, purpose: "hook", visual: "Glossy vs matte under the same lamp", onScreenText: "Spot the glare" }, ...reelsBody] },
      ],
    },
  ],
};
