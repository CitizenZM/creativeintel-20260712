import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pollVeoOperation, PollError } from "@/services/video-gen/poll";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; operationId: string }> }
) {
  const { projectId, operationId } = await params;

  // Only operations this project started (generate-video records each one as a FalVideoJob): the
  // poll uses the platform's shared Google key, so an arbitrary id must never reach it.
  const own = await prisma.falVideoJob.findFirst({
    where: { projectId, falRequestId: operationId },
    select: { id: true },
  });
  if (!own) return NextResponse.json({ error: "Operation not found", done: false }, { status: 404 });

  try {
    const result = await pollVeoOperation(operationId);

    if (result.done) {
      return NextResponse.json({
        done: true,
        videoUrl: result.videoUrl ?? null,
        operationId,
      });
    }

    return NextResponse.json({
      done: false,
      operationId,
      metadata: result.metadata || null,
    });
  } catch (err) {
    if (err instanceof PollError) {
      return NextResponse.json({ error: err.message, done: false }, { status: err.status });
    }
    console.error("Video status check failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed", done: false },
      { status: 500 }
    );
  }
}
