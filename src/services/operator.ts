/**
 * Operator actions for /api/worker/operator: the same steps a user takes in
 * the Studio (approve a storyboard's frames, compile a render, approve it),
 * callable with the worker token when no browser is available. A run that
 * spends money is refused unless the call carries allowPaid and a creditCap
 * covering its estimate (only on the user's explicit go-ahead).
 */
import { z } from "zod";
import { appendFrameHistory } from "@/services/creative-library";
import { LOCALES } from "@/services/video-gen/localize";

export const operatorActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve-frames"), projectId: z.string().min(1), storyboardId: z.string().min(1) }),
  z.object({
    action: z.literal("compile-run"),
    projectId: z.string().min(1),
    storyboardId: z.string().min(1),
    scriptId: z.string().min(1).nullable().optional(),
    imageModel: z.string().min(1),
    videoModel: z.string().min(1),
    clipDurationSec: z.number().int().positive().max(20).optional(),
    aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5", "4:3", "3:4"]).optional(),
    budgetMode: z.enum(["economy", "full"]).optional(),
    allowOverBudget: z.boolean().optional(),
    holdVideos: z.boolean().optional(),
  }),
  /** Store a prepared image (composite, reference, end card) and return its URL. */
  z.object({
    action: z.literal("upload-asset"),
    projectId: z.string().min(1),
    filename: z.string().min(1).max(120),
    // video/mp4: a clip rendered from official product photos that replaces a generated clip.
    contentType: z.enum(["image/jpeg", "image/png", "video/mp4"]),
    base64: z.string().min(10).max(5_000_000),
  }),
  /**
   * Import an approved script as a locked storyboard; creates the project and its brand kit
   * (packshots, logo) when `project` is given instead of `projectId`.
   */
  z.object({
    action: z.literal("import-script"),
    projectId: z.string().min(1).optional(),
    templateProjectId: z.string().min(1).optional(),
    project: z
      .object({ name: z.string().min(1), brandName: z.string().min(1), productName: z.string().min(1), productUrl: z.string().url().optional() })
      .optional(),
    packshots: z.array(z.object({ url: z.string().url(), variant: z.string().optional() })).max(6).optional(),
    logoUrl: z.string().url().optional(),
    storyboard: z.object({ title: z.string().min(1), frames: z.array(z.record(z.string(), z.unknown())).min(1).max(30) }),
  }),
  /** Release the held clips of a keyframe-review run and start rendering them. */
  z.object({ action: z.literal("release-videos"), projectId: z.string().min(1), runId: z.string().min(1) }),
  z.object({ action: z.literal("reassemble-run"), projectId: z.string().min(1), runId: z.string().min(1) }),
  /** Tick an approved server run now instead of waiting for the 5-minute cron (no new spend beyond what was approved). */
  z.object({ action: z.literal("drive-run"), projectId: z.string().min(1), runId: z.string().min(1) }),
  z.object({ action: z.literal("director-review"), projectId: z.string().min(1), runId: z.string().min(1) }),
  /** Extract the sp-1 product brief (selling points → proof visuals, keywords, objections) and store it on the project. strictCompliance adds the legal layer. */
  z.object({
    action: z.literal("product-brief"),
    projectId: z.string().min(1),
    reviews: z.array(z.object({ stars: z.number(), text: z.string() })).max(300).optional(),
    qa: z.array(z.object({ q: z.string(), a: z.string() })).max(50).optional(),
    specs: z.record(z.string(), z.string()).optional(),
    price: z.number().nullable().optional(),
    listPrice: z.number().nullable().optional(),
    rating: z.number().nullable().optional(),
    reviewCount: z.number().nullable().optional(),
    keywordData: z.record(z.string(), z.array(z.string())).optional(),
    platforms: z.array(z.string()).max(12).optional(),
    durationSec: z.number().int().min(6).max(60).optional(),
    strictCompliance: z.boolean().optional(),
  }),
  /**
   * Plan the campaign from the stored brief: per platform 3 hook variants, end card, timed beat map
   * and a script per hook variant (one text-model call per platform). Stored on Project.campaignPlan;
   * the script writer then follows it. Needs product-brief first.
   */
  z.object({
    action: z.literal("plan-campaign"),
    projectId: z.string().min(1),
    platforms: z.array(z.string().min(1)).max(12).optional(),
    goal: z.string().max(80).optional(),
    promo: z.object({ pct: z.number().nullable().optional(), price: z.number().nullable().optional(), comparePrice: z.number().nullable().optional(), priceCheckedAt: z.string().nullable().optional(), code: z.string().nullable().optional(), deadline: z.string().nullable().optional() }).optional(),
    runDate: z.string().optional(),
    durationSec: z.number().int().min(5).max(90).optional(),
    strictCompliance: z.boolean().optional(),
    /** Studio choices: { [platform]: { hookIds?: string[] (≤ 3, lead the auto picks), endCardId? } }. */
    overrides: z.record(z.string(), z.unknown()).optional(),
  }),
  /** Turn a stored campaign-plan script into a locked storyboard (refs, cast lock, zooms, anchoring, end card decided in code; one model call writes the prompts). */
  z.object({
    action: z.literal("plan-to-storyboard"),
    projectId: z.string().min(1),
    platform: z.string().optional(),
    hookId: z.string().optional(),
    cast: z.string().max(400).optional(),
    setting: z.string().max(300).optional(),
    engine: z.enum(["kling", "veo", "veo1080"]).optional(),
    ctaButton: z.string().max(40).optional(),
  }),
  /** Pick 3 diverse opening hooks + an end card for category × platform × goal (category defaults to the stored brief). */
  z.object({
    action: z.literal("select-creative"),
    projectId: z.string().min(1).optional(),
    category: z.string().optional(),
    platform: z.string().min(1),
    goal: z.enum(["cold", "retarget", "promo", "awareness", "app_install", "lead"]),
    promo: z.object({ pct: z.number().nullable().optional(), price: z.number().nullable().optional(), comparePrice: z.number().nullable().optional(), priceCheckedAt: z.string().nullable().optional(), code: z.string().nullable().optional(), deadline: z.string().nullable().optional() }).optional(),
    assets: z.object({ creatorFootage: z.boolean().optional(), realTestFootage: z.boolean().optional(), rating: z.object({ value: z.number(), count: z.number() }).nullable().optional(), multiSku: z.boolean().optional() }).optional(),
    runDate: z.string().optional(),
    ctv: z.boolean().optional(),
    strictCompliance: z.boolean().optional(),
  }),
  z.object({ action: z.literal("save-structure"), projectId: z.string().min(1), teardownId: z.string().min(1) }),
  z.object({ action: z.literal("choose-structure"), projectId: z.string().min(1), structureId: z.string().min(1).nullable() }),
  z.object({
    action: z.literal("rerender-shots"),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    /** Default: the shots the AI director flagged. */
    shotIndexes: z.array(z.number().int().min(0)).optional(),
  }),
  z.object({
    action: z.literal("render-export"),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    format: z.enum(["4:5", "1:1", "16:9", "15s", "10s"]),
  }),
  z.object({
    action: z.literal("render-variant"),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    hookStyle: z.enum(["q", "c", "p"]),
    hookText: z.string().max(80).optional(),
  }),
  /** Batch Mode: variant matrix (hooks × end cards × CTA × voice × music × aspect × duration) + cost, kept on qcReport.batches. */
  z.object({
    action: z.literal("plan-batch"),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    dims: z.object({ hooks: z.array(z.string()).max(12).optional(), endCards: z.array(z.string()).max(12).optional(), ctas: z.array(z.string().max(40)).max(8).optional(), voices: z.array(z.string()).max(8).optional(), musicMoods: z.array(z.string()).max(4).optional(), aspects: z.array(z.enum(["9:16", "4:5", "1:1", "16:9"])).max(4).optional(), durations: z.array(z.number().int().min(5).max(60)).max(6).optional() }).default({}),
    maxVariants: z.number().int().min(1).max(200).default(24),
    design: z.enum(["pairwise", "full"]).default("pairwise"),
  }),
  /** Render the next free re-edit variants of a planned batch (never generates new hook clips). */
  z.object({ action: z.literal("render-batch"), projectId: z.string().min(1), runId: z.string().min(1), batchId: z.string().min(1), limit: z.number().int().min(1).max(10).default(1) }),
  /** Export pack: videos + thumbnails, per-platform ad copy, Meta/TikTok bulk CSVs, README, manifest (+ zip). */
  z.object({ action: z.literal("export-pack"), projectId: z.string().min(1), runId: z.string().min(1), platforms: z.array(z.string()).max(12).optional() }),
  /** Ad Cloner: a winning ad's structure (stored teardown or saved structure) for our product → Project.campaignPlan "Cloned from <ref>". */
  z.object({ action: z.literal("clone-ad"), projectId: z.string().min(1), teardownId: z.string().min(1).optional(), structureId: z.string().min(1).optional(), platform: z.string().min(1).optional(), goal: z.string().max(80).optional() }),
  /** Localized versions of a finished master (same clips; translated VO, captions, text, end card). Renders in the background. */
  z.object({ action: z.literal("localize-run"), projectId: z.string().min(1), runId: z.string().min(1), locales: z.array(z.enum(LOCALES)).min(1).max(LOCALES.length), gender: z.enum(["male", "female"]).optional(), force: z.boolean().optional() }),
  z.object({
    action: z.literal("approve-run"),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    /**
     * Spend on a paid server render (Matrix, paid Zhipu). Only with the user's
     * explicit go-ahead for this run, and never above `creditCap`.
     */
    allowPaid: z.boolean().optional(),
    creditCap: z.number().int().positive().optional(),
  }),
  /** Performance Agent: answer a question from the aggregated results table (one text-model call). */
  z.object({ action: z.literal("perf-ask"), projectId: z.string().min(1), question: z.string().min(3).max(500) }),
  /** Test-plan strategist: structure, phases, power-sized round 1, kill/scale rules → Project.testPlan. Needs plan-campaign first. */
  z.object({
    action: z.literal("test-plan"),
    projectId: z.string().min(1),
    totalBudget: z.number().positive(),
    days: z.number().int().min(1).max(120),
    goal: z.string().max(40).optional(),
    platforms: z.array(z.string().min(1)).max(12).optional(),
    baseline: z.record(z.string(), z.object({ cpm: z.number().positive(), ctr: z.number().gt(0).lt(1), cvr: z.number().gt(0).lt(1), hookRate: z.number().gt(0).lt(1) }).partial()).optional(),
    targetCpa: z.number().positive().optional(),
    targetLift: z.number().gt(0).max(5).optional(),
    maxVariants: z.number().int().min(2).max(20).optional(),
    narrative: z.boolean().optional(),
  }),
  /** Line-item cost forecast (low / expected / high, QC rerolls included) of a compiled run or a storyboard — before approving spend. */
  z.object({ action: z.literal("estimate-run"), projectId: z.string().min(1), runId: z.string().min(1).optional(), storyboardId: z.string().min(1).optional(), imageModel: z.string().min(1).optional(), videoModel: z.string().min(1).optional(), clipDurationSec: z.number().int().positive().max(20).optional() }),
  /** Owner-approved USD cap for the project, or one run (runId); null removes it. Paid calls past it are refused before the provider is called. */
  z.object({ action: z.literal("set-budget"), projectId: z.string().min(1), runId: z.string().min(1).optional(), usd: z.number().nonnegative().max(10_000).nullable() }),
  /** Spend ledger totals by kind / model / run (since an ISO date). */
  z.object({ action: z.literal("spend-report"), projectId: z.string().min(1), since: z.string().min(4).optional() }),
  /** Client report (HTML + DOCX), uploaded; returns both URLs. narrative "template" skips the LLM summary. */
  z.object({ action: z.literal("campaign-report"), projectId: z.string().min(1), narrative: z.enum(["llm", "template"]).optional() }),
]);

