import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIVE, appendFrameHistory } from "@/services/creative-library";

/**
 * PATCH /api/projects/{projectId}/creative/storyboards/{storyboardId}/frames
 * Merges a partial update into one frame of a storyboard's frames JSON array.
 *
 * Grid-owned fields (frameNumber, startSec, endSec, duration, segment) are not
 * patchable — they come from src/lib/storyboard-grid.ts and must stay in sync
 * with the 2-second cadence.
 */
const PATCHABLE_FIELDS = new Set([
  "scene",
  "visualDirection",
  "voiceover",
  "textOverlay",
  "cameraNotes",
  "imagePrompt",
  "videoPrompt",
  "shotType",
  "cameraMove",
  "subject",
  "productAction",
  "sfx",
  "sellingPoint",
  "howExpressed",
  "imageUrl",
  "transitionEffect",
  "approved",
  "feedback",
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; storyboardId: string }> }
) {
  const { projectId, storyboardId } = await params;
  const body = await request.json().catch(() => ({}));
  const { frameNumber, ...rest } = body as { frameNumber?: unknown } & Record<string, unknown>;

  if (typeof frameNumber !== "number") {
    return NextResponse.json({ error: "frameNumber required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (PATCHABLE_FIELDS.has(key)) updates[key] = value;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No patchable fields supplied" }, { status: 400 });
  }

  const storyboard = await prisma.storyboard.findFirst({
    where: { id: storyboardId, projectId, ...LIVE },
  });

  if (!storyboard) {
    return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });
  }

  const existingFrames = Array.isArray(storyboard.frames)
    ? (storyboard.frames as Array<Record<string, unknown>>)
    : [];

  const previous = existingFrames.find((f) => f.frameNumber === frameNumber);
  if (!previous) {
    return NextResponse.json({ error: `Frame ${frameNumber} not found` }, { status: 404 });
  }

  const frames = existingFrames.map((frame) =>
    frame.frameNumber === frameNumber ? { ...frame, ...updates } : frame
  );

  // Keep what the frame said before this edit — an edit must never be the
  // only copy of the frame's content.
  const changed = Object.entries(updates).some(
    ([key, value]) => JSON.stringify(previous[key]) !== JSON.stringify(value)
  );

  const updated = await prisma.storyboard.update({
    where: { id: storyboardId },
    data: {
      frames: frames as never,
      ...(changed
        ? { frameHistory: appendFrameHistory(storyboard.frameHistory, frameNumber, previous) as never }
        : {}),
    },
  });

  return NextResponse.json({ ok: true, frames: updated.frames });
}
