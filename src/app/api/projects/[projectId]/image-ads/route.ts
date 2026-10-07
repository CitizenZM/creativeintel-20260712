/**
 * GET  — the project's image ad sets (Project.imageAdSets, newest first).
 * POST { templates?, formats?, promo?, proof?, copy? } — render a static ad set (templates × formats)
 *      from the brief + plan locally, upload it and keep it on the project. Same service as the
 *      operator's image-ads action; no paid model call.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseOperatorAction } from "@/services/operator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { imageAdSets: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ sets: Array.isArray(project.imageAdSets) ? project.imageAdSets : [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const parsed = parseOperatorAction("image-ads", { ...body, projectId });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.data;
  const { generateImageAdSet } = await import("@/services/image-ads/generate");
  try {
    const set = await generateImageAdSet(projectId, { ...input, templates: input.templates as never, formats: input.formats as never, copy: input.copy as never });
    return NextResponse.json({ ok: true, set }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : /Unknown image ad|No product image/.test(msg) ? 400 : 500 });
  }
}
