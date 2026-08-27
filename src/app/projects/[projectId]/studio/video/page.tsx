"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Loader2, Play, Download, Trash2, RefreshCw, Zap,
  ChevronDown, ChevronUp, Copy, Check, Film, Sparkles,
  Clock, AlertCircle, CheckCircle2, Video, Settings2,
  RotateCcw, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VideoLibraryPanel } from "@/components/video/video-library-panel";

// ─── Types ───────────────────────────────────────────────────────────────────

type ModelId = "grok-imagine-video" | "wan-2.6" | "kling-v3-pro" | "wan-2.5";

interface ModelConfig {
  id: ModelId;
  label: string;
  costPerSec: number;
  quality: number; // 1-5
  speed: "fast" | "medium" | "slow";
  audio: boolean;
  maxDuration: number;
  badge?: string;
}

const MODELS: ModelConfig[] = [
  { id: "grok-imagine-video", label: "Grok Imagine", costPerSec: 0.07, quality: 4, speed: "fast", audio: true, maxDuration: 10, badge: "Best Value" },
  { id: "wan-2.6",            label: "Wan 2.6",      costPerSec: 0.10, quality: 4, speed: "fast", audio: true, maxDuration: 15 },
  { id: "kling-v3-pro",       label: "Kling v3 Pro", costPerSec: 0.112, quality: 5, speed: "medium", audio: false, maxDuration: 15, badge: "Highest Quality" },
  { id: "wan-2.5",            label: "Wan 2.5",      costPerSec: 0.05, quality: 3, speed: "fast", audio: false, maxDuration: 10, badge: "Cheapest" },
];

interface FalJob {
  id: string;
  falRequestId: string;
  model: ModelId;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  duration: number;
  status: "queued" | "processing" | "completed" | "failed";
  videoUrl?: string | null;
  widthPx?: number | null;
  heightPx?: number | null;
  fpS?: number | null;
  durationSec?: number | null;
  fileSizeBytes?: number | null;
  costUsd?: number | null;
  error?: string | null;
  scriptId?: string | null;
  shotIndex?: number | null;
  promptVersion?: number;
  createdAt: string;
  completedAt?: string | null;
}

interface VeoPromptShot {
  shot_id: string;
  duration_seconds: number;
  purpose: string;
  scene_description: string;
  veo_prompt: string;
  test_prompt: string;
  dialogue_or_vo: string;
  cta: string;
}

interface VeoPromptResult {
  project_meta: { brand: string; campaign_goal: string };
  shot_list: VeoPromptShot[];
}

