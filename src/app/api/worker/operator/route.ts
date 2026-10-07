/**
 * Operator endpoint — the Studio's approve-frames → compile → approve steps
 * for the operator's tooling when no browser session is available.
 *
 * Auth: header `x-worker-token` vs env WORKER_TOKEN (exempt from Access like
 * the other /api/worker routes). A paid server render needs allowPaid and a
 * creditCap covering its estimate; LibTV runs stay a Studio action.
 *
 * POST { action: "approve-frames", projectId, storyboardId }
 * POST { action: "compile-run", projectId, storyboardId, scriptId?, imageModel, videoModel, clipDurationSec?, aspectRatio? }
 * POST { action: "approve-run", projectId, runId, allowPaid?, creditCap? }
 * POST { action: "reassemble-run", projectId, runId } — re-cut a finished server run from its clips
 * POST { action: "render-variant", projectId, runId, hookStyle: q|c|p, hookText? } — A/B hook variant
 * POST { action: "render-export", projectId, runId, format: 4:5|1:1|16:9|15s|10s } — delivery format
 * POST { action: "director-review", projectId, runId } — AI director sign-off of the master
 * POST { action: "save-structure", projectId, teardownId } / { action: "choose-structure", projectId, structureId|null }
 * POST { action: "product-brief", projectId, reviews?, qa?, price?, … } — sp-1 brief → Project.productBrief
 * POST { action: "select-creative", projectId?, platform, goal, promo? } — 3 hooks + end card
 * POST { action: "plan-to-storyboard", projectId, platform?, hookId?, cast?, setting?, engine?, presenter?: true | personaId, casting? } — plan script → locked storyboard (presenter: AI talking-head frames)
 * POST { action: "plan-campaign", projectId, platforms?, goal?, promo?, runDate?, durationSec? } — campaign plan → Project.campaignPlan
 * POST { action: "plan-batch", projectId, runId, dims?, maxVariants?, design?: pairwise|full } — Batch Mode matrix + cost → qc.batches
 * POST { action: "render-batch", projectId, runId, batchId, limit? } — render free re-edit variants of a batch
 * POST { action: "export-pack", projectId, runId, platforms? } — videos, thumbnails, ad copy, bulk CSVs, README, manifest
 * POST { action: "perf-ask", projectId, question } — Performance Agent answer + the aggregated table it used
 * POST { action: "test-plan", projectId, totalBudget, days, goal?, platforms?, baseline?, targetCpa?, targetLift? } — testing plan → Project.testPlan
 * POST { action: "clone-ad", projectId, teardownId | structureId, platform?, goal? } — Ad Cloner → Project.campaignPlan
 * POST { action: "localize-run", projectId, runId, locales[], gender?, force? } — localized versions → qcReport.locales
 * POST { action: "estimate-run" | "set-budget" | "spend-report" | "campaign-report", projectId, … } — cost forecast, budget, ledger, client report
 * POST { action: "image-ads", projectId, templates?, formats?, promo?, proof?, copy?, productUrl?, beforeUrl? } — static ad set → Project.imageAdSets
 * POST { action: "preflight", projectId, runId, platform?, goal? } — pre-flight creative score → qcReport.preflight
 * POST { action: "hook-trends", projectId, category?, platform?, windowDays?, llm? } — rising / saturated competitor hooks + recommendations
 * POST { action: "next-round", projectId, platform? } — proposed next test round + cost → Project.nextRound (never spends)
 * POST { action: "autopilot-start", url | projectId, platforms?, goal?, promo?, cast?, setting?, ctaButton?, approvedBudgetUsd? } — URL-to-video autopilot (202 + autopilotId)
 * POST { action: "autopilot-approve", autopilotId, approvedBudgetUsd } / { action: "autopilot-status", autopilotId, retry? } — budget gate, status
 * POST { action: "creative-agent", projectId, message, storyboardId? } / { action: "creative-agent-undo", projectId } — chat edits to the plan / storyboard
 * POST { action: "covers", projectId, runId, force? } — cover frames (9:16 / 1:1 / 4:5) for the master + variants / exports → qcReport.covers
 * POST { action: "auto-fix", projectId, runId, platform? } — re-edit once with pre-flight corrections (free) → qcReport.autofix
 * POST { action: "ops-health" } / { action: "ops-recover", dryRun? (default true) } — health scan / safe auto-recovery
 * GET  ?runId=…  — the run's status, job counts and outputs
 */
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { hasWorkerToken } from "@/lib/worker-token";
import { LIVE } from "@/services/creative-library";
import { approveAllFrames, freeRunRefusal, operatorActionSchema } from "@/services/operator";
import { compileRunFromStoryboard, LibtvCompileError } from "@/services/video-gen/libtv-compile";
import { isServerEngine } from "@/services/video-gen/libtv-pricing";
import { approveRun, cloneRunForRerender, getRunWithJobs, runDone } from "@/services/video-gen/libtv-queue";
import { assembleGlmMaster } from "@/services/video-gen/glm-assemble";
import { renderVariantForRun } from "@/services/video-gen/variants";
import { renderExportForRun } from "@/services/video-gen/exports";
import { storyboardFrames } from "@/services/video-gen/server-executor";
import { driveServerRun } from "@/services/video-gen/server-engines";
import { loadAiSettings } from "@/services/settings/ai-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function summarize(run: NonNullable<Awaited<ReturnType<typeof getRunWithJobs>>>) {
  const jobs = (run as { jobs?: { status: string }[] }).jobs ?? [];
  const counts: Record<string, number> = {};
  for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;
  const r = run as unknown as Record<string, unknown>;
  return {
    id: run.id,
    status: run.status,
    executor: run.executor,
    creditsEstimated: run.creditsEstimated,
    jobs: counts,
    masterUrl: r.masterMp4Url ?? null,
    voiceoverUrl: r.voiceoverUrl ?? null,
    subtitlesUrl: r.subtitlesUrl ?? null,
    previewUrl: r.previewMp4Url ?? null,
    contactSheetUrl: r.contactSheetUrl ?? null,
    qc: r.qcReport ?? null,
    error: r.error ?? null,
  };
}

