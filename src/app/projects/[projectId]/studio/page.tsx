"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { VideoLibraryPanel } from "@/components/video/video-library-panel";
import { StoryboardTimeline } from "@/components/studio/storyboard-timeline";
import { LibtvRunPanel } from "@/components/studio/libtv-run-panel";
import { NextStepHint } from "@/components/layout/next-step-hint";
import { LegacyApiRender } from "@/components/studio/legacy-api-render";
import type {
  BrandKitReadiness,
  BudgetMode,
  LibtvRunView,
  ModelOptionView,
  RunLimits,
  StoryboardFrameView,
  StoryboardView,
} from "@/components/studio/types";

interface StoryboardRow {
  id: string;
  title: string;
  scriptId: string | null;
  totalDuration: string | null;
  frameSeconds: number | null;
  frames: unknown;
}

function toStoryboardView(row: StoryboardRow): StoryboardView {
  return {
    id: row.id,
    title: row.title,
    scriptId: row.scriptId,
    totalDuration: row.totalDuration,
    frameSeconds: row.frameSeconds ?? 2,
    frames: (Array.isArray(row.frames) ? row.frames : []) as StoryboardFrameView[],
  };
}

export default function StudioPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  // Captured once at mount — used only to preselect a board on first load.
  // Selecting a board afterwards updates the URL itself via router.replace,
  // and must not re-trigger the initial-load effect below.
  const [initialStoryboardId] = useState(() => searchParams.get("storyboardId"));

  const [storyboards, setStoryboards] = useState<StoryboardView[]>([]);
  const [storyboardId, setStoryboardId] = useState<string | null>(null);
  const [runs, setRuns] = useState<LibtvRunView[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [models, setModels] = useState<{ image: ModelOptionView[]; video: ModelOptionView[] }>({
    image: [],
    video: [],
  });
  const [brandKit, setBrandKit] = useState<BrandKitReadiness | null>(null);
  const [limits, setLimits] = useState<RunLimits | null>(null);
  const [plan, setPlan] = useState<{ budgetMode: BudgetMode; clipDurationSec: number }>({
    budgetMode: "economy",
    clipDurationSec: 6,
  });
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [sbRes, runRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/creative/storyboards`),
          fetch(`/api/projects/${projectId}/studio/libtv-runs`),
        ]);
        const sbData = await sbRes.json().catch(() => []);
        const runData = await runRes.json().catch(() => ({}));
        if (cancelled) return;

        const boards = (Array.isArray(sbData) ? sbData : []).map(toStoryboardView);
        setStoryboards(boards);
        // boards are returned newest-first (orderBy createdAt desc), so
        // boards[0] is the default "newest storyboard" fallback.
        setStoryboardId((current) => current ?? initialStoryboardId ?? boards[0]?.id ?? null);

        const loadedRuns = (runData.runs ?? []) as LibtvRunView[];
        setRuns(loadedRuns);
        setActiveRunId((current) => current ?? loadedRuns[0]?.id ?? null);
        if (runData.models) setModels(runData.models);
        if (runData.brandKit) setBrandKit(runData.brandKit);
        if (runData.limits) {
          setLimits(runData.limits as RunLimits);
          setPlan((current) => ({ ...current, budgetMode: runData.limits.defaultBudgetMode ?? current.budgetMode }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, initialStoryboardId]);

  const storyboard = useMemo(
    () => storyboards.find((s) => s.id === storyboardId) ?? null,
    [storyboards, storyboardId]
  );
  const activeRun = useMemo(() => runs.find((r) => r.id === activeRunId) ?? null, [runs, activeRunId]);

  const handleRunChanged = useCallback((run?: LibtvRunView) => {
    if (!run) return;
    setRuns((prev) => {
      const next = prev.filter((r) => r.id !== run.id);
      return [run, ...next].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
  }, []);

  const runStoryboard = useMemo(() => {
    if (!activeRun?.storyboardId) return storyboard;
    return storyboards.find((s) => s.id === activeRun.storyboardId) ?? storyboard;
  }, [activeRun, storyboards, storyboard]);

  const selectStoryboard = useCallback(
    (id: string) => {
      setStoryboardId(id);
      setSelectedFrame(null);
      router.replace(`${pathname}?storyboardId=${id}`, { scroll: false });
    },
    [pathname, router]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {storyboards.length > 0 && (
        <NextStepHint
          step="Step 5"
          title={
            activeRun?.status === "awaiting_approval"
              ? "Approve the run to start rendering"
              : "Compile the storyboard into a production run"
          }
          detail={
            activeRun?.status === "awaiting_approval"
              ? "Compiling costs nothing. Approving hands the run to the local worker, which spends LibTV credits."
              : "Pick a storyboard, choose the models and budget mode, then compile. Nothing is spent until you approve."
          }
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Create Studio</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Storyboard → LibTV keyframes and clips → local assembly → master MP4
          </p>
        </div>
        {storyboards.length > 0 && (
          <div className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Storyboard
            </span>
            <div role="radiogroup" aria-label="Storyboard" className="flex flex-wrap gap-1.5">
              {storyboards.map((s) => (
                <label
                  key={s.id}
                  data-storyboard-id={s.id}
                  className={cn(
                    "flex h-9 cursor-pointer items-center rounded-md border px-2.5 text-xs font-medium transition-colors",
                    storyboardId === s.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  <input
                    type="radio"
                    name="storyboard"
                    value={s.id}
                    checked={storyboardId === s.id}
                    onChange={() => selectStoryboard(s.id)}
                    aria-label={s.title}
                    className="sr-only"
                  />
                  {s.title} ({(s.frames as StoryboardFrameView[]).length} frames)
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {storyboards.length === 0 ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center">
          <Palette className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No storyboards yet. Generate a script and a 2-second storyboard on the Create tab first.
          </p>
        </div>
      ) : (
        <>
          <StoryboardTimeline
            storyboard={runStoryboard}
            run={activeRun}
            selectedFrame={selectedFrame}
            budgetMode={plan.budgetMode}
            clipDurationSec={plan.clipDurationSec}
            onSelectFrame={(n) => setSelectedFrame((prev) => (prev === n ? null : n))}
          />

          {selectedFrame != null && runStoryboard && (
            <FrameDetail frame={runStoryboard.frames.find((f) => f.frameNumber === selectedFrame) ?? null} />
          )}

          <LibtvRunPanel
            projectId={projectId}
            storyboard={storyboard}
            models={models}
            brandKit={brandKit}
            runs={runs}
            activeRun={activeRun}
            limits={limits}
            onSelectRun={setActiveRunId}
            onRunsChanged={handleRunChanged}
            onPlanChange={setPlan}
          />
        </>
      )}

      <VideoLibraryPanel projectId={projectId} />

      <LegacyApiRender projectId={projectId} scriptId={storyboard?.scriptId ?? null} />
    </div>
  );
}

function FrameDetail({ frame }: { frame: StoryboardFrameView | null }) {
  if (!frame) return null;
  const rows: Array<[string, string | undefined]> = [
    ["Scene", frame.scene],
    ["Shot", frame.shotType],
    ["Camera", frame.cameraMove],
    ["Product", frame.productAction],
    ["Text overlay", frame.textOverlay],
    ["Voiceover", frame.voiceover],
    ["Selling point", frame.sellingPoint],
  ];
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="mb-2 text-xs font-semibold">
        Frame {frame.frameNumber} · {frame.segment ?? "BODY"}
      </p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <p key={label} className="text-xs">
              <span className="text-muted-foreground">{label}: </span>
              {value}
            </p>
          ))}
      </div>
      {frame.imagePrompt && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Keyframe prompt</p>
          <p className="mt-1 rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">{frame.imagePrompt}</p>
        </div>
      )}
      {frame.videoPrompt && (
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Clip prompt</p>
          <p className="mt-1 rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">{frame.videoPrompt}</p>
        </div>
      )}
    </div>
  );
}