interface Script {
  id: string;
  title: string;
  format: string;
  duration: string;
  targetEmotion: string;
  predictedScore: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCost(usd: number) {
  return `$${usd.toFixed(3)}`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  return `${Math.round(diff / 3600000)}h ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function QualityDots({ score }: { score: number }) {
  return (
    <span className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <span key={i} className={cn("w-1.5 h-1.5 rounded-full", i <= score ? "bg-emerald-500" : "bg-muted")} />
      ))}
    </span>
  );
}

function StatusPill({ status }: { status: FalJob["status"] }) {
  const map = {
    queued:     { icon: Clock,         cls: "text-amber-600 bg-amber-50 border-amber-200",   label: "Queued" },
    processing: { icon: Loader2,       cls: "text-blue-600 bg-blue-50 border-blue-200",      label: "Rendering" },
    completed:  { icon: CheckCircle2,  cls: "text-emerald-600 bg-emerald-50 border-emerald-200", label: "Done" },
    failed:     { icon: AlertCircle,   cls: "text-red-600 bg-red-50 border-red-200",         label: "Failed" },
  };
  const { icon: Icon, cls, label } = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border", cls)}>
      <Icon className={cn("h-3 w-3", status === "processing" && "animate-spin")} />
      {label}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded hover:bg-muted transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

// ─── Video Card ───────────────────────────────────────────────────────────────

function VideoCard({ job, onDelete, onRetry }: {
  job: FalJob;
  onDelete: (id: string) => void;
  onRetry: (job: FalJob) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const model = MODELS.find(m => m.id === job.model);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex gap-3 p-3">
        {/* Thumbnail / video player */}
        <div className="flex-shrink-0 w-[72px] h-[128px] bg-muted rounded-lg overflow-hidden relative">
          {job.status === "completed" && job.videoUrl ? (
            <video
              src={job.videoUrl}
              className="w-full h-full object-cover"
              loop
              muted
              playsInline
              onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play()}
              onMouseLeave={e => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {job.status === "processing" || job.status === "queued"
                ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                : <Video className="h-5 w-5 text-muted-foreground/40" />}
            </div>
          )}
          {job.status === "completed" && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/30">
              <Play className="h-5 w-5 text-white fill-white" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <StatusPill status={job.status} />
                <span className="text-[10px] text-muted-foreground">{model?.label}</span>
                {job.costUsd && <span className="text-[10px] text-muted-foreground">{formatCost(job.costUsd)}</span>}
              </div>
              <p className="text-xs text-muted-foreground">{timeAgo(job.createdAt)}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {job.status === "completed" && job.videoUrl && (
                <a href={job.videoUrl} download target="_blank" rel="noopener noreferrer">
                  <button className="p-1.5 rounded-md hover:bg-muted transition-colors">
                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </a>
              )}
              {job.status === "failed" && (
                <button onClick={() => onRetry(job)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
                  <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
              <button onClick={() => onDelete(job.id)} className="p-1.5 rounded-md hover:bg-red-50 hover:text-red-500 transition-colors">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Stats */}
          {job.status === "completed" && (
            <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
              {job.durationSec && <span>{job.durationSec.toFixed(1)}s</span>}
              {job.widthPx && job.heightPx && <span>{job.widthPx}×{job.heightPx}</span>}
              {job.fpS && <span>{job.fpS.toFixed(0)}fps</span>}
              {job.fileSizeBytes && <span>{formatBytes(job.fileSizeBytes)}</span>}
            </div>
          )}

          {/* Error */}
          {job.status === "failed" && job.error && (
            <p className="text-[10px] text-red-500 truncate">{job.error}</p>
          )}

          {/* Prompt preview */}
          <div className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
            {job.prompt}
          </div>

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide" : "Full prompt"}
          </button>
        </div>
      </div>

      {/* Expanded prompt */}
      {expanded && (
        <div className="border-t border-border bg-muted/30 p-3">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Full Prompt</p>
            <CopyButton text={job.prompt} />
          </div>
          <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{job.prompt}</p>
          <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
            <span>Model: {job.model}</span>
            <span>AR: {job.aspectRatio}</span>
            <span>Res: {job.resolution}</span>
            <span>Duration: {job.duration}s</span>
            {job.promptVersion && job.promptVersion > 1 && <span>v{job.promptVersion}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shot Prompt Card ─────────────────────────────────────────────────────────

function ShotPromptCard({
  shot, index, scriptId, onGenerate, generating,
}: {
  shot: VeoPromptShot;
  index: number;
  scriptId: string;
  onGenerate: (prompt: string, testMode: boolean, shotIndex: number, scriptId: string) => void;
  generating: boolean;
}) {
  const [useTestPrompt, setUseTestPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(shot.veo_prompt);
  const [editedTestPrompt, setEditedTestPrompt] = useState(shot.test_prompt || "");
  const [editing, setEditing] = useState(false);
  const prompt = useTestPrompt ? editedTestPrompt : editedPrompt;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center">
            {index + 1}
          </span>
          <div>
            <p className="text-xs font-semibold">{shot.purpose}</p>
            <p className="text-[10px] text-muted-foreground">{shot.duration_seconds}s · {shot.scene_description.slice(0, 60)}…</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {shot.test_prompt && (
            <button
              onClick={() => setUseTestPrompt(!useTestPrompt)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                useTestPrompt
                  ? "bg-amber-50 border-amber-300 text-amber-700"
                  : "border-border text-muted-foreground hover:border-foreground"
              )}
            >
              {useTestPrompt ? "3s Test" : "Full 8s"}
            </button>
          )}
          <button
            onClick={() => setEditing(!editing)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Prompt display / edit */}
      <div className="p-4 space-y-3">
        {editing ? (
          <textarea
            value={useTestPrompt ? editedTestPrompt : editedPrompt}
            onChange={e => useTestPrompt ? setEditedTestPrompt(e.target.value) : setEditedPrompt(e.target.value)}
            rows={12}
            className="w-full text-xs bg-muted rounded-lg p-3 border border-border focus:outline-none focus:ring-1 focus:ring-foreground resize-none font-mono leading-relaxed"
          />
        ) : (
          <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">{prompt || "No prompt generated yet."}</p>
        )}

        {shot.dialogue_or_vo && (
          <div className="rounded-lg bg-muted/50 border border-border px-3 py-2">
            <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">VO / Dialogue</p>
            <p className="text-xs italic text-foreground/70">&ldquo;{shot.dialogue_or_vo}&rdquo;</p>
          </div>
        )}

        {/* Word count quality indicator */}
        {(() => {
          const wc = prompt.split(/\s+/).filter(Boolean).length;
          const color = wc >= 400 ? "text-emerald-600" : wc >= 200 ? "text-amber-600" : "text-red-500";
          const label = wc >= 400 ? "Cinematic quality ✓" : wc >= 200 ? "Moderate detail" : "Too brief — regenerate";
          return <span className={cn("text-[10px] font-semibold", color)}>{wc} words — {label}</span>;
        })()}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <CopyButton text={prompt} />
            <button
              onClick={() => setEditing(!editing)}
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border hover:border-foreground/40 transition-colors"
            >
              {editing ? "Done" : "Edit"}
            </button>
          </div>
          <Button
            size="sm"
            disabled={generating || !prompt}
            onClick={() => onGenerate(prompt, useTestPrompt, index, scriptId)}
            className="h-7 text-xs gap-1.5"
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {useTestPrompt ? "Test 3s" : "Generate 8s"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VideoStudioPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  // State
  const [scripts, setScripts] = useState<Script[]>([]);
  const [selectedScript, setSelectedScript] = useState<string>("");
  const [veoResult, setVeoResult] = useState<VeoPromptResult | null>(null);
  const [jobs, setJobs] = useState<FalJob[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelId>("grok-imagine-video");
  const [selectedAspect, setSelectedAspect] = useState("9:16");
  const [selectedResolution, setSelectedResolution] = useState("720p");
  const [customPrompt, setCustomPrompt] = useState("");
  const [customDuration, setCustomDuration] = useState(5);

  // Loading states
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [generatingShot, setGeneratingShot] = useState<string | null>(null); // shot id or "custom"
  const [generatingAll, setGeneratingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load scripts ──
  useEffect(() => {
    fetch(`/api/projects/${projectId}/creative/scripts`)
      .then(r => r.json()).catch(() => [])
      .then(data => {
        if (Array.isArray(data)) {
          setScripts(data);
          if (data.length > 0) setSelectedScript(data[0].id);
        }
      });
  }, [projectId]);

  // ── Load existing jobs ──
  const loadJobs = useCallback(async () => {
    const data = await fetch(`/api/projects/${projectId}/studio/fal-jobs`).then(r => r.json()).catch(() => []);
    if (Array.isArray(data)) setJobs(data);
  }, [projectId]);

  useEffect(() => {
    (async () => {
      await loadJobs();
    })();
  }, [loadJobs]);

  // ── Poll active jobs — ONLY when jobs are actively rendering ──
  // Uses 15s interval (not 4s) to reduce unnecessary DB + fal.ai calls.
  // Polling stops immediately when no active jobs remain.
  const pollJobs = useCallback(async () => {
    const active = jobs.filter(j => j.status === "queued" || j.status === "processing");
    if (active.length === 0) return;

    const updated = await Promise.all(active.map(j =>
      fetch(`/api/projects/${projectId}/studio/fal-status/${j.id}`)
        .then(r => r.json()).catch(() => j)
    ));

    setJobs(prev => {
      const map = new Map(prev.map(j => [j.id, j]));
      updated.forEach(u => { if (u?.id) map.set(u.id, u); });
      return Array.from(map.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });
  }, [jobs, projectId]);

  useEffect(() => {
    const hasActive = jobs.some(j => j.status === "queued" || j.status === "processing");
    if (!hasActive) return; // stop polling immediately when nothing is rendering
    // 15s interval instead of 4s — reduces unnecessary API calls by 75%
    pollRef.current = setTimeout(pollJobs, 15000);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [jobs, pollJobs]);

  // ── Generate VEO prompts ──
  async function generatePrompts() {
    if (!selectedScript) return;
    setLoadingPrompts(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/studio/veo-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId: selectedScript }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setVeoResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate prompts");
    } finally {
      setLoadingPrompts(false);
    }
  }

  // ── Submit video generation ──
  async function submitGeneration(prompt: string, shotIndex?: number, scriptId?: string) {
    const key = shotIndex !== undefined ? `shot-${shotIndex}` : "custom";
    setGeneratingShot(key);
    setError(null);
    try {
      const model = MODELS.find(m => m.id === selectedModel)!;
      const duration = shotIndex !== undefined ? 5 : customDuration; // test clips = 5s
      const res = await fetch(`/api/projects/${projectId}/studio/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model: selectedModel,
          aspectRatio: selectedAspect,
          resolution: selectedResolution,
          duration: Math.min(duration, model.maxDuration),
          scriptId,
          shotIndex,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Add optimistic job
      if (data.jobId) {
        const optimistic: FalJob = {
          id: data.jobId,
          falRequestId: data.falRequestId,
          model: selectedModel,
          prompt,
          aspectRatio: selectedAspect,
          resolution: selectedResolution,
          duration,
          status: "queued",
          scriptId: scriptId || null,
          shotIndex: shotIndex ?? null,
          createdAt: new Date().toISOString(),
        };
        setJobs(prev => [optimistic, ...prev]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGeneratingShot(null);
    }
  }

  async function generateAllShots() {
    if (!veoResult) return;
    setGeneratingAll(true);
    for (let i = 0; i < veoResult.shot_list.length; i++) {
      const shot = veoResult.shot_list[i];
      await submitGeneration(shot.veo_prompt, i, selectedScript);
      await new Promise(r => setTimeout(r, 800)); // stagger requests
    }
    setGeneratingAll(false);
  }

  async function deleteJob(id: string) {
    await fetch(`/api/projects/${projectId}/studio/fal-status/${id}`, { method: "DELETE" }).catch(() => {});
    setJobs(prev => prev.filter(j => j.id !== id));
  }

  async function retryJob(job: FalJob) {
    await submitGeneration(job.prompt, job.shotIndex ?? undefined, job.scriptId ?? undefined);
  }

  async function clearAllJobs() {
    await fetch(`/api/projects/${projectId}/studio/fal-jobs`, { method: "DELETE" }).catch(() => {});
    setJobs([]);
  }

  const activeJobs = jobs.filter(j => j.status === "queued" || j.status === "processing");
  const completedJobs = jobs.filter(j => j.status === "completed");
  const currentModel = MODELS.find(m => m.id === selectedModel)!;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Film className="h-5 w-5" /> Video Studio
          </h2>
          <p className="text-sm text-muted-foreground">
            Generate short-form video ads via fal.ai · {completedJobs.length} completed
            {activeJobs.length > 0 && <span className="ml-2 text-blue-600">{activeJobs.length} rendering…</span>}
          </p>
        </div>
        {jobs.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearAllJobs} className="gap-1.5 text-xs h-8">
            <Trash2 className="h-3.5 w-3.5" /> Clear all
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* ── Left panel: Controls ── */}
        <div className="space-y-4">

