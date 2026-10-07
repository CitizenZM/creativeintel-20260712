/**
 * GET  — imported ad results + what they teach (hook style winners).
 * PUT  — { mappings: [{ adName, hookId?, endCardId?, voice?, aspect?, durationSec?, sellingPointId?, platform?, runId? }] }:
 *        the element mapping table for ads whose names don't carry their creative elements.
 * POST — import a Meta Ads Manager / TikTok Ads export (multipart "file", or a
 *        raw CSV body). Rows are matched to our versions by their A/B ad name.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rowsFromCsv } from "@/services/performance/import";
import { loadLearning, saveRows } from "@/services/performance/store";
import { loadElementLearning, saveElementMaps } from "@/services/performance/agent";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [rows, learning, elements] = await Promise.all([
    prisma.adPerformance.findMany({ where: { projectId }, orderBy: [{ dateFrom: "desc" }, { impressions: "desc" }], take: 200 }),
    loadLearning(projectId),
    loadElementLearning(projectId),
  ]);
  return NextResponse.json({ rows, learning, elements });
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  let text = "";
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "Export is larger than 4 MB — export fewer columns or days" }, { status: 413 });
    text = await file.text();
  } else {
    text = await req.text();
  }
  const { rows, platform, unmatchedHeaders } = rowsFromCsv(text);
  if (!rows.length) {
    return NextResponse.json({ error: "No ad rows found — export from Ads Manager at the Ad level with Ad name and Impressions columns" }, { status: 400 });
  }
  if (unmatchedHeaders.includes("adName") || unmatchedHeaders.includes("impressions")) {
    return NextResponse.json({ error: `Missing columns: ${unmatchedHeaders.join(", ")}` }, { status: 400 });
  }
  const saved = await saveRows(projectId, rows);
  return NextResponse.json({
    ok: true,
    platform,
    saved,
    matched: rows.filter((r) => r.hookStyle).length,
    unmatchedHeaders,
    learning: await loadLearning(projectId),
  });
}

const opt = z.string().trim().max(60).nullable().optional();
const mapSchema = z.object({
  mappings: z
    .array(z.object({ adName: z.string().trim().min(1).max(300), runId: opt, hookId: opt, endCardId: opt, voice: opt, aspect: opt, durationSec: z.number().int().positive().max(600).nullable().optional(), sellingPointId: opt, platform: opt }))
    .min(1)
    .max(500),
});

export async function PUT(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const parsed = mapSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid mappings", issues: parsed.error.issues }, { status: 400 });
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const saved = await saveElementMaps(projectId, parsed.data.mappings);
  return NextResponse.json({ ok: true, saved, elements: await loadElementLearning(projectId) });
}
