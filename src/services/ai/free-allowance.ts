/**
 * What Zhipu's free models actually allow — researched 2026-09-25 from
 * docs.bigmodel.cn (the raw Markdown of each page). Numbers not published by
 * Zhipu are recorded as "not published", never guessed.
 *
 * Sources:
 *  - Pricing table (all four free models listed as 免费 / free):
 *      https://docs.bigmodel.cn/cn/guide/start/pricing
 *  - GLM-4.7-Flash: context 200K, max output 128K ("上下文窗口 200K / 最大输出 Tokens 128K"):
 *      https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash
 *  - GLM-4.6V-Flash: context 128K, max output 32K ("免费模型，支持视觉推理 | 128K | 32K"):
 *      https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash
 *      https://docs.bigmodel.cn/cn/guide/start/model-overview
 *  - CogView-3-Flash: standard quality "耗时约5-10秒", hd "约20秒"; image link valid 30 days:
 *      https://docs.bigmodel.cn/api-reference/模型-api/图像生成
 *      https://docs.bigmodel.cn/cn/guide/models/free/cogview-3-flash
 *  - CogVideoX-Flash: sizes up to 3840x2160, fps 30/60, prompt ≤ 512 chars, watermarked by default;
 *    the request schema has no `duration` parameter, so clip length is not published:
 *      https://docs.bigmodel.cn/api-reference/模型-api/视频生成异步
 *      https://docs.bigmodel.cn/cn/guide/models/free/cogvideox-flash
 *  - Rate limits are concurrency limits set per model and per account tier
 *    ("速率限制主要体现在：并发请求数限制 / 不同模型设有独立的并发限制"); error 1302 = account
 *    limit hit, 1305 = platform overloaded. The per-model numbers for the free models are
 *    NOT published in the docs — only on the logged-in console page:
 *      https://docs.bigmodel.cn/cn/api/rate-limit
 *      https://bigmodel.cn/usercenter/proj-mgmt/rate-limits
 *  - Tiers V0–V3 by points from cash spend (V0 < 2,000 points):
 *      https://docs.bigmodel.cn/cn/guide/platform/equity-explain
 *  - The only published concurrency table is for PAID video (CogVideoX-3, ViduQ1):
 *    V0=5, V1=10, V2=15, V3=20 tasks in flight.
 *  - Paid video prices: CogVideoX-3 1 元/次 (5 s or 10 s); ViduQ1 2.5 元/次 (5 s, 1080P):
 *      https://docs.bigmodel.cn/cn/guide/models/video-generation/cogvideox-3
 *      https://docs.bigmodel.cn/cn/guide/models/video-generation/viduq1
 *  - Terms: the platform may limit free services' frequency and data volume, or change/end them:
 *      https://docs.bigmodel.cn/cn/terms/user-agreement
 *  - Daily token/clip caps for the free models: not published.
 *  - Video generation time: not published (for any model).
 */

export interface SourcedFact {
  label: string;
  value: string;
  source: string;
}

export interface FreeModelFacts {
  model: string;
  capability: "text" | "vision" | "image" | "video";
  facts: SourcedFact[];
}

const PRICING = "https://docs.bigmodel.cn/cn/guide/start/pricing";
const RATE_LIMIT = "https://docs.bigmodel.cn/cn/api/rate-limit";

export const FREE_MODEL_FACTS: FreeModelFacts[] = [
  {
    model: "glm-4.7-flash",
    capability: "text",
    facts: [
      { label: "Price", value: "Free (input and output)", source: PRICING },
      { label: "Context / max output", value: "200K / 128K tokens", source: "https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash" },
      { label: "Daily token cap", value: "Not published", source: RATE_LIMIT },
      { label: "Concurrency", value: "Per-model limit, number not published", source: RATE_LIMIT },
    ],
  },
  {
    model: "glm-4.6v-flash",
    capability: "vision",
    facts: [
      { label: "Price", value: "Free", source: PRICING },
      { label: "Context / max output", value: "128K / 32K tokens", source: "https://docs.bigmodel.cn/cn/guide/start/model-overview" },
      { label: "Concurrency", value: "Per-model limit, number not published", source: RATE_LIMIT },
    ],
  },
  {
    model: "cogview-3-flash",
    capability: "image",
    facts: [
      { label: "Price", value: "Free", source: PRICING },
      { label: "Time per image", value: "About 5–10 s (standard quality)", source: "https://docs.bigmodel.cn/api-reference/模型-api/图像生成" },
      { label: "Concurrency", value: "Per-model limit, number not published", source: RATE_LIMIT },
    ],
  },
  {
    model: "cogvideox-flash",
    capability: "video",
    facts: [
      { label: "Price", value: "Free, watermarked by default", source: PRICING },
      { label: "Output", value: "Up to 3840×2160, 30 or 60 fps; clip length not published", source: "https://docs.bigmodel.cn/api-reference/模型-api/视频生成异步" },
      { label: "Generation time", value: "Not published", source: "https://docs.bigmodel.cn/api-reference/模型-api/视频生成异步" },
      { label: "Concurrency", value: "Per-model limit, number not published (see your console)", source: "https://bigmodel.cn/usercenter/proj-mgmt/rate-limits" },
    ],
  },
];

/** CogView-3-Flash standard quality, as published: "耗时约5-10秒". */
export const COGVIEW_SECONDS_PER_IMAGE = { min: 5, max: 10 } as const;

/**
 * Clip length the app assumes for CogVideoX-Flash (the Studio catalogue's
 * default). Zhipu does not publish the Flash clip length.
 */
export const ASSUMED_FLASH_CLIP_SECONDS = 5;

/**
 * The app's own cap on CogVideoX-Flash tasks in flight (glm-executor.ts
 * MAX_VIDEOS_IN_FLIGHT) — the effective concurrency while Zhipu's number for
 * the free model is unpublished.
 */
export const APP_VIDEO_CONCURRENCY = 2;

/** An ESTIMATE: items per hour at a given concurrency and time per item. */
export function estimateHourlyCeiling(input: {
  concurrency: number;
  secondsPerItem: number | null;
  secondsOfVideoPerItem?: number;
}): { itemsPerHour: number | null; videoMinutesPerHour: number | null } {
  const { concurrency, secondsPerItem, secondsOfVideoPerItem } = input;
  if (!secondsPerItem || secondsPerItem <= 0 || concurrency <= 0) {
    return { itemsPerHour: null, videoMinutesPerHour: null };
  }
  const itemsPerHour = Math.floor((concurrency * 3600) / secondsPerItem);
  return {
    itemsPerHour,
    videoMinutesPerHour: secondsOfVideoPerItem ? (itemsPerHour * secondsOfVideoPerItem) / 60 : null,
  };
}
