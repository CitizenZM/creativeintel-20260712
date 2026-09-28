"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format-duration";
import type { VisionModelOption } from "@/services/settings/ai-settings-core";

interface PickerData {
  current: string;
  recommended: string;
  options: VisionModelOption[];
  strictFree: boolean;
}

function price(usd: number): string {
  if (usd === 0) return "free";
  return usd < 0.01 ? `~$${usd.toFixed(3)}` : `~$${usd.toFixed(2)}`;
}

/**
 * Pick the model that reads the ad frames before an analysis runs. Shows each
 * model's measured speed and cost per ad, marks the recommended one, and saves
 * the choice for every later teardown (same setting as Settings → AI engines).
 */
export function VisionModelPicker({
  adCount,
  compact = false,
  className,
  onSaved,
}: {
  adCount?: number;
  compact?: boolean;
  className?: string;
  onSaved?: () => void | Promise<void>;
}) {
  const [data, setData] = useState<PickerData | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/ai/vision-model", { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load the vision models (${res.status})`);
    setData((await res.json()) as PickerData);
  }, []);

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  async function choose(model: string) {
    const option = data?.options.find((o) => o.model === model);
    if (!option) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vision: option.engine, visionModel: option.model }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Could not save (${res.status})`);
      }
      await load();
      await onSaved?.();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return error ? <p className={cn("text-[11px] text-muted-foreground", className)}>{error}</p> : null;
  }

  const selected = data.options.find((o) => o.model === data.current);
  const recommended = data.options.find((o) => o.model === data.recommended);
  const n = adCount && adCount > 0 ? adCount : 0;

  return (
    <div
      className={cn("rounded-md border border-border bg-background/80 px-2.5 py-2 text-xs", className)}
      data-testid="vision-model-picker"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <label htmlFor="vision-model" className="font-medium text-foreground">
          Vision model
        </label>
        <select
          id="vision-model"
          value={selected ? selected.model : ""}
          disabled={saving}
          onChange={(e) => void choose(e.target.value)}
          className="h-8 min-w-0 max-w-full flex-1 rounded-md border border-border bg-background px-2 text-xs sm:max-w-sm"
        >
          {!selected && <option value="">{data.current} (current)</option>}
          {data.options.map((o) => (
            <option key={o.model} value={o.model} disabled={!!o.disabledReason && o.model !== data.current}>
              {o.label} — {price(o.usdPerAd)}/ad · ~{o.secsPerAd}s/ad
              {o.recommended ? " · Recommended" : ""}
              {o.disabledReason ? ` (${o.disabledReason})` : ""}
            </option>
          ))}
        </select>
        <span className="w-4">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : saved ? (
            <Check className="h-3.5 w-3.5 text-[var(--status-healthy-fg)]" />
          ) : null}
        </span>
      </div>

      {selected && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {selected.note}
          {n > 0 && (
            <>
              {" "}
              For up to {n} ad{n === 1 ? "" : "s"}: <span className="font-medium text-foreground">{price(selected.usdPerAd * n)}</span>, about{" "}
              {formatDuration(Math.round((selected.secsPerAd * n) / (selected.engine === "glm" ? 2 : 3)))}.
            </>
          )}
        </p>
      )}
      {!compact && recommended && selected?.model !== recommended.model && (
        <p className="mt-1 text-[11px] text-foreground">
          <span className="font-semibold">Recommended: {recommended.label}</span> — {recommended.note}{" "}
          <button
            type="button"
            disabled={saving || !!recommended.disabledReason}
            onClick={() => void choose(recommended.model)}
            className="font-medium underline underline-offset-2 disabled:opacity-60"
          >
            Use it
          </button>
        </p>
      )}
      {error && <p className="mt-1 text-[11px] text-[var(--status-urgent-fg)]">{error}</p>}
    </div>
  );
}
