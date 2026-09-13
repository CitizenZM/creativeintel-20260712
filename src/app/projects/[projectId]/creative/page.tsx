"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NARRATIVE_TYPE_LABELS } from "@/lib/constants";
import {
  Loader2,
  Wand2,
  FileText,
  Layout,
  Grid3X3,
  Check,
  Sparkles,
  ArrowRight,
  Palette,
  Zap,
  Download,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScoreBar, StatusBadge } from "@/components/dashboard/status-badge";
import { StoryboardFrameCard, type StoryboardFrameData } from "@/components/creative/storyboard-frame-card";
import { TemplatePicker, videoTypeBadgeClass, videoTypeLabel } from "@/components/creative/template-picker";
import { ScriptCard, type ScriptData } from "@/components/creative/script-card";
import { StoryboardTimeline } from "@/components/creative/storyboard-timeline";
import { LookControls } from "@/components/creative/look-controls";
import { NextStepHint } from "@/components/layout/next-step-hint";
import { Textarea } from "@/components/ui/textarea";
import { defaultTemplateBatch, getScriptTemplate } from "@/services/ai/prompts/script-templates";

interface Angle {
  id: number;
  title: string;
  description: string;
  targetEmotion: string;
  narrativeType: string;
  videoType?: string;
  templateIds?: string[];
  predictedScore: number;
  rationale: string;
  targetAudience: string;
  platform: string;
}

type StoryboardFrame = StoryboardFrameData;

interface Storyboard {
  id: string;
  title: string;
  style: string;
  totalDuration: string;
  scriptId: string | null;
  frameSeconds?: number;
  frames: StoryboardFrame[];
}

interface TestVariant {
  hookVariant: string;
  narrativeType: string;
  ctaVariant: string;
  templateId?: string;
  templateName?: string;
  videoType?: string;
  format?: string;
  predictedScore: number;
  rationale: string;
  scriptOutline: string;
}

const STUDIO_CTA = "Send to Studio";

// Requests to the custom domain pass through Cloudflare, which drops the
// connection at ~100s regardless of Vercel's own maxDuration. Both batch
// generators fan out N AI calls, so they are sent in chunks that comfortably
// finish inside that window.
const SCRIPT_CHUNK = 4;
const BOARD_CHUNK = 3;

