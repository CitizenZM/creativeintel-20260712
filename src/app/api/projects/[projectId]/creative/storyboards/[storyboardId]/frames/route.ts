import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIVE, appendFrameHistory, type FrameHistoryEntry } from "@/services/creative-library";

// Grid-owned fields keep their current values on undo — only content reverts.
const GRID_FIELDS = ["frameNumber", "startSec", "endSec", "duration", "segment"];

/**
 * POST {frameNumber} — undo the last edit to one frame: restore its most
 * recent history snapshot and drop that snapshot. Returns how many earlier
 * edits can still be undone.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string; storyboardId: string }> }
) {
  const { projectId, storyboardId } = await params;
  const body = (await request.json().catch(() => ({}))) as { frameNumber?: unknown };
  if (typeof body.frameNumber !== "number") {
    return NextResponse.json({ error: "frameNumber required" }, { status: 400 });
  }
  const frameNumber = body.frameNumber;

  const storyboard = await prisma.storyboard.findFirst({ where: { id: storyboardId, projectId, ...LIVE } });
  if (!storyboard) return NextResponse.json({ error: "Storyboard not found" }, { status: 404 });

  const history = Array.isArray(storyboard.frameHistory)
    ? (storyboard.frameHistory as unknown as FrameHistoryEntry[])
    : [];
  let lastIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].frameNumber === frameNumber) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1) return NextResponse.json({ error: "Nothing to undo for this frame" }, { status: 409 });

  const frames = Array.isArray(storyboard.frames) ? (storyboard.frames as Array<Record<string, unknown>>) : [];
  const current = frames.find((f) => f.frameNumber === frameNumber);
  if (!current) return NextResponse.json({ error: `Frame ${frameNumber} not found` }, { status: 404 });

  const snapshot: Record<string, unknown> = { ...history[lastIdx].frame };
  for (const key of GRID_FIELDS) snapshot[key] = current[key];
  // Undoing a text edit must not throw away the frame's rendered image —
  // the card would regenerate it (and pay for it) the moment it disappeared.
  if (!snapshot.imageUrl && current.imageUrl) snapshot.imageUrl = current.imageUrl;
  const nextFrames = frames.map((f) => (f.frameNumber === frameNumber ? snapshot : f));
  const nextHistory = history.filter((_, i) => i !== lastIdx);

  await prisma.storyboard.update({
    where: { id: storyboardId },
    data: { frames: nextFrames as never, frameHistory: nextHistory as never },
  });
  return NextResponse.json({
    ok: true,
    frame: snapshot,
    remaining: nextHistory.filter((h) => h.frameNumber === frameNumber).length,
  });
}

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
  // A generated keyframe image being attached is not an edit a person would
  // want to undo, so image-only updates leave the history alone.
  const changed = Object.entries(updates).some(
    ([key, value]) => key !== "imageUrl" && JSON.stringify(previous[key]) !== JSON.stringify(value)
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