          {/* Model selector */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Model
            </h3>
            <div className="space-y-2">
              {MODELS.map(m => (
                <button
                  key={m.id}
                  onClick={() => setSelectedModel(m.id)}
                  className={cn(
                    "w-full text-left rounded-lg border p-3 transition-colors",
                    selectedModel === m.id
                      ? "border-foreground bg-foreground/5"
                      : "border-border hover:border-foreground/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{m.label}</span>
                      {m.badge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                          {m.badge}
                        </span>
                      )}
                    </div>
                    <QualityDots score={m.quality} />
                  </div>
                  <div className="mt-1 flex gap-3 text-[10px] text-muted-foreground">
                    <span>${m.costPerSec}/s</span>
                    <span>{m.speed}</span>
                    <span>max {m.maxDuration}s</span>
                    {m.audio && <span className="text-emerald-600">+ audio</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Output settings */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Output Settings</h3>
            <div className="grid grid-cols-3 gap-2">
              {["9:16","16:9","1:1"].map(ar => (
                <button
                  key={ar}
                  onClick={() => setSelectedAspect(ar)}
                  className={cn(
                    "text-xs py-1.5 rounded-lg border transition-colors",
                    selectedAspect === ar ? "border-foreground bg-foreground/5 font-semibold" : "border-border hover:border-foreground/40"
                  )}
                >
                  {ar}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {["720p","1080p"].map(r => (
                <button
                  key={r}
                  onClick={() => setSelectedResolution(r)}
                  className={cn(
                    "text-xs py-1.5 rounded-lg border transition-colors",
                    selectedResolution === r ? "border-foreground bg-foreground/5 font-semibold" : "border-border hover:border-foreground/40"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Est. cost (5s)</span>
              <span className="font-semibold">{formatCost(currentModel.costPerSec * 5)}</span>
            </div>
          </section>

          {/* Custom prompt */}
          <section className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Custom Prompt</h3>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="Enter a custom video prompt…"
              rows={4}
              className="w-full text-xs bg-muted rounded-lg p-3 border border-border focus:outline-none focus:ring-1 focus:ring-foreground resize-none leading-relaxed"
            />
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>Dur:</span>
                {[3,5,8,10].map(d => (
                  <button
                    key={d}
                    onClick={() => setCustomDuration(d)}
                    className={cn(
                      "px-1.5 py-0.5 rounded border text-[10px]",
                      customDuration === d ? "border-foreground bg-foreground/5" : "border-border hover:border-foreground/40"
                    )}
                    disabled={d > currentModel.maxDuration}
                  >
                    {d}s
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                className="ml-auto h-7 text-xs gap-1.5"
                disabled={!customPrompt.trim() || generatingShot === "custom"}
                onClick={() => submitGeneration(customPrompt.trim())}
              >
                {generatingShot === "custom" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                Generate
              </Button>
            </div>
          </section>
        </div>

        {/* ── Right panel: Prompts + Jobs ── */}
        <div className="space-y-5">

          {/* Script-driven prompts */}
          <section className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Video className="h-4 w-4" /> AI-Generated Shot Prompts
              </h3>
              <div className="flex items-center gap-2">
                {scripts.length > 0 && (
                  <select
                    value={selectedScript}
                    onChange={e => { setSelectedScript(e.target.value); setVeoResult(null); }}
                    className="text-xs bg-background border border-border rounded-md px-2 py-1 focus:outline-none"
                  >
                    {scripts.map(s => (
                      <option key={s.id} value={s.id}>{s.title}</option>
                    ))}
                  </select>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={generatePrompts}
                  disabled={loadingPrompts || !selectedScript}
                  className="h-7 text-xs gap-1.5"
                >
                  {loadingPrompts ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {veoResult ? "Regenerate" : "Generate Prompts"}
                </Button>
                {veoResult && (
                  <Button
                    size="sm"
                    onClick={generateAllShots}
                    disabled={generatingAll}
                    className="h-7 text-xs gap-1.5"
                  >
                    {generatingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                    Generate All ({veoResult.shot_list.length})
                  </Button>
                )}
              </div>
            </div>

            <div className="p-4">
              {!veoResult && !loadingPrompts && (
                <div className="text-center py-8 text-muted-foreground">
                  <Video className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Select a script and generate detailed shot prompts</p>
                  <p className="text-xs mt-1">Each shot gets a 150–250 word cinematic prompt with camera, lighting, timing</p>
                </div>
              )}
              {loadingPrompts && (
                <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating detailed shot prompts…
                </div>
              )}
              {veoResult && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5" />
                    <span>Hover video thumbnail to preview · Toggle &quot;3s Test&quot; for quick iteration · Edit prompts before generating</span>
                  </div>
                  {veoResult.shot_list.map((shot, i) => (
                    <ShotPromptCard
                      key={shot.shot_id}
                      shot={shot}
                      index={i}
                      scriptId={selectedScript}
                      generating={generatingShot === `shot-${i}`}
                      onGenerate={(prompt, _test, shotIdx, sid) => submitGeneration(prompt, shotIdx, sid)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Generated videos */}
          {jobs.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Film className="h-4 w-4" /> Generated Videos
                  <span className="text-xs text-muted-foreground font-normal">({jobs.length})</span>
                </h3>
                <button
                  onClick={loadJobs}
                  className="p-1.5 rounded-md hover:bg-muted transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {jobs.map(job => (
                  <VideoCard
                    key={job.id}
                    job={job}
                    onDelete={deleteJob}
                    onRetry={retryJob}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <VideoLibraryPanel projectId={projectId} />
    </div>
  );
}
