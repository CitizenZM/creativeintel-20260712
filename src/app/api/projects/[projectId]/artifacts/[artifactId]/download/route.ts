/**
 * GET — one archived artifact as a file: its stored bytes (ArtifactBlob) when kept, else its stored JSON /
 * text (briefs, plans, storyboards, scripts → .json; HTML reports → .html), else its blob URL proxied
 * with a Content-Disposition filename. ?inline=1 for previews and the JSON viewer.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { contentDisposition, downloadPlan, openStoredUrl } from "@/services/artifacts/serve";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; artifactId: string }> }) {
  const { projectId, artifactId } = await params;
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const a = await prisma.projectArtifact.findFirst({ where: { id: artifactId, projectId }, include: { blob: { select: { artifactId: true } } } });
  if (!a) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  const plan = downloadPlan({ ...a, hasBlob: !!a.blob });
  const headers = (type: string, length?: number | null): Record<string, string> => ({
    "Content-Type": type,
    "Content-Disposition": contentDisposition(plan.filename, inline),
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    ...(length ? { "Content-Length": String(length) } : {}),
    ...(a.sha256 ? { "X-Artifact-Sha256": a.sha256 } : {}),
  });

  if (plan.source === "blob") {
    const blob = await prisma.artifactBlob.findUnique({ where: { artifactId: a.id } });
    if (blob) return new Response(new Uint8Array(blob.data), { headers: headers(plan.contentType, blob.data.length) });
  }
  if (plan.source === "content") return new Response(plan.body, { headers: headers(plan.contentType) });
  if (plan.source === "data-url") return new Response(new Uint8Array(plan.body), { headers: headers(plan.contentType, plan.body.length) });
  const url = plan.source === "proxy" ? plan.url : a.url && /^https?:/i.test(a.url) ? a.url : null;
  if (!url) return NextResponse.json({ error: "Nothing stored for this artifact" }, { status: 404 });
  const body = await openStoredUrl(url);
  if (!body) return NextResponse.json({ error: "The stored file could not be fetched (missing or broken URL)", url }, { status: 502 });
  return new Response(body, { headers: headers(a.contentType || "application/octet-stream", a.bytes) });
}
