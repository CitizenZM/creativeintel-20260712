import { NextResponse, after } from "next/server";
import { createJob, failJob, runJobItems, runningJob } from "@/services/jobs";
import { prisma } from "@/lib/db";
import { buildStoryboardCreateData } from "@/services/ai/storyboard-generator";
import { getBrandTruthForPrompts } from "@/services/brand-kit";
import { renderVisualDirection } from "@/lib/visual-direction";
import { withIdempotency } from "@/lib/idempotency";
import { pMapSettled } from "@/lib/parallel";
import { LIVE, createStoryboardVersion } from "@/services/creative-library";

export const maxDuration = 300;

const CONCURRENCY = 4;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const idem = await withIdempotency<unknown>(request, {
    route: "creative/storyboards-batch",
    projectId,
  });
  if (idem.replay && idem.response) return idem.response;

  const body = await request.json().catch(() => ({}));
  const { scriptIds, visualDirection, background } = body as {
    scriptIds?: string[];
    visualDirection?: { lighting?: string; style?: string; notes?: string };
    background?: boolean;
  };

  if (!scriptIds || !Array.isArray(scriptIds) || scriptIds.length === 0) {
    return NextResponse.json({ error: "scriptIds array required" }, { status: 400 });
  }

  try {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [scripts, campaignSel, brandKit, brandTruth] = await Promise.all([
      // Deduped: boarding the same script twice in one batch would race on its
      // version number.
      prisma.script.findMany({ where: { id: { in: [...new Set(scriptIds)] }, projectId, ...LIVE } }),
      prisma.campaignSelection.findUnique({ where: { projectId } }).catch(() => null),
      prisma.brandKit.findUnique({ where: { projectId } }).catch(() => null),
      getBrandTruthForPrompts(projectId).catch(() => ""),
    ]);

    if (!scripts.length) {
      return NextResponse.json({ error: "No matching scripts" }, { status: 404 });
    }

    const extras = {
      brandTruth: brandTruth || undefined,
      approvedOffer: brandKit?.offerText || undefined,
      visualDirection: renderVisualDirection(visualDirection) || undefined,
    };

    const boardOne = async (script: (typeof scripts)[number]) => {
      const data = await buildStoryboardCreateData(projectId, script, project, campaignSel, extras);
      return createStoryboardVersion(data);
    };

    if (background) {
      const running = await runningJob(projectId, "storyboards");
      if (running) return NextResponse.json({ jobId: running.id, reused: true }, { status: 202 });
      const describe = (s: (typeof scripts)[number]) => ({ key: s.id, label: s.title });
      const job = await createJob(projectId, "storyboards", scripts.map(describe), { scriptIds, visualDirection });
      after(() =>
        runJobItems(job.id, scripts, describe, boardOne, { concurrency: CONCURRENCY }).catch((err) =>
          failJob(job.id, err)
        )
      );
      const payload = { jobId: job.id, requested: scripts.length };
      await idem.commit?.(payload, 202);
      return NextResponse.json(payload, { status: 202 });
    }

    const settled = await pMapSettled(scripts, boardOne, { concurrency: CONCURRENCY });

    const storyboards = settled
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof createStoryboardVersion>>>).value);

    const failures = settled
      .map((r, i) =>
        r.status === "rejected"
          ? {
              scriptId: scripts[i].id,
              scriptTitle: scripts[i].title,
              error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            }
          : null
      )
      .filter((f): f is { scriptId: string; scriptTitle: string; error: string } => f !== null);

    for (const f of failures) {
      console.error("Storyboard failed for script:", f.scriptId, f.error);
    }

    if (!storyboards.length) {
      return NextResponse.json(
        { error: "Every storyboard in this batch failed", failures },
        { status: 500 }
      );
    }

    const payload = { storyboards, failures };
    await idem.commit?.(payload, 200);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("Storyboards batch failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate storyboards" },
      { status: 500 }
    );
  }
}
