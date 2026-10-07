/**
 * Per-platform ad copy (primary text / headline / description …) for the export pack: 3–5 variants per
 * platform from the product brief + campaign plan in ONE text-model call, then hard platform limits
 * (smart truncation at a sentence or word boundary, never mid-emoji) and a per-platform emoji policy.
 * A deterministic scaffold fills in when the model fails or returns too few variants.
 *
 * CHARACTER LIMITS (as of 2026-10; platforms change these — recheck in each Ads Manager before a big push)
 * | Channel     | Field          | Limit | Note                                                                 |
 * |-------------|----------------|-------|----------------------------------------------------------------------|
 * | Meta        | Primary text   | 125   | visible before "See more" (hard max ~2,200); we keep it all visible  |
 * | Meta        | Headline       | 40    | recommended (hard max 255); longer is cut on mobile placements       |
 * | Meta        | Description    | 30    | recommended (hard max 255); hidden on many placements                |
 * | TikTok      | Ad text        | 100   | hard max (Latin script); emoji not accepted in Ads Manager ad text   |
 * | YouTube     | Headline       | 15    | Video action / in-stream CTA overlay headline                        |
 * | YouTube     | Long headline  | 90    | Video action / responsive video ads                                  |
 * | YouTube     | Description    | 70    | Video action description line                                        |
 * | Demand Gen  | Headline       | 40    | up to 5 headlines (long headline 90, business name 25 not used here) |
 * | Demand Gen  | Description    | 90    | up to 5 descriptions                                                 |
 * | Pinterest   | Title          | 100   | first ~40 shown in feed                                              |
 * | Pinterest   | Description    | 500   | first ~50 shown in feed                                              |
 * | Snapchat    | Headline       | 34    | hard max                                                             |
 * | Snapchat    | Brand name     | 25    | hard max (filled from the project brand, not the model)              |
 * Google (YouTube, Demand Gen) editorial policy rejects emoji/gimmicky symbols; Snapchat headlines are
 * kept emoji-free; Meta and Pinterest take them sparingly.
 */
import { z } from "zod";
import type { CampaignPlan } from "@/services/creative/campaign-plan.types";
import type { ProductBrief } from "@/services/creative/product-brief";

export type CopyChannel = "meta" | "tiktok" | "youtube" | "demand_gen" | "pinterest" | "snapchat";
export const COPY_CHANNELS: CopyChannel[] = ["meta", "tiktok", "youtube", "demand_gen", "pinterest", "snapchat"];

export interface EmojiPolicy {
  mode: "none" | "sparing";
  max: number;
  note: string;
}

export interface CopyFieldSpec {
  key: string;
  label: string;
  limit: number;
  /** Filled from the project, not the model. */
  fixed?: "brand";
}

export interface ChannelSpec {
  label: string;
  fields: CopyFieldSpec[];
  emoji: EmojiPolicy;
}

const NO_EMOJI = (note: string): EmojiPolicy => ({ mode: "none", max: 0, note });

export const COPY_LIMITS: Record<CopyChannel, ChannelSpec> = {
  meta: {
    label: "Meta (Facebook / Instagram)",
    fields: [
      { key: "primaryText", label: "Primary text", limit: 125 },
      { key: "headline", label: "Headline", limit: 40 },
      { key: "description", label: "Description", limit: 30 },
    ],
    emoji: { mode: "sparing", max: 2, note: "≤ 2 emoji in primary text as visual bullets; none in headline/description" },
  },
  tiktok: { label: "TikTok", fields: [{ key: "adText", label: "Ad text", limit: 100 }], emoji: NO_EMOJI("TikTok Ads Manager ad text doesn't take emoji") },
  youtube: {
    label: "YouTube",
    fields: [
      { key: "headline", label: "Headline", limit: 15 },
      { key: "longHeadline", label: "Long headline", limit: 90 },
      { key: "description", label: "Description", limit: 70 },
    ],
    emoji: NO_EMOJI("Google Ads editorial policy: no emoji"),
  },
  demand_gen: {
    label: "Google Demand Gen",
    fields: [
      { key: "headline", label: "Headline", limit: 40 },
      { key: "description", label: "Description", limit: 90 },
    ],
    emoji: NO_EMOJI("Google Ads editorial policy: no emoji"),
  },
  pinterest: {
    label: "Pinterest",
    fields: [
      { key: "title", label: "Title", limit: 100 },
      { key: "description", label: "Description", limit: 500 },
    ],
    emoji: { mode: "sparing", max: 1, note: "≤ 1 emoji; keywords matter more (Pinterest is search)" },
  },
  snapchat: {
    label: "Snapchat",
    fields: [
      { key: "headline", label: "Headline", limit: 34 },
      { key: "brandName", label: "Brand name", limit: 25, fixed: "brand" },
    ],
    emoji: NO_EMOJI("kept emoji-free for Snap ad review"),
  },
};

