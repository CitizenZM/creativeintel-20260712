import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAccess } from "@/lib/auth/route-guard";

async function unguardedGET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const jobs = await prisma.falVideoJob.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(jobs);
}

async function unguardedDELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  await prisma.falVideoJob.deleteMany({ where: { projectId } });
  return NextResponse.json({ ok: true });
}

export const GET = withAccess(unguardedGET);
export const DELETE = withAccess(unguardedDELETE);
