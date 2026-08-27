"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Link2,
  Download,
  Scissors,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Film,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface VideoReference {
  id: string;
  sourceUrl: string;
  platform: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  transcript: string | null;
  language: string | null;
  createdAt: string;
  title?: string | null;
  thumbnail?: string | null;
}

interface RenderJob {
  id: string;
  kind: string; // import | shortsify | generate
  status: string; // pending | running | complete | error
  progress: number;
  currentStep: string | null;
  error: string | null;
  outputPath: string | null;
  output: {
    videoReferenceId?: string;
    durationSec?: number;
    width?: number;
    height?: number;
    hookText?: string;
    rationale?: string;
  } | null;
  createdAt: string;
}

type AspectRatio = "9:16" | "16:9" | "1:1";

const ASPECTS: AspectRatio[] = ["9:16", "16:9", "1:1"];
const DURATIONS = [15, 30, 45, 60];

function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function VideoLibraryPanel({ projectId }: { projectId: string }) {
  const [refs, setRefs] = useState<VideoReference[]>([]);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-reference shortsify controls
  const [targetDuration, setTargetDuration] = useState(30);
  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const [shortifyingRef, setShortifyingRef] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRefs = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/video/references`);
      const data = await res.json().catch(() => []);
      if (Array.isArray(data)) setRefs(data);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/video/jobs`);
      const data = await res.json().catch(() => ({ jobs: [] }));
      const all: RenderJob[] = data.jobs || [];
      // Only surface import/shortsify here; fal.ai generation lives elsewhere.
      setJobs(all.filter((j) => j.kind === "import" || j.kind === "shortsify"));
      return all;
    } catch {
      return [];
    }
  }, [projectId]);

  useEffect(() => {
    (async () => {
      await Promise.all([loadRefs(), loadJobs()]);
    })();
  }, [loadRefs, loadJobs]);

  // Poll while any job is active.
  const hasActive = jobs.some((j) => j.status === "pending" || j.status === "running");
  useEffect(() => {
    if (!hasActive) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const all = await loadJobs();
      const stillActive = all.some(
        (j) =>
          (j.kind === "import" || j.kind === "shortsify") &&
          (j.status === "pending" || j.status === "running")
      );
      if (!stillActive) {
        loadRefs(); // a completed import/shortsify may have added a reference
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    }, 2500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [hasActive, loadJobs, loadRefs]);

  async function startImport() {
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/video/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Import failed");
      setImportUrl("");
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function makeShort(ref: VideoReference) {
    setShortifyingRef(ref.id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/video/shortsify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoReferenceId: ref.id,
          targetDurationSec: targetDuration,
          aspectRatio: aspect,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Shortsify failed");
      await loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Shortsify failed");
    } finally {
      setShortifyingRef(null);
    }
  }

  async function deleteJob(id: string) {
    await fetch(`/api/projects/${projectId}/video/jobs/${id}`, {
      method: "DELETE",
    }).catch(() => {});
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  const completedShorts = jobs.filter(
    (j) => j.kind === "shortsify" && j.status === "complete"
  );

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-5">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Film className="h-4 w-4" /> Reference library &amp; shorts
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Import a TikTok / YouTube / Douyin URL, then auto-cut a vertical short
          from its best moment.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Import */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startImport()}
            placeholder="https://www.tiktok.com/@user/video/…"
            className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-foreground/40"
          />
        </div>
        <Button
          onClick={startImport}
          disabled={importing || !importUrl.trim()}
          size="sm"
          className="h-9 rounded-md bg-foreground text-background hover:bg-foreground/90 text-xs shrink-0"
        >
          {importing ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Link2 className="mr-1.5 h-3.5 w-3.5" />
          )}
          Import
        </Button>
      </div>

      {/* Shortsify controls */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted-foreground font-medium">Short settings:</span>
        <div className="flex items-center gap-1">
          {DURATIONS.map((d) => (
            <button
              key={d}
              onClick={() => setTargetDuration(d)}
              className={cn(
                "rounded-md border px-2 py-1 transition-colors",
                targetDuration === d
                  ? "border-foreground bg-foreground/5 font-medium"
                  : "border-border text-muted-foreground hover:border-foreground/40"
              )}
            >
              {d}s
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {ASPECTS.map((a) => (
            <button
              key={a}
              onClick={() => setAspect(a)}
              className={cn(
                "rounded-md border px-2 py-1 transition-colors",
                aspect === a
                  ? "border-foreground bg-foreground/5 font-medium"
                  : "border-border text-muted-foreground hover:border-foreground/40"
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* Active / recent jobs */}
      {jobs.length > 0 && (
        <div className="space-y-1.5">
          {jobs.map((j) => (
            <div
              key={j.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs"
            >
              {j.status === "complete" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              ) : j.status === "error" ? (
                <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
              ) : (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 shrink-0" />
              )}
              <span className="font-medium capitalize">{j.kind}</span>
              <span className="text-muted-foreground truncate flex-1">
                {j.status === "error"
                  ? j.error
                  : j.status === "complete"
                    ? j.currentStep || "Done"
                    : `${j.currentStep || "Working"} · ${Math.round(j.progress)}%`}
              </span>
              {j.kind === "shortsify" && j.status === "complete" && j.outputPath && (
                <a
                  href={`/api/projects/${projectId}/video/jobs/${j.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-foreground hover:underline shrink-0"
                >
                  <Download className="h-3 w-3" /> Open
                </a>
              )}
              {(j.status === "complete" || j.status === "error") && (
                <button
                  onClick={() => deleteJob(j.id)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Completed shorts preview */}
      {completedShorts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {completedShorts.map((j) => (
            <div
              key={j.id}
              className="rounded-lg border border-border overflow-hidden bg-black/5"
            >
              <video
                src={`/api/projects/${projectId}/video/jobs/${j.id}/file`}
                controls
                className="w-full aspect-[9/16] object-cover bg-black"
              />
              {j.output?.hookText && (
                <p className="px-2 py-1.5 text-[10px] text-muted-foreground line-clamp-2">
                  {j.output.hookText}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reference list */}
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
          References ({refs.length})
        </p>
        {refs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
            No references yet. Import a video URL above to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {refs.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                {r.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.thumbnail}
                    alt=""
                    className="h-12 w-12 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="h-12 w-12 rounded bg-muted flex items-center justify-center shrink-0">
                    <Film className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">
                    {r.title || r.sourceUrl}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                    <span className="capitalize">{r.platform}</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {fmtDuration(r.durationSec)}
                    </span>
                    {r.transcript && (
                      <span className="inline-flex items-center gap-0.5">
                        <FileText className="h-2.5 w-2.5" /> transcript
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  onClick={() => makeShort(r)}
                  disabled={shortifyingRef !== null || hasActive}
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-md text-xs shrink-0"
                >
                  {shortifyingRef === r.id ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <Scissors className="mr-1.5 h-3 w-3" />
                  )}
                  Make short
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
