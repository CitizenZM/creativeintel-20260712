import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { suggestCompetitors } from "@/services/competitor-suggest";

export const maxDuration = 60;

const MIN_COMPETITORS = 3;

/**
 * Add AI-suggested competitors until the project tracks at least three (or
 * `count` more when asked). Body: { count?: number }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as { count?: unknown };
  const current = await prisma.competitor.count({ where: { projectId, excluded: false } });
  const asked = typeof body.count === "number" && body.count > 0 ? Math.min(Math.floor(body.count), 5) : 0;
  const want = Math.max(asked, MIN_COMPETITORS - current);
  if (want <= 0) return NextResponse.json({ added: [], message: "Already tracking enough competitors" });
  try {
    const added = await suggestCompetitors(projectId, want);
    return NextResponse.json({ added });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not suggest competitors" },
      { status: 500 }
    );
  }
}
