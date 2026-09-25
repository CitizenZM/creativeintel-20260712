import Link from "next/link";
import { prisma } from "@/lib/db";
import { StageGuide } from "@/components/layout/stage-guide";
import { isPlayable } from "@/components/studio/types";
import { Download, ExternalLink, Film, FileText, Clapperboard } from "lucide-react";

export const dynamic = "force-dynamic";

type RunLike = { status: string; masterMp4Url: string | null; isFinal: boolean };

// Final deliverables first, then other finished cuts, then work still
// rendering, then failures — so the thing to ship is never buried.
const RUN_GROUPS: { id: string; label: string; match: (r: RunLike) => boolean }[] = [
  { id: "final", label: "Final", match: (r) => r.isFinal },
  { id: "ready", label: "Ready", match: (r) => !r.isFinal && r.status === "completed" },
  {
    id: "progress",
    label: "In progress",
    match: (r) => ["draft", "awaiting_approval", "approved", "claimed", "running", "assembling"].includes(r.status),
  },
  { id: "failed", label: "Failed or cancelled", match: (r) => r.status === "failed" || r.status === "cancelled" },
];

export default async function DeliverPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [runs, scripts, storyboards] = await Promise.all([
    prisma.libtvRun.findMany({
      where: { projectId },
      orderBy: [{ isFinal: "desc" }, { createdAt: "desc" }],
      include: { jobs: { select: { status: true, kind: true } } },
    }),
    prisma.script.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, videoType: true, template: true, totalDurationSec: true, platform: true },
    }),
    prisma.storyboard.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, scriptId: true, totalDuration: true, frameSeconds: true },
    }),
  ]);

  const delivered = runs.filter((r) => r.masterMp4Url);
  const scriptById = new Map(scripts.map((s) => [s.id, s]));

  return (
    <div className="space-y-8">
      <StageGuide projectId={projectId} stage="deliver" detail="Finished masters land here once a studio run renders." />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Deliverables</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Finished ad videos rendered on LibTV, plus the scripts and storyboards behind them.
          </p>
        </div>
        <a
          href={`/api/projects/${projectId}/export`}
          className={`inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted${
            delivered.length > 0 ? " cta-attention" : ""
          }`}
        >
          <Download className="h-3.5 w-3.5" /> Export package (zip)
        </a>
      </div>

      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
          <Film className="h-4 w-4" /> Rendered videos
          <span className="text-xs font-normal text-muted-foreground">{delivered.length} ready · {runs.length} runs</span>
        </h3>
        {runs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground space-y-2">
            <p>
              Nothing rendered yet.{" "}
              {storyboards.length > 0 ? (
                <>
                  You already have{" "}
                  <strong className="text-foreground">
                    {storyboards.length} storyboard{storyboards.length === 1 ? "" : "s"}
                  </strong>{" "}
                  ready to compile.
                </>
              ) : (
                <>Write a script and build a storyboard first.</>
              )}
            </p>
            <Link
              href={`/projects/${projectId}/${storyboards.length > 0 ? "studio" : "creative"}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
            >
              {storyboards.length > 0 ? "Compile a run in Studio" : "Go to Creative"} →
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {RUN_GROUPS.map((group) => {
              const list = runs.filter(group.match);
              if (list.length === 0) return null;
              return (
                <div key={group.id} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label} <span className="num">({list.length})</span>
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((run) => {
              const script = run.scriptId ? scriptById.get(run.scriptId) : null;
              const done = run.jobs.filter((j) => j.status === "completed").length;
              const playable = isPlayable(run.previewMp4Url)
                ? run.previewMp4Url
                : isPlayable(run.masterMp4Url)
                  ? run.masterMp4Url
                  : null;
              return (
                <div key={run.id} className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="aspect-[9/16] max-h-64 bg-muted/50 flex items-center justify-center">
                    {playable ? (
                      <video
                        src={playable}
                        controls
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-contain bg-black"
                      />
                    ) : (
                      <span className="px-3 text-center text-xs text-muted-foreground">
                        {run.masterMp4Url
                          ? "Master is on a file:// path — set LOCAL_FILES_ROOT or a storage provider"
                          : run.status === "failed"
                            ? "Failed"
                            : `${run.status} · ${done}/${run.jobs.length} nodes`}
                      </span>
                    )}
                  </div>
                  <div className="p-3 space-y-1.5">
                    <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                      {run.isFinal && (
                        <span className="shrink-0 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                          FINAL
                        </span>
                      )}
                      {run.parentRunId && (
                        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          re-render
                        </span>
                      )}
                      <span className="truncate">{script?.title ?? run.canvasName ?? run.id}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {script?.videoType ?? "—"} · {script?.template ?? "—"} · {script?.totalDurationSec ?? "?"}s ·{" "}
                      {run.creditsSpent || run.creditsEstimated} credits
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {run.masterMp4Url && (
                        <a
                          href={run.masterMp4Url}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
                        >
                          <Download className="h-3 w-3" /> Master
                        </a>
                      )}
                      {run.canvasUrl && (
                        <a
                          href={run.canvasUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
                        >
                          <ExternalLink className="h-3 w-3" /> Open in LibTV
                        </a>
                      )}
                      {run.contactSheetUrl && (
                        <a
                          href={run.contactSheetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
                        >
                          Contact sheet
                        </a>
                      )}
                      {(run.status === "failed" || run.status === "cancelled" || (run.status === "completed" && !run.isFinal)) && (
                        <Link
                          href={`/projects/${projectId}/studio${run.storyboardId ? `?storyboardId=${run.storyboardId}` : ""}`}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
                        >
                          {run.status === "completed" ? "Review in Studio" : "Fix in Studio"} →
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
            <FileText className="h-4 w-4" /> Scripts <span className="text-xs font-normal text-muted-foreground">{scripts.length}</span>
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {scripts.slice(0, 20).map((s) => (
              <li key={s.id} className="px-3 py-2 text-sm">
                <p className="font-medium truncate">{s.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {/* Older scripts predate these fields — show only what is known. */}
                  {[s.videoType, s.template, s.platform, s.totalDurationSec ? `${s.totalDurationSec}s` : null]
                    .filter(Boolean)
                    .join(" · ") || "Script"}
                </p>
              </li>
            ))}
            {scripts.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">No scripts yet.</li>}
          </ul>
        </div>
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
            <Clapperboard className="h-4 w-4" /> Storyboards{" "}
            <span className="text-xs font-normal text-muted-foreground">{storyboards.length}</span>
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {storyboards.slice(0, 20).map((b) => (
              <li key={b.id} className="px-3 py-2 text-sm">
                <p className="font-medium truncate">{b.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {b.totalDuration ?? "?"} · {b.frameSeconds}s frames · script {b.scriptId ? scriptById.get(b.scriptId)?.title ?? b.scriptId : "—"}
                </p>
              </li>
            ))}
            {storyboards.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">No storyboards yet.</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}