export type OperatorAction = z.infer<typeof operatorActionSchema>;

/** Approve every frame, keeping each changed frame's prior state in the history — as PATCH …/frames does. */
export function approveAllFrames(
  frames: Array<Record<string, unknown>>,
  history: unknown
): { frames: Array<Record<string, unknown>>; history: unknown; approved: number } {
  let approved = 0;
  let next = history;
  const out = frames.map((f) => {
    if (f.approved === true) return f;
    next = appendFrameHistory(next, f.frameNumber as number, f);
    approved++;
    return { ...f, approved: true };
  });
  return { frames: out, history: next, approved };
}

/** Why the operator may not approve this run, or null when it's a free server render. */
export function freeRunRefusal(
  run: { executor: string | null; creditsEstimated: number; status: string },
  isServerEngine: boolean,
  paid: { allowPaid?: boolean; creditCap?: number } = {}
): string | null {
  if (!isServerEngine) return `Only server renders can be approved here (executor ${run.executor ?? "none"}) — approve LibTV runs in the Studio.`;
  if (run.creditsEstimated > 0) {
    if (!paid.allowPaid) return `This run is estimated at ${run.creditsEstimated} credits — approve it in the Studio, or pass allowPaid with a creditCap.`;
    if (!paid.creditCap || paid.creditCap < run.creditsEstimated) {
      return `This run is estimated at ${run.creditsEstimated} credits — a creditCap of at least that is required.`;
    }
  }
  return null;
}
