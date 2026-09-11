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

export const maxDuration = 60;

const BUDGET_MS = Number(process.env.ANALYSIS_BUDGET_MS) || 45_000;

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

  const ok = stages.every((s) => s.ok);
  return NextResponse.json({ ok, assetsAnalyzed: scored, stages }, { status: ok ? 200 : 207 });
}
