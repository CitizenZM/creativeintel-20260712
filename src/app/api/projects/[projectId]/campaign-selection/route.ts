import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sanitizeStyleCategories } from "@/lib/style-categories";
import { readStatusMap } from "@/lib/field-status";
import { campaignFieldKey } from "@/lib/setup-suggest";

// Only these fields may be written from the request body. A raw `...body` spread
// would let an unknown field or a wrong-typed value (e.g. totalDurationSec as a
// string) throw a PrismaClientValidationError (500).
const STRING_FIELDS = [
  "selectedProductName",
  "selectedProductImage",
  "selectedEnvironment",
  "selectedEnvImage",
  "selectedEnvNotes",
  "selectedActorRole",
  "selectedActorImage",
  "selectedActorDesc",
  "selectedActorAge",
  "platform",
] as const;
const JSON_FIELDS = [
  "selectedSellingPoints",
  "videoTimeline",
  "referenceVideoIds",
] as const;

function sanitizeSelection(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const k of STRING_FIELDS) {
    if (typeof body[k] === "string") data[k] = body[k];
  }
  for (const k of JSON_FIELDS) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  if (body.totalDurationSec !== undefined) {
    const n = Number(body.totalDurationSec);
    if (Number.isFinite(n)) data.totalDurationSec = Math.round(n);
  }
  if (typeof body.confirmed === "boolean") data.confirmed = body.confirmed;
  if (body.styleCategories !== undefined) data.styleCategories = sanitizeStyleCategories(body.styleCategories);
  return data;
}

/**
 * Whichever CampaignSelection fields this write touches become confirmed (the
 * user set them), regardless of any prior "suggested" mark. Review state for
 * CampaignSelection fields lives on the parent Project.fieldStatus, keyed
 * "campaign.<field>", per the shared convention (see src/lib/setup-suggest.ts).
 */
async function markCampaignFieldsConfirmed(projectId: string, touchedKeys: string[]) {
  if (touchedKeys.length === 0) return;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { fieldStatus: true } });
  const status = readStatusMap(project?.fieldStatus);
  const next = { ...status };
  for (const k of touchedKeys) next[campaignFieldKey(k)] = "confirmed";
  await prisma.project.update({ where: { id: projectId }, data: { fieldStatus: next as never } });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const [sel, project] = await Promise.all([
    prisma.campaignSelection.findUnique({ where: { projectId } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { fieldStatus: true } }),
  ]);
  return NextResponse.json({ ...(sel || {}), fieldStatus: project?.fieldStatus ?? null });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));
  const data = sanitizeSelection(body);

  const sel = await prisma.campaignSelection.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
  });
  await markCampaignFieldsConfirmed(projectId, Object.keys(data));
  return NextResponse.json(sel);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));

  // Handle confirm action
  if (body.action === "confirm") {
    const sel = await prisma.campaignSelection.upsert({
      where: { projectId },
      create: { projectId, confirmed: true, confirmedAt: new Date() },
      update: { confirmed: true, confirmedAt: new Date() },
    });
    return NextResponse.json(sel);
  }

  const data = sanitizeSelection(body);
  const sel = await prisma.campaignSelection.upsert({
    where: { projectId },
    create: { projectId, ...data },
    update: data,
  });
  await markCampaignFieldsConfirmed(projectId, Object.keys(data));
  return NextResponse.json(sel);
}
