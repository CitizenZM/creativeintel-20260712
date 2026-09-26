"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CheckSquare, Square, ChevronDown, ChevronUp, Archive } from "lucide-react";
import { getScriptTemplate } from "@/services/ai/prompts/script-templates";
import { SEGMENT_STYLES } from "./segment-styles";
import { videoTypeBadgeClass, videoTypeLabel } from "./template-picker";

export interface ScriptHookData {
  text?: string;
  visual?: string;
  shot?: string;
  durationSec?: number;
  hookFormula?: string;
}

export interface ScriptBeatData {
  beat?: string;
  sellingPoint?: string;
  howExpressed?: string;
  shot?: string;
  startSec?: number;
  endSec?: number;
  voiceover?: string;
  textOverlay?: string;
  proof?: string;
}

export interface ScriptCtaData {
  text?: string;
  offer?: string;
  urgency?: string;
  visual?: string;
  shot?: string;
  durationSec?: number;
}

export interface ScriptData {
  id: string;
  createdAt?: string;
  status?: string;
  selectedHookIdx?: number | null;
  selectedCtaIdx?: number | null;
  roleName?: string | null;
  environmentName?: string | null;
  title: string;
  angle: string;
  format: string;
  duration: string;
  platform?: string | null;
  totalDurationSec?: number | null;
  videoType?: string | null;
  template?: string | null;
  hook?: ScriptHookData | null;
  bodyBeats?: ScriptBeatData[] | null;
  cta?: ScriptCtaData | null;
  hookVariants: string[];
  body: string;
  ctaVariants: string[];
  narrativeType: string;
  targetEmotion: string;
  predictedScore: number;
  /** Brand-rule violations the rewrite couldn't fix (the title carries ⚠). */
  complianceNotes?: string[] | null;
}

type Picks = Pick<ScriptData, "selectedHookIdx" | "selectedCtaIdx" | "roleName" | "environmentName">;

/**
 * The choices that shape this script's storyboard: which generated hook and
 * CTA to lead with, who is on camera and where. Saved on change.
 */
