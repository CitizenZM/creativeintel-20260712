"use client";

import { useState, useCallback } from "react";
import {
  MapPin, Users, Pencil, Check, X, Plus, Trash2,
  ChevronDown, ChevronUp, ArrowRight, Lightbulb, Target,
  Zap, CheckCircle2, XCircle, Sparkles,
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
interface DisplayGuideline {
  rule: string;
  example: string;
  antiExample: string;
}
interface Insight {
  id: string;
  category: string;
  title: string;
  description: string;
  importance: number;
  recommendation?: string | null;
}
interface SellingPoint {
  id: string;
  point: string;
  category: string;
  strength: number;
  uniqueness: number;
  frequency: number;
}
interface NarrativePattern {
  id: string;
  type: string;
  name: string;
  description: string;
  frequency: number;
  avgPerformance: number | null;
  bestPractices: unknown;
}

// ─── Inline editable text ────────────────────────────────────────────────────

function InlineEdit({
  value, onSave, multiline = false, placeholder = "Click to edit…", className,
}: {
  value: string; onSave: (v: string) => void | Promise<void>;
  multiline?: boolean; placeholder?: string; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setEditing(false);
  }

  if (editing) {
    const cls = "w-full text-sm border border-foreground rounded-md px-2 py-1 focus:outline-none bg-background";
    return (
      <div className="flex gap-1.5 items-start">
        {multiline
          ? <textarea value={draft} onChange={e => setDraft(e.target.value)} className={cn(cls, "min-h-[60px] resize-y")} autoFocus />
          : <input value={draft} onChange={e => setDraft(e.target.value)} className={cls} autoFocus
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} />}
        <button onClick={save} disabled={saving} className="p-1 rounded hover:bg-muted mt-0.5">
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        </button>
        <button onClick={() => { setDraft(value); setEditing(false); }} className="p-1 rounded hover:bg-muted mt-0.5">
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className={cn("group text-left w-full flex items-start gap-1.5 hover:opacity-80 transition-opacity", className)}
    >
      <span className={value ? "text-sm" : "text-sm italic text-muted-foreground"}>{value || placeholder}</span>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
    </button>
  );
}

// ─── "Send to script" selector ────────────────────────────────────────────────

function SendToScriptBadge({ label, onSend }: { label: string; onSend: () => void }) {
  const [sent, setSent] = useState(false);
  return (
    <button
      onClick={() => { onSend(); setSent(true); setTimeout(() => setSent(false), 2000); }}
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors",
        sent
          ? "bg-emerald-50 border-emerald-300 text-emerald-700"
          : "bg-muted border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
      )}
    >
      {sent ? <Check className="h-2.5 w-2.5" /> : <ArrowRight className="h-2.5 w-2.5" />}
      {sent ? "Added" : `→ ${label}`}
    </button>
  );
}

// ─── SECTION 1: Environments (editable, priority top) ─────────────────────────

export function EnvironmentsSection({
  projectId, initial,
}: { projectId: string; initial: UseEnvironment[] }) {
  const [envs, setEnvs] = useState<UseEnvironment[]>(initial);
  const [expanded, setExpanded] = useState<number | null>(0);

  const save = useCallback(async (updated: UseEnvironment[]) => {
    setEnvs(updated);
    await fetch(`/api/projects/${projectId}/brand`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useEnvironments: updated }),
    });
  }, [projectId]);

  function updateField(i: number, field: keyof UseEnvironment, value: string) {
    const next = envs.map((e, idx) => idx === i ? { ...e, [field]: value } : e);
    save(next);
  }

  function addEnv() {
    const next = [...envs, { name: "New Environment", description: "", typicalUser: "", imagePrompt: "" }];
    save(next);
    setExpanded(next.length - 1);
  }

  function removeEnv(i: number) {
    save(envs.filter((_, idx) => idx !== i));
  }

  if (envs.length === 0) return (
    <div className="rounded-xl border border-dashed border-border p-5 text-center">
      <MapPin className="h-7 w-7 mx-auto mb-2 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">No environments defined</p>
      <p className="text-xs text-muted-foreground mt-1 mb-3">Run research or add environments manually</p>
      <Button size="sm" variant="outline" onClick={addEnv} className="h-7 text-xs gap-1">
        <Plus className="h-3 w-3" /> Add Environment
      </Button>
    </div>
  );

  return (
    <div className="space-y-2">
      {envs.map((env, i) => (
        <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
          <div
            role="button"
            tabIndex={0}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer"
            onClick={() => setExpanded(expanded === i ? null : i)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(expanded === i ? null : i); } }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <MapPin className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <div className="text-left min-w-0">
                <p className="text-sm font-semibold truncate">{env.name || "Unnamed"}</p>
                <p className="text-[11px] text-muted-foreground truncate">{env.typicalUser || "No user defined"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" aria-label="Remove environment" onClick={e => { e.stopPropagation(); removeEnv(i); }} className="p-1 rounded hover:bg-red-50 hover:text-red-500 transition-colors">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {expanded === i ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>

          {expanded === i && (
            <div className="border-t border-border px-4 pb-4 pt-3 space-y-3 bg-muted/20">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Environment Name</p>
                  <InlineEdit value={env.name} onSave={v => updateField(i, "name", v)} />
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Typical User</p>
                  <InlineEdit value={env.typicalUser} placeholder="Who uses product here?" onSave={v => updateField(i, "typicalUser", v)} />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Scene Description (for video production)</p>
                <InlineEdit value={env.description} multiline onSave={v => updateField(i, "description", v)}
                  placeholder="Specific scene details — lighting, props, time of day, mood…" />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">AI Image Generation Prompt</p>
                <InlineEdit value={env.imagePrompt || ""} multiline onSave={v => updateField(i, "imagePrompt", v)}
                  placeholder="Detailed prompt for generating reference scene images…" />
              </div>
            </div>
          )}
        </div>
      ))}
      <button onClick={addEnv} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-2">
        <Plus className="h-3.5 w-3.5" /> Add environment
      </button>
    </div>
  );
}

