"use client";

import { useState, useEffect, useRef } from "react";
import {
  Loader2, ImageIcon, CheckCircle2, XCircle, RefreshCw,
  MessageSquare, ChevronDown, Camera, Zap, ChevronRight, Film,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { segmentStyle } from "./segment-styles";

// ─── Transition effects catalogue ────────────────────────────────────────────

export const TRANSITIONS = [
  { id: "cut",           label: "Cut",            category: "Cut",     icon: "✂️", description: "Instant hard cut" },
  { id: "cut-on-motion", label: "Cut on Motion",  category: "Cut",     icon: "⚡", description: "Cut aligned to movement" },
  { id: "smash-cut",     label: "Smash Cut",      category: "Cut",     icon: "💥", description: "Jarring abrupt impact cut" },
  { id: "cross-dissolve",label: "Cross Dissolve", category: "Dissolve",icon: "🔀", description: "Gradual blend" },
  { id: "dip-to-black",  label: "Dip to Black",   category: "Dissolve",icon: "⬛", description: "Fade out / in black" },
  { id: "dip-to-white",  label: "Dip to White",   category: "Dissolve",icon: "⬜", description: "Flash white — energy" },
  { id: "match-dissolve",label: "Match Dissolve", category: "Dissolve",icon: "🎯", description: "Dissolve matching shapes" },
  { id: "wipe-left",     label: "Wipe Left",      category: "Wipe",    icon: "⬅️", description: "Slides in from right" },
  { id: "wipe-right",    label: "Wipe Right",     category: "Wipe",    icon: "➡️", description: "Slides in from left" },
  { id: "iris-open",     label: "Iris Open",      category: "Wipe",    icon: "🔵", description: "Circular reveal" },
  { id: "whip-pan",      label: "Whip Pan",       category: "Camera",  icon: "💨", description: "Fast horizontal blur sweep" },
  { id: "rack-focus",    label: "Rack Focus",     category: "Camera",  icon: "🔍", description: "Shift focus to next subject" },
  { id: "dolly-zoom",    label: "Dolly Zoom",     category: "Camera",  icon: "🌀", description: "Vertigo effect" },
  { id: "speed-ramp",    label: "Speed Ramp",     category: "Speed",   icon: "⏩", description: "Slow-mo into normal speed" },
  { id: "freeze-frame",  label: "Freeze Frame",   category: "Speed",   icon: "⏸️", description: "Pause then cut" },
  { id: "match-cut",     label: "Match Cut",      category: "Match",   icon: "🔗", description: "Visual rhyme between frames" },
  { id: "j-cut",         label: "J-Cut",          category: "Match",   icon: "🎵", description: "Next audio starts early" },
  { id: "l-cut",         label: "L-Cut",          category: "Match",   icon: "🎶", description: "Prior audio continues" },
] as const;

export type TransitionId = typeof TRANSITIONS[number]["id"];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoryboardFrameData {
  frameNumber: number;
  duration: string;
  startSec?: number;
  endSec?: number;
  segment?: string;
  scene: string;
  visualDirection: string;
  voiceover: string;
  textOverlay: string;
  cameraNotes: string;
  imagePrompt: string;
  videoPrompt?: string;
  shotType?: string;
  cameraMove?: string;
  subject?: string;
  productAction?: string;
  sfx?: string;
  sellingPoint?: string;
  howExpressed?: string;
  imageUrl?: string | null;
  transitionEffect?: TransitionId | null;
  approved?: boolean | null;
  feedback?: string | null;
}

interface StoryboardFrameCardProps {
  frame: StoryboardFrameData;
  storyboardId: string;
  projectId: string;
  autoLoad?: boolean;
  isLast?: boolean;
  onUpdate?: (frameNumber: number, updates: Partial<StoryboardFrameData>) => void;
}

// ─── Compact transition badge (inline in card footer) ─────────────────────────

function TransitionBadge({
  value,
  onChange,
}: {
  value: TransitionId | null | undefined;
  onChange: (id: TransitionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = TRANSITIONS.find(t => t.id === value);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const categories = [...new Set(TRANSITIONS.map(t => t.category))];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
          value
            ? "bg-blue-50 text-blue-700 border border-blue-200"
            : "text-muted-foreground border border-border hover:border-foreground/30"
        )}
        title="Set transition to next frame"
      >
        <Zap className="h-2.5 w-2.5" />
        {selected ? `${selected.icon} ${selected.label}` : "Transition →"}
        <ChevronDown className="h-2 w-2" />
      </button>

      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 w-56 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          <div className="p-1.5 border-b border-border bg-muted/30">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Transition → next frame</p>
          </div>
          <div className="max-h-48 overflow-y-auto p-1 space-y-0.5">
            {categories.map(cat => (
              <div key={cat}>
                <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest px-1.5 pt-1 pb-0.5">{cat}</p>
                {TRANSITIONS.filter(t => t.category === cat).map(t => (
                  <button
                    key={t.id}
                    onClick={() => { onChange(t.id as TransitionId); setOpen(false); }}
                    className={cn(
                      "w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left transition-colors",
                      value === t.id ? "bg-blue-50 text-blue-700" : "hover:bg-muted text-foreground"
                    )}
                  >
                    <span className="text-xs">{t.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold">{t.label}</p>
                      <p className="text-[9px] text-muted-foreground truncate">{t.description}</p>
                    </div>
                    {value === t.id && <CheckCircle2 className="h-2.5 w-2.5 text-blue-500 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Compact frame card ───────────────────────────────────────────────────────

export function StoryboardFrameCard({
  frame,
  storyboardId,
  projectId,
  autoLoad = false,
  isLast = false,
  onUpdate,
}: StoryboardFrameCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(frame.imageUrl || null);
  const [loading, setLoading] = useState(false);
  const [transition, setTransition] = useState<TransitionId | null | undefined>(
    frame.transitionEffect as TransitionId | null | undefined
  );
  const [approved, setApproved] = useState<boolean | null>(frame.approved ?? null);
  const [showDetail, setShowDetail] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState(frame.feedback || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showI2V, setShowI2V] = useState(false);
  const autoLoadedRef = useRef(false);
  const style = segmentStyle(frame.segment);

  useEffect(() => {
    if (autoLoad && !imageUrl && !loading && !autoLoadedRef.current) {
      autoLoadedRef.current = true;
      generateImage();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  async function generateImage() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/studio/frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: frame.imagePrompt,
          style: "cinematic storyboard concept art",
          dimensions: "512x288",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Image generation failed (${res.status})`);
      if (!data.imageUrl) throw new Error("Image generation returned no image");
      setImageUrl(data.imageUrl);
      await saveFrameUpdate({ imageUrl: data.imageUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveFrameUpdate(updates: Partial<StoryboardFrameData>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/creative/storyboards/${storyboardId}/frames`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameNumber: frame.frameNumber, ...updates }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      setError(null);
      onUpdate?.(frame.frameNumber, updates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleTransitionChange(id: TransitionId) {
    setTransition(id);
    await saveFrameUpdate({ transitionEffect: id });
  }

  async function handleApproval(value: boolean) {
    setApproved(value);
    await saveFrameUpdate({ approved: value });
    if (!value) setShowFeedback(true);
  }

  async function handleFeedbackSave() {
    await saveFrameUpdate({ feedback, approved: false });
    setShowFeedback(false);
  }

  return (
    <div className={cn(
      "rounded-xl border-2 overflow-hidden bg-card transition-all",
      approved === true && "border-emerald-400",
      approved === false && "border-red-300",
      approved === null && cn(style.border, "hover:border-foreground/30")
    )}>
      <div className={cn("h-1 w-full", style.bar)} />
      {/* ── Image ─────────────────────────────────────── */}
      <div className="aspect-video relative overflow-hidden bg-muted/60 group">
        {imageUrl ? (
          <>
            <img src={imageUrl} alt={frame.scene} className="w-full h-full object-cover" onError={() => setImageUrl(null)} />
            {/* Hover: regenerate */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <button
                onClick={generateImage}
                disabled={loading}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/90 text-[10px] font-semibold hover:bg-white"
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Redo
              </button>
            </div>
          </>
        ) : loading ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <p className="text-[9px] text-muted-foreground">Frame {frame.frameNumber}…</p>
          </div>
        ) : (
          <button onClick={generateImage} className="w-full h-full flex flex-col items-center justify-center gap-1.5 hover:bg-muted/80 transition-colors">
            <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
            <p className="text-[9px] text-muted-foreground">Click to generate</p>
          </button>
        )}

        {/* Badges */}
        <div className="absolute top-1.5 left-1.5 flex gap-1">
          <span className="bg-foreground/80 text-background text-[9px] font-bold px-1.5 py-0.5 rounded-full">#{frame.frameNumber}</span>
          <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wider", style.badge)}>
            {style.label}
          </span>
          {approved === true && <span className="bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">✓</span>}
          {approved === false && <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">✗</span>}
        </div>
        <span className="absolute top-1.5 right-1.5 bg-foreground/80 text-background text-[9px] font-semibold px-1.5 py-0.5 rounded-full">
          {frame.duration}
        </span>
        {saving && <Loader2 className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 animate-spin text-muted-foreground" />}
      </div>

      {/* ── Compact info row ──────────────────────────── */}
      <div className="px-2 pt-1.5 pb-1">
        <p className="text-[10px] font-semibold leading-snug line-clamp-2">{frame.scene}</p>
        {frame.voiceover && (
          <p className="text-[9px] text-muted-foreground italic mt-0.5 line-clamp-1">&ldquo;{frame.voiceover}&rdquo;</p>
        )}
        {(frame.shotType || frame.cameraMove) && (
          <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1">
            {[frame.shotType, frame.cameraMove].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {error && (
        <div className="mx-2 mb-1 rounded border border-red-200 bg-red-50 px-1.5 py-1">
          <p className="text-[9px] text-red-700 leading-snug">{error}</p>
        </div>
      )}

      {/* ── Expandable detail ─────────────────────────── */}
      {showDetail && (
        <div className="px-2 pb-1.5 space-y-1.5 border-t border-border pt-1.5">
          <dl className="space-y-0.5">
            {frame.shotType && (
              <div className="flex gap-1 text-[9px]">
                <dt className="text-muted-foreground shrink-0">Shot</dt>
                <dd className="font-medium leading-snug">{frame.shotType}</dd>
              </div>
            )}
            {frame.cameraMove && (
              <div className="flex gap-1 text-[9px]">
                <dt className="text-muted-foreground shrink-0">Camera</dt>
                <dd className="font-medium leading-snug">{frame.cameraMove}</dd>
              </div>
            )}
            {frame.subject && (
              <div className="flex gap-1 text-[9px]">
                <dt className="text-muted-foreground shrink-0">Subject</dt>
                <dd className="font-medium leading-snug">{frame.subject}</dd>
              </div>
            )}
            {frame.productAction && (
              <div className="flex gap-1 text-[9px]">
                <dt className="text-muted-foreground shrink-0">Product</dt>
                <dd className="font-medium leading-snug">{frame.productAction}</dd>
              </div>
            )}
            {frame.sfx && (
              <div className="flex gap-1 text-[9px]">
                <dt className="text-muted-foreground shrink-0">SFX</dt>
                <dd className="font-medium leading-snug">{frame.sfx}</dd>
              </div>
            )}
            {frame.sellingPoint && (
              <div className="flex gap-1 text-[9px]">
                <dt className="text-muted-foreground shrink-0">Sells</dt>
                <dd className="font-medium leading-snug">
                  {frame.sellingPoint}
                  {frame.howExpressed ? ` — ${frame.howExpressed}` : ""}
                </dd>
              </div>
            )}
          </dl>
          {frame.cameraNotes && (
            <div className="flex items-start gap-1">
              <Camera className="h-2.5 w-2.5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <p className="text-[9px] text-muted-foreground italic leading-snug">{frame.cameraNotes}</p>
            </div>
          )}
          {frame.visualDirection && (
            <p className="text-[9px] text-foreground/70 leading-snug border-l-2 border-blue-300 pl-1.5">{frame.visualDirection}</p>
          )}
          {frame.textOverlay && (
            <div className="rounded bg-foreground/5 border border-border px-1.5 py-1">
              <p className="text-[8px] text-muted-foreground font-semibold uppercase mb-0.5">On Screen</p>
              <p className="text-[9px] font-bold">{frame.textOverlay}</p>
            </div>
          )}
          {frame.videoPrompt && (
            <div>
              <button
                onClick={() => setShowI2V(!showI2V)}
                className="flex items-center gap-0.5 text-[9px] font-semibold text-muted-foreground hover:text-foreground"
              >
                <Film className="h-2.5 w-2.5" />
                i2v prompt
                <ChevronRight className={cn("h-2.5 w-2.5 transition-transform", showI2V && "rotate-90")} />
              </button>
              {showI2V && (
                <p className="mt-1 rounded bg-muted/60 border border-border px-1.5 py-1 text-[9px] leading-snug">
                  {frame.videoPrompt}
                </p>
              )}
            </div>
          )}
          {/* Feedback */}
          {showFeedback ? (
            <div className="space-y-1">
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="What to change?"
                rows={2}
                className="w-full text-[10px] rounded border border-border bg-muted/30 px-1.5 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-foreground/20"
              />
              <div className="flex gap-1">
                <button onClick={handleFeedbackSave} className="px-2 py-0.5 rounded bg-foreground text-background text-[9px] font-semibold">Save</button>
                <button onClick={() => setShowFeedback(false)} className="px-2 py-0.5 rounded border border-border text-[9px] text-muted-foreground">Cancel</button>
              </div>
            </div>
          ) : feedback ? (
            <div className="rounded bg-amber-50 border border-amber-200 px-1.5 py-1">
              <p className="text-[8px] font-semibold text-amber-700 mb-0.5">Note</p>
              <p className="text-[9px] text-amber-800">{feedback}</p>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Footer: approve / detail / transition ─────── */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border bg-muted/20">
        {/* Approve */}
        <button
          onClick={() => handleApproval(true)}
          title="Approve frame"
          className={cn(
            "flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold transition-colors",
            approved === true
              ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
              : "border border-border text-muted-foreground hover:border-emerald-300 hover:text-emerald-600"
          )}
        >
          <CheckCircle2 className="h-2.5 w-2.5" /> OK
        </button>

        {/* Revise */}
        <button
          onClick={() => handleApproval(false)}
          title="Mark for revision"
          className={cn(
            "flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold transition-colors",
            approved === false
              ? "bg-red-100 text-red-700 border border-red-300"
              : "border border-border text-muted-foreground hover:border-red-300 hover:text-red-600"
          )}
        >
          <XCircle className="h-2.5 w-2.5" /> Fix
        </button>

        {/* Note */}
        <button
          onClick={() => { setShowDetail(true); setShowFeedback(true); }}
          title="Add feedback note"
          className={cn(
            "flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold border transition-colors",
            feedback ? "border-amber-300 text-amber-700 bg-amber-50" : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <MessageSquare className="h-2.5 w-2.5" />
          {feedback ? "Noted" : "Note"}
        </button>

        {/* Toggle detail */}
        <button
          onClick={() => setShowDetail(!showDetail)}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] text-muted-foreground border border-border hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn("h-2.5 w-2.5 transition-transform", showDetail && "rotate-90")} />
          Info
        </button>

        {/* Transition — only if not last frame */}
        {!isLast && (
          <div className="ml-auto">
            <TransitionBadge value={transition} onChange={handleTransitionChange} />
          </div>
        )}
      </div>
    </div>
  );
}
