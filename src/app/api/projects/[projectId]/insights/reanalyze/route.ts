import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  runAdTeardownStage,
  runCompetitorRollupStage,
  runCompetitiveGapStage,
  runPatternMiningStage,
  runDeepAnalysisStage,
  type StageResult,
} from "@/services/ai/analysis-pipeline";

export const maxDuration = 300;

// Requests to the custom domain die at Cloudflare's ~100s origin timeout, so
// spend most of that here rather than the old 45s — a single click then gets
// through several stages instead of one.
const BUDGET_MS = Number(process.env.ANALYSIS_BUDGET_MS) || 80_000;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const deadline = Date.now() + BUDGET_MS;

  const scored = await prisma.contentAsset.count({
    where: { projectId, overallScore: { not: null } },
  });
  if (scored === 0) {
    return NextResponse.json(
      { error: "No scored content yet. Run research first." },
      { status: 400 }
    );
  }

  const stages: StageResult[] = [];

  const run = async (stage: StageResult["stage"], fn: () => Promise<number>) => {
    try {
      stages.push({ stage, ok: true, count: await fn() });
    } catch (err) {
      stages.push({
        stage, ok: false, count: 0,
        error: err instanceof Error ? err.message : "stage failed",
      });
    }
  };

  const teardown = await runAdTeardownStage(projectId, deadline).catch((err) => {
    stages.push({
      stage: "teardown", ok: false, count: 0,
      error: err instanceof Error ? err.message : "teardown failed",
    });
    return null;
  });
  if (teardown) {
    stages.push({
      stage: "teardown", ok: true, count: teardown.count,
      error: teardown.remaining > 0 ? `${teardown.remaining} teardowns outstanding` : undefined,
    });
  }

  await run("rollup", () => runCompetitorRollupStage(projectId, deadline));
  await run("gap", () => runCompetitiveGapStage(projectId));
  await run("patterns", () => runPatternMiningStage(projectId));
  await run("patterns", () => runDeepAnalysisStage(projectId));

  // Tell the caller whether anything is still outstanding, so the UI can keep
  // going instead of making someone press Re-analyze until the numbers stop
  // moving.
  const [pendingTeardowns, competitorsWithoutRollup] = await Promise.all([
    prisma.contentAsset.count({
      where: { projectId, overallScore: { not: null }, teardown: { is: null } },
    }),
    prisma.competitor.count({ where: { projectId, rollup: { is: null } } }),
  ]);
  const remaining = pendingTeardowns + competitorsWithoutRollup;

  const ok = stages.every((s) => s.ok);
  return NextResponse.json(
    { ok, assetsAnalyzed: scored, stages, remaining, done: remaining === 0 },
    { status: ok ? 200 : 207 }
  );
}
