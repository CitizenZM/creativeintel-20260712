/**
 * Production step functions for the autopilot engine — each wraps the same service the matching
 * operator action calls (product-page scrape, product-brief, plan-campaign, plan-to-storyboard,
 * estimate-run, compile-run, set-budget + approve-run, drive-run, preflight, campaign-report).
 *
 * Idempotency: every row a step creates is either reserved first (its id saved in state before the
 * insert, then looked up on a retry) or found by what links it to this autopilot (the run compiled
 * from this autopilot's storyboard), so re-running a step never duplicates a project, storyboard or run.
 */
import { prisma } from "@/lib/db";
import { brandFromUrl, newRowId, parsePrice } from "./helpers";
import { AutopilotFatalError, type AutopilotForecast, type AutopilotSteps, type StepContext, type StepOutcome } from "./types";

const money = (n: number) => Math.ceil(n * 100) / 100;
const asMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const MAX_RENDER_MS = 24 * 3600_000;

/**
 * A paid model call of a step before the budget gate (brief, plan, storyboard): reserved in the spend
 * ledger under the project, so it shows up there, and refused when the project's budget can't cover it
 * (fatal: retrying can't help until the owner raises it — then autopilot-status retry).
 */
async function guardedStepCall<T>(projectId: string, est: { inTokens: number; outTokens: number }, call: () => Promise<T>): Promise<T> {
  const [{ guardLlm }, { isBudgetExceeded }] = await Promise.all([import("@/services/ops/spend"), import("@/services/ops/budget-guard")]);
  try {
    return await guardLlm({ projectId, kind: "llm" }, est, call);
  } catch (err) {
    if (isBudgetExceeded(err)) throw new AutopilotFatalError(err.message);
    throw err;
  }
}

function requireProject(ctx: StepContext): string {
  if (!ctx.state.projectId) throw new AutopilotFatalError("No project yet — the scrape step did not record one");
  return ctx.state.projectId;
}

/** The scraped product images as unverified packshots when the kit has none (compile needs one). */
async function seedPackshots(projectId: string, images: { url: string }[], landingUrl: string | null) {
  const kit = await prisma.brandKit.upsert({ where: { projectId }, create: { projectId, landingUrl }, update: {}, select: { id: true } });
  const has = await prisma.brandAsset.count({ where: { brandKitId: kit.id, kind: "PACKSHOT" } });
  if (has || !images.length) return has;
  const picks = images.filter((i) => /^https?:\/\//.test(i.url)).slice(0, 2);
  for (const [k, img] of picks.entries()) {
    await prisma.brandAsset.create({ data: { brandKitId: kit.id, kind: "PACKSHOT", variant: k === 0 ? "front" : "side", url: img.url, provider: "url", verified: false, caption: "From the product page (autopilot)" } });
  }
  return picks.length;
}

const scrape = async (ctx: StepContext): Promise<StepOutcome> => {
  const { scrapeProductPageDetailed } = await import("@/services/research/product-page-scraper");
  const pageText = (d: { description: string; features: string[] }) => [d.description, ...d.features].filter(Boolean).join("\n\n") || null;

  if (ctx.state.projectId) {
    const project = await prisma.project.findUnique({ where: { id: ctx.state.projectId }, select: { id: true, productUrl: true, productPageTitle: true, productPageText: true, productPageImages: true } });
    if (!project) throw new AutopilotFatalError(`Project ${ctx.state.projectId} not found`);
    const images = (Array.isArray(project.productPageImages) ? project.productPageImages : []) as { url: string }[];
    if (project.productPageTitle || project.productPageText) {
      await seedPackshots(project.id, images, project.productUrl);
      return { kind: "done", state: { scrape: { adapter: null, title: project.productPageTitle, imageCount: images.length, price: null, reused: true } }, note: "product page already on the project" };
    }
    const url = ctx.input.url ?? project.productUrl;
    if (!url) throw new AutopilotFatalError("The project has no product page and no url was given");
    const outcome = await scrapeProductPageDetailed(url);
    if (!outcome.data) throw new Error(`Product page scrape failed: ${outcome.error ?? "no data"}`);
    const d = outcome.data;
    await prisma.project.update({
      where: { id: project.id },
      data: { productUrl: url, productPageTitle: d.title || null, productPageImages: d.images as never, productPageText: pageText(d), productName: d.title || undefined },
    });
    await seedPackshots(project.id, d.images, url);
    return { kind: "done", state: { scrape: { adapter: outcome.adapter, title: d.title || null, imageCount: d.images.length, price: parsePrice(d.price) } } };
  }

  const url = ctx.input.url;
  if (!url) throw new AutopilotFatalError("autopilot needs a url or projectId");
  // Reserve the project id first: a retry after a crash finds the project instead of creating another.
  const projectId = ctx.state.pendingProjectId ?? newRowId();
  if (!ctx.state.pendingProjectId) await ctx.save({ pendingProjectId: projectId });
  const existing = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, productPageImages: true } });
  if (existing) {
    await seedPackshots(existing.id, (Array.isArray(existing.productPageImages) ? existing.productPageImages : []) as { url: string }[], url);
    return { kind: "done", state: { projectId }, note: "project already created by an earlier attempt" };
  }
  const outcome = await scrapeProductPageDetailed(url);
  if (!outcome.data) throw new Error(`Product page scrape failed: ${outcome.error ?? "no data"}`);
  const d = outcome.data;
  const brandName = brandFromUrl(url, d.brand);
  const text = pageText(d);
  let origin: string | null = null;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = null;
  }
  await prisma.project.create({
    data: {
      id: projectId,
      name: `${d.title || brandName} — ${brandName}`.slice(0, 200),
      brandName,
      brandUrl: origin,
      productUrl: url,
      productName: d.title || null,
      productPageTitle: d.title || null,
      productPageImages: d.images as never,
      productPageText: text,
      campaignGoal: ctx.input.goal ?? null,
      brand: { create: { name: brandName, url: origin, productDescription: text?.slice(0, 2000) || null } },
      brandKit: { create: { landingUrl: url, productSummary: text?.slice(0, 1800) || null } },
    },
    select: { id: true },
  });
  await seedPackshots(projectId, d.images, url);
  await import("@/services/brand-kit").then((m) => m.refreshCompleteness(projectId)).catch(() => null);
  return { kind: "done", state: { projectId, scrape: { adapter: outcome.adapter, title: d.title || null, imageCount: d.images.length, price: parsePrice(d.price) } } };
};

