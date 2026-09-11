"use client";

import { cn } from "@/lib/utils";
import { CheckSquare, Square, ChevronDown, ChevronUp } from "lucide-react";
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
  script,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
}: {
  script: ScriptData;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}) {
  const template = getScriptTemplate(script.template);
  const total = script.totalDurationSec || 30;
  const hook = script.hook ?? null;
  const beats = Array.isArray(script.bodyBeats) ? script.bodyBeats : [];
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
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
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
          ) : (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
                Script body
              </p>
              <div className="rounded-md bg-muted p-4 text-sm whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                {script.body}
              </div>
            </div>
          )}

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
