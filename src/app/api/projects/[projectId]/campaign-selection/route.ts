import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sanitizeStyleCategories } from "@/lib/style-categories";

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const sel = await prisma.campaignSelection.findUnique({ where: { projectId } });
  return NextResponse.json(sel || {});
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
  return NextResponse.json(sel);
}