export default function CreativePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  const [angles, setAngles] = useState<Angle[]>([]);
  const [scripts, setScripts] = useState<ScriptData[]>([]);
  const [selectedScriptIds, setSelectedScriptIds] = useState<Set<string>>(new Set());
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [testMatrix, setTestMatrix] = useState<TestVariant[]>([]);
  const [expandedScript, setExpandedScript] = useState<string | null>(null);

  const [platformId, setPlatformId] = useState<string | null>(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [scriptCount, setScriptCount] = useState(10);

  const [loadingAngles, setLoadingAngles] = useState(false);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [loadingStoryboards, setLoadingStoryboards] = useState(false);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [sendingMatrixRow, setSendingMatrixRow] = useState<number | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [allProgress, setAllProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [kitUpdatedAt, setKitUpdatedAt] = useState<string | null>(null);
  const [customBrief, setCustomBrief] = useState("");
  const [lighting, setLighting] = useState("");
  const [visualStyle, setVisualStyle] = useState("");
  const [styleNotes, setStyleNotes] = useState("");

  useEffect(() => {
    if (loaded) return;
    async function loadSaved() {
      try {
        const [scriptsRes, storyboardsRes, matrixRes, campaignRes, kitRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/creative/scripts`),
          fetch(`/api/projects/${projectId}/creative/storyboards`),
          fetch(`/api/projects/${projectId}/creative/test-matrix`),
          fetch(`/api/projects/${projectId}/campaign-selection`),
          fetch(`/api/projects/${projectId}/brand-kit`),
        ]);
        const kit = await kitRes.json().catch(() => null);
        if (kit?.kit?.updatedAt) setKitUpdatedAt(kit.kit.updatedAt as string);
        const savedScripts = await scriptsRes.json().catch(() => []);
        const savedStoryboards = await storyboardsRes.json().catch(() => []);
        const savedMatrix = await matrixRes.json().catch(() => ({ variants: [] }));
        const campaign = await campaignRes.json().catch(() => ({}));

        if (campaign?.platform) setPlatformId(campaign.platform);

        if (Array.isArray(savedScripts) && savedScripts.length > 0) {
          setScripts(savedScripts);
          setExpandedScript(savedScripts[0].id);
        }
        if (Array.isArray(savedStoryboards) && savedStoryboards.length > 0) {
          setStoryboards(savedStoryboards);
        }
        if (savedMatrix?.variants?.length > 0) {
          setTestMatrix(savedMatrix.variants);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load saved creative");
      }
      setLoaded(true);
    }
    loadSaved();
  }, [projectId, loaded]);

  // Scripts written before the Brand Kit was last saved never saw the current
  // product truth — the studio renders what the script says, so a stale script
  // silently produces an off-brand ad (observed live: an adult, un-helmeted
  // rider on a 68cm kids' bike).
  const staleScripts =
    !!kitUpdatedAt &&
    scripts.length > 0 &&
    scripts.every((s) => !!s.createdAt && new Date(s.createdAt) < new Date(kitUpdatedAt));

  // Exactly one control on the page carries `cta-attention`, chosen from where
  // the project actually is. More than one glowing control tells you nothing.
  const busy = loadingAngles || loadingScripts || loadingStoryboards || loadingMatrix || loadingAll;
  const activeStep: "angles" | "scripts" | "select" | "board" | "studio" | null = busy
    ? null
    : scripts.length === 0 && angles.length === 0
      ? "angles"
      : scripts.length === 0
        ? "scripts"
        : storyboards.length === 0 && selectedScriptIds.size === 0
          ? "select"
          : storyboards.length === 0
            ? "board"
            : "studio";

  const stages = [
    { num: 1, name: "Angles", icon: Wand2, done: angles.length > 0, active: loadingAngles },
    { num: 2, name: "Scripts", icon: FileText, done: scripts.length > 0, active: loadingScripts },
    { num: 3, name: "Storyboards", icon: Layout, done: storyboards.length > 0, active: loadingStoryboards },
    { num: 4, name: "Test Matrix", icon: Grid3X3, done: testMatrix.length > 0, active: loadingMatrix },
  ];

  const effectiveTemplates =
    selectedTemplateIds.length > 0
      ? selectedTemplateIds
      : defaultTemplateBatch(platformId, scriptCount).map((t) => t.id);

  const noteFailures = useCallback(
    (label: string, failures: unknown) => {
      if (!Array.isArray(failures) || failures.length === 0) return;
      setWarnings((prev) => [
        ...prev,
        ...failures.map((f) => {
          const row = f as { templateId?: string; scriptTitle?: string; error?: string };
          return `${label}: ${row.templateId ?? row.scriptTitle ?? "item"} — ${row.error ?? "failed"}`;
        }),
      ]);
    },
    []
  );

  async function generateAngles(): Promise<Angle[]> {
    setLoadingAngles(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/creative/angles`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Angle generation failed (${res.status})`);
      const result: Angle[] = data.angles || [];
      setAngles(result);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Angle generation failed");
      return [];
    } finally {
      setLoadingAngles(false);
    }
  }

  async function generateScripts(fromAngles?: Angle[]): Promise<ScriptData[]> {
    setLoadingScripts(true);
    setError(null);
    try {
      const sourceAngles = (fromAngles || angles)
        .slice()
        .sort((a, b) => b.predictedScore - a.predictedScore);

      // Chunked for the same reason as generateStoryboards — 10 scripts in one
      // call runs ~100s, which is exactly Cloudflare's origin timeout.
      const explicit = selectedTemplateIds.length > 0 ? selectedTemplateIds : null;
      const total = explicit ? explicit.length : scriptCount;
      const newScripts: ScriptData[] = [];

      for (let i = 0; i < total; i += SCRIPT_CHUNK) {
        const chunkTemplates = explicit ? explicit.slice(i, i + SCRIPT_CHUNK) : undefined;
        const chunkCount = explicit ? chunkTemplates!.length : Math.min(SCRIPT_CHUNK, total - i);

        const res = await fetch(`/api/projects/${projectId}/creative/scripts-batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateIds: chunkTemplates,
            count: chunkCount,
            angles: sourceAngles.length ? sourceAngles : undefined,
            customBrief: customBrief.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Script generation failed (${res.status})`);

        noteFailures("Script", data.failures);
        const chunkScripts: ScriptData[] = data.scripts || [];
        newScripts.push(...chunkScripts);
        setScripts((prev) => [...chunkScripts, ...prev]);
      }
      // Deliberately not auto-selected: picking which scripts get boarded is
      // the decision this step exists for, and selecting all of them by
      // default quietly turns it into "board everything".
      if (newScripts.length > 0) setExpandedScript(newScripts[0].id);
      return newScripts;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Script generation failed");
      return [];
    } finally {
      setLoadingScripts(false);
    }
  }

  async function generateStoryboards(scriptIds: string[]): Promise<Storyboard[]> {
    if (scriptIds.length === 0) return [];
    setLoadingStoryboards(true);
    setError(null);
    const all: Storyboard[] = [];
    try {
      // One request per chunk. Boarding 15 scripts in a single call took >100s
      // and was killed by Cloudflare (524) before Vercel's own limit — and the
      // custom domain sits behind Cloudflare, so the request budget is theirs,
      // not ours. Chunks also mean a mid-run failure keeps what already landed.
      for (let i = 0; i < scriptIds.length; i += BOARD_CHUNK) {
        const slice = scriptIds.slice(i, i + BOARD_CHUNK);
        const res = await fetch(`/api/projects/${projectId}/creative/storyboards-batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scriptIds: slice,
            visualDirection: {
              lighting: lighting || undefined,
              style: visualStyle || undefined,
              notes: styleNotes.trim() || undefined,
            },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Storyboard generation failed (${res.status})`);

        noteFailures("Storyboard", data.failures);
        const newBoards: Storyboard[] = data.storyboards || [];
        all.push(...newBoards);
        setStoryboards((prev) => [...newBoards, ...prev]);
      }
      return all;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Storyboard generation failed");
      return all;
    } finally {
      setLoadingStoryboards(false);
    }
  }

  async function generateTestMatrix() {
    setLoadingMatrix(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/creative/test-matrix`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Test matrix failed (${res.status})`);
      setTestMatrix(data.variants || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test matrix failed");
    } finally {
      setLoadingMatrix(false);
    }
  }

  async function sendVariantToScript(v: TestVariant, index: number) {
    setSendingMatrixRow(index);
    setError(null);
    try {
      const narrativeLabel = NARRATIVE_TYPE_LABELS[v.narrativeType] || v.narrativeType;
      const angle = [
        `Hook: ${v.hookVariant}`,
        v.scriptOutline ? `Outline: ${v.scriptOutline}` : "",
        `Narrative: ${narrativeLabel}`,
        `CTA: ${v.ctaVariant}`,
      ]
        .filter(Boolean)
        .join(". ");

      const res = await fetch(`/api/projects/${projectId}/creative/scripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          angle,
          templateId: v.templateId || v.format,
          videoType: v.videoType,
        }),
      });
      const script = await res.json().catch(() => null);
      if (!res.ok || !script?.id) {
        throw new Error(script?.error || `Could not promote variant (${res.status})`);
      }

      setScripts((prev) => [script, ...prev]);
      setSelectedScriptIds((prev) => new Set(prev).add(script.id));
      setExpandedScript(script.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not promote variant");
    } finally {
      setSendingMatrixRow(null);
    }
  }

  async function generateAll() {
    setLoadingAll(true);
    setError(null);
    setWarnings([]);
    try {
      setAllProgress("Generating 10 ad angles...");
      const newAngles = await generateAngles();
      if (newAngles.length === 0) {
        setError((prev) => prev ?? "No angles were generated — stopping the pipeline.");
        return;
      }

      setAllProgress(`Writing ${effectiveTemplates.length} scripts across templates...`);
      const newScripts = await generateScripts(newAngles);
      if (newScripts.length === 0) {
        setError((prev) => prev ?? "No scripts were generated — stopping the pipeline.");
        return;
      }

      setAllProgress("Creating 2-second storyboards...");
      setSelectedScriptIds(new Set(newScripts.map((s) => s.id)));
      const boards = await generateStoryboards(newScripts.map((s) => s.id));
      if (boards.length === 0) {
        setError((prev) => prev ?? "No storyboards were generated.");
      }

      setAllProgress("Building test matrix...");
      await generateTestMatrix();

      setAllProgress("Done");
    } finally {
      setLoadingAll(false);
      setAllProgress("");
    }
  }

  function toggleScript(id: string) {
    setSelectedScriptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goToStudio() {
    const selectedIds = Array.from(selectedScriptIds).join(",");
    router.push(`/projects/${projectId}/studio?scripts=${selectedIds}`);
  }

  const nothingGenerated =
    angles.length === 0 && scripts.length === 0 && storyboards.length === 0 && testMatrix.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Creative Generator</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Angles → templated scripts → 2-second storyboards → Studio
          </p>
        </div>
        {nothingGenerated && (
          <Button
            onClick={generateAll}
            disabled={loadingAll}
            className="h-10 rounded-md bg-foreground text-background hover:bg-foreground/90 font-medium"
          >
            {loadingAll ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {allProgress || "Generating..."}
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Generate full pipeline
              </>
            )}
          </Button>
        )}
      </div>

      {/* Stepper */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2 overflow-x-auto scrollbar-none">
          {stages.map((stage, i) => (
            <div key={stage.num} className="flex items-center gap-2 flex-1 min-w-max">
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-all",
                    stage.done
                      ? "bg-foreground border-foreground text-background"
                      : stage.active
                        ? "bg-[var(--status-ai-bg)] border-[var(--status-ai)] text-[var(--status-ai-fg)] animate-pulse"
                        : "border-border text-muted-foreground"
                  )}
                >
                  {stage.done ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : stage.active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    stage.num
                  )}
                </div>
                <span
                  className={cn(
                    "text-sm font-medium",
                    stage.done || stage.active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {stage.name}
                </span>
              </div>
              {i < stages.length - 1 && <div className="h-px bg-border flex-1 mx-2 hidden sm:block" />}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] px-4 py-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-[var(--status-urgent-fg)]" />
            <p className="text-sm text-[var(--status-urgent-fg)]">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-xs font-medium text-[var(--status-urgent-fg)] hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {warnings.length} item{warnings.length !== 1 ? "s" : ""} failed in the last run
              </p>
              <ul className="mt-1 space-y-0.5">
                {warnings.slice(0, 8).map((w, i) => (
                  <li key={i} className="text-xs text-amber-800">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => setWarnings([])}
              className="text-xs font-medium text-amber-800 hover:underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loadingAll && allProgress && (
        <div className="rounded-lg border border-[var(--status-ai)] bg-[var(--status-ai-bg)] p-4 text-center">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-[var(--status-ai-fg)]" />
          <p className="text-sm font-medium text-[var(--status-ai-fg)]">{allProgress}</p>
        </div>
      )}

      {/* STEP 1: Angles */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <Wand2 className="h-4 w-4" /> 1. Ad Angles
          </h3>
          {!loadingAll && (
            <Button
              onClick={() => generateAngles()}
              disabled={loadingAngles}
              size="sm"
              variant="outline"
              className={cn("h-8 rounded-md text-xs", activeStep === "angles" && "cta-attention")}
            >
              {loadingAngles ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3 w-3" />
              )}
              {angles.length > 0 ? "Regenerate" : "Generate 10 angles"}
            </Button>
          )}
        </div>

        {angles.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {angles.map((angle, i) => {
              const isTop3 = i < 3;
              return (
                <div
                  key={angle.id}
                  className={cn(
                    "rounded-lg border bg-card p-3.5",
                    isTop3 ? "border-foreground/40 ring-1 ring-foreground/10" : "border-border"
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-sm font-semibold">{angle.title}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      {isTop3 && <StatusBadge level="ai">TOP {i + 1}</StatusBadge>}
                      <span className="text-sm font-semibold num">{angle.predictedScore}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{angle.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {angle.videoType && (
                      <span
                        className={cn(
                          "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                          videoTypeBadgeClass(angle.videoType)
                        )}
                      >
                        {videoTypeLabel(angle.videoType)}
                      </span>
                    )}
                    {(angle.templateIds ?? []).map((id) => (
                      <StatusBadge key={id} level="neutral">
                        {getScriptTemplate(id)?.name ?? id}
                      </StatusBadge>
                    ))}
                    <StatusBadge level="neutral">{angle.platform}</StatusBadge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* STEP 2: Templates → Scripts */}
      <section className="space-y-3 pt-4 border-t border-border">
        <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
          <FileText className="h-4 w-4" /> 2. Scripts
        </h3>

        {activeStep === "scripts" && (
          <NextStepHint
            step="Step 2"
            title="Write the scripts"
            detail="Pick templates below, or just press Write scripts and a balanced batch is chosen for you. Add your own idea first if you have one."
          />
        )}

        <div className="space-y-1.5">
          <label htmlFor="customBrief" className="text-xs font-medium">
            Your own idea, angle or style{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id="customBrief"
            value={customBrief}
            onChange={(e) => setCustomBrief(e.target.value)}
            disabled={loadingScripts || loadingAll}
            rows={2}
            placeholder="e.g. lead with the 99-day risk-free trial, talk to dads buying a first bike, keep it fast and funny"
            className="rounded-md text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Applied on top of the templates below. It outranks their usual treatment — never the
            brand kit or the compliance rules.
          </p>
        </div>

        {staleScripts && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              <strong>These scripts were written before the Brand Kit was last updated.</strong> They
              were generated without the current product truth, so they can describe the wrong
              audience, scale or scene — and the studio will render exactly what they say. Regenerate
              scripts and storyboards before compiling a run.
            </p>
          </div>
        )}

        <TemplatePicker
          platformId={platformId}
          selected={selectedTemplateIds}
          onChange={setSelectedTemplateIds}
          count={scriptCount}
          onCountChange={setScriptCount}
          disabled={loadingScripts || loadingAll}
        />

        {!loadingAll && (
          <Button
            onClick={() => generateScripts()}
            disabled={loadingScripts}
            variant="outline"
            className={cn("h-9 rounded-md", activeStep === "scripts" && "cta-attention")}
          >
            {loadingScripts ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="mr-2 h-3.5 w-3.5" />
            )}
            Write {effectiveTemplates.length} script{effectiveTemplates.length !== 1 ? "s" : ""}
          </Button>
        )}

        {scripts.length > 0 && (
          <>
            {activeStep === "select" && (
              <NextStepHint
                step="Step 3"
                title="Choose which scripts to storyboard"
                detail="Tick the ones worth producing — boarding costs a generation each, so pick deliberately rather than boarding all of them."
              />
            )}

            <div className="flex items-start justify-between gap-3 flex-wrap pt-2">
              <p className="text-xs text-muted-foreground">
                {selectedScriptIds.size === 0
                  ? `${scripts.length} script${scripts.length !== 1 ? "s" : ""} — tick the ones you want to storyboard`
                  : `${selectedScriptIds.size} of ${scripts.length} selected`}
              </p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => setSelectedScriptIds(new Set(scripts.map((s) => s.id)))}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Select all
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <button
                  onClick={() => setSelectedScriptIds(new Set())}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {scripts.map((script) => (
                <ScriptCard
                  key={script.id}
                  script={script}
                  selected={selectedScriptIds.has(script.id)}
                  expanded={expandedScript === script.id}
                  onToggleSelect={() => toggleScript(script.id)}
                  onToggleExpand={() =>
                    setExpandedScript(expandedScript === script.id ? null : script.id)
                  }
                />
              ))}
            </div>

            {selectedScriptIds.size > 0 && !loadingAll && (
              <div className="space-y-3">
                {activeStep === "board" && (
                  <NextStepHint
                    step="Step 4"
                    title={`Build storyboards for the ${selectedScriptIds.size} script${selectedScriptIds.size !== 1 ? "s" : ""} you picked`}
                    detail="Set the look first if you want a specific lighting or style — it is baked into every frame and carried into the render."
                  />
                )}

                <LookControls
                  lighting={lighting}
                  style={visualStyle}
                  notes={styleNotes}
                  onLighting={setLighting}
                  onStyle={setVisualStyle}
                  onNotes={setStyleNotes}
                  disabled={loadingStoryboards}
                />

                <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={() => generateStoryboards(Array.from(selectedScriptIds))}
                  disabled={loadingStoryboards}
                  variant="outline"
                  className={cn("h-9 rounded-md", activeStep === "board" && "cta-attention")}
                >
                  {loadingStoryboards ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Layout className="mr-2 h-3.5 w-3.5" />
                  )}
                  Generate storyboards ({selectedScriptIds.size})
                </Button>
                <Button
                  onClick={goToStudio}
                  variant="outline"
                  className={cn("h-9 rounded-md", activeStep === "studio" && "cta-attention")}
                >
                  <Palette className="mr-2 h-3.5 w-3.5" />
                  {STUDIO_CTA} ({selectedScriptIds.size})
                  <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* STEP 3: Storyboards */}
      {storyboards.length > 0 && (
        <section className="space-y-4 pt-4 border-t border-border">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
                <Layout className="h-4 w-4" /> 3. Storyboards ({storyboards.length})
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                One frame per 2 seconds, tagged HOOK / BODY / CTA. Approve each frame or add feedback
                before proceeding.
              </p>
            </div>
            <Button
              onClick={goToStudio}
              variant="outline"
              size="sm"
              className="h-8 rounded-md text-xs"
              disabled={selectedScriptIds.size === 0}
            >
              <Palette className="mr-1.5 h-3 w-3" />
              {STUDIO_CTA}
            </Button>
          </div>

          {storyboards.map((storyboard) => {
            const linkedScript = scripts.find((s) => s.id === storyboard.scriptId);
            const template = getScriptTemplate(linkedScript?.template);
            const approvedCount = storyboard.frames.filter((f) => f.approved === true).length;
            const pendingCount = storyboard.frames.filter(
              (f) => f.approved === null || f.approved === undefined
            ).length;
            const revisedCount = storyboard.frames.filter((f) => f.approved === false).length;

            return (
              <div key={storyboard.id} className="space-y-4 rounded-xl border border-border bg-card/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold">{storyboard.title}</p>
                      {linkedScript?.videoType && (
                        <span
                          className={cn(
                            "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                            videoTypeBadgeClass(linkedScript.videoType)
                          )}
                        >
                          {videoTypeLabel(linkedScript.videoType)}
                        </span>
                      )}
                      {template && (
                        <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">
                          {template.name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {linkedScript && (
                        <>
                          <span className="font-medium">{linkedScript.title}</span> ·{" "}
                        </>
                      )}
                      {storyboard.style} · {storyboard.totalDuration} · {storyboard.frames.length} frames
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] shrink-0">
                    {approvedCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                        ✓ {approvedCount}
                      </span>
                    )}
                    {revisedCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                        ✗ {revisedCount}
                      </span>
                    )}
                    {pendingCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold">
                        ? {pendingCount}
                      </span>
                    )}
                  </div>
                </div>

                <StoryboardTimeline
                  frames={storyboard.frames}
                  frameSeconds={storyboard.frameSeconds ?? 2}
                />

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {storyboard.frames.map((frame, idx) => (
                    <StoryboardFrameCard
                      key={frame.frameNumber}
                      frame={frame}
                      storyboardId={storyboard.id}
                      projectId={projectId}
                      autoLoad={true}
                      isLast={idx === storyboard.frames.length - 1}
                      onUpdate={(frameNumber, updates) => {
                        setStoryboards((prev) =>
                          prev.map((sb) => {
                            if (sb.id !== storyboard.id) return sb;
                            return {
                              ...sb,
                              frames: sb.frames.map((f) =>
                                f.frameNumber === frameNumber ? { ...f, ...updates } : f
                              ),
                            };
                          })
                        );
                      }}
                    />
                  ))}
                </div>

                {approvedCount === storyboard.frames.length && storyboard.frames.length > 0 && (
                  <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-emerald-800">All frames approved ✓</p>
                      <p className="text-xs text-emerald-700">Ready for video generation</p>
                    </div>
                    <Button
                      onClick={goToStudio}
                      size="sm"
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1.5"
                    >
                      <Palette className="h-3 w-3" />
                      {STUDIO_CTA}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* STEP 4: Test Matrix */}
      <section className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <Grid3X3 className="h-4 w-4" /> 4. Test Matrix
          </h3>
          {!loadingAll && (
            <Button
              onClick={generateTestMatrix}
              disabled={loadingMatrix}
              size="sm"
              variant="outline"
              className="h-8 rounded-md text-xs"
            >
              {loadingMatrix ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Grid3X3 className="mr-1.5 h-3 w-3" />
              )}
              {testMatrix.length > 0 ? "Regenerate" : "Generate matrix"}
            </Button>
          )}
        </div>

        {testMatrix.length > 0 && (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-medium px-4 py-2.5 w-10">#</th>
                    <th className="text-left font-medium px-3 py-2.5">Hook</th>
                    <th className="text-left font-medium px-3 py-2.5 hidden sm:table-cell">Template</th>
                    <th className="text-left font-medium px-3 py-2.5 hidden md:table-cell">Type</th>
                    <th className="text-left font-medium px-3 py-2.5 hidden lg:table-cell">CTA</th>
                    <th className="text-left font-medium px-3 py-2.5 w-28">Score</th>
                    <th className="text-right font-medium px-3 py-2.5 w-32">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...testMatrix]
                    .sort((a, b) => b.predictedScore - a.predictedScore)
                    .map((v, i) => {
                      const template = getScriptTemplate(v.templateId || v.format);
                      return (
                        <tr key={i} className="hover:bg-muted/40">
                          <td className="px-4 py-2.5 text-xs text-muted-foreground num">{i + 1}</td>
                          <td className="px-3 py-2.5 text-xs max-w-xs">
                            <p className="line-clamp-1">{v.hookVariant}</p>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                            {template?.name ?? v.templateName ?? v.templateId ?? v.format ?? "—"}
                          </td>
                          <td className="px-3 py-2.5 hidden md:table-cell">
                            <span
                              className={cn(
                                "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                                videoTypeBadgeClass(v.videoType ?? template?.videoType)
                              )}
                            >
                              {videoTypeLabel(v.videoType ?? template?.videoType)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                            <p className="line-clamp-1 max-w-xs">{v.ctaVariant}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            <ScoreBar score={v.predictedScore} />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Button
                              onClick={() => sendVariantToScript(v, i)}
                              disabled={sendingMatrixRow !== null}
                              size="sm"
                              variant="outline"
                              className="h-7 rounded-md text-xs whitespace-nowrap"
                            >
                              {sendingMatrixRow === i ? (
                                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                              ) : (
                                <FileText className="mr-1.5 h-3 w-3" />
                              )}
                              To script
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Footer CTA */}
      {scripts.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-5 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
          <div className="flex-1">
            <p className="text-sm font-semibold">Ready to build the video?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Send {selectedScriptIds.size} selected script{selectedScriptIds.size !== 1 ? "s" : ""} to
              Studio for a detailed video brief and keyframe reel.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`/api/projects/${projectId}/export`}
              className="inline-flex items-center justify-center h-10 px-4 rounded-md border border-border bg-background hover:bg-muted/60 text-sm font-medium transition-colors"
            >
              <Download className="mr-2 h-4 w-4" />
              Export package
            </a>
            <Button
              onClick={goToStudio}
              disabled={selectedScriptIds.size === 0}
              className="h-10 rounded-md bg-foreground text-background hover:bg-foreground/90 font-medium"
            >
              <Palette className="mr-2 h-4 w-4" />
              {STUDIO_CTA}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
