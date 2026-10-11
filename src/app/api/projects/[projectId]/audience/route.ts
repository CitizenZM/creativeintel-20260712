import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAccess } from "@/lib/auth/route-guard";

async function unguardedGET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const profile = await prisma.audienceProfile.findUnique({
    where: { projectId },
  });
  return NextResponse.json(profile);
}

async function unguardedPATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));

  const allowedFields = [
    "segments", "psychographics", "painPoints", "interests",
    "platforms", "buyingBehavior", "incomeLevel", "geoMarkets",
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
  }

  const profile = await prisma.audienceProfile.upsert({
    where: { projectId },
    create: { projectId, ...updates },
    update: updates,
  });

  return NextResponse.json(profile);
}

export const GET = withAccess(unguardedGET);
export const PATCH = withAccess(unguardedPATCH);
