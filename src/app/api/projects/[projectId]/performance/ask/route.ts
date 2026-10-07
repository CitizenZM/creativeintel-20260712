/**
 * POST { question } — "ask the data": the Performance Agent answers from the project's aggregated
 * results table (element level × hook rate, hold rate, CTR, CPC, CPM, CVR, CPA, ROAS + A/B
 * verdicts), citing numbers from that table only. Returns the answer and the table it used.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { askPerformance } from "@/services/performance/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ question: z.string().trim().min(3).max(500) });

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body must be { question: string (3–500 chars) }" }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(await askPerformance(projectId, parsed.data.question));
}