const opsReply = (r: { status: number; body: Record<string, unknown> }) => NextResponse.json(r.body, { status: r.status });

export async function GET(request: Request) {
  if (!hasWorkerToken(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
  const run = await getRunWithJobs(runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ run: summarize(run) });
}

export async function POST(request: Request) {
  if (!hasWorkerToken(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = operatorActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action", issues: parsed.error.issues }, { status: 400 });
  const input = parsed.data;

  if (input.action === "approve-frames") {
    const board = await prisma.storyboard.findFirst({ where: { id: input.storyboardId, projectId: input.projectId, ...LIVE } });
    if (!board) return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
    const frames = Array.isArray(board.frames) ? (board.frames as Array<Record<string, unknown>>) : [];
    const next = approveAllFrames(frames, board.frameHistory);
    if (next.approved) {
      await prisma.storyboard.update({
        where: { id: board.id },
        data: { frames: next.frames as never, frameHistory: next.history as never },
      });
    }
    return NextResponse.json({ ok: true, approved: next.approved, frames: frames.length });
  }

  if (input.action === "compile-run") {
    try {
      const result = await compileRunFromStoryboard({
        projectId: input.projectId,
        storyboardId: input.storyboardId,
        scriptId: input.scriptId ?? null,
        imageModel: input.imageModel,
        videoModel: input.videoModel,
        clipDurationSec: input.clipDurationSec,
        aspectRatio: input.aspectRatio,
        budgetMode: input.budgetMode,
        allowOverBudget: input.allowOverBudget === true,
        holdVideos: input.holdVideos === true,
      });
      return NextResponse.json(
        { runId: result.runId, creditsEstimated: result.creditsEstimated, jobCount: result.jobCount },
        { status: 201 }
      );
    } catch (err) {
      if (err instanceof LibtvCompileError) {
        return NextResponse.json({ error: err.message, missing: err.missing }, { status: err.status });
      }
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  if (input.action === "upload-asset") {
    const { uploadBuffer } = await import("@/services/storage");
    const up = await uploadBuffer({ buffer: Buffer.from(input.base64, "base64"), filename: input.filename, contentType: input.contentType, folder: `scripts/${input.projectId}` });
    if (up.provider === "inline") return NextResponse.json({ error: "No asset storage configured" }, { status: 500 });
    return NextResponse.json({ ok: true, url: up.url });
  }

  if (input.action === "import-script") {
    let projectId = input.projectId ?? null;
    if (!projectId) {
      if (!input.project) return NextResponse.json({ error: "Give projectId or project" }, { status: 400 });
      const template = input.templateProjectId
        ? await prisma.project.findUnique({ where: { id: input.templateProjectId }, select: { workspaceId: true } })
        : null;
      const created = await prisma.project.create({
        data: {
          name: input.project.name,
          brandName: input.project.brandName,
          productName: input.project.productName,
          productUrl: input.project.productUrl ?? null,
          workspaceId: template?.workspaceId ?? null,
        },
        select: { id: true },
      });
      projectId = created.id;
    }
    if (input.packshots?.length || input.logoUrl) {
      const kit = await prisma.brandKit.upsert({ where: { projectId }, create: { projectId }, update: {}, select: { id: true } });
      const assets = [
        ...(input.packshots ?? []).map((p) => ({ brandKitId: kit.id, kind: "PACKSHOT", variant: p.variant ?? "front", url: p.url, provider: "url", verified: true })),
        ...(input.logoUrl ? [{ brandKitId: kit.id, kind: "LOGO", variant: "light", url: input.logoUrl, provider: "url", verified: true }] : []),
      ];
      // Newest packshot first is PROD-1: clear older packshots so the script's reference wins.
      if (input.packshots?.length) await prisma.brandAsset.deleteMany({ where: { brandKitId: kit.id, kind: "PACKSHOT" } });
      if (input.logoUrl) await prisma.brandAsset.deleteMany({ where: { brandKitId: kit.id, kind: "LOGO" } });
      for (const a of assets) await prisma.brandAsset.create({ data: a });
    }
    const sb = await prisma.storyboard.create({
      data: { projectId, title: input.storyboard.title, frames: input.storyboard.frames as object[], style: "locked-script", frameSeconds: 1 },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, projectId, storyboardId: sb.id }, { status: 201 });
  }

  if (input.action === "release-videos") {
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const held = await prisma.libtvJob.findMany({ where: { runId: run.id, kind: "video" } });
    let released = 0;
    for (const j of held) {
      const s = { ...((j.settings ?? {}) as Record<string, unknown>) };
      if (!s.hold) continue;
      delete s.hold;
      await prisma.libtvJob.update({ where: { id: j.id }, data: { settings: s as object } });
      released++;
    }
    await loadAiSettings();
    after(() => driveServerRun(run.executor, run.id, 280_000).then(() => undefined));
    return NextResponse.json({ ok: true, released });
  }

  if (input.action === "drive-run") {
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (!isServerEngine(run.executor)) return NextResponse.json({ error: `Not a server run (executor ${run.executor ?? "none"})` }, { status: 409 });
    await loadAiSettings();
    after(() => driveServerRun(run.executor, run.id, 280_000).then(() => undefined));
    return NextResponse.json({ ok: true, driving: run.id, status: run.status });
  }

  if (input.action === "reassemble-run") {
    // Re-cut a finished server run from its existing clips (no generation, no spend).
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (!isServerEngine(run.executor) || run.status !== "completed") {
      return NextResponse.json({ error: `Only completed server runs can be re-assembled (status ${run.status})` }, { status: 409 });
    }
    const jobs = await prisma.libtvJob.findMany({ where: { runId: run.id } });
    const frames = await storyboardFrames(run.storyboardId, run.directorPlan);
    const master = await assembleGlmMaster({ runId: run.id, projectId: run.projectId, aspectRatio: run.aspectRatio, frames, jobs });
    await runDone({
      runId: run.id,
      masterMp4Url: master.masterUrl,
      voiceoverUrl: master.voiceoverUrl,
      subtitlesUrl: master.subtitlesUrl,
      previewMp4Url: master.previewUrl ?? null,
      contactSheetUrl: master.contactSheetUrl ?? null,
      qcReport: master.qcReport ? { ...master.qcReport, variants: ((run.qcReport as { variants?: unknown[] } | null)?.variants ?? []), batches: ((run.qcReport as { batches?: unknown[] } | null)?.batches ?? []) } : null,
      creditsSpent: run.creditsSpent,
    });
    return NextResponse.json({ ok: true, run: summarize((await getRunWithJobs(run.id))!), qc: master.qcReport ?? null });
  }

  if (input.action === "save-structure") {
    try {
      const { saveStructureFromTeardown } = await import("@/services/structures");
      return NextResponse.json({ ok: true, structure: await saveStructureFromTeardown(input.projectId, input.teardownId) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
  }

  if (input.action === "choose-structure") {
    if (input.structureId && !(await prisma.adStructure.findUnique({ where: { id: input.structureId }, select: { id: true } }))) {
      return NextResponse.json({ error: "Structure not found" }, { status: 404 });
    }
    await prisma.campaignSelection.upsert({
      where: { projectId: input.projectId },
      create: { projectId: input.projectId, structureId: input.structureId },
      update: { structureId: input.structureId },
    });
    return NextResponse.json({ ok: true, structureId: input.structureId });
  }

  if (input.action === "product-brief") {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, brandName: true, productName: true, productUrl: true, productPageTitle: true, productPageText: true },
    });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const title = project.productPageTitle || project.productName || "";
    if (!title && !project.productPageText) return NextResponse.json({ error: "No product page on this project — set productUrl first" }, { status: 409 });
    try {
      const { extractProductBrief } = await import("@/services/creative/product-brief");
      const text = project.productPageText ?? "";
      const brief = await extractProductBrief({
        url: project.productUrl,
        title,
        brand: project.brandName,
        bullets: text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 12 && l.length < 300).slice(0, 20),
        description: text,
        specs: input.specs,
        price: input.price ?? null,
        listPrice: input.listPrice ?? null,
        rating: input.rating ?? null,
        reviewCount: input.reviewCount ?? null,
        reviews: input.reviews,
        qa: input.qa,
        keywordData: input.keywordData,
        platforms: input.platforms,
        durationSec: input.durationSec,
      }, { strictCompliance: input.strictCompliance ?? process.env.CREATIVE_STRICT_COMPLIANCE === "true" });
      await prisma.project.update({ where: { id: project.id }, data: { productBrief: brief as object, productBriefAt: new Date() } });
      return NextResponse.json({ ok: true, brief });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  if (input.action === "plan-campaign") {
    const { createCampaignPlan, CampaignPlanError } = await import("@/services/creative/campaign-plan.store");
    const { summarizePlan } = await import("@/services/creative/campaign-planner");
    try {
      const plan = await createCampaignPlan(input.projectId, {
        platforms: input.platforms,
        goal: input.goal,
        promo: input.promo,
        runDate: input.runDate,
        durationSec: input.durationSec,
        strictCompliance: input.strictCompliance,
        overrides: input.overrides,
      });
      return NextResponse.json({ ok: true, summary: summarizePlan(plan) });
    } catch (err) {
      const status = err instanceof CampaignPlanError ? err.status : 500;
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
    }
  }

  if (input.action === "plan-to-storyboard") {
    const { directPlanStoryboard } = await import("@/services/creative/plan-to-storyboard");
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { campaignPlan: true, productName: true, name: true, ...(input.presenter ? { brandName: true, productBrief: true } : {}) } });
    const plan = project?.campaignPlan as { platforms?: import("@/services/creative/campaign-plan.types").PlatformPlan[]; cast?: string; setting?: string } | null;
    const platformPlan = plan?.platforms?.find((p) => !input.platform || p.platform === input.platform);
    if (!platformPlan) return NextResponse.json({ error: "No campaign plan for that platform — run plan-campaign first" }, { status: 409 });
    const out = await directPlanStoryboard({
      plan: platformPlan,
      hookId: input.hookId,
      productName: project?.productName || project?.name || "product",
      cast: input.cast ?? plan?.cast,
      setting: input.setting ?? plan?.setting,
      engine: input.engine,
      ctaButton: input.ctaButton,
      ...(await presenterOptions(input, project as { brandName?: string | null; productBrief?: unknown } | null)),
    });
    const sb = await prisma.storyboard.create({
      data: { projectId: input.projectId, title: out.title, frames: out.frames as unknown as object[], style: "locked-script", frameSeconds: 1 },
      select: { id: true },
    });
    const talkFrames = out.frames.filter((f) => f.locked.talk).map((f) => f.frameNumber);
    return NextResponse.json({ ok: true, storyboardId: sb.id, frames: out.frames.length, promptSource: out.source, error: out.error, ...(out.presenter ? { presenter: out.presenter, talkFrames } : {}) }, { status: 201 });
  }

  if (input.action === "select-creative") {
    const { selectCreative, platformProfile } = await import("@/services/creative/library");
    const { TO_CREATIVE_CATEGORY } = await import("@/services/creative/product-brief");
    let category = input.category;
    if (!category && input.projectId) {
      const p = await prisma.project.findUnique({ where: { id: input.projectId }, select: { productBrief: true } });
      const sp = (p?.productBrief as { category?: string } | null)?.category;
      if (sp) category = TO_CREATIVE_CATEGORY[sp as keyof typeof TO_CREATIVE_CATEGORY];
    }
    if (!category) return NextResponse.json({ error: "category required (or a stored product brief)" }, { status: 400 });
    try {
      platformProfile(input.platform as never);
      const choice = selectCreative({ ...input, category: category as never, platform: input.platform as never });
      return NextResponse.json({ ok: true, category, choice });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
  }

  if (input.action === "director-review") {
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, select: { id: true } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    try {
      const { reviewAndStore } = await import("@/services/video-gen/director");
      return NextResponse.json({ ok: true, review: await reviewAndStore(run.id) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
    }
  }

  if (input.action === "rerender-shots") {
    // A new run version re-rendering the chosen shots (default: the director's picks); approve it next.
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, select: { id: true, qcReport: true } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const flagged = ((run.qcReport as { director?: { shotIndexes?: number[] } } | null)?.director?.shotIndexes ?? []) as number[];
    const shots = input.shotIndexes?.length ? input.shotIndexes : flagged;
    if (!shots.length) return NextResponse.json({ error: "No shots to re-render (run the director review first)" }, { status: 400 });
    const result = await cloneRunForRerender(run.id, shots);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, runId: result.run?.id ?? null, shots, creditsEstimated: result.run?.creditsEstimated ?? 0 }, { status: 201 });
  }

  if (input.action === "render-export") {
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, select: { id: true } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    try {
      return NextResponse.json({ ok: true, export: await renderExportForRun(run.id, input.format) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
    }
  }

  if (input.action === "perf-ask") {
    const { askPerformance } = await import("@/services/performance/agent");
    return NextResponse.json({ ok: true, ...(await askPerformance(input.projectId, input.question)) });
  }

  if (input.action === "test-plan") {
    const { createTestPlan, TestPlanError } = await import("@/services/creative/test-plan.store");
    try {
      const { action: _a, projectId, ...req } = input;
      return NextResponse.json({ ok: true, testPlan: await createTestPlan(projectId, req) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof TestPlanError ? err.status : 500 });
    }
  }

  if (input.action === "render-variant") {
    // An A/B hook variant from the same clips; kept on the run next to its QC.
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, select: { id: true } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    try {
      const variant = await renderVariantForRun(run.id, input.hookStyle, input.hookText);
      return NextResponse.json({ ok: true, variant });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
    }
  }

  if (input.action === "plan-batch" || input.action === "render-batch" || input.action === "export-pack") {
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, select: { id: true } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    try {
      if (input.action === "plan-batch") {
        const { planBatchForRun } = await import("@/services/video-gen/batch-render");
        const batch = await planBatchForRun({ runId: run.id, dims: input.dims, design: input.design, maxVariants: input.maxVariants });
        return NextResponse.json({ ok: true, batch });
      }
      if (input.action === "render-batch") {
        // Claim now, render after the response (each re-edit is ~2–3 min); poll GET ?runId= for qc.batches.
        const { claimBatchVariants, renderClaimedVariants } = await import("@/services/video-gen/batch-render");
        const claimed = await claimBatchVariants(run.id, input.batchId, input.limit);
        if (claimed.length) after(() => renderClaimedVariants(run.id, input.batchId, claimed).then(() => undefined));
        return NextResponse.json({ ok: true, rendering: claimed.map((v) => ({ id: v.id, name: v.name })) }, { status: claimed.length ? 202 : 200 });
      }
      const { buildExportPack } = await import("@/services/delivery/export-pack");
      return NextResponse.json({ ok: true, ...(await buildExportPack(run.id, { platforms: input.platforms })) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
    }
  }
  if (input.action === "estimate-run") return opsReply(await (await import("@/services/ops/operator-ops")).estimateRunAction(input));
  if (input.action === "set-budget") return opsReply(await (await import("@/services/ops/operator-ops")).setBudgetAction(input));
  if (input.action === "spend-report") return opsReply(await (await import("@/services/ops/operator-ops")).spendReportAction(input));
  if (input.action === "campaign-report") return opsReply(await (await import("@/services/ops/operator-ops")).campaignReportAction(input));
  if (input.action === "hook-trends" || input.action === "next-round") {
    try {
      if (input.action === "hook-trends") {
        const { hookTrendReport } = await import("@/services/research/hook-trends");
        if (input.llm) await loadAiSettings();
        return NextResponse.json({ ok: true, report: await hookTrendReport(input.projectId, { category: input.category, platform: input.platform, windowDays: input.windowDays, llm: input.llm ? "default" : null }) });
      }
      const { planNextRound } = await import("@/services/performance/iterate");
      return NextResponse.json({ ok: true, nextRound: await planNextRound(input.projectId, { platform: input.platform }) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 500 });
    }
  }

  if (input.action === "clone-ad") {
    const { cloneAdIntoProject } = await import("@/services/creative/ad-cloner.store");
    const { CampaignPlanError } = await import("@/services/creative/campaign-plan.store");
    const { summarizePlan } = await import("@/services/creative/campaign-planner");
    try {
      const { plan, clone } = await cloneAdIntoProject(input.projectId, { teardownId: input.teardownId, structureId: input.structureId, platform: input.platform, goal: input.goal });
      return NextResponse.json({ ok: true, label: clone.plan.label, hook: clone.hook, endCard: clone.endCard, summary: summarizePlan(plan) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof CampaignPlanError ? err.status : 500 });
    }
  }

  if (input.action === "localize-run") {
    // Same clips, re-edited per locale (~2–3 min each) after the response; poll GET ?runId for qc.locales.
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, select: { id: true, executor: true, status: true, qcReport: true } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (!isServerEngine(run.executor) || run.status !== "completed") return NextResponse.json({ error: `Only completed server runs can be localized (status ${run.status})` }, { status: 409 });
    const { missingLocales } = await import("@/services/video-gen/localize");
    const queued = missingLocales((run.qcReport ?? {}) as never, input.locales, Date.now(), input.force);
    if (queued.length) {
      await loadAiSettings();
      const { localizeRun } = await import("@/services/video-gen/localize-run");
      after(() => localizeRun(run.id, queued, { gender: input.gender, force: input.force, budgetMs: 280_000 }).then((r) => console.log(`[localize] ${run.id}: done ${r.done.map((d) => d.locale).join(",") || "-"} failed ${r.failed.map((f) => `${f.locale} (${f.error.slice(0, 80)})`).join("; ") || "-"} left ${r.left.join(",") || "-"}`)));
    }
    return NextResponse.json({ ok: true, queued, skipped: input.locales.filter((l) => !queued.includes(l)), note: queued.length > 1 ? "Locales render one after another (~2–3 min each); any that don't fit this call's time budget stay missing — call again to continue." : undefined }, { status: 202 });
  }

  if (input.action === "image-ads") {
    const { generateImageAdSet } = await import("@/services/image-ads/generate");
    try {
      const set = await generateImageAdSet(input.projectId, { ...input, templates: input.templates as never, formats: input.formats as never, copy: input.copy as never });
      return NextResponse.json({ ok: true, set }, { status: 201 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : /Unknown image ad|No product image/.test(msg) ? 400 : 500 });
    }
  }

  if (input.action === "preflight") {
    const { preflightRun, PreflightError } = await import("@/services/video-gen/preflight/run");
    try {
      return NextResponse.json({ ok: true, preflight: await preflightRun(input.projectId, input.runId, input) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof PreflightError ? err.status : 500 });
    }
  }

  if (input.action === "autopilot-start" || input.action === "autopilot-approve" || input.action === "autopilot-status") {
    return opsReply(await (await import("@/services/autopilot/operator-actions")).autopilotAction(input, (task) => after(() => task().then(() => undefined))));
  }
  if (input.action === "creative-agent" || input.action === "creative-agent-undo") {
    const { creativeAgentTurn, undoCreativeEdit } = await import("@/services/creative/creative-agent.store");
    return opsReply(input.action === "creative-agent" ? await creativeAgentTurn(input.projectId, input.message, input.storyboardId) : await undoCreativeEdit(input.projectId));
  }

  if (input.action === "covers") {
    const { coversForRun, CoversError } = await import("@/services/video-gen/covers-run");
    try {
      return NextResponse.json({ ok: true, covers: await coversForRun(input.projectId, input.runId, { force: input.force }) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof CoversError ? err.status : 500 });
    }
  }

  if (input.action === "auto-fix") {
    // One re-edit (~2–3 min) from the same clips; synchronous like render-export.
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, select: { id: true } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const { autoFixRender, prismaDeps } = await import("@/services/video-gen/autofix");
    try {
      return NextResponse.json({ ok: true, autofix: await autoFixRender(run.id, prismaDeps({ platform: (input.platform as import("@/services/creative/types").PlatformId | undefined) ?? null })) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
    }
  }

  if (input.action === "ops-health") return NextResponse.json(await (await import("@/services/ops/health")).scanHealth()); // report.ok = no critical / warning issues
  if (input.action === "ops-recover") return NextResponse.json({ ok: true, ...(await (await import("@/services/ops/health")).autoRecover({ dryRun: input.dryRun })) });

  // approve-run: free server renders only.
  await loadAiSettings();
  const existing = await getRunWithJobs(input.runId);
  if (!existing || existing.projectId !== input.projectId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const refusal = freeRunRefusal(existing, isServerEngine(existing.executor), input);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  const run = await approveRun(input.runId, existing.creditsEstimated > 0 ? (input.creditCap ?? null) : null);
  if (!run) {
    return NextResponse.json({ error: `Run cannot be approved from status "${existing.status}"` }, { status: 409 });
  }
  after(() => driveServerRun(run.executor, run.id, 280_000).then(() => undefined));
  return NextResponse.json({ ok: true, run: summarize((await getRunWithJobs(run.id)) ?? run) });
}

/** plan-to-storyboard presenter options: persona choice inputs (category, casting: call → project → brand → env → default). */
async function presenterOptions(
  input: { presenter?: boolean | string; casting?: { ethnicities: string[] | null } },
  project: { brandName?: string | null; productBrief?: unknown } | null
): Promise<{ presenter?: boolean | string; category?: string; casting?: import("@/services/creative/personas").CastingPrefs }> {
  if (!input.presenter) return {};
  const { resolveCasting } = await import("@/services/creative/personas");
  const { TO_CREATIVE_CATEGORY } = await import("@/services/creative/product-brief");
  const brief = (project?.productBrief ?? null) as { category?: string; casting?: unknown } | null;
  const category = brief?.category ? TO_CREATIVE_CATEGORY[brief.category as keyof typeof TO_CREATIVE_CATEGORY] : undefined;
  return { presenter: input.presenter, category, casting: resolveCasting({ override: input.casting, project: brief?.casting, brandName: project?.brandName, env: process.env.PRESENTER_CASTING }) };
}