function ScriptPicks({
  projectId,
  script,
  castOptions,
}: {
  projectId: string;
  script: ScriptData;
  castOptions?: { roles: string[]; environments: string[] };
}) {
  const hooks = Array.isArray(script.hookVariants) ? script.hookVariants : [];
  const ctas = Array.isArray(script.ctaVariants) ? script.ctaVariants : [];
  const [picks, setPicks] = useState<Picks>({
    selectedHookIdx: script.selectedHookIdx ?? null,
    selectedCtaIdx: script.selectedCtaIdx ?? null,
    roleName: script.roleName ?? null,
    environmentName: script.environmentName ?? null,
  });
  const [note, setNote] = useState<string | null>(null);

  async function save(patch: Partial<Picks>) {
    const prev = picks;
    setPicks({ ...picks, ...patch });
    setNote(null);
    const res = await fetch(`/api/projects/${projectId}/creative/scripts/${script.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res?.ok) {
      setPicks(prev);
      setNote("Couldn't save that pick — try again.");
    } else {
      setNote("Saved — used the next time this script is storyboarded.");
    }
  }

  const roles = castOptions?.roles ?? [];
  const environments = castOptions?.environments ?? [];
  if (hooks.length < 2 && ctas.length < 2 && roles.length === 0 && environments.length === 0) return null;

  const chip = (on: boolean) =>
    cn(
      "rounded-md border px-2 py-1 text-left text-xs transition-colors",
      on ? "border-foreground bg-foreground/5 font-medium" : "border-border text-muted-foreground hover:border-foreground/40"
    );

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your picks for this script</p>
      {hooks.length > 1 && (
        <div role="radiogroup" aria-label="Hook" className="space-y-1">
          <p className="text-xs font-medium">Opening hook</p>
          <div className="flex flex-col gap-1">
            {hooks.map((h, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={(picks.selectedHookIdx ?? 0) === i}
                onClick={() => save({ selectedHookIdx: i })}
                className={chip((picks.selectedHookIdx ?? 0) === i)}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      )}
      {ctas.length > 1 && (
        <div role="radiogroup" aria-label="Call to action" className="space-y-1">
          <p className="text-xs font-medium">Call to action</p>
          <div className="flex flex-wrap gap-1">
            {ctas.map((c, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={(picks.selectedCtaIdx ?? 0) === i}
                onClick={() => save({ selectedCtaIdx: i })}
                className={chip((picks.selectedCtaIdx ?? 0) === i)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
      {(roles.length > 0 || environments.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="space-y-1 text-xs">
            <span className="font-medium">On camera</span>
            <select
              value={picks.roleName ?? ""}
              onChange={(e) => save({ roleName: e.target.value || null })}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="">Campaign default</option>
              {roles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">Setting</span>
            <select
              value={picks.environmentName ?? ""}
              onChange={(e) => save({ environmentName: e.target.value || null })}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="">Campaign default</option>
              {environments.map((env) => (
                <option key={env} value={env}>{env}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p className="text-xs leading-relaxed">
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </p>
  );
}

export function ScriptCard({
  projectId,
  script,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onArchive,
  castOptions,
}: {
  script: ScriptData;
  projectId: string;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onArchive?: () => void;
  /** Brand roles and settings this script can be cast with. */
  castOptions?: { roles: string[]; environments: string[] };
}) {
  const template = getScriptTemplate(script.template);
  const total = script.totalDurationSec || 30;
  const hook = script.hook ?? null;
  const beats = Array.isArray(script.bodyBeats) ? script.bodyBeats : [];
  const [editing, setEditing] = useState(false);
  // The saved body lives here rather than being written back onto the prop —
  // the parent owns that object and mutating it would not re-render anyway.
  const [bodyText, setBodyText] = useState(script.body);
  const [draft, setDraft] = useState(script.body);
  const [saving, setSaving] = useState(false);
  const [editNote, setEditNote] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setEditNote(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/creative/scripts/${script.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
      setBodyText(draft);
      setEditing(false);
      // Edits are not blocked on compliance, but they are reported — the
      // studio will render exactly what this says.
      if (Array.isArray(data.complianceWarnings) && data.complianceWarnings.length > 0) {
        setEditNote(`Saved, but check: ${data.complianceWarnings.join(" · ")}`);
      }
    } catch (err) {
      setEditNote(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }
  const cta = script.cta ?? null;
  const structured = Boolean(hook?.text || beats.length || cta?.text);

  const hookDur = Math.max(1, Math.round(hook?.durationSec ?? 3));
  const ctaDur = Math.max(1, Math.round(cta?.durationSec ?? 3));
  const ctaStart = Math.max(hookDur, total - ctaDur);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-all",
        selected ? "border-foreground" : "border-border"
      )}
    >
      <div className="w-full p-4 flex items-center justify-between gap-3">
        <button onClick={onToggleSelect} className="shrink-0" aria-label="Select script">
          {selected ? (
            <CheckSquare className="h-5 w-5 text-foreground" />
          ) : (
            <Square className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={onToggleExpand}
          className="flex-1 text-left flex items-center justify-between gap-3"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold">{script.title}</p>
              {script.videoType && (
                <span
                  className={cn(
                    "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                    videoTypeBadgeClass(script.videoType)
                  )}
                >
                  {videoTypeLabel(script.videoType)}
                </span>
              )}
              {(template || script.template) && (
                <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">
                  {template?.name ?? script.template}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              <span className="font-medium text-foreground">{script.angle.slice(0, 60)}</span>
              <span className="mx-1">·</span>
              {script.duration}
              {script.targetEmotion ? ` · ${script.targetEmotion}` : ""}
            </p>
            {!!script.complianceNotes?.length && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                Check before producing: {script.complianceNotes.join(" · ")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <span className="text-lg font-semibold num">{script.predictedScore}</span>
              <p className="text-[10px] text-muted-foreground">predicted</p>
            </div>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>
        <Link
          href={`/projects/${projectId}/library`}
          title="Script versions, picks and archived scripts"
          className="shrink-0 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          History
        </Link>
        {onArchive && (
          <button
            type="button"
            onClick={onArchive}
            className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Archive script"
            title="Archive — hides this script and its storyboards"
          >
            <Archive className="h-4 w-4" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          <ScriptPicks projectId={projectId} script={script} castOptions={castOptions} />
          {structured ? (
            <div className="space-y-3">
              {/* HOOK */}
              <section className={cn("rounded-md border-l-4 bg-muted/40 px-3 py-2.5", SEGMENT_STYLES.HOOK.border)}>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                      SEGMENT_STYLES.HOOK.badge
                    )}
                  >
                    Hook
                  </span>
                  <span className="text-[10px] num text-muted-foreground">0–{hookDur}s</span>
                  {hook?.hookFormula && (
                    <span className="text-[10px] text-muted-foreground">· {hook.hookFormula}</span>
                  )}
                </div>
                <p className="text-sm font-medium">{hook?.text || "—"}</p>
                <div className="mt-1 space-y-0.5">
                  <Field label="Visual" value={hook?.visual} />
                  <Field label="Shot" value={hook?.shot} />
                </div>
              </section>

              {/* BODY */}
              <section className="space-y-2">
                {beats.map((b, i) => (
                  <div
                    key={i}
                    className={cn("rounded-md border-l-4 bg-muted/30 px-3 py-2.5", SEGMENT_STYLES.BODY.border)}
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span
                        className={cn(
                          "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                          SEGMENT_STYLES.BODY.badge
                        )}
                      >
                        Body {i + 1}
                      </span>
                      <span className="text-[10px] num text-muted-foreground">
                        {b.startSec ?? 0}–{b.endSec ?? 0}s
                      </span>
                      {b.beat && <span className="text-[10px] text-muted-foreground">· {b.beat}</span>}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3 gap-y-0.5 mb-1">
                      <p className="text-xs">
                        <span className="text-muted-foreground">Selling point: </span>
                        <span className="font-medium">{b.sellingPoint || "—"}</span>
                      </p>
                      <p className="text-xs">
                        <span className="text-muted-foreground">How: </span>
                        <span className="font-medium">{b.howExpressed || "—"}</span>
                      </p>
                      <p className="text-xs">
                        <span className="text-muted-foreground">Shot: </span>
                        <span className="font-medium">{b.shot || "—"}</span>
                      </p>
                    </div>
                    <Field label="VO" value={b.voiceover} />
                    <Field label="Text" value={b.textOverlay} />
                    <Field label="Proof" value={b.proof} />
                  </div>
                ))}
                {beats.length === 0 && (
                  <p className="text-xs text-muted-foreground">No structured body beats on this script.</p>
                )}
              </section>

              {/* CTA */}
              <section className={cn("rounded-md border-l-4 bg-muted/40 px-3 py-2.5", SEGMENT_STYLES.CTA.border)}>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                      SEGMENT_STYLES.CTA.badge
                    )}
                  >
                    CTA
                  </span>
                  <span className="text-[10px] num text-muted-foreground">
                    {ctaStart}–{total}s
                  </span>
                </div>
                <p className="text-sm font-medium">{cta?.text || "—"}</p>
                <div className="mt-1 space-y-0.5">
                  <Field label="Offer" value={cta?.offer} />
                  <Field label="Urgency" value={cta?.urgency} />
                  <Field label="Visual" value={cta?.visual} />
                  <Field label="Shot" value={cta?.shot} />
                </div>
              </section>
            </div>
          ) : null}

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                Script body
              </p>
              {!editing ? (
                <button
                  onClick={() => {
                    setDraft(bodyText);
                    setEditing(true);
                    setEditNote(null);
                  }}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditing(false)}
                    disabled={saving}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button onClick={save} disabled={saving} className="text-[11px] font-semibold">
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
            </div>
            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
                className="w-full rounded-md border border-border bg-background p-3 text-sm leading-relaxed font-mono"
              />
            ) : (
              <div className="rounded-md bg-muted p-4 text-sm whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                {bodyText}
              </div>
            )}
            {editNote && <p className="mt-1.5 text-[11px] text-amber-700">{editNote}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
                Hook variants
              </p>
              <ol className="space-y-1.5">
                {script.hookVariants.map((h, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <span className="text-muted-foreground shrink-0 num w-4">{i + 1}.</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
                CTA variants
              </p>
              <ol className="space-y-1.5">
                {script.ctaVariants.map((c, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <span className="text-muted-foreground shrink-0 num w-4">{i + 1}.</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
