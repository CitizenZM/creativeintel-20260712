import { safePublicError } from "@/lib/public-error";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAccess } from "@/lib/auth/route-guard";

async function unguardedGET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; operationId: string }> }
) {
  const { projectId, operationId } = await params;

  // Only operations this project started (generate-video records each one as a FalVideoJob): the
  // poll uses the platform's shared Google key, so an arbitrary id must never reach it.
  const own = await prisma.falVideoJob.findFirst({
    where: { projectId, falRequestId: operationId },
    select: { status: true, videoUrl: true, error: true },
  });
  if (!own) return NextResponse.json({ error: "Operation not found", done: false }, { status: 404 });

  return NextResponse.json({
    done: ["completed", "failed"].includes(own.status),
    videoUrl: own.videoUrl,
    error: own.error ? safePublicError(own.error) : null,
    operationId,
  });
}

export const GET = withAccess(unguardedGET);
