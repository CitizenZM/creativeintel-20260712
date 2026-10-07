/**
 * POST { locales[], gender?, force? } — localized versions of a finished server master (same clips;
 * translated voiceover, captions, on-screen text and end card). Locales render one after another
 * after the response (~2–3 min each); the Studio polls the run for qcReport.locales / localesPending.
 */
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { parseOperatorAction } from "@/services/operator";
import { isServerEngine } from "@/services/video-gen/libtv-pricing";
import { missingLocales } from "@/services/video-gen/localize";
import { loadAiSettings } from "@/services/settings/ai-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const parsed = parseOperatorAction("localize-run", { ...body, projectId, runId });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.data;
  const run = await prisma.libtvRun.findFirst({ where: { id: runId, projectId }, select: { id: true, executor: true, status: true, qcReport: true } });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!isServerEngine(run.executor) || run.status !== "completed") {
    return NextResponse.json({ error: `Only completed server runs can be localized (status ${run.status})` }, { status: 409 });
  }
  const queued = missingLocales((run.qcReport ?? {}) as never, input.locales, Date.now(), input.force);
  if (queued.length) {
    await loadAiSettings();
    const { localizeRun } = await import("@/services/video-gen/localize-run");
    after(() =>
      localizeRun(run.id, queued, { gender: input.gender, force: input.force, budgetMs: 280_000 }).then((r) =>
        console.log(`[localize] ${run.id}: done ${r.done.map((d) => d.locale).join(",") || "-"} failed ${r.failed.map((f) => f.locale).join(",") || "-"} left ${r.left.join(",") || "-"}`)
      )
    );
  }
  return NextResponse.json(
    {
      ok: true,
      queued,
      skipped: input.locales.filter((l) => !queued.includes(l)),
      note: queued.length > 1 ? "Locales render one after another (~2–3 min each); any that don't fit this call's time budget stay missing — start again to continue." : undefined,
    },
    { status: 202 }
  );
}
