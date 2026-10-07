/**
 * GET ?format=html|docx[&narrative=llm] — the project's client campaign report as a file
 * (services/reports). The summary is the deterministic template unless narrative=llm, which spends
 * one budget-guarded text-model call.
 */
import { NextResponse } from "next/server";
import { buildCampaignReportModel, llmNarrator, loadReportInputs } from "@/services/reports/campaign-report";
import { renderReportHtml } from "@/services/reports/report-html";
import { DOCX_CONTENT_TYPE, renderReportDocx } from "@/services/reports/report-docx";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "html";
  if (format !== "html" && format !== "docx") return NextResponse.json({ error: "format must be html or docx" }, { status: 400 });
  const data = await loadReportInputs(projectId);
  if (!data) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const model = await buildCampaignReportModel(data, { narrator: url.searchParams.get("narrative") === "llm" ? llmNarrator(projectId) : null });
  const name = `${(model.project.title || "campaign").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}-report`;
  if (format === "docx") {
    const buf = await renderReportDocx(model);
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": DOCX_CONTENT_TYPE, "Content-Disposition": `attachment; filename="${name}.docx"`, "Cache-Control": "no-store" },
    });
  }
  return new Response(renderReportHtml(model), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename="${name}.html"`, "Cache-Control": "no-store" },
  });
}
