"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CheckCircle2, AlertCircle, Loader2, MapPin,
  Users, Target, Clock, ChevronDown, ChevronUp,
  Zap, Play, Check, Film, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseEnvironment {
  name: string;
  description: string;
  typicalUser: string;
  imagePrompt?: string;
}

interface ActorSetting {
  role: string;
  ageRange: string;
  scenario: string;
  visualDescription: string;
  painPoint: string;
  productInteraction: string;
}

interface SellingPoint {
  id: string;
  point: string;
  category: string;
  strength: number;
}

interface TimelineSegment {
  segment: string;
  startSec: number;
  endSec: number;
  label: string;
  description: string;
  cameraNote?: string;
  voiceover?: string;
  purpose?: string;
}

interface VideoTimeline {
  recommendedDurationSec: number;
  platform: string;
  segments: TimelineSegment[];
  rationale?: string;
}

interface CampaignSelectionData {
  selectedProductName?: string | null;
  selectedProductImage?: string | null;
  selectedEnvironment?: string | null;
  selectedEnvImage?: string | null;
  selectedEnvNotes?: string | null;
  selectedActorRole?: string | null;
  selectedActorImage?: string | null;
  selectedActorDesc?: string | null;
  selectedActorAge?: string | null;
  selectedSellingPoints?: { point: string; priority: number; visualTreatment?: string }[] | null;
  videoTimeline?: TimelineSegment[] | null;
  totalDurationSec?: number | null;
  platform?: string | null;
  confirmed?: boolean;
  confirmedAt?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_OPTIONS = [
  { id: "tiktok", label: "TikTok / Reels", durationSec: 30, icon: "⬛" },
  { id: "instagram", label: "Instagram Feed", durationSec: 15, icon: "📸" },
  { id: "youtube", label: "YouTube Pre-roll", durationSec: 30, icon: "▶️" },
  { id: "tvc", label: "TVC (Television)", durationSec: 60, icon: "📺" },
  { id: "amazon", label: "Amazon PDP Video", durationSec: 30, icon: "📦" },
];

const DURATION_OPTIONS = [15, 30, 45, 60];

function generateActorImageUrl(desc: string, role: string): string {
  const prompt = `${role} person — ${desc}. Portrait photo, lifestyle, natural expression, NOT looking at camera, modern home setting, soft natural light. Real person, authentic, UGC style. No text, no logo.`;
  const seed = role.length * 17 + desc.length * 7;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&seed=${seed}&nologo=true&model=flux&nofeed=true`;
}

function generateEnvImageUrl(name: string, prompt?: string): string {
  const p = prompt || `${name} home environment, realistic photography, clean modern interior, no humans, natural daylight, commercial photography style`;
  const seed = name.length * 13;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=768&height=432&seed=${seed}&nologo=true&model=flux&nofeed=true`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SelectionCard({
  selected, onClick, children, className,
}: {
  selected: boolean; onClick: () => void; children: React.ReactNode; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full text-left rounded-xl border-2 transition-all overflow-hidden",
        selected
          ? "border-foreground bg-foreground/5 shadow-sm"
          : "border-border hover:border-foreground/40 bg-card",
        className
      )}
    >
      {selected && (
        <div className="absolute top-2 right-2 z-10">
          <Check className="h-4 w-4 text-foreground bg-background rounded-full p-0.5 ring-2 ring-foreground" />
        </div>
      )}
      {children}
    </button>
  );
}

function SectionHeader({
  icon: Icon, title, subtitle, complete,
}: {
  icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string; complete?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
        complete ? "bg-emerald-100" : "bg-muted"
      )}>
        <Icon className={cn("h-4 w-4", complete ? "text-emerald-600" : "text-muted-foreground")} />
      </div>
      <div>
        <p className="text-sm font-semibold flex items-center gap-2">
          {title}
          {complete && <span className="text-[10px] text-emerald-600 font-normal">Selected ✓</span>}
        </p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