const brief = async (ctx: StepContext): Promise<StepOutcome> => {
  const projectId = requireProject(ctx);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { brandName: true, productName: true, productUrl: true, productPageTitle: true, productPageText: true, productBrief: true },
  });
  if (!project) throw new AutopilotFatalError("Project not found");
  const stored = project.productBrief as { sellingPoints?: unknown[] } | null;
  if (Array.isArray(stored?.sellingPoints) && stored.sellingPoints.length) {
    return { kind: "done", state: { briefSellingPoints: stored.sellingPoints.length }, note: "reused the stored product brief" };
  }
  const title = project.productPageTitle || project.productName || "";
  if (!title && !project.productPageText) throw new AutopilotFatalError("No product page on this project");
  const { extractProductBrief } = await import("@/services/creative/product-brief");
  const text = project.productPageText ?? "";
  const made = await guardedStepCall(projectId, { inTokens: 2000 + Math.ceil(text.length / 4), outTokens: 3000 }, () => extractProductBrief(
    {
      url: project.productUrl,
      title,
      brand: project.brandName,
      bullets: text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 12 && l.length < 300).slice(0, 20),
      description: text,
      price: ctx.input.promo?.price ?? ctx.state.scrape?.price ?? null,
      listPrice: ctx.input.promo?.comparePrice ?? null,
      platforms: ctx.input.platforms,
    },
    { strictCompliance: process.env.CREATIVE_STRICT_COMPLIANCE === "true" }
  ));
  await prisma.project.update({ where: { id: projectId }, data: { productBrief: made as object, productBriefAt: new Date() } });
  return { kind: "done", state: { briefSellingPoints: made.sellingPoints.length } };
};