/** Creative-library platform id → copy channel. */
export function channelFor(platform: string): CopyChannel {
  if (platform === "tiktok") return "tiktok";
  if (platform === "google_demand_gen") return "demand_gen";
  if (platform.startsWith("youtube")) return "youtube";
  if (platform === "pinterest") return "pinterest";
  if (platform === "snapchat") return "snapchat";
  return "meta"; // instagram_*, meta_feed, facebook_reels
}

// ─── Limits ─────────────────────────────────────────────────────────────────

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const graphemes = (s: string) => [...segmenter.segment(s)].map((g) => g.segment);

/** Characters as a person (and the ad UIs) count them: one emoji = one. */
export const charCount = (s: string | null | undefined) => (s ? graphemes(s).length : 0);

const JOINERS = new Set(["and", "or", "with", "the", "a", "an", "to", "for", "of", "in", "on", "at", "by", "your", "our", "&", "+", "-", "–", "—", "but", "so", "from"]);

function tidyEnd(s: string): string {
  let out = s.trim();
  for (let i = 0; i < 6; i++) {
    const before = out;
    out = out.replace(/[\s,;:·•\-–—&+/(]+$/u, "");
    const words = out.split(/\s+/);
    if (words.length > 1 && JOINERS.has(words[words.length - 1].toLowerCase())) out = words.slice(0, -1).join(" ");
    if (out === before) break;
  }
  return out;
}

/**
 * Fit text to `limit` characters: whole sentences when the last full one is at least half the limit,
 * else whole words without a dangling "and / the / ," end, else a hard cut. No ellipsis (ad UIs add
 * their own "See more").
 */
export function smartTruncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const g = graphemes(clean);
  if (g.length <= limit) return clean;
  const head = g.slice(0, limit).join("");
  const sentence = /^([\s\S]*[.!?])(?=\s)/u.exec(head + " ");
  if (sentence && charCount(sentence[1]) >= limit * 0.5) return sentence[1].trim();
  const wordEnd = /\s/.test(g[limit]) ? head : head.slice(0, Math.max(0, head.lastIndexOf(" ")));
  const words = tidyEnd(wordEnd);
  if (words && charCount(words) >= limit * 0.4) return words;
  return head.trim();
}

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;