// ─── Timeline Diagram ─────────────────────────────────────────────────────────

function TimelineDiagram({
  segments, totalSec, platform,
}: {
  segments: TimelineSegment[]; totalSec: number; platform: string;
}) {
  const SEGMENT_COLORS: Record<string, string> = {
    Hook: "bg-red-500",
    "Product Demo": "bg-blue-500",
    "Problem Setup": "bg-amber-500",
    "Social Proof": "bg-purple-500",
    CTA: "bg-emerald-500",
    Lifestyle: "bg-teal-500",
    "Brand Reveal": "bg-pink-500",
    Transition: "bg-gray-400",
  };
  const getColor = (label: string) => {
    const match = Object.keys(SEGMENT_COLORS).find(k => label.toLowerCase().includes(k.toLowerCase()));
    return match ? SEGMENT_COLORS[match] : "bg-indigo-500";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>0s</span>
        <span className="font-semibold text-foreground">{platform} · {totalSec}s total</span>
        <span>{totalSec}s</span>
      </div>

      {/* Timeline bar */}
      <div className="flex h-10 rounded-lg overflow-hidden border border-border gap-px">
        {segments.map((seg, i) => {
          const width = ((seg.endSec - seg.startSec) / totalSec) * 100;
          const color = getColor(seg.segment);
          return (
            <div
              key={i}
              className={cn("relative flex items-center justify-center", color)}
              style={{ width: `${width}%`, minWidth: "2px" }}
              title={`${seg.segment}: ${seg.startSec}s–${seg.endSec}s`}
            >
              {width > 8 && (
                <span className="text-[9px] font-bold text-white truncate px-1">
                  {seg.segment}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Segment cards */}
      <div className="grid gap-2">
        {segments.map((seg, i) => {
          const color = getColor(seg.segment);
          const duration = seg.endSec - seg.startSec;
          return (
            <div key={i} className="flex gap-3 items-start">
              {/* Time marker */}
              <div className="flex-shrink-0 w-20 text-right">
                <span className="text-[10px] font-mono text-muted-foreground">
                  {seg.startSec}s–{seg.endSec}s
                </span>
                <div className={cn("h-1 rounded-full mt-0.5 ml-auto", color)} style={{ width: `${Math.min(duration * 3, 80)}px` }} />
              </div>
              {/* Content */}
              <div className="flex-1 rounded-lg border border-border bg-card p-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full flex-shrink-0", color)} />
                  <p className="text-xs font-semibold">{seg.segment} — {seg.label}</p>
                  <span className="text-[10px] text-muted-foreground ml-auto">{duration}s</span>
                </div>
                <p className="text-[11px] text-foreground/70 leading-relaxed">{seg.description}</p>
                {seg.cameraNote && (
                  <p className="text-[10px] text-blue-600 italic">{seg.cameraNote}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CampaignSelection({
  projectId,
  environments,
  actorSettings,
  sellingPoints,
  deepTimeline,
}: {
  projectId: string;
  environments: UseEnvironment[];
  actorSettings: ActorSetting[];
  sellingPoints: SellingPoint[];
  deepTimeline?: VideoTimeline | null;
}) {
  const [sel, setSel] = useState<CampaignSelectionData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>("platform");

  // Local timeline state (can be customized from deep analysis default)
  const [customTimeline, setCustomTimeline] = useState<TimelineSegment[]>([]);
  const [totalDuration, setTotalDuration] = useState(30);
  const [platform, setPlatform] = useState("tiktok");
  const [selectedSPs, setSelectedSPs] = useState<string[]>([]);

  // Tracks whether the deep-analysis timeline has already been seeded, so it
  // only applies once (and never clobbers a timeline loaded from saved data).
  const deepTimelineSeeded = useRef(false);

  useEffect(() => {
    (async () => {
      const data: CampaignSelectionData | null = await fetch(
        `/api/projects/${projectId}/campaign-selection`
      )
        .then((r) => r.json())
        .catch(() => null);

      if (data) {
        setSel(data);
        if (data.platform) setPlatform(data.platform);
        if (data.totalDurationSec) setTotalDuration(data.totalDurationSec);
        if (data.selectedSellingPoints) setSelectedSPs(data.selectedSellingPoints.map(s => s.point));
        if (data.videoTimeline) setCustomTimeline(data.videoTimeline);
      }
      setLoading(false);

      // Seed timeline from deep analysis if no custom one was saved.
      if (!deepTimelineSeeded.current && !data?.videoTimeline && deepTimeline?.segments?.length) {
        deepTimelineSeeded.current = true;
        setCustomTimeline(deepTimeline.segments);
        setTotalDuration(deepTimeline.recommendedDurationSec || 30);
        if (deepTimeline.platform) setPlatform(deepTimeline.platform);
      }
    })();
  }, [projectId, deepTimeline]);

  const save = useCallback(async (updates: Partial<CampaignSelectionData>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/campaign-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sel, ...updates }),
      });
      const updated = await res.json();
      setSel(updated);
    } finally {
      setSaving(false);
    }
  }, [projectId, sel]);

  const confirm = async () => {
    setConfirming(true);
    try {
      // Save final timeline + platform before confirming
      await save({
        platform,
        totalDurationSec: totalDuration,
        videoTimeline: customTimeline,
        selectedSellingPoints: selectedSPs.map((p, i) => ({ point: p, priority: i + 1 })),
        confirmed: true,
        confirmedAt: new Date().toISOString(),
      });
    } finally {
      setConfirming(false);
    }
  };

  const toggleSection = (s: string) => setExpandedSection(expandedSection === s ? null : s);

  const isComplete = !!(sel.selectedEnvironment && sel.selectedActorRole && selectedSPs.length > 0 && customTimeline.length > 0);

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading campaign context…
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className={cn(
        "rounded-xl border px-4 py-3 flex items-center justify-between gap-4 flex-wrap",
        sel.confirmed ? "border-emerald-200 bg-emerald-50" : isComplete ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"
      )}>
        <div className="flex items-center gap-2.5">
          {sel.confirmed
            ? <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
            : <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />}
          <div>
            <p className={cn("text-sm font-semibold", sel.confirmed ? "text-emerald-800" : "text-amber-800")}>
              {sel.confirmed
                ? "Campaign context confirmed — AI is aligned for next steps"
                : isComplete ? "Ready to confirm — review your selections below" : "Select your campaign focus"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {sel.selectedEnvironment && `Environment: ${sel.selectedEnvironment}`}
              {sel.selectedActorRole && ` · Actor: ${sel.selectedActorRole}`}
              {selectedSPs.length > 0 && ` · ${selectedSPs.length} selling points`}
              {platform && ` · Platform: ${platform}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {!sel.confirmed && isComplete && (
            <Button size="sm" onClick={confirm} disabled={confirming} className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700">
              {confirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Confirm & Align AI
            </Button>
          )}
          {sel.confirmed && (
            <Button size="sm" variant="outline" onClick={() => setSel(p => ({ ...p, confirmed: false }))} className="h-8 text-xs">
              Edit Selections
            </Button>
          )}
        </div>
      </div>

      {/* ── Section 1: Platform + Duration ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection("platform")}
        >
          <SectionHeader icon={Film} title="Platform & Duration" subtitle="Where will this ad run and how long?" complete={!!platform} />
          {expandedSection === "platform" ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        </button>
        {expandedSection === "platform" && (
          <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {PLATFORM_OPTIONS.map(p => (
                <SelectionCard
                  key={p.id}
                  selected={platform === p.id}
                  onClick={() => {
                    setPlatform(p.id);
                    setTotalDuration(p.durationSec);
                    save({ platform: p.id, totalDurationSec: p.durationSec });
                  }}
                >
                  <div className="p-3 text-center">
                    <div className="text-lg mb-1">{p.icon}</div>
                    <p className="text-xs font-semibold leading-tight">{p.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{p.durationSec}s default</p>
                  </div>
                </SelectionCard>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Duration:</p>
              <div className="flex gap-1.5">
                {DURATION_OPTIONS.map(d => (
                  <button
                    key={d}
                    onClick={() => { setTotalDuration(d); save({ totalDurationSec: d }); }}
                    className={cn(
                      "px-3 py-1 rounded-lg border text-xs font-semibold transition-colors",
                      totalDuration === d ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/40"
                    )}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 2: Environment ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection("env")}
        >
          <SectionHeader icon={MapPin} title="Shooting Environment" subtitle="Where does the ad take place?" complete={!!sel.selectedEnvironment} />
          {expandedSection === "env" ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        </button>
        {expandedSection === "env" && (
          <div className="px-4 pb-4 border-t border-border pt-3">
            {environments.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No environments defined. Run research first.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {environments.map((env, i) => (
                  <SelectionCard
                    key={i}
                    selected={sel.selectedEnvironment === env.name}
                    onClick={() => save({ selectedEnvironment: env.name, selectedEnvNotes: env.description, selectedEnvImage: generateEnvImageUrl(env.name, env.imagePrompt) })}
                  >
                    <div className="aspect-video overflow-hidden bg-muted relative">
                      <img
                        src={generateEnvImageUrl(env.name, env.imagePrompt)}
                        alt={env.name}
                        className="w-full h-full object-cover"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
                      />
                      {sel.selectedEnvironment === env.name && (
                        <div className="absolute inset-0 bg-foreground/10" />
                      )}
                    </div>
                    <div className="p-3 space-y-1">
                      <p className="text-xs font-semibold">{env.name}</p>
                      <p className="text-[10px] text-muted-foreground leading-snug">{env.description.slice(0, 80)}…</p>
                      <p className="text-[10px] text-blue-600">{env.typicalUser}</p>
                    </div>
                  </SelectionCard>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Section 3: Actor Role ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection("actor")}
        >
          <SectionHeader icon={Users} title="Actor Role & Persona" subtitle="Who appears in the ad?" complete={!!sel.selectedActorRole} />
          {expandedSection === "actor" ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        </button>
        {expandedSection === "actor" && (
          <div className="px-4 pb-4 border-t border-border pt-3">
            {actorSettings.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No actor settings defined. Run research first.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {actorSettings.map((actor, i) => (
                  <SelectionCard
                    key={i}
                    selected={sel.selectedActorRole === actor.role}
                    onClick={() => save({
                      selectedActorRole: actor.role,
                      selectedActorAge: actor.ageRange,
                      selectedActorDesc: actor.visualDescription,
                      selectedActorImage: generateActorImageUrl(actor.visualDescription, actor.role),
                    })}
                  >
                    {/* Actor portrait */}
                    <div className="aspect-square overflow-hidden bg-muted relative mx-auto w-28 mt-3 rounded-lg">
                      <img
                        src={generateActorImageUrl(actor.visualDescription, actor.role)}
                        alt={actor.role}
                        className="w-full h-full object-cover"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
                      />
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold">{actor.role}</p>
                        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{actor.ageRange}</span>
                      </div>
                      <p className="text-[10px] text-foreground/70 leading-snug">{actor.visualDescription.slice(0, 80)}</p>
                      <div className="rounded-lg bg-red-50 border border-red-100 px-2 py-1">
                        <p className="text-[10px] text-red-700"><span className="font-semibold">Pain:</span> {actor.painPoint.slice(0, 60)}</p>
                      </div>
                      <div className="rounded-lg bg-blue-50 border border-blue-100 px-2 py-1">
                        <p className="text-[10px] text-blue-700"><span className="font-semibold">Action:</span> {actor.productInteraction.slice(0, 80)}</p>
                      </div>
                    </div>
                  </SelectionCard>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Section 4: Selling Points ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection("sp")}
        >
          <SectionHeader icon={Target} title="Selling Points Priority" subtitle="Which benefits should the ad focus on?" complete={selectedSPs.length > 0} />
          {expandedSection === "sp" ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        </button>
        {expandedSection === "sp" && (
          <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
            <p className="text-xs text-muted-foreground">Select up to 5. Drag to reorder (top = highest priority in script).</p>
            {sellingPoints.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No selling points yet. Run research first.</p>
            ) : (
              <div className="space-y-1.5">
                {sellingPoints.slice(0, 8).map((sp) => {
                  const idx = selectedSPs.indexOf(sp.point);
                  const selected = idx !== -1;
                  return (
                    <button
                      key={sp.id}
                      onClick={() => {
                        const next = selected
                          ? selectedSPs.filter(p => p !== sp.point)
                          : selectedSPs.length < 5 ? [...selectedSPs, sp.point] : selectedSPs;
                        setSelectedSPs(next);
                        save({ selectedSellingPoints: next.map((p, i) => ({ point: p, priority: i + 1 })) });
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all",
                        selected ? "border-foreground bg-foreground/5" : "border-border hover:border-foreground/30 bg-card"
                      )}
                    >
                      {/* Priority number */}
                      {selected && (
                        <span className="w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                      )}
                      {!selected && (
                        <span className="w-5 h-5 rounded-full border-2 border-muted flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium leading-snug">{sp.point}</p>
                        <p className="text-[10px] text-muted-foreground">{sp.category}</p>
                      </div>
                      {/* Strength bar */}
                      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden flex-shrink-0">
                        <div
                          className="h-full rounded-full bg-foreground/60"
                          style={{ width: `${sp.strength}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-6 text-right flex-shrink-0">{sp.strength}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedSPs.length > 0 && (
              <div className="rounded-lg bg-muted/50 border border-border p-3">
                <p className="text-[10px] font-semibold text-muted-foreground mb-1">Priority order for script:</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedSPs.map((p, i) => (
                    <span key={i} className="text-[10px] bg-foreground text-background px-2 py-0.5 rounded-full font-medium">
                      {i + 1}. {p.slice(0, 30)}{p.length > 30 ? "…" : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Section 5: Video Timeline ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection("timeline")}
        >
          <SectionHeader icon={Clock} title="Video Timeline Design" subtitle="Second-by-second segment plan" complete={customTimeline.length > 0} />
          {expandedSection === "timeline" ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        </button>
        {expandedSection === "timeline" && (
          <div className="px-4 pb-4 border-t border-border pt-3 space-y-4">
            {customTimeline.length > 0 ? (
              <>
                <TimelineDiagram segments={customTimeline} totalSec={totalDuration} platform={platform} />
                {deepTimeline?.rationale && (
                  <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
                    <p className="text-[10px] text-blue-700 leading-relaxed">
                      <span className="font-semibold">AI Rationale: </span>{deepTimeline.rationale}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No timeline yet</p>
                <p className="text-xs mt-1">
                  Run &quot;Re-analyze Insights&quot; to auto-generate a {totalDuration}s timeline structure,
                  or confirm your platform above to trigger AI timeline generation.
                </p>
              </div>
            )}

            {/* Quick timeline presets */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Quick Presets:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  {
                    label: `TikTok ${totalDuration}s — Hook → Demo → CTA`,
                    segments: [
                      { segment: "Hook", startSec: 0, endSec: Math.round(totalDuration * 0.13), label: "Scroll-Stop Hook", description: "Pattern interrupt — product in action or problem reveal", cameraNote: "Macro close-up or extreme wide", voiceover: "Opening hook line", purpose: "Stop scroll in first 2s" },
                      { segment: "Problem Setup", startSec: Math.round(totalDuration * 0.13), endSec: Math.round(totalDuration * 0.33), label: "Pain Agitation", description: "Show the problem the product solves — real and relatable", cameraNote: "Medium shot, actor not looking at camera", voiceover: "Pain point description", purpose: "Create empathy and tension" },
                      { segment: "Product Demo", startSec: Math.round(totalDuration * 0.33), endSec: Math.round(totalDuration * 0.73), label: "Solution Reveal", description: "Product in use — show key features and results", cameraNote: "Product close-up with slow push-in", voiceover: "Feature benefits", purpose: "Show tangible value" },
                      { segment: "CTA", startSec: Math.round(totalDuration * 0.73), endSec: totalDuration, label: "Call to Action", description: "Clear next step — link in bio, discount, limited time", cameraNote: "Product hero shot or satisfied actor", voiceover: "CTA with urgency", purpose: "Drive conversion" },
                    ],
                  },
                  {
                    label: `TVC ${totalDuration}s — Story Arc`,
                    segments: [
                      { segment: "Hook", startSec: 0, endSec: Math.round(totalDuration * 0.1), label: "Brand Moment", description: "Lifestyle establishing shot with brand energy", cameraNote: "Wide cinematic shot", voiceover: "None — music only", purpose: "Set brand tone" },
                      { segment: "Lifestyle", startSec: Math.round(totalDuration * 0.1), endSec: Math.round(totalDuration * 0.5), label: "Story Scene", description: "Real-life scenario showing product in authentic use", cameraNote: "Moving camera, multiple angles", voiceover: "Voiceover begins", purpose: "Emotional connection" },
                      { segment: "Product Demo", startSec: Math.round(totalDuration * 0.5), endSec: Math.round(totalDuration * 0.8), label: "Feature Showcase", description: "Key differentiating features demonstrated clearly", cameraNote: "Close-up product shots", voiceover: "Feature callouts", purpose: "Rational justification" },
                      { segment: "Brand Reveal", startSec: Math.round(totalDuration * 0.8), endSec: totalDuration, label: "Brand Close", description: "Logo lockup with tagline and website", cameraNote: "Product hero, clean background", voiceover: "Brand tagline", purpose: "Brand recall" },
                    ],
                  },
                ].map((preset, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setCustomTimeline(preset.segments);
                      save({ videoTimeline: preset.segments, totalDurationSec: totalDuration });
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-lg border border-border hover:border-foreground/40 bg-card transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Play className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <p className="text-xs font-medium">{preset.label}</p>
                    </div>
                    <div className="flex gap-0.5 mt-1.5 h-2">
                      {preset.segments.map((seg, j) => {
                        const COLORS = ["bg-red-400", "bg-amber-400", "bg-blue-400", "bg-emerald-400"];
                        const w = ((seg.endSec - seg.startSec) / totalDuration) * 100;
                        return <div key={j} className={cn("rounded-sm", COLORS[j % COLORS.length])} style={{ width: `${w}%` }} />;
                      })}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Summary card when confirmed */}
      {sel.confirmed && (
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold text-emerald-800">AI Context Confirmed</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-white rounded-lg p-2 border border-emerald-100">
              <p className="text-muted-foreground text-[10px] uppercase font-semibold mb-0.5">Platform</p>
              <p className="font-medium">{platform} · {totalDuration}s</p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-emerald-100">
              <p className="text-muted-foreground text-[10px] uppercase font-semibold mb-0.5">Environment</p>
              <p className="font-medium">{sel.selectedEnvironment || "—"}</p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-emerald-100">
              <p className="text-muted-foreground text-[10px] uppercase font-semibold mb-0.5">Actor</p>
              <p className="font-medium">{sel.selectedActorRole || "—"}</p>
            </div>
            <div className="bg-white rounded-lg p-2 border border-emerald-100">
              <p className="text-muted-foreground text-[10px] uppercase font-semibold mb-0.5">Selling Points</p>
              <p className="font-medium">{selectedSPs.length} selected</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
            <Zap className="h-3 w-3" />
            All subsequent AI steps (Insights re-analysis, Script generation) will use this context.
          </div>
        </div>
      )}
    </div>
  );
}