const plan = async (ctx: StepContext): Promise<StepOutcome> => {
  const projectId = requireProject(ctx);
  const { input } = ctx;
  const current = await prisma.project.findUnique({ where: { id: projectId }, select: { campaignPlan: true } });
  const existing = current?.campaignPlan as { platforms?: { platform: string }[] } | null;
  const asked = !!(input.platforms?.length || input.goal || input.promo);
  // A project's curated plan is kept unless this call asks for a different one.
  if (existing?.platforms?.length && !asked) {
    return { kind: "done", state: { plannedPlatforms: existing.platforms.map((p) => p.platform) }, note: "reused the stored campaign plan" };
  }
  const { createCampaignPlan, CampaignPlanError } = await import("@/services/creative/campaign-plan.store");
  try {
    const made = await guardedStepCall(projectId, { inTokens: 6000, outTokens: 6000 }, () => createCampaignPlan(projectId, { platforms: input.platforms, goal: input.goal, promo: input.promo }));
    return { kind: "done", state: { plannedPlatforms: made.platforms.map((p) => p.platform) } };
  } catch (err) {
    if (err instanceof CampaignPlanError && err.status < 500) throw new AutopilotFatalError(err.message);
    throw err;
  }
};

const storyboard = async (ctx: StepContext): Promise<StepOutcome> => {
  const projectId = requireProject(ctx);
  if (ctx.state.storyboardId) return { kind: "done", note: "storyboard already made" };
  const { input } = ctx;
  const sbId = ctx.state.pendingStoryboardId ?? newRowId();
  if (!ctx.state.pendingStoryboardId) await ctx.save({ pendingStoryboardId: sbId });
  const found = await prisma.storyboard.findUnique({ where: { id: sbId }, select: { id: true } });
  if (found) return { kind: "done", state: { storyboardId: sbId }, note: "storyboard created by an earlier attempt" };

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { campaignPlan: true, productName: true, name: true } });
  const stored = project?.campaignPlan as import("@/services/creative/campaign-plan.types").CampaignPlan | null;
  if (!stored?.platforms?.length) throw new AutopilotFatalError("No campaign plan — the plan step must run first");
  const { normalizePlatform } = await import("@/services/creative/campaign-planner");
  const want = input.platform ? normalizePlatform(input.platform) : input.platforms?.[0] ? normalizePlatform(input.platforms[0]) : null;
  const platformPlan = stored.platforms.find((p) => p.platform === want) ?? stored.platforms[0];
  const { directPlanStoryboard } = await import("@/services/creative/plan-to-storyboard");
  const out = await guardedStepCall(projectId, { inTokens: 4000, outTokens: 4000 }, () => directPlanStoryboard({
    plan: platformPlan,
    hookId: input.hookId,
    productName: project?.productName || project?.name || "product",
    cast: input.cast ?? stored.cast,
    setting: input.setting ?? stored.setting,
    engine: input.engine,
    ctaButton: input.ctaButton,
  }));
  await prisma.storyboard.create({
    data: { id: sbId, projectId, title: out.title, frames: out.frames as unknown as object[], style: "locked-script", frameSeconds: 1 },
    select: { id: true },
  });
  const hookId = input.hookId && platformPlan.scripts.some((s) => s.hookId === input.hookId) ? input.hookId : platformPlan.scripts[0]?.hookId;
  return { kind: "done", state: { storyboardId: sbId, platform: platformPlan.platform, hookId }, note: `${out.frames.length} frames (${out.source})` };
};

function forecastOf(body: Record<string, unknown>, source: AutopilotForecast["source"]): AutopilotForecast {
  const totals = (body.forecast as { totals?: { low: number; expected: number; high: number } } | undefined)?.totals;
  if (!totals) throw new Error("estimate returned no totals");
  return { lowUsd: money(totals.low), expectedUsd: money(totals.expected), highUsd: money(totals.high), recommendedBudgetUsd: Number(body.recommendedBudgetUsd ?? money(totals.high)), source };
}

const estimate = async (ctx: StepContext): Promise<StepOutcome> => {
  const projectId = requireProject(ctx);
  if (!ctx.state.storyboardId) throw new AutopilotFatalError("No storyboard to estimate");
  const { estimateRunAction } = await import("@/services/ops/operator-ops");
  const r = await estimateRunAction({ projectId, storyboardId: ctx.state.storyboardId, imageModel: ctx.input.imageModel, videoModel: ctx.input.videoModel });
  if (r.status !== 200) throw new Error(String(r.body.error ?? `estimate failed (${r.status})`));
  const forecast = forecastOf(r.body, "storyboard");
  return { kind: "done", state: { forecast }, note: `forecast $${forecast.lowUsd}–$${forecast.highUsd}` };
};

