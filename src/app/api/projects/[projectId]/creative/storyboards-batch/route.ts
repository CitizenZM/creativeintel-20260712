import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildStoryboardCreateData } from "@/services/ai/storyboard-generator";
import { getBrandTruthForPrompts } from "@/services/brand-kit";
import { withIdempotency } from "@/lib/idempotency";
import { pMapSettled } from "@/lib/parallel";

export const maxDuration = 60;

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
  const { scriptIds } = body as { scriptIds?: string[] };

  if (!scriptIds || !Array.isArray(scriptIds) || scriptIds.length === 0) {
    return NextResponse.json({ error: "scriptIds array required" }, { status: 400 });
  }

  try {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [scripts, campaignSel, brandKit, brandTruth] = await Promise.all([
      prisma.script.findMany({ where: { id: { in: scriptIds }, projectId } }),
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
    };

    const settled = await pMapSettled(
      scripts,
      async (script) => {
        const data = await buildStoryboardCreateData(projectId, script, project, campaignSel, extras);
        return prisma.storyboard.create({ data });
      },
      { concurrency: CONCURRENCY }
    );

    const storyboards = settled
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof prisma.storyboard.create>>>).value);

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
