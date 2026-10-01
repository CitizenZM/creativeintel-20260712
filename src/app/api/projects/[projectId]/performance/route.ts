/**
 * GET  — imported ad results + what they teach (hook style winners).
 * POST — import a Meta Ads Manager / TikTok Ads export (multipart "file", or a
 *        raw CSV body). Rows are matched to our versions by their A/B ad name.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rowsFromCsv } from "@/services/performance/import";
import { loadLearning, saveRows } from "@/services/performance/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [rows, learning] = await Promise.all([
    prisma.adPerformance.findMany({ where: { projectId }, orderBy: [{ dateFrom: "desc" }, { impressions: "desc" }], take: 200 }),
    loadLearning(projectId),
  ]);
  return NextResponse.json({ rows, learning });
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
