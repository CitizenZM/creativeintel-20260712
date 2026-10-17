"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportHook, TrendPlatform } from "@/services/research/hook-trends";
import type { PlatformId } from "@/services/creative/types";

type Evidence = {
  generatedAt: string;
  window: { from: string; to: string; days: number };
  platform: TrendPlatform;
  coverage: { ads: number; classified: number; platformAds: number; latestEvidenceAt: string | null; byMethod: { rules: number; llm: number; fallback: number } };
  rising: ReportHook[];
  saturated: ReportHook[];
  longevityLeaders: ReportHook[];
  recommendations: string[];
};

const SOURCE_LINKS: Partial<Record<TrendPlatform, { title: string; url: string }>> = {
  tiktok: { title: "TikTok Creative Center Top Ads", url: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en" },
  youtube: { title: "YouTube Shorts analytics", url: "https://support.google.com/youtube/answer/12942217" },
};

function researchPlatform(platform: PlatformId | null): TrendPlatform | null {
  if (!platform) return null;
  if (platform === "tiktok") return "tiktok";
  if (platform.startsWith("youtube_") || platform === "google_demand_gen") return "youtube";
  if (platform.startsWith("instagram_") || platform.startsWith("facebook_") || platform.startsWith("meta_")) return "meta";
  if (platform === "pinterest" || platform === "snapchat") return platform;
  return null;
}

export function HookEvidence({ projectId, platform, onPin }: { projectId: string; platform: PlatformId | null; onPin: (id: string) => void }) {
  const source = researchPlatform(platform);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loadedPlatform, setLoadedPlatform] = useState<TrendPlatform | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!source || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/hook-selector?platform=${source}`);
      const body = await response.json() as Evidence & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Research failed (HTTP ${response.status})`);
      setEvidence(body);
      setLoadedPlatform(source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research failed");
    } finally {
      setLoading(false);
    }
  }

  const current = source === loadedPlatform ? evidence : null;
  const evidenceAgeDays = current?.coverage.latestEvidenceAt
    ? Math.max(0, Math.floor((new Date(current.generatedAt).getTime() - new Date(current.coverage.latestEvidenceAt).getTime()) / 86_400_000))
    : null;
  const sourceLink = source ? SOURCE_LINKS[source] : null;
  return (
    <section className="mt-4 rounded-lg border p-3 text-xs" aria-label="Research-backed hook selector">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <p className="font-medium">Research-backed hook selector</p>
          <p className="text-muted-foreground">Compare openings from saved competitor ads for this platform. Load on demand; no AI call.</p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={!source || loading}>
          {loading && <Loader2 className="animate-spin" />}{current ? "Refresh evidence" : "Find hooks"}
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
      {current && (
        <div className="mt-3 space-y-3">
          <p className="text-muted-foreground">
            {current.coverage.platformAds} {source} ads in this window · {current.coverage.classified} classified across the category · {current.window.days}-day window · latest saved ad observed {current.coverage.latestEvidenceAt ? new Date(current.coverage.latestEvidenceAt).toLocaleDateString() : "unknown"} · analysis run {new Date(current.generatedAt).toLocaleString()}
          </p>
          {evidenceAgeDays !== null && evidenceAgeDays > 14 && <p className="rounded-md bg-amber-500/10 p-2">The newest saved {source} ad was observed {evidenceAgeDays} days before this analysis. Review current ads before treating these hooks as recent.</p>}
          {current.coverage.platformAds < 6 && <p className="rounded-md bg-amber-500/10 p-2">Small platform sample. Use these as ideas to test, not proof of performance. Add current ads from the platform source below.</p>}
          {current.rising.length === 0 && <p className="text-muted-foreground">No rising pattern detected in this window. Use the library above and test the first frame against the same body.</p>}
          {current.rising.length > 0 && <div><p className="mb-1 font-medium">Candidates to test</p><div className="grid gap-2 md:grid-cols-2">{current.rising.map((hook) => (
            <div key={hook.hookId} className="rounded-md border p-2">
              <p className="font-medium">{hook.hookId} · {hook.name}</p>
              <p className="text-muted-foreground">{hook.ads} ads · {Math.round(hook.share * 100)}% of this platform sample</p>
              <div className="mt-1 flex flex-wrap items-center gap-2"><Button size="xs" variant="outline" onClick={() => onPin(hook.hookId)}>Pin for this platform</Button>{hook.examples.filter((e) => e.url && /^https?:\/\//.test(e.url)).slice(0, 2).map((e) => <a key={e.url} href={e.url!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">Example <ExternalLink className="size-3" /></a>)}</div>
            </div>
          ))}</div></div>}
          {current.saturated.length > 0 && <p className="text-muted-foreground">Common in this sample: {current.saturated.map((h) => `${h.hookId} (${h.ads})`).join(", ")}. Test a different opening before reusing one.</p>}
        </div>
      )}
      {sourceLink && <a className="mt-3 inline-flex items-center gap-1 text-muted-foreground underline" href={sourceLink.url} target="_blank" rel="noopener noreferrer">Review current {sourceLink.title} <ExternalLink className="size-3" /></a>}
      {source === "youtube" && <p className="mt-1 text-muted-foreground">Compare Shorts with “viewed vs. swiped away”; do not mix that measure with TikTok ad view rates.</p>}
    </section>
  );
}