// ─── SECTION 2: Actor Settings (editable) ────────────────────────────────────

export function ActorSettingsSection({
  projectId, initial,
}: { projectId: string; initial: ActorSetting[] }) {
  const [actors, setActors] = useState<ActorSetting[]>(initial);
  const [expanded, setExpanded] = useState<number | null>(0);

  const save = useCallback(async (updated: ActorSetting[]) => {
    setActors(updated);
    await fetch(`/api/projects/${projectId}/brand`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorSettings: updated }),
    });
  }, [projectId]);

  function updateField(i: number, field: keyof ActorSetting, value: string) {
    const next = actors.map((a, idx) => idx === i ? { ...a, [field]: value } : a);
    save(next);
  }

  function addActor() {
    const next = [...actors, { role: "New Role", ageRange: "25-40", scenario: "", visualDescription: "", painPoint: "", productInteraction: "" }];
    save(next);
    setExpanded(next.length - 1);
  }

  if (actors.length === 0) return (
    <div className="rounded-xl border border-dashed border-border p-5 text-center">
      <Users className="h-7 w-7 mx-auto mb-2 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">No actor roles defined</p>
      <Button size="sm" variant="outline" onClick={addActor} className="h-7 text-xs gap-1 mt-3">
        <Plus className="h-3 w-3" /> Add Actor Role
      </Button>
    </div>
  );

  return (
    <div className="space-y-2">
      {actors.map((actor, i) => (
        <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
          <div
            role="button"
            tabIndex={0}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer"
            onClick={() => setExpanded(expanded === i ? null : i)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(expanded === i ? null : i); } }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                <Users className="h-3.5 w-3.5 text-purple-600" />
              </div>
              <div className="text-left min-w-0">
                <p className="text-sm font-semibold truncate">{actor.role || "Unnamed"}</p>
                <p className="text-[11px] text-muted-foreground">{actor.ageRange} · {actor.scenario?.slice(0, 50) || "No scenario"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" aria-label="Remove actor" onClick={e => { e.stopPropagation(); save(actors.filter((_, idx) => idx !== i)); }} className="p-1 rounded hover:bg-red-50 hover:text-red-500 transition-colors">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {expanded === i ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>

          {expanded === i && (
            <div className="border-t border-border px-4 pb-4 pt-3 space-y-3 bg-muted/20">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Role Name</p>
                  <InlineEdit value={actor.role} onSave={v => updateField(i, "role", v)} />
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Age Range</p>
                  <InlineEdit value={actor.ageRange} onSave={v => updateField(i, "ageRange", v)} />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Scenario</p>
                <InlineEdit value={actor.scenario} multiline onSave={v => updateField(i, "scenario", v)} placeholder="Describe the situation this actor is in…" />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Visual Description (appearance, wardrobe, style)</p>
                <InlineEdit value={actor.visualDescription} multiline onSave={v => updateField(i, "visualDescription", v)} placeholder="Age, gender, ethnicity, hair, clothing details for production…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-red-50 border border-red-100 p-3 space-y-1">
                  <p className="text-[10px] font-semibold text-red-700">Pain Point</p>
                  <InlineEdit value={actor.painPoint} multiline onSave={v => updateField(i, "painPoint", v)} placeholder="What problem do they face?" className="text-red-800" />
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 space-y-1">
                  <p className="text-[10px] font-semibold text-blue-700">Product Interaction</p>
                  <InlineEdit value={actor.productInteraction} multiline onSave={v => updateField(i, "productInteraction", v)} placeholder="How do they physically use the product?" className="text-blue-800" />
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
      <button onClick={addActor} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-2">
        <Plus className="h-3.5 w-3.5" /> Add actor role
      </button>
    </div>
  );
}

// ─── SECTION 3: Display Guidelines (editable) ────────────────────────────────

export function DisplayGuidelinesSection({
  projectId, initial,
}: { projectId: string; initial: DisplayGuideline[] }) {
  const [guides, setGuides] = useState<DisplayGuideline[]>(initial);

  const save = useCallback(async (updated: DisplayGuideline[]) => {
    setGuides(updated);
    await fetch(`/api/projects/${projectId}/brand`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayGuidelines: updated }),
    });
  }, [projectId]);

  function updateField(i: number, field: keyof DisplayGuideline, value: string) {
    save(guides.map((g, idx) => idx === i ? { ...g, [field]: value } : g));
  }

  return (
    <div className="space-y-2">
      {guides.map((guide, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <InlineEdit value={guide.rule} onSave={v => updateField(i, "rule", v)} placeholder="Guideline rule…" className="font-semibold text-sm" />
            <button onClick={() => save(guides.filter((_, idx) => idx !== i))} className="ml-auto p-1 rounded hover:bg-red-50 hover:text-red-500 transition-colors">
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-1">
              <p className="text-[10px] font-semibold text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Correct</p>
              <InlineEdit value={guide.example} multiline onSave={v => updateField(i, "example", v)} placeholder="How to show it correctly…" className="text-emerald-800" />
            </div>
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-1">
              <p className="text-[10px] font-semibold text-red-700 flex items-center gap-1"><XCircle className="h-3 w-3" /> Must Avoid</p>
              <InlineEdit value={guide.antiExample} multiline onSave={v => updateField(i, "antiExample", v)} placeholder="What not to do…" className="text-red-800" />
            </div>
          </div>
        </div>
      ))}
      <button
        onClick={() => save([...guides, { rule: "New guideline", example: "", antiExample: "" }])}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-2"
      >
        <Plus className="h-3.5 w-3.5" /> Add guideline
      </button>
    </div>
  );
}

// ─── SECTION 4: Insights with Send-to-Script ─────────────────────────────────

const CATEGORY_CONFIG: Record<string, { color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  positioning:     { color: "text-blue-700",   bg: "bg-blue-50 border-blue-200",   icon: Target },
  audience:        { color: "text-purple-700", bg: "bg-purple-50 border-purple-200", icon: Users },
  messaging:       { color: "text-amber-700",  bg: "bg-amber-50 border-amber-200",  icon: Sparkles },
  differentiation: { color: "text-emerald-700",bg: "bg-emerald-50 border-emerald-200", icon: Zap },
  opportunity:     { color: "text-teal-700",   bg: "bg-teal-50 border-teal-200",    icon: Lightbulb },
};

function getCatConfig(cat: string) {
  return CATEGORY_CONFIG[cat.toLowerCase()] || { color: "text-muted-foreground", bg: "bg-muted border-border", icon: Lightbulb };
}

export function InsightsSelectableSection({ insights }: { insights: Insight[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sentToScript, setSentToScript] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function sendSelected() {
    const newSent = new Set(sentToScript);
    selected.forEach(id => newSent.add(id));
    setSentToScript(newSent);
    setSelected(new Set());
  }

  // Group by category
  const grouped = insights.reduce<Record<string, Insight[]>>((acc, ins) => {
    const cat = ins.category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(ins);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 rounded-xl border border-foreground bg-foreground text-background px-4 py-2.5 flex items-center justify-between gap-3 shadow-lg">
          <p className="text-sm font-semibold">{selected.size} insight{selected.size > 1 ? "s" : ""} selected</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}
              className="h-7 text-xs bg-transparent border-background/40 text-background hover:bg-background/10">
              Clear
            </Button>
            <Button size="sm" onClick={sendSelected}
              className="h-7 text-xs bg-background text-foreground hover:bg-background/90 gap-1">
              <ArrowRight className="h-3 w-3" /> Add to Script Context
            </Button>
          </div>
        </div>
      )}

      {Object.entries(grouped).map(([cat, catInsights]) => {
        const cfg = getCatConfig(cat);
        const Icon = cfg.icon;
        return (
          <div key={cat} className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground capitalize">{cat}</p>
              <span className="text-[10px] text-muted-foreground">({catInsights.length})</span>
            </div>
            {catInsights.map(ins => {
              const isSelected = selected.has(ins.id);
              const isSent = sentToScript.has(ins.id);
              const isExpanded = expandedId === ins.id;
              return (
                <div
                  key={ins.id}
                  className={cn(
                    "rounded-xl border transition-all cursor-pointer",
                    isSelected ? "border-foreground bg-foreground/5 shadow-sm" : "border-border bg-card hover:border-foreground/30"
                  )}
                >
                  <div className="flex items-start gap-3 p-4" onClick={() => toggle(ins.id)}>
                    {/* Selection checkbox */}
                    <div className={cn(
                      "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors",
                      isSelected ? "border-foreground bg-foreground" : "border-muted-foreground/40"
                    )}>
                      {isSelected && <Check className="h-3 w-3 text-background" />}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug">{ins.title}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isSent && <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5"><Check className="h-3 w-3" /> In Script</span>}
                          <span className="text-[10px] num text-muted-foreground">{ins.importance}</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{ins.description}</p>
                      {ins.recommendation && !isExpanded && (
                        <p className="text-xs text-foreground/80 flex items-start gap-1">
                          <ArrowRight className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                          {ins.recommendation}
                        </p>
                      )}
                    </div>
                    <button onClick={e => { e.stopPropagation(); setExpandedId(isExpanded ? null : ins.id); }}
                      className="p-1 rounded hover:bg-muted transition-colors shrink-0">
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border px-4 pb-4 pt-3 bg-muted/20 space-y-2">
                      <p className="text-xs text-foreground/80 leading-relaxed">{ins.description}</p>
                      {ins.recommendation && (
                        <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
                          <p className="text-[10px] font-semibold text-blue-700 mb-0.5">Recommendation</p>
                          <p className="text-xs text-blue-800 leading-relaxed">{ins.recommendation}</p>
                        </div>
                      )}
                      <div className="flex gap-2 pt-1">
                        <SendToScriptBadge label="Script" onSend={() => { setSentToScript(prev => new Set([...prev, ins.id])); }} />
                        <SendToScriptBadge label="Ideation" onSend={() => { setSentToScript(prev => new Set([...prev, ins.id])); }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Selling Points with send-to-script ──────────────────────────────────────

export function SellingPointsSection({ sellingPoints }: { sellingPoints: SellingPoint[] }) {
  const [sent, setSent] = useState<Set<string>>(new Set());

  return (
    <div className="space-y-2">
      {sellingPoints.map(sp => (
        <div key={sp.id} className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
          {/* Strength bar on left */}
          <div className="flex-shrink-0 w-1 h-10 rounded-full bg-muted overflow-hidden">
            <div className="w-full rounded-full bg-foreground/60 transition-all" style={{ height: `${sp.strength}%` }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug">{sp.point}</p>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-[10px] text-muted-foreground capitalize">{sp.category.replace("_", " ")}</span>
              <span className="text-[10px] text-muted-foreground">Strength: {sp.strength}</span>
              <span className="text-[10px] text-muted-foreground">Unique: {sp.uniqueness}</span>
              <span className="text-[10px] text-muted-foreground">{sp.frequency}×</span>
            </div>
          </div>
          <SendToScriptBadge
            label="Script"
            onSend={() => setSent(prev => new Set([...prev, sp.id]))}
          />
          {sent.has(sp.id) && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

// ─── Narrative Patterns with send-to-script ───────────────────────────────────

export function NarrativePatternsSection({ patterns }: { patterns: NarrativePattern[] }) {
  const NARRATIVE_LABELS: Record<string, string> = {
    PROBLEM_SOLUTION: "Problem / Solution", TESTIMONIAL: "Testimonial",
    DEMONSTRATION: "Demonstration", LIFESTYLE: "Lifestyle",
    EDUCATIONAL: "Educational", COMPARISON: "Comparison",
    STORY_ARC: "Story Arc", UGC_STYLE: "UGC Style",
    TREND_RIDING: "Trend Riding", BEFORE_AFTER: "Before / After",
  };
  const [, setSent] = useState<Set<string>>(new Set());

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {patterns.map(p => (
        <div key={p.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{NARRATIVE_LABELS[p.type] || p.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold num tracking-tight">{p.avgPerformance?.toFixed(0) ?? "—"}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg score</p>
            </div>
          </div>
          {/* Performance bar */}
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-foreground/60" style={{ width: `${Math.min(p.avgPerformance || 0, 100)}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Used {p.frequency}× in top content</span>
            <SendToScriptBadge label="Script" onSend={() => setSent(prev => new Set([...prev, p.id]))} />
          </div>
          {(p.bestPractices as string[])?.length > 0 && (
            <div className="rounded-lg bg-muted/50 p-2.5 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Best Practices</p>
              <ul className="space-y-0.5">
                {((p.bestPractices as string[]) || []).slice(0, 3).map((bp, i) => (
                  <li key={i} className="flex gap-2 text-[11px] text-foreground/70">
                    <Check className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />{bp}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
