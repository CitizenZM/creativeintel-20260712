import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { createJob, failJob, jobWriter, cancelRequested, runningJob, type JobStep } from "@/services/jobs";
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

// A background run keeps making passes until everything is analysed or this
// much of the function's 300s is spent, leaving room to write the result.
const BACKGROUND_BUDGET_MS = 250_000;

const STEP_LABELS: { key: string; label: string }[] = [
  { key: "teardown", label: "Ad teardowns" },
  { key: "rollup", label: "Competitor rollups" },
  { key: "gap", label: "Competitive gaps" },
  { key: "patterns", label: "Pattern mining" },
  { key: "deep", label: "Deep analysis" },
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = (await req.json().catch(() => ({}))) as { background?: boolean };

  const scored = await prisma.contentAsset.count({
    where: { projectId, overallScore: { not: null } },
  });
  if (scored === 0) {
    return NextResponse.json(
      { error: "No scored content yet. Run research first." },
      { status: 400 }
    );
  }

  if (body.background) {
    const running = await runningJob(projectId, "analysis");
    if (running) return NextResponse.json({ jobId: running.id, reused: true }, { status: 202 });
    const job = await createJob(projectId, "analysis", STEP_LABELS);
    after(() => runAnalysisJob(projectId, job.id).catch((err) => failJob(job.id, err)));
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  }

  const pass = await reanalyzePass(projectId, Date.now() + BUDGET_MS);
  return NextResponse.json(
    { ok: pass.ok, assetsAnalyzed: scored, stages: pass.stages, remaining: pass.remaining, done: pass.done },
    { status: pass.ok ? 200 : 207 }
  );
}

/**
 * Progress is reported in percent (total = 100): teardowns are most of the
 * work, so they carry 60%, and the four follow-on stages 10% each.
 */
async function runAnalysisJob(projectId: string, jobId: string) {
  const write = jobWriter(jobId);
  const started = Date.now();
  const steps: JobStep[] = STEP_LABELS.map((s) => ({ ...s, status: "queued" }));
  const teardownTotal = await prisma.contentAsset.count({ where: { projectId, overallScore: { not: null } } });

  await write({ status: "running", startedAt: new Date(), total: 100, steps, currentStep: "Ad teardowns" });

  let last: Awaited<ReturnType<typeof reanalyzePass>> | null = null;
  let cancelled = false;
  let stalled = false;
  let prevRemaining = Number.POSITIVE_INFINITY;
  while (Date.now() - started < BACKGROUND_BUDGET_MS) {
    if (await cancelRequested(jobId)) {
      cancelled = true;
      break;
    }
    steps[0] = { ...steps[0], status: "running" };
    await write({ steps });
    const deadline = Math.min(Date.now() + BUDGET_MS, started + BACKGROUND_BUDGET_MS);
    last = await reanalyzePass(projectId, deadline);

    const byStage = new Map<string, StageResult>();
    // First result per stage — the second "patterns" entry is deep analysis.
    for (const s of last.stages) if (!byStage.has(s.stage)) byStage.set(s.stage, s);
    const tornDown = Math.max(0, teardownTotal - last.pendingTeardowns);
    steps[0] = {
      ...steps[0],
      status: last.pendingTeardowns === 0 ? "done" : "running",
      error: last.pendingTeardowns ? `${tornDown} of ${teardownTotal} ads torn down` : undefined,
    };
    const followOn: [number, string][] = [[1, "rollup"], [2, "gap"], [3, "patterns"], [4, "deep"]];
    for (const [idx, key] of followOn) {
      const r = key === "deep" ? last.deep : byStage.get(key);
      if (r) steps[idx] = { ...steps[idx], status: r.ok ? "done" : "failed", error: r.ok ? undefined : r.error };
    }
    const percent = Math.round(
      (teardownTotal ? (tornDown / teardownTotal) * 60 : 60) +
        steps.slice(1).filter((s) => s.status === "done").length * 10
    );
    await write({
      steps,
      done: Math.min(99, percent),
      failed: steps.filter((s) => s.status === "failed").length,
      currentStep: last.done ? null : steps[0].status === "done" ? "Finishing analysis" : "Ad teardowns",
    });
    if (last.done) break;
    // A pass that moved nothing forward will not do better on the next one
    // (e.g. the model provider is down) — stop and report instead of looping.
    if (last.remaining >= prevRemaining || last.stages.every((s) => !s.ok)) {
      stalled = true;
      break;
    }
    prevRemaining = last.remaining;
  }

  const failedSteps = steps.filter((s) => s.status === "failed");
  if (stalled && last && last.stages.every((s) => !s.ok)) {
    await write({
      status: "failed",
      steps,
      currentStep: null,
      completedAt: new Date(),
      error: last.stages.find((s) => s.error)?.error ?? "Analysis made no progress",
      result: { ids: [], failures: failedSteps.map((s) => ({ key: s.key, label: s.label, error: s.error ?? "failed" })) },
    });
    return;
  }

  const partial = !cancelled && !!last && !last.done;
  await prisma.project
    .update({ where: { id: projectId }, data: { status: "ANALYZED" } })
    .catch(() => {});
  await write({
    status: cancelled ? "cancelled" : "completed",
    done: partial || cancelled ? undefined : 100,
    steps,
    currentStep: null,
    completedAt: new Date(),
    result: {
      ids: [],
      failures: steps.filter((s) => s.status === "failed").map((s) => ({ key: s.key, label: s.label, error: s.error ?? "failed" })),
      partial,
      remaining: last?.remaining ?? null,
    },
  });
}

/** One time-budgeted pass over every post-scoring stage. */
async function reanalyzePass(projectId: string, deadline: number) {
  const stages: StageResult[] = [];
  let deep: StageResult | null = null;

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
  // Both runs above report as "patterns"; the last one is deep analysis.
  deep = stages[stages.length - 1];

  // Tell the caller whether anything is still outstanding, so the UI can keep
  // going instead of making someone press Re-analyze until the numbers stop
  // moving.
  const [pendingTeardowns, competitorsWithoutRollup] = await Promise.all([
    prisma.contentAsset.count({
      where: { projectId, overallScore: { not: null }, excluded: false, teardown: { is: null } },
    }),
    prisma.competitor.count({ where: { projectId, excluded: false, rollup: { is: null } } }),
  ]);
  const remaining = pendingTeardowns + competitorsWithoutRollup;

  return { ok: stages.every((s) => s.ok), stages, deep, remaining, pendingTeardowns, done: remaining === 0 };
}
