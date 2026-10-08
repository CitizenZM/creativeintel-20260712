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
import { PLATFORM_PROFILES } from "@/services/creative/platforms.data";

const PLATFORM_IDS = PLATFORM_PROFILES.map((p) => p.id) as [string, ...string[]];

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
    /** AI presenter: true = pick a persona (platform × category × audience), or a persona id (services/creative/personas.ts). */
    presenter: z.union([z.boolean(), z.string().min(1).max(60)]).optional(),
    /** Presenter casting override, e.g. { ethnicities: ["white", "latino"] } (null = anyone); default: project → brand → env → white/Latino. */
    casting: z.object({ ethnicities: z.array(z.string().max(20)).max(6).nullable() }).optional(),
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
  /** Static image ad set (templates × formats) from the brief + plan, rendered locally, uploaded, kept on Project.imageAdSets. */
  z.object({ action: z.literal("image-ads"), projectId: z.string().min(1), templates: z.array(z.string()).max(12).optional(), formats: z.array(z.string()).max(12).optional(), promo: z.object({ pct: z.number().nullable().optional(), price: z.number().nullable().optional(), comparePrice: z.number().nullable().optional(), currency: z.string().nullable().optional(), code: z.string().nullable().optional(), deadline: z.string().nullable().optional(), label: z.string().max(40).nullable().optional() }).optional(), proof: z.object({ rating: z.number().min(0).max(5).nullable().optional(), reviewCount: z.number().int().nullable().optional(), quote: z.string().max(240).nullable().optional(), author: z.string().max(60).nullable().optional() }).optional(), copy: z.record(z.string(), z.string().max(160)).optional(), productUrl: z.string().url().optional(), beforeUrl: z.string().url().optional() }),
  /** Pre-flight creative score of a run's master (thumb-stop predictor, no spend) → qcReport.preflight. */
  z.object({ action: z.literal("preflight"), projectId: z.string().min(1), runId: z.string().min(1), platform: z.string().max(40).optional(), goal: z.string().max(40).optional() }),
  /** Hook trend report: competitor/category openings → rising / saturated hooks, examples, recommendations. llm: batch the unsure openings (≤ 40 per call). */
  z.object({ action: z.literal("hook-trends"), projectId: z.string().min(1), category: z.string().max(80).optional(), platform: z.string().max(60).optional(), windowDays: z.number().int().min(7).max(180).optional(), llm: z.boolean().optional() }),
  /** Auto-iteration: propose the next test round (keep / kill / explore / retest / cutdowns + cost) → Project.nextRound. Never renders or spends. */
  z.object({ action: z.literal("next-round"), projectId: z.string().min(1), platform: z.string().max(60).optional() }),
  /** URL-to-Video Autopilot: url | projectId → finished ad. Stops at awaiting_approval unless approvedBudgetUsd covers the high forecast. */
  z.object({ action: z.literal("autopilot-start"), url: z.string().url().optional(), projectId: z.string().min(1).optional(), platforms: z.array(z.string().min(1)).max(12).optional(), platform: z.string().optional(), goal: z.string().max(80).optional(), promo: z.object({ pct: z.number().nullable().optional(), price: z.number().nullable().optional(), comparePrice: z.number().nullable().optional(), priceCheckedAt: z.string().nullable().optional(), code: z.string().nullable().optional(), deadline: z.string().nullable().optional() }).optional(), hookId: z.string().optional(), cast: z.string().max(400).optional(), setting: z.string().max(300).optional(), ctaButton: z.string().max(40).optional(), durationSec: z.number().int().min(5).max(90).optional(), approvedBudgetUsd: z.number().nonnegative().max(10_000).optional(), imageModel: z.string().min(1).optional(), videoModel: z.string().min(1).optional(), engine: z.enum(["kling", "veo", "veo1080"]).optional(), narrative: z.enum(["llm", "template"]).optional() }).refine((v) => !!(v.url || v.projectId), { message: "url or projectId required" }),
  z.object({ action: z.literal("autopilot-approve"), autopilotId: z.string().min(1), approvedBudgetUsd: z.number().nonnegative().max(10_000) }),
  z.object({ action: z.literal("autopilot-status"), autopilotId: z.string().min(1), retry: z.boolean().optional() }),
  /** Creative Agent: one chat instruction → validated edit ops applied to the stored plan (or a storyboard's frames); undo restores the previous version. */
  z.object({ action: z.literal("creative-agent"), projectId: z.string().min(1), message: z.string().min(2).max(2000), storyboardId: z.string().min(1).optional() }),
  z.object({ action: z.literal("creative-agent-undo"), projectId: z.string().min(1) }),
  /** Cover frames (9:16 / 1:1 / 4:5) for the master and each variant / export without them (all with force) → qcReport.covers. */
  z.object({ action: z.literal("covers"), projectId: z.string().min(1), runId: z.string().min(1), force: z.boolean().optional() }),
  /** Pre-flight auto-fix: one free re-edit with the corrections for fixable QC / pre-flight issues → qcReport.autofix. */
  z.object({ action: z.literal("auto-fix"), projectId: z.string().min(1), runId: z.string().min(1), platform: z.enum(PLATFORM_IDS).optional() }),
  /** Ops health: stuck runs / jobs, failing engines, broken renders, spend anomalies, cron heartbeats (read-only). */
  z.object({ action: z.literal("ops-health") }),
  /** Safe auto-recovery (re-drive, re-assemble, release orphaned reservations, re-queue provider-failed tasks); dry run by default. */
  z.object({ action: z.literal("ops-recover"), dryRun: z.boolean().default(true) }),
  /** Packshot repair of a server run's keyframe (local composite, no spend): returns the repaired image; apply swaps it in as the job's result. */
  z.object({ action: z.literal("repair-keyframe"), projectId: z.string().min(1), runId: z.string().min(1), node: z.string().regex(/^K\d+E?$/), bbox: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]).optional(), packshotUrl: z.string().url().optional(), reason: z.string().max(200).optional(), apply: z.boolean().optional() }),
  /** Catalog ads: import a product feed (Shopify products.json, Google Merchant XML/TSV, Meta CSV, generic CSV) → CatalogRun. Free. */
  z.object({ action: z.literal("catalog-import"), projectId: z.string().min(1), feedUrl: z.string().url().optional(), feedText: z.string().min(1).max(15_000_000).optional(), format: z.enum(["shopify", "google-xml", "google-tsv", "meta-csv", "generic-csv"]).optional(), currency: z.string().length(3).optional() }),
  /** Plan a CatalogRun: image (free) | video-template (one paid first render per category) | video-full (estimate only, never compiles). */
  z.object({ action: z.literal("catalog-plan"), projectId: z.string().min(1), catalogRunId: z.string().min(1), mode: z.enum(["image", "video-template", "video-full"]), platforms: z.array(z.string().min(1)).max(12).optional(), goal: z.string().max(80).optional(), promo: z.object({ pct: z.number().nullable().optional(), code: z.string().max(40).nullable().optional(), deadline: z.string().nullable().optional(), label: z.string().max(40).nullable().optional() }).optional(), maxSkus: z.number().int().min(1).max(500).optional(), templates: z.array(z.string()).max(12).optional(), formats: z.array(z.string()).max(12).optional() }),
  /** Render the next image-mode SKUs locally (sharp + pango, $0) and upload them; call again to continue. */
  z.object({ action: z.literal("catalog-render-images"), projectId: z.string().min(1), catalogRunId: z.string().min(1), limit: z.number().int().min(1).max(20).optional(), formats: z.array(z.string()).max(12).optional() }),
  /** Media-plan strategy agent: cross-platform allocation, forecasts, pacing, creative needs, measurement, scenarios → Project.mediaPlan. Never spends (narrative: one optional text call). */
  z.object({ action: z.literal("media-plan"), projectId: z.string().min(1), goal: z.enum(["sales", "leads", "awareness", "app_installs"]), totalBudget: z.number().positive().max(10_000_000), flightStart: z.string().min(8).max(30), flightEnd: z.string().min(8).max(30), targetCpa: z.number().positive().optional(), targetRoas: z.number().positive().optional(), aov: z.number().positive().optional(), markets: z.array(z.string().min(2).max(3)).max(20).optional(), channels: z.array(z.string().min(1)).max(8).optional(), baseline: z.record(z.string(), z.object({ cpm: z.number().positive(), ctr: z.number().gt(0).lt(1), cvr: z.number().gt(0).lt(1), hookRate: z.number().gt(0).lt(1) }).partial()).optional(), allowProxyEvent: z.boolean().optional(), maxChannels: z.number().int().min(1).max(8).optional(), narrative: z.boolean().optional() }),
  /** Weekly digest payload (subject, markdown, HTML email body, Feishu card) for a project — built, not sent. */
  z.object({ action: z.literal("report-preview"), projectId: z.string().min(1), since: z.string().min(4).optional(), channel: z.enum(["feishu-dm", "email", "webhook"]).optional() }),
  /** Read or set Project.reportDelivery {enabled, channel, target, schedule}. Sending also needs REPORT_DELIVERY_SEND=on; Feishu goes to an open_id only. */
  z.object({ action: z.literal("report-delivery-config"), projectId: z.string().min(1), config: z.object({ enabled: z.boolean().optional(), channel: z.enum(["feishu-dm", "email", "webhook"]).optional(), target: z.string().min(3).max(500).optional(), schedule: z.enum(["weekly", "manual"]).optional() }).optional() }),
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

export type OperatorActionOf<A extends OperatorAction["action"]> = Extract<OperatorAction, { action: A }>;

/**
 * Validate a session route's body with the operator schema of one action, so the Studio routes and
 * the worker operator accept exactly the same input. The route supplies projectId / runId from its path.
 */
export function parseOperatorAction<A extends OperatorAction["action"]>(
  action: A,
  input: Record<string, unknown>
): { ok: true; data: OperatorActionOf<A> } | { ok: false; error: string; issues: z.core.$ZodIssue[] } {
  const parsed = operatorActionSchema.safeParse({ ...input, action });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first ? `Invalid ${first.path.join(".") || "input"}: ${first.message}` : "Invalid input", issues: parsed.error.issues };
  }
  return { ok: true, data: parsed.data as OperatorActionOf<A> };
}
