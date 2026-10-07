/**
 * Pick 3 opening hooks + an end card per platform (category × platform × goal × promo). Pure and free —
 * no model call. Category comes from the stored product brief unless the body overrides it.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { categoryFromBrief, runSelection, selectBodySchema } from "./_select";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsed = selectBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const body = parsed.data;

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, productBrief: true } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const category = body.category ?? categoryFromBrief(project.productBrief);
  if (!category) return NextResponse.json({ error: "No product brief yet — generate it, or pass a category" }, { status: 409 });

  const results = runSelection(category, body);
  if (body.platforms?.length) {
    return NextResponse.json({ category, choices: Object.fromEntries(results.map((r) => [r.platform, r.choice])) });
  }
  return NextResponse.json({ category, choice: results[0].choice });
}
