"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, RefreshCw, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { RESEARCH_STARTED_EVENT } from "@/components/research/research-progress";
import { CAMPAIGN_PLATFORMS, adaptersFor } from "@/lib/campaign-platform";

interface PlatformOption {
  id: string;
  label: string;
  icon: string;
  durationSec: number;
  /** The sources this platform dispatches, shown so the choice is legible. */
  sources: string;
}

const ADAPTER_LABELS: Record<string, string> = {
  youtube_long: "YouTube",
  youtube_shorts: "YT Shorts",
  meta_ad_library: "Meta Ad Library",
  tiktok_cc: "TikTok Creative Center",
  tiktok_organic: "TikTok",
  instagram: "Instagram",
  browser_meta: "Meta AL (worker)",
  browser_tiktok: "TikTok AL (worker)",
  browser_google: "Google ATC (worker)",
};

const ICONS: Record<string, string> = {
  tiktok: "⬛",
  instagram: "📸",
  youtube: "▶️",
  tvc: "📺",
  amazon: "📦",
};

// Derived from the dispatch table, so the picker can never offer a platform the
// research runner has no adapters for.
const PLATFORMS: PlatformOption[] = Object.values(CAMPAIGN_PLATFORMS).map((p) => ({
  id: p.id,
  label: p.label,
  icon: ICONS[p.id] ?? "🎬",
  durationSec: p.defaultDurationSec,
  sources: adaptersFor(p)
    .map((a) => ADAPTER_LABELS[a])
    .filter(Boolean)
    .join(" · "),
}));

const DURATIONS = [15, 30, 45, 60];

export function ContentPlatformControls({
  projectId,
  initialPlatform,
  initialDuration,
  hasContent,
}: {
  projectId: string;
  initialPlatform: string | null;
  initialDuration: number | null;
  hasContent: boolean;
}) {
  const router = useRouter();
  const [platform, setPlatform] = useState(initialPlatform || "tiktok");
  const [duration, setDuration] = useState(initialDuration || 30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickPlatform(p: PlatformOption) {
    setPlatform(p.id);
    setDuration(p.durationSec); // sensible default; user can still override below
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      // 1) Persist the selected video mode so search stays consistent with it.
      const saveRes = await fetch(`/api/projects/${projectId}/campaign-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, totalDurationSec: duration }),
      });
      if (!saveRes.ok) throw new Error("Could not save platform selection");

      // 2) Kick off research / regenerate for this platform.
      const res = await fetch(`/api/projects/${projectId}/research`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not start research");

      // 3) The progress panel at the top of this page takes it from here.
      window.dispatchEvent(new CustomEvent(RESEARCH_STARTED_EVENT, { detail: { jobId: data?.jobId } }));
      router.refresh();
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  const activePlatform = PLATFORMS.find((p) => p.id === platform);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Video mode</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Where will this ad run and how long? This picks which ad sources are searched.
          </p>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-foreground text-background hover:bg-foreground/90 text-sm font-medium disabled:opacity-60 shrink-0"
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : hasContent ? (
            <RefreshCw className="mr-2 h-4 w-4" />
          ) : (
            <Search className="mr-2 h-4 w-4" />
          )}
          {hasContent ? "Regenerate" : "Run research"}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Platform options */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            onClick={() => pickPlatform(p)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
              platform === p.id
                ? "border-foreground bg-foreground/5"
                : "border-border hover:border-foreground/40"
            )}
          >
            <span className="text-lg leading-none">{p.icon}</span>
            <span className="text-xs font-medium leading-tight">{p.label}</span>
            <span className="text-[10px] text-muted-foreground">{p.durationSec}s default</span>
            <span className="text-[10px] text-muted-foreground/70 leading-tight line-clamp-2">
              {p.sources}
            </span>
          </button>
        ))}
      </div>

      {/* Duration */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground">Duration:</span>
        {DURATIONS.map((d) => (
          <button
            key={d}
            onClick={() => setDuration(d)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              duration === d
                ? "border-foreground bg-foreground/5 font-medium"
                : "border-border text-muted-foreground hover:border-foreground/40"
            )}
          >
            {d}s
          </button>
        ))}
        {activePlatform && (
          <span className="text-[11px] text-muted-foreground ml-1">
            · {activePlatform.label} · {duration}s
          </span>
        )}
      </div>
    </div>
  );
}
