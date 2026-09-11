import type { PromptPart } from "@/services/ai/claude-client";

export const AD_TEARDOWN_PROMPT_VERSION = 1;

export const HOOK_TYPES = [
  "curiosity_gap",
  "problem_agitate",
  "shock_stat",
  "pattern_interrupt",
  "social_proof",
  "offer_first",
  "demo_first",
  "question",
  "before_after",
  "trend_native",
] as const;

export type HookType = (typeof HOOK_TYPES)[number];

export const CTA_PLACEMENTS = ["end_card", "mid_roll", "persistent_overlay", "none"] as const;

export type EvidenceLevel = "vision_transcript" | "transcript" | "thumbnail" | "metadata";

export interface TeardownTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface AdTeardownInput {
  brandName: string;
  ownerName: string;
  isBrandOwned: boolean;
  title: string;
  url: string;
  platform?: string | null;
  adSource?: string | null;
  isPaidMedia?: boolean;
  description?: string | null;
  durationSec?: number | null;
  viewCount?: number | null;
  publishedAt?: Date | null;
  landingUrl?: string | null;
  rank?: number | null;
  frameUrls: string[];
  frameTimestamps?: number[];
  transcript?: string | null;
  transcriptSegments?: TeardownTranscriptSegment[];
  evidenceLevel: EvidenceLevel;
}

function formatSegments(segments: TeardownTranscriptSegment[]): string {
  return segments
    .slice(0, 80)
    .map((s) => `[${s.start.toFixed(1)}s–${s.end.toFixed(1)}s] ${s.text.trim()}`)
    .join("\n");
}

export function buildAdTeardownPrompt(input: AdTeardownInput): {
  system: string;
  user: PromptPart[];
} {
  const system = `You are a direct-response creative strategist tearing down ONE video ad, frame by frame.

You may receive keyframe images sampled across the ad and a timestamped transcript. Describe ONLY what the supplied evidence supports. Never invent a shot, a line of voiceover, a price, or a claim that is not visible in a frame or present in the transcript. When evidence is thin, say so in "whyItWorks" and lower "confidence".

hookType MUST be exactly one of:
${HOOK_TYPES.join(" | ")}

ctaPlacement MUST be exactly one of: ${CTA_PLACEMENTS.join(" | ")}

Respond with ONLY a JSON object:
{
  "hookType": "one of the enum values above",
  "hookText": "the actual opening line (quote the transcript when available, else the on-screen text visible in the first frame)",
  "hookVisual": "what the first 1-3 seconds look like — subject, framing, motion, setting",
  "beats": [
    {
      "startSec": number,
      "endSec": number,
      "role": "hook|problem|demo|proof|offer|cta|brand",
      "visual": "what is on screen during this beat",
      "vo": "voiceover or dialogue in this beat (empty string when silent/unknown)",
      "onScreenText": "text burned into frame during this beat (empty string when none)"
    }
  ],
  "sellingPoints": [{ "point": "benefit or feature as this ad states it", "evidenceTimestamp": "e.g. 7.5s or 'frame 3'" }],
  "proofDevices": [{ "type": "demo|testimonial|stat|before_after|authority|ugc|award|guarantee", "description": "how it is shown", "timestamp": "e.g. 12s" }],
  "ctaText": "exact CTA wording, or null",
  "ctaPlacement": "end_card|mid_roll|persistent_overlay|none",
  "offer": "discount / bundle / free shipping / trial as stated, or null",
  "landingUrl": "destination URL if visible or supplied, else null",
  "whyItWorks": "3-5 sentences: the mechanism of this ad — what it does to attention, desire and action, and what evidence you based that on",
  "evidenceLevel": "vision_transcript|transcript|thumbnail|metadata",
  "confidence": "high|medium|low"
}

Rules:
- beats must cover the ad end to end, in order, without gaps or overlaps; use the supplied duration as the final endSec.
- evidenceLevel MUST equal the tier stated below — do not upgrade it.
- confidence: "high" only for vision_transcript, "medium" for transcript or multi-frame vision, "low" for thumbnail/metadata.
- Keep every string concrete and specific to this ad. No generic marketing filler.`;

  const evidenceNote: Record<EvidenceLevel, string> = {
    vision_transcript: "Keyframes AND a timestamped transcript are provided. This is the strongest tier — read both.",
    transcript: "A transcript is provided but no usable frames. Do not describe visuals you cannot verify; keep 'visual' fields short and hedged.",
    thumbnail: "Only still images (thumbnail/storyboard) are provided — no audio. You cannot quote speech; base hookText on visible on-screen text or the title, and mark confidence 'low'.",
    metadata: "No frames and no transcript — only metadata. Keep beats coarse, set confidence 'low', and say plainly in whyItWorks that this is metadata-only inference.",
  };

  const header = `AD UNDER ANALYSIS
Advertiser: ${input.ownerName}${input.isBrandOwned ? " (our own brand)" : " (competitor)"}
Analysed for brand: ${input.brandName}
Title: ${input.title}
URL: ${input.url}
Platform: ${input.platform || "unknown"}${input.adSource ? ` | Ad source: ${input.adSource}` : ""}${input.isPaidMedia ? " | Confirmed paid media" : ""}
Duration: ${input.durationSec ? `${Math.round(input.durationSec)}s` : "unknown"}${input.rank ? ` | Rank in owner: #${input.rank}` : ""}
Views: ${input.viewCount?.toLocaleString() || "unknown"}${input.publishedAt ? ` | Published: ${input.publishedAt.toISOString().slice(0, 10)}` : ""}${input.landingUrl ? `\nKnown landing URL: ${input.landingUrl}` : ""}
Description: ${(input.description || "none").slice(0, 500)}

EVIDENCE TIER: ${input.evidenceLevel}
${evidenceNote[input.evidenceLevel]}`;

  const parts: PromptPart[] = [{ type: "text", text: header }];

  if (input.frameUrls.length > 0) {
    const stamps = input.frameTimestamps;
    parts.push({
      type: "text",
      text: `KEYFRAMES (${input.frameUrls.length}), in chronological order${
        stamps?.length ? ` at approximately ${stamps.map((t) => `${t}s`).join(", ")}` : ""
      }:`,
    });
    input.frameUrls.forEach((url, i) => {
      parts.push({ type: "text", text: `Frame ${i + 1}${stamps?.[i] !== undefined ? ` (~${stamps[i]}s)` : ""}:` });
      parts.push({ type: "image_url", url });
    });
  }

  if (input.transcriptSegments?.length) {
    parts.push({
      type: "text",
      text: `TIMESTAMPED TRANSCRIPT:\n${formatSegments(input.transcriptSegments)}`,
    });
  } else if (input.transcript) {
    parts.push({
      type: "text",
      text: `TRANSCRIPT (no timestamps available — infer beat boundaries from pacing):\n${input.transcript.slice(0, 6000)}`,
    });
  }

  parts.push({
    type: "text",
    text: `Produce the teardown JSON for this ad now. beats must end at ${
      input.durationSec ? `${Math.round(input.durationSec)}s` : "the ad's final moment"
    }.`,
  });

  return { system, user: parts };
}
