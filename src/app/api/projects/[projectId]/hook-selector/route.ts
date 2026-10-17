import { NextResponse } from "next/server";
import { withAccess } from "@/lib/auth/route-guard";
import { safePublicError } from "@/lib/public-error";
import { hookTrendReport } from "@/services/research/hook-trends";

const PLATFORMS = new Set(["tiktok", "youtube", "meta", "pinterest", "snapchat"]);

async function unguardedGET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const platform = new URL(request.url).searchParams.get("platform") ?? "tiktok";
  if (!PLATFORMS.has(platform)) return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  try {
    // This is an explicit, read-only action. Classification is rules-only (zero AI tokens).
    const report = await hookTrendReport(projectId, { platform, windowDays: 30, llm: null });
    return NextResponse.json({
      generatedAt: report.generatedAt,
      window: report.window,
      platform: report.platform,
      coverage: { ...report.coverage, platformAds: report.slices[0]?.totalAds ?? 0 },
      rising: report.rising,
      saturated: report.saturated,
      longevityLeaders: report.longevityLeaders,
      recommendations: report.recommendations,
    }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    if (err instanceof Error && err.message === "Project not found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: safePublicError(err) }, { status: 500 });
  }
}

export const GET = withAccess(unguardedGET);
