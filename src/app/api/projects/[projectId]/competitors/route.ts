import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Add a competitor by hand; it is researched on the next run. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; url?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  let url: string | null = null;
  if (typeof body.url === "string" && body.url.trim()) {
    try {
      url = new URL(body.url.trim().startsWith("http") ? body.url.trim() : `https://${body.url.trim()}`).toString();
    } catch {
      return NextResponse.json({ error: "url is not a valid web address" }, { status: 400 });
    }
  }

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.competitor.findFirst({
    where: { projectId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) {
    // Re-adding a removed competitor brings it back instead of duplicating it.
    const competitor = await prisma.competitor.update({
      where: { id: existing.id },
      data: { excluded: false, ...(url ? { url } : {}) },
    });
    return NextResponse.json({ competitor, restored: existing.excluded }, { status: 200 });
  }
  const competitor = await prisma.competitor.create({
    data: { projectId, name, url, dataSource: "USER_INPUT" },
  });
  return NextResponse.json({ competitor }, { status: 201 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      brand: true,
      competitors: {
        include: {
          _count: { select: { contentAssets: true } },
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Per-owner paid/ranked counts so the Content page can show how full each
  // competitor's Top-N actually is rather than a raw asset total.
  const grouped = await prisma.contentAsset.groupBy({
    by: ["competitorId"],
    where: { projectId, isPaidMedia: true },
    _count: { _all: true },
  });
  const rankedGrouped = await prisma.contentAsset.groupBy({
    by: ["competitorId"],
    where: { projectId, rankInOwner: { not: null } },
    _count: { _all: true },
  });

  const paidByOwner = new Map(grouped.map((g) => [g.competitorId ?? "brand", g._count._all]));
  const rankedByOwner = new Map(
    rankedGrouped.map((g) => [g.competitorId ?? "brand", g._count._all])
  );

  return NextResponse.json({
    brand: project.brand,
    brandPaidCount: paidByOwner.get("brand") ?? 0,
    brandRankedCount: rankedByOwner.get("brand") ?? 0,
    competitors: project.competitors.map((c) => ({
      ...c,
      paidCount: paidByOwner.get(c.id) ?? 0,
      rankedCount: rankedByOwner.get(c.id) ?? 0,
    })),
  });
}
