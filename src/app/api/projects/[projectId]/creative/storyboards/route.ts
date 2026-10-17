import { safePublicError } from "@/lib/public-error";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildStoryboardCreateData } from "@/services/ai/storyboard-generator";
import { getBrandTruthForPrompts } from "@/services/brand-kit";
import { withIdempotency } from "@/lib/idempotency";
import { LIVE, createStoryboardVersion, listStoryboards } from "@/services/creative-library";
import { withAccess } from "@/lib/auth/route-guard";

export const maxDuration = 300;

async function unguardedGET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  return NextResponse.json(await listStoryboards(projectId));
}

async function unguardedPOST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const idem = await withIdempotency<unknown>(request, {
    route: "creative/storyboards",
    projectId,
  });
  if (idem.replay && idem.response) return idem.response;

  const body = await request.json().catch(() => ({}));
  const { scriptId } = body as { scriptId?: string };

  try {
    if (!scriptId) {
      return NextResponse.json({ error: "scriptId required" }, { status: 400 });
    }

    const script = await prisma.script.findFirst({ where: { id: scriptId, projectId, ...LIVE } });
    if (!script) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [campaignSel, brandKit, brandTruth] = await Promise.all([
      prisma.campaignSelection.findUnique({ where: { projectId } }).catch(() => null),
      prisma.brandKit.findUnique({ where: { projectId } }).catch(() => null),
      getBrandTruthForPrompts(projectId).catch(() => ""),
    ]);

    const data = await buildStoryboardCreateData(projectId, script, project, campaignSel, {
      brandTruth: brandTruth || undefined,
      approvedOffer: brandKit?.offerText || undefined,
    });
    const storyboard = await createStoryboardVersion(data);

    await idem.commit?.(storyboard, 200);
    return NextResponse.json(storyboard);
  } catch (err) {
    console.error("Storyboard generation failed:", err);
    return NextResponse.json(
      { error: safePublicError(err) },
      { status: 500 }
    );
  }
}

export const GET = withAccess(unguardedGET);
export const POST = withAccess(unguardedPOST);
