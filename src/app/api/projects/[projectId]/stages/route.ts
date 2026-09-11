import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getProjectStages } from "@/services/project-stages";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await getProjectStages(projectId));
}