export function applyEmojiPolicy(text: string, policy: EmojiPolicy): string {
  let n = 0;
  return text
    .replace(EMOJI, (m) => (policy.mode === "sparing" && n++ < policy.max ? m : ""))
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Keep only the channel's fields, apply its emoji policy, and fit each to its limit. */
export function enforceCopy(channel: CopyChannel, fields: Record<string, string | undefined>, fixed: { brand?: string } = {}): { fields: Record<string, string>; truncated: string[] } {
  const spec = COPY_LIMITS[channel];
  const out: Record<string, string> = {};
  const truncated: string[] = [];
  spec.fields.forEach((f, i) => {
    let v = (f.fixed === "brand" ? (fixed.brand ?? fields[f.key]) : fields[f.key]) ?? "";
    // Sparing emoji only in the first (body) field; headlines and descriptions stay clean.
    v = applyEmojiPolicy(v, i === 0 ? spec.emoji : NO_EMOJI(""));
    const cut = smartTruncate(v, f.limit);
    if (cut !== v.replace(/\s+/g, " ").trim()) truncated.push(f.key);
    out[f.key] = cut;
  });
  return { fields: out, truncated };
}

// ─── Generation ─────────────────────────────────────────────────────────────

export interface AdCopyVariant {
  angle: string;
  fields: Record<string, string>;
  truncated: string[];
}

export interface AdCopySet {
  channel: CopyChannel;
  label: string;
  /** The plan platforms this copy serves. */
  platforms: string[];
  source: "llm" | "scaffold";
  variants: AdCopyVariant[];
}

export type CopyLlm = (args: { system: string; user: string }) => Promise<unknown>;

export interface AdCopyInput {
  product: { brand?: string | null; name?: string | null; url?: string | null };
  brief?: Pick<ProductBrief, "bigIdea" | "sellingPoints"> | Partial<ProductBrief> | null;
  plan?: CampaignPlan | null;
  /** Creative-library platform ids (several may share a channel). */
  platforms: string[];
  /** Variants per channel, 3–5 (default 4). */
  count?: number;
  llm?: CopyLlm;
}

export const adCopySchema = z.object({
  channels: z
    .array(
      z.object({
        channel: z.string(),
        variants: z.array(z.object({ angle: z.string().catch(""), fields: z.record(z.string(), z.string()).catch({}) })).catch([]),
      })
    )
    .catch([]),
});

function facts(input: AdCopyInput) {
  const brand = input.product.brand?.trim() || "";
  const name = input.product.name?.trim() || input.plan?.productTitle || brand || "it";
  const big = input.plan?.bigIdea || input.brief?.bigIdea?.proposition || "";
  const points = (input.brief?.sellingPoints ?? []).slice(0, 4).map((p) => ({ claim: p.claim, benefit: p.benefit }));
  const promo = input.plan?.promo;
  const offer = promo?.pct ? `${promo.pct}% off${promo.code ? ` with code ${promo.code}` : ""}` : promo?.code ? `Use code ${promo.code}` : promo?.price ? `Now $${promo.price}` : "";
  const button = input.plan?.platforms[0]?.endCard.button || "Shop now";
  return { brand, name, big, points, offer, button, keywords: input.plan?.keywords?.slice(0, 8) ?? [] };
}

function groupChannels(platforms: string[]): Map<CopyChannel, string[]> {
  const by = new Map<CopyChannel, string[]>();
  for (const p of platforms) {
    const c = channelFor(p);
    by.set(c, [...(by.get(c) ?? []), p]);
  }
  return by;
}

export function adCopyPrompts(input: AdCopyInput): { system: string; user: string } {
  const f = facts(input);
  const n = clampCount(input.count);
  const channels = [...groupChannels(input.platforms).keys()];
  const specs = channels
    .map((c) => `- ${c} (${COPY_LIMITS[c].label}): ${COPY_LIMITS[c].fields.filter((x) => !x.fixed).map((x) => `${x.key} ≤ ${x.limit} chars`).join(", ")}; emoji: ${COPY_LIMITS[c].emoji.note}`)
    .join("\n");
  const system = `You are CreativeIntel's performance ad copywriter. Write paid-social ad copy that sells hard: concrete benefit first, real numbers from the facts, buyer language, a clear action. Output JSON only:
{"channels":[{"channel":"meta","variants":[{"angle":"short label","fields":{"primaryText":"…","headline":"…","description":"…"}}]}]}
RULES
- Exactly ${n} variants per channel, each a different angle (big idea, top benefit, proof/number, offer/urgency, objection buster).
- Stay inside each field's character limit — count characters; front-load the hook in the first 40 characters.
- Use only the facts given; never invent prices, discounts, ratings or awards.
- Follow each channel's emoji rule.
CHANNELS
${specs}`;
  const user = JSON.stringify({
    brand: f.brand,
    product: f.name,
    bigIdea: f.big,
    sellingPoints: f.points,
    offer: f.offer || null,
    cta: f.button,
    keywords: f.keywords,
    url: input.product.url ?? null,
  });
  return { system, user };
}

const clampCount = (n?: number) => Math.max(3, Math.min(5, Math.round(n ?? 4)));

/** Deterministic copy from the brief + plan (model failure, or padding to the requested count). */
export function scaffoldVariants(channel: CopyChannel, input: AdCopyInput, count: number): Record<string, string>[] {
  const f = facts(input);
  const p0 = f.points[0];
  const p1 = f.points[1] ?? p0;
  const lead = [f.brand, f.name].filter(Boolean).join(" ").trim() || f.name;
  const angles: { angle: string; body: string; head: string; desc: string }[] = [
    { angle: "big idea", body: `${f.big || `Meet ${lead}`}. ${p0 ? `${p0.benefit}.` : ""} ${f.button}.`, head: f.big || lead, desc: p0?.benefit || f.button },
    { angle: "top benefit", body: p0 ? `${p0.claim}. ${p0.benefit}. ${f.button}.` : `${lead}: built to impress. ${f.button}.`, head: p0?.benefit || lead, desc: p0?.claim || f.button },
    { angle: "proof", body: p1 ? `${p1.claim} — ${p1.benefit}. See why buyers switch to ${f.name}.` : `See why buyers switch to ${f.name}.`, head: p1?.claim || `Why ${f.name}`, desc: "See why buyers switch" },
    { angle: "offer", body: f.offer ? `${f.offer} on ${f.name}. ${p0?.benefit ?? ""} Don't miss it.` : `${f.name} is in stock now. ${p0?.benefit ?? ""} Get yours today.`, head: f.offer || `Get ${f.name} today`, desc: f.offer || "Get yours today" },
    { angle: "objection buster", body: `${p1?.benefit ?? "Made to last"}. ${f.name} by ${f.brand || "us"} — ${f.button.toLowerCase()} and see for yourself.`, head: `${f.name}, done right`, desc: p1?.benefit || "See for yourself" },
  ];
  return angles.slice(0, count).map((a) => {
    const body = a.body.replace(/\s+/g, " ").replace(/\.\s*\./g, ".").trim();
    const map: Record<CopyChannel, Record<string, string>> = {
      meta: { primaryText: body, headline: a.head, description: a.desc },
      tiktok: { adText: body },
      youtube: { headline: f.button, longHeadline: a.head, description: body },
      demand_gen: { headline: a.head, description: body },
      pinterest: { title: `${a.head} | ${f.name}`, description: `${body} ${f.keywords.join(" · ")}`.trim() },
      snapchat: { headline: a.head, brandName: f.brand || f.name },
    };
    return { angle: a.angle, ...map[channel] };
  });
}

/** The default copy model call (export-pack runs it under the spend guard). */
export const defaultAdCopyLlm: CopyLlm = async ({ system, user }) => {
  const { analyzeWithClaude } = await import("@/services/ai/claude-client");
  return analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: adCopySchema, maxTokens: 3000 });
};