const compile = async (ctx: StepContext): Promise<StepOutcome> => {
  const projectId = requireProject(ctx);
  const storyboardId = ctx.state.storyboardId;
  if (!storyboardId) throw new AutopilotFatalError("No storyboard to compile");
  if (ctx.state.runId) return { kind: "done", note: "run already compiled" };
  // The storyboard belongs to this autopilot: a run on it is ours (compiled by an earlier attempt).
  const prior = await prisma.libtvRun.findFirst({ where: { projectId, storyboardId, status: { notIn: ["cancelled", "failed"] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (prior) return { kind: "done", state: { runId: prior.id }, note: "reused the run compiled earlier" };
  const { compileRunFromStoryboard, LibtvCompileError } = await import("@/services/video-gen/libtv-compile");
  try {
    const result = await compileRunFromStoryboard({ projectId, storyboardId, imageModel: ctx.input.imageModel, videoModel: ctx.input.videoModel });
    return { kind: "done", state: { runId: result.runId }, note: `${result.jobCount} jobs, ${result.creditsEstimated} credits est.` };
  } catch (err) {
    if (err instanceof LibtvCompileError && err.status >= 400 && err.status < 500) {
      throw new AutopilotFatalError(`${err.message}${err.missing.length ? ` (missing: ${err.missing.join("; ")})` : ""}`);
    }
    throw err;
  }
};

const approve = async (ctx: StepContext): Promise<StepOutcome> => {
  const projectId = requireProject(ctx);
  const runId = ctx.state.runId;
  if (!runId) throw new AutopilotFatalError("No run to approve");
  const run = await prisma.libtvRun.findFirst({ where: { id: runId, projectId }, select: { id: true, status: true, executor: true, creditsEstimated: true } });
  if (!run) throw new AutopilotFatalError("Run not found");
  if (run.status !== "draft" && run.status !== "awaiting_approval") return { kind: "done", note: `run already ${run.status}` };
  const { isServerEngine } = await import("@/services/video-gen/libtv-pricing");
  if (!isServerEngine(run.executor)) throw new AutopilotFatalError(`Only server renders can run on autopilot (executor ${run.executor}) — approve LibTV runs in the Studio.`);

  // Re-check against the compiled run: the owner's number must cover its high forecast too.
  const { estimateRunAction, setBudgetAction } = await import("@/services/ops/operator-ops");
  const est = await estimateRunAction({ projectId, runId });
  if (est.status !== 200) throw new Error(String(est.body.error ?? `estimate failed (${est.status})`));
  const forecast = forecastOf(est.body, "run");
  const approved = ctx.state.approvedBudgetUsd ?? null;
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const free = forecast.highUsd <= 0 && run.creditsEstimated <= 0;
  if (!free && (approved == null || forecast.highUsd > approved + 1e-9)) {
    const reason = `The compiled run forecasts up to ${fmt(forecast.highUsd)}, above the approved ${approved == null ? "budget (none)" : fmt(approved)} — approve at least ${fmt(forecast.recommendedBudgetUsd)}.`;
    return { kind: "await_approval", state: { forecast }, awaiting: { reason, forecastHighUsd: forecast.highUsd, recommendedBudgetUsd: forecast.recommendedBudgetUsd, approvedBudgetUsd: approved } };
  }
  const projectBudget = est.body.projectBudgetUsd as number | null | undefined;
  const projectSpent = Number(est.body.projectSpentUsd ?? 0);
  if (projectBudget != null && projectSpent + forecast.highUsd > projectBudget + 1e-9) {
    // The project cap is the owner's too: never raised here.
    const reason = `The project budget ${fmt(projectBudget)} (${fmt(projectSpent)} spent) cannot cover this run's ${fmt(forecast.highUsd)} — the owner must raise it with set-budget, then autopilot-approve.`;
    return { kind: "await_approval", state: { forecast }, awaiting: { reason, forecastHighUsd: forecast.highUsd, recommendedBudgetUsd: forecast.recommendedBudgetUsd, approvedBudgetUsd: approved } };
  }
  // The run's cap is exactly the owner's approved number ($0 for a free run: no paid call can slip through).
  const set = await setBudgetAction({ projectId, runId, usd: approved ?? 0 });
  if (set.status !== 200) throw new Error(String(set.body.error ?? "set-budget failed"));
  const { approveRun } = await import("@/services/video-gen/libtv-queue");
  const ok = await approveRun(runId, run.creditsEstimated > 0 ? run.creditsEstimated : null);
  if (!ok) {
    const now = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (now && now.status !== "draft" && now.status !== "awaiting_approval") return { kind: "done", note: `run already ${now.status}` };
    throw new Error(`Run cannot be approved from status "${now?.status}"`);
  }
  return { kind: "done", state: { forecast }, note: `approved with a ${fmt(approved ?? 0)} run cap` };
};

const render = async (ctx: StepContext): Promise<StepOutcome> => {
  const runId = ctx.state.runId;
  if (!runId) throw new AutopilotFatalError("No run to render");
  const read = () => prisma.libtvRun.findUnique({ where: { id: runId }, select: { status: true, executor: true, masterMp4Url: true, error: true } });
  let run = await read();
  if (!run) throw new AutopilotFatalError("Run not found");
  const settled = (r: NonNullable<typeof run>): StepOutcome | null => {
    if (r.status === "completed") return { kind: "done", state: { masterUrl: r.masterMp4Url }, note: "master rendered" };
    if (r.status === "failed" || r.status === "cancelled") throw new AutopilotFatalError(`Render ${r.status}${r.error ? `: ${r.error}` : ""}`);
    return null;
  };
  const early = settled(run);
  if (early) return early;
  const started = ctx.state.renderStartedAt ? Date.parse(ctx.state.renderStartedAt) : ctx.now();
  if (ctx.now() - started > MAX_RENDER_MS) throw new AutopilotFatalError("Render has not finished in 24 h");
  const left = ctx.deadline - ctx.now() - 15_000;
  if (left > 20_000) {
    const [{ loadAiSettings }, { driveServerRun }] = await Promise.all([import("@/services/settings/ai-settings"), import("@/services/video-gen/server-engines")]);
    await loadAiSettings();
    await driveServerRun(run.executor, runId, left).catch((err) => console.warn(`[autopilot] drive ${runId}: ${asMsg(err)}`));
    run = await read();
    if (!run) throw new AutopilotFatalError("Run not found");
    const after = settled(run);
    if (after) return after;
  }
  return { kind: "wait", note: `render ${run.status}` };
};

/**
 * Pre-flight creative score: edit-v2 renders carry it on qcReport.preflight; otherwise the master is
 * scored here (free, local). A failure is recorded as skipped — it never blocks the report.
 */
const preflight = async (ctx: StepContext): Promise<StepOutcome> => {
  const runId = ctx.state.runId;
  if (!runId) return { kind: "done", state: { preflight: { status: "skipped", note: "no run" } } };
  const run = await prisma.libtvRun.findUnique({ where: { id: runId }, select: { qcReport: true } });
  const pf = (run?.qcReport as { preflight?: { score?: unknown; total?: unknown } } | null)?.preflight;
  if (pf) {
    const score = typeof pf.score === "number" ? pf.score : typeof pf.total === "number" ? pf.total : null;
    return { kind: "done", state: { preflight: { status: "scored", score } }, note: score != null ? `pre-flight ${score}/100` : "pre-flight scored" };
  }
  // Not scored at render time: score the master now (local ffmpeg, free). Advisory — never blocks the report.
  try {
    const { preflightRun } = await import("@/services/video-gen/preflight/run");
    const { score, verdict } = await preflightRun(ctx.state.projectId ?? "", runId);
    return { kind: "done", state: { preflight: { status: "scored", score, verdict } }, note: `pre-flight ${score}/100 (${verdict})` };
  } catch (err) {
    return { kind: "done", state: { preflight: { status: "skipped", note: `pre-flight failed: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}` } } };
  }
};

const report = async (ctx: StepContext): Promise<StepOutcome> => {
  const projectId = requireProject(ctx);
  const { campaignReportAction } = await import("@/services/ops/operator-ops");
  const r = await campaignReportAction({ projectId, narrative: ctx.input.narrative ?? "template" });
  if (r.status === 200) return { kind: "done", state: { report: { htmlUrl: String(r.body.htmlUrl), docxUrl: String(r.body.docxUrl) } } };
  const error = String(r.body.error ?? `report failed (${r.status})`);
  // The ad is finished; a deployment without asset storage just has no report file.
  if (/No asset storage/i.test(error)) return { kind: "done", state: { report: { skipped: error } }, note: error };
  throw new Error(error);
};

export const defaultAutopilotSteps: AutopilotSteps = { scrape, brief, plan, storyboard, estimate, compile, approve, render, preflight, report };
