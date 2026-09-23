/**
 * Persist the "send to script context" picks on the Insights page. Angle and
 * script generation read these flags, so a pick changes what gets written.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const KINDS = ["insight", "sellingPoint", "pattern"] as const;
type Kind = (typeof KINDS)[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    ids?: unknown;
    selected?: unknown;
  };

  if (!KINDS.includes(body.kind as Kind)) {
    return NextResponse.json({ error: "kind must be insight, sellingPoint or pattern" }, { status: 400 });
  }
  if (typeof body.selected !== "boolean") {
    return NextResponse.json({ error: "selected must be a boolean" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });

  const where = { projectId, id: { in: ids } };
  const data = { selected: body.selected };
  const { count } =
    body.kind === "insight"
      ? await prisma.insight.updateMany({ where, data })
      : body.kind === "sellingPoint"
        ? await prisma.sellingPoint.updateMany({ where, data })
        : await prisma.narrativePattern.updateMany({ where, data });

  return NextResponse.json({ ok: true, count });
}