/** 3–5 copy variants per channel in one model call, limits enforced; the scaffold covers gaps. */
export async function generateAdCopy(input: AdCopyInput): Promise<AdCopySet[]> {
  const count = clampCount(input.count);
  const groups = groupChannels(input.platforms);
  let raw: z.infer<typeof adCopySchema> = { channels: [] };
  let llmOk = false;
  if (groups.size) {
    try {
      const { system, user } = adCopyPrompts(input);
      raw = adCopySchema.parse((await (input.llm ?? defaultAdCopyLlm)({ system, user })) ?? {});
      llmOk = true;
    } catch (err) {
      console.warn("[ad-copy] model copy failed, using the scaffold:", err instanceof Error ? err.message.slice(0, 200) : err);
    }
  }
  const brand = input.product.brand?.trim() || undefined;
  return [...groups.entries()].map(([channel, platforms]) => {
    const fromModel = (raw.channels.find((c) => c.channel.toLowerCase() === channel)?.variants ?? []).filter((v) => COPY_LIMITS[channel].fields.some((f) => !f.fixed && v.fields[f.key]?.trim()));
    const scaffold = scaffoldVariants(channel, input, count);
    const variants: AdCopyVariant[] = [];
    for (let i = 0; i < count; i++) {
      const m = fromModel[i];
      const s = scaffold[i] ?? scaffold[0];
      const merged = { ...s, ...(m ? Object.fromEntries(Object.entries(m.fields).filter(([, v]) => v?.trim())) : {}) };
      const { fields, truncated } = enforceCopy(channel, merged, { brand });
      variants.push({ angle: m?.angle || s.angle || `variant ${i + 1}`, fields, truncated });
    }
    return { channel, label: COPY_LIMITS[channel].label, platforms, source: llmOk && fromModel.length ? "llm" : "scaffold", variants };
  });
}
