"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import {
  SCRIPT_TEMPLATES,
  VIDEO_TYPES,
  templatesForPlatform,
  defaultTemplateBatch,
  type ScriptTemplate,
  type VideoType,
} from "@/services/ai/prompts/script-templates";

const TYPE_ORDER: VideoType[] = ["PRODUCT_INTRO", "AWARENESS_INTEREST", "PROMO_OFFER"];

const TYPE_ACCENT: Record<VideoType, string> = {
  PRODUCT_INTRO: "border-sky-300 bg-sky-50 text-sky-800",
  PROMO_OFFER: "border-emerald-300 bg-emerald-50 text-emerald-800",
  AWARENESS_INTEREST: "border-violet-300 bg-violet-50 text-violet-800",
};

export function videoTypeBadgeClass(videoType: string | null | undefined): string {
  const key = (videoType ?? "").toUpperCase() as VideoType;
  return TYPE_ACCENT[key] ?? "border-border bg-muted text-muted-foreground";
}

export function videoTypeLabel(videoType: string | null | undefined): string {
  const key = (videoType ?? "").toUpperCase() as VideoType;
  return VIDEO_TYPES[key]?.label ?? (videoType || "—");
}

interface TemplatePickerProps {
  platformId?: string | null;
  selected: string[];
  onChange: (ids: string[]) => void;
  count: number;
  onCountChange: (n: number) => void;
  disabled?: boolean;
}

export function TemplatePicker({
  platformId,
  selected,
  onChange,
  count,
  onCountChange,
  disabled = false,
}: TemplatePickerProps) {
  const available = useMemo(() => templatesForPlatform(platformId), [platformId]);
  const availableIds = useMemo(() => new Set(available.map((t) => t.id)), [available]);
  const excluded = SCRIPT_TEMPLATES.filter((t) => !availableIds.has(t.id));

  const grouped = useMemo(() => {
    const map = new Map<VideoType, ScriptTemplate[]>();
    for (const type of TYPE_ORDER) map.set(type, []);
    for (const t of available) map.get(t.videoType)?.push(t);
    return map;
  }, [available]);

  const selectedSet = new Set(selected);

  function toggle(id: string) {
    if (disabled) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  function autoPick() {
    onChange(defaultTemplateBatch(platformId, count).map((t) => t.id));
  }

  const effectiveCount = selected.length || count;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold tracking-tight">Script templates</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {platformId
              ? `${available.length} templates viable on ${platformId}`
              : `${available.length} templates`}
            {selected.length > 0
              ? ` · ${selected.length} selected`
              : ` · none selected — a balanced batch of ${count} will be chosen for you`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={autoPick}
            disabled={disabled}
            className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Auto-pick {count}
          </button>
          <span className="text-xs text-muted-foreground">·</span>
          <button
            onClick={() => onChange([])}
            disabled={disabled || selected.length === 0}
            className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="script-count" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
          Scripts to write
        </label>
        <input
          id="script-count"
          type="range"
          min={5}
          max={20}
          step={1}
          value={count}
          disabled={disabled || selected.length > 0}
          onChange={(e) => onCountChange(Number(e.target.value))}
          className="flex-1 accent-foreground disabled:opacity-40"
        />
        <span className="text-sm font-semibold num w-8 text-right">{effectiveCount}</span>
      </div>

      <div className="space-y-3">
        {TYPE_ORDER.map((type) => {
          const list = grouped.get(type) ?? [];
          if (!list.length) return null;
          return (
            <div key={type}>
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                    TYPE_ACCENT[type]
                  )}
                >
                  {VIDEO_TYPES[type].label}
                </span>
                <span className="text-[11px] text-muted-foreground truncate">{VIDEO_TYPES[type].goal}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {list.map((t) => {
                  const isSelected = selectedSet.has(t.id);
                  const fits = platformId ? t.platforms.includes(platformId.toLowerCase()) : true;
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggle(t.id)}
                      disabled={disabled}
                      title={t.whenToUse}
                      className={cn(
                        "text-left rounded-md border px-2.5 py-2 transition-colors disabled:opacity-50",
                        isSelected
                          ? "border-foreground bg-foreground/5"
                          : "border-border hover:border-foreground/30"
                      )}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <p className="text-xs font-semibold leading-tight">{t.name}</p>
                        {isSelected && <Check className="h-3 w-3 shrink-0 mt-0.5" />}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{t.whenToUse}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[9px] num text-muted-foreground">
                          {t.beats.hookPct}/{t.beats.bodyPct}/{t.beats.ctaPct}
                        </span>
                        {!fits && (
                          <span className="text-[9px] text-muted-foreground/70">· off-platform</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {excluded.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Not offered on {platformId}: {excluded.map((t) => t.name).join(", ")}
        </p>
      )}
    </div>
  );
}
