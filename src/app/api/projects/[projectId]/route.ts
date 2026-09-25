import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isGoalType } from "@/lib/style-categories";
import { readStatusMap } from "@/lib/field-status";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      brand: true,
      competitors: true,
      _count: {
        select: {
          contentAssets: true,
          insights: true,
          scripts: true,
          storyboards: true,
          creativeVariants: true,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

/** Fields whose review state is tracked in Project.fieldStatus (see src/lib/field-status.ts). */
const TRACKED_FIELDS = ["campaignGoal", "goalType"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));

  // "Confirm all suggestions" — clears every "suggested" mark on this project
  // to "confirmed" without changing any value. Setup page calls this.
  if (body && typeof body === "object" && body.action === "confirmAllSuggestions") {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { fieldStatus: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const status = readStatusMap(project.fieldStatus);
    const nextStatus = Object.fromEntries(
      Object.entries(status).map(([k, v]) => [k, v === "suggested" ? "confirmed" : v])
    );
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: { fieldStatus: nextStatus as never },
    });
    return NextResponse.json(updated);
  }

  // Confirm one suggested field without changing its value (FieldShell's Confirm button).
  if (body && typeof body === "object" && body.action === "confirmField" && typeof body.field === "string") {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { fieldStatus: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const status = readStatusMap(project.fieldStatus);
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: { fieldStatus: { ...status, [body.field]: "confirmed" } as never },
    });
    return NextResponse.json(updated);
  }

  const allowed = ["brandUrl", "productUrl", "productName", "campaignGoal", "briefingText", "category", "name"];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body && typeof body === "object" && key in body) data[key] = body[key];
  }
  if (body && typeof body === "object" && "goalType" in body) {
    if (body.goalType !== null && !isGoalType(body.goalType)) {
      return NextResponse.json({ error: "goalType must be storytelling, conversion or hybrid" }, { status: 400 });
    }
    data.goalType = body.goalType;
  }
  // Archiving is a boolean at the API edge but a timestamp in the row, so the
  // list can show when something was put away.
  if (body && typeof body === "object" && "archived" in body) {
    data.archivedAt = body.archived ? new Date() : null;
  }

  // A field the user explicitly edited here is their own, by definition — clear
  // any "suggested" mark on it so it reads as confirmed (green).
  const touchedTracked = TRACKED_FIELDS.filter((f) => f in data);
  if (touchedTracked.length > 0) {
    const existing = await prisma.project.findUnique({ where: { id: projectId }, select: { fieldStatus: true } });
    const status = readStatusMap(existing?.fieldStatus);
    const nextStatus = { ...status };
    for (const f of touchedTracked) nextStatus[f] = "confirmed";
    data.fieldStatus = nextStatus;
  }

  try {
    const project = await prisma.project.update({ where: { id: projectId }, data });
    return NextResponse.json(project);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  try {
    await prisma.project.delete({ where: { id: projectId } });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    throw err;
  }
}
