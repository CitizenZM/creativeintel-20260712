/**
 * Operator actions for the cost / budget / report capabilities (route: /api/worker/operator):
 *   estimate-run     line-item forecast for a compiled run or a storyboard, before spend is approved
 *   set-budget       the owner-approved USD cap for a project or one run
 *   spend-report     ledger totals by kind / model / run
 *   campaign-report  render the client report (HTML + DOCX), upload both, return the URLs
 * Each returns { status, body } for the route to send as JSON.
 */
import { prisma } from "@/lib/db";
import { spendLedger, summarizeSpend } from "./budget-guard";
import { directorReviewCall, estimateRunCost, storyboardJobs, type RunCostForecast } from "./cost-model";
import { loadPriceTable } from "./prices";
import { qcEstimateModel } from "./spend";

type Result = { status: number; body: Record<string, unknown> };
const err = (status: number, error: string): Result => ({ status, body: { error } });
const cents = (n: number) => Math.ceil(n * 100) / 100;

async function qcOptions() {
  const { MAX_KEYFRAME_REROLLS } = await import("@/services/video-gen/keyframe-qc");
  return { enabled: process.env.KEYFRAME_QC !== "off", maxRerolls: MAX_KEYFRAME_REROLLS, model: qcEstimateModel() };
}

/** After a clip renders: the drift check (its vision calls), drift re-generations and billed retries. */
async function clipOptions() {
  const { clipDriftMode } = await import("@/services/video-gen/keyframe-qc");
  return { driftMode: clipDriftMode(), autoRegen: process.env.AUTO_REGEN_ON_DRIFT === "on", maxRegens: 1, driftRate: 0.2, retryRate: 0.05, retryHighRate: 0.25 };
}

export async function estimateRunAction(input: { projectId: string; runId?: string; storyboardId?: string; imageModel?: string; videoModel?: string; clipDurationSec?: number }): Promise<Result> {
  if (!input.runId && !input.storyboardId) return err(400, "runId or storyboardId required");
  const prices = await loadPriceTable();
  const qc = await qcOptions();
  const clips = await clipOptions();
  let forecast: RunCostForecast;
  let remaining: RunCostForecast | null = null;
  let runInfo: Record<string, unknown> = {};
  if (input.runId) {
    const run = await prisma.libtvRun.findFirst({ where: { id: input.runId, projectId: input.projectId }, include: { jobs: true } });
    if (!run) return err(404, "Run not found");
    const frames = run.jobs.filter((j) => j.kind === "video").length;
    const opts = { prices, qc, clips, llm: [directorReviewCall(Math.max(1, frames))] };
    const src = { executor: run.executor, clipDurationSec: run.clipDurationSec, jobs: run.jobs };
    forecast = estimateRunCost(src, opts);
    if (run.status !== "draft" && run.status !== "awaiting_approval") remaining = estimateRunCost(src, { ...opts, remainingOnly: true });
    const ledger = await spendLedger();
    const b = await ledger.budgets(input.projectId, run.id);
    runInfo = { runId: run.id, status: run.status, executor: run.executor, creditsEstimated: run.creditsEstimated, approvedBudgetUsd: b.run?.budgetUsd ?? null, runSpentUsd: b.run?.spentUsd ?? 0, projectBudgetUsd: b.project.budgetUsd, projectSpentUsd: b.project.spentUsd };
  } else {
    const sb = await prisma.storyboard.findFirst({ where: { id: input.storyboardId, projectId: input.projectId }, select: { id: true, frames: true, style: true, frameSeconds: true } });
    if (!sb) return err(404, "Storyboard not found");
    const frames = (Array.isArray(sb.frames) ? sb.frames : []) as Record<string, unknown>[];
    const { isLockedStoryboard } = await import("@/services/video-gen/locked-script");
    const opts = { prices, qc, clips, llm: [directorReviewCall(frames.length)] };
    forecast = isLockedStoryboard(sb.style)
      ? estimateRunCost({ lockedFrames: frames as never, imageModel: input.imageModel }, opts)
      : estimateRunCost(storyboardJobs({ frames: frames as never, frameSeconds: sb.frameSeconds, imageModel: input.imageModel, videoModel: input.videoModel, clipDurationSec: input.clipDurationSec }), opts);
    runInfo = { storyboardId: sb.id, locked: isLockedStoryboard(sb.style) };
  }
  return {
    status: 200,
    body: {
      ok: true,
      ...runInfo,
      forecast,
      ...(remaining ? { remaining } : {}),
      // Approving at the worst case means QC rerolls and a director review never hit the cap mid-run.
      recommendedBudgetUsd: cents(forecast.totals.high),
    },
  };
}

export async function setBudgetAction(input: { projectId: string; runId?: string; usd: number | null }): Promise<Result> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
  if (!project) return err(404, "Project not found");
  const ledger = await spendLedger();
  try {
    await ledger.setBudget({ projectId: input.projectId, runId: input.runId ?? null }, input.usd);
  } catch (e) {
    return err(404, e instanceof Error ? e.message : String(e));
  }
  const b = await ledger.budgets(input.projectId, input.runId ?? null);
  return { status: 200, body: { ok: true, project: b.project, run: b.run } };
}

export async function spendReportAction(input: { projectId: string; since?: string }): Promise<Result> {
  const since = input.since ? new Date(input.since) : undefined;
  if (since && Number.isNaN(since.getTime())) return err(400, "since must be an ISO date");
  const ledger = await spendLedger();
  const [entries, b] = await Promise.all([ledger.entries({ projectId: input.projectId, since }), ledger.budgets(input.projectId)]);
  return { status: 200, body: { ok: true, since: since?.toISOString() ?? null, projectSpentUsd: b.project.spentUsd, ...summarizeSpend(entries, { projectBudgetUsd: b.project.budgetUsd }) } };
}

export async function campaignReportAction(input: { projectId: string; narrative?: "llm" | "template" }): Promise<Result> {
  const { buildCampaignReportModel, llmNarrator, loadReportInputs } = await import("@/services/reports/campaign-report");
  const data = await loadReportInputs(input.projectId);
  if (!data) return err(404, "Project not found");
  const model = await buildCampaignReportModel(data, { narrator: input.narrative === "template" ? null : llmNarrator(input.projectId) });
  const { renderReportHtml } = await import("@/services/reports/report-html");
  const { renderReportDocx, DOCX_CONTENT_TYPE } = await import("@/services/reports/report-docx");
  const { uploadBuffer } = await import("@/services/storage");
  const stamp = model.generatedAt.slice(0, 16).replace(/[-:T]/g, "");
  const base = `${(model.project.title || "campaign").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}-report-${stamp}`;
  const folder = `reports/${input.projectId}`;
  const [html, docx] = await Promise.all([
    uploadBuffer({ buffer: Buffer.from(renderReportHtml(model), "utf8"), filename: `${base}.html`, contentType: "text/html", folder }),
    renderReportDocx(model).then((buffer) => uploadBuffer({ buffer, filename: `${base}.docx`, contentType: DOCX_CONTENT_TYPE, folder })),
  ]);
  if (html.provider === "inline" || docx.provider === "inline") return err(500, "No asset storage configured — set BLOB_READ_WRITE_TOKEN or CLOUDINARY_URL");
  return {
    status: 200,
    body: {
      ok: true,
      htmlUrl: html.url,
      docxUrl: docx.url,
      summary: model.executiveSummary,
      keyNumbers: model.keyNumbers,
      nextActions: model.nextActions,
    },
  };
}
