import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runAnalysisPipeline, ANALYSIS_STAGES, type AnalysisStage } from "@/services/ai/analysis-pipeline";

export const maxDuration = 300;

function parseStage(value: unknown): AnalysisStage | undefined {
  return typeof value === "string" && (ANALYSIS_STAGES as string[]).includes(value)
    ? (value as AnalysisStage)
    : undefined;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const result = await runAnalysisPipeline(projectId, {
      startStage: parseStage((body as { stage?: unknown }).stage),
    });

    if (result.done) {
      await prisma.project
        .update({ where: { id: projectId }, data: { status: "ANALYZED" } })
        .catch(() => {});
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed", done: false, nextStage: "brand" },
      { status: 500 }
    );
  }
}
