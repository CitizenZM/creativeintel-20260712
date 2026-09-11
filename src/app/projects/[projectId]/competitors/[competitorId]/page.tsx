import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  ArrowLeft, ExternalLink, Zap, Film, Tag, MousePointerClick,
  Clock, Lightbulb, AlertCircle,
} from "lucide-react";
import { AdTeardownCard, type TeardownAssetView } from "@/components/insights/ad-teardown-card";

const TOP_N = Number(process.env.TOP_N_DEEP) || 5;

type HookRow = { hookType?: string; count?: number; example?: string; whyItLands?: string };
type FormatRow = { format?: string; count?: number; typicalDurationSec?: number; notes?: string };
type OfferRow = { offer?: string; frequency?: number; placement?: string; aggressiveness?: string };
type CtaRow = { ctaText?: string; placement?: string; frequency?: number; destination?: string };
type Cadence = {
  avgDurationSec?: number;
  hookWindowSec?: number;
  productRevealSec?: number;
  ctaStartPct?: number;
  beatsPerAd?: number;
  notes?: string;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 border border-border px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
    </div>
  );
}

export default async function CompetitorDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; competitorId: string }>;
}) {
  const { projectId, competitorId } = await params;

  const competitor = await prisma.competitor.findUnique({
    where: { id: competitorId },
    include: {
      rollup: true,
      insights: { orderBy: { importance: "desc" } },
      _count: { select: { contentAssets: true, adTeardowns: true } },
    },
  });

  if (!competitor || competitor.projectId !== projectId) notFound();

  const assets = await prisma.contentAsset.findMany({
    where: { projectId, competitorId },
    orderBy: [{ rankInOwner: "asc" }, { overallScore: "desc" }],
    take: TOP_N,
    include: { teardown: true },
  });

  const rollup = competitor.rollup;
  const hooks = asArray<HookRow>(rollup?.dominantHooks);
  const formats = asArray<FormatRow>(rollup?.dominantFormats);
  const offers = asArray<OfferRow>(rollup?.offerLadder);
  const ctas = asArray<CtaRow>(rollup?.ctaPatterns);
  const cadence = (rollup?.cadence as Cadence | null) || null;

  const cards: TeardownAssetView[] = assets.map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    thumbnailUrl: a.thumbnailUrl,
    platform: a.platform,
    adSource: a.adSource,
    isPaidMedia: a.isPaidMedia,
    durationSec: a.durationSec,
    viewCount: a.viewCount,
    overallScore: a.overallScore,
    rankInOwner: a.rankInOwner,
    teardown: a.teardown
      ? {
          id: a.teardown.id,
          rank: a.teardown.rank,
          hookType: a.teardown.hookType,
          hookText: a.teardown.hookText,
          hookVisual: a.teardown.hookVisual,
          beats: a.teardown.beats,
          sellingPoints: a.teardown.sellingPoints,
          proofDevices: a.teardown.proofDevices,
          ctaText: a.teardown.ctaText,
          ctaPlacement: a.teardown.ctaPlacement,
          offer: a.teardown.offer,
          landingUrl: a.teardown.landingUrl,
          whyItWorks: a.teardown.whyItWorks,
          evidenceLevel: a.teardown.evidenceLevel,
          confidence: a.teardown.confidence,
        }
      : null,
  }));

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}/insights`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to insights
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">{competitor.name}</h2>
          <p className="text-xs text-muted-foreground">
            {competitor._count.contentAssets} ads collected · {competitor._count.adTeardowns} torn down · Top {TOP_N} shown
          </p>
          {competitor.url && (
            <a
              href={competitor.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> {competitor.url}
            </a>
          )}
        </div>
      </div>

      {competitor.valueProposition && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-sm font-bold">Positioning</p>
          <p className="text-xs text-foreground/80 leading-relaxed">{competitor.valueProposition}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {competitor.brandPromise && <Stat label="Promise" value={competitor.brandPromise} />}
            {competitor.toneOfVoice && <Stat label="Tone" value={competitor.toneOfVoice} />}
            {competitor.pricingTheme && <Stat label="Pricing" value={competitor.pricingTheme} />}
          </div>
        </section>
      )}

      {rollup && (
        <section className="rounded-2xl border-2 border-rose-200 bg-rose-50/20 p-5 space-y-4">
          <p className="text-sm font-bold">Creative playbook</p>
          <p className="text-xs text-foreground/80 leading-relaxed">{rollup.summary}</p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {hooks.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3 w-3" /> Dominant hooks
                </p>
                {hooks.map((h, i) => (
                  <div key={i} className="rounded-lg border border-border bg-card px-3 py-2 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold capitalize">{(h.hookType || "").replace(/_/g, " ")}</p>
                      <span className="text-[10px] text-muted-foreground">{h.count ?? 0}×</span>
                    </div>
                    {h.example && <p className="text-[11px] italic text-foreground/70">&ldquo;{h.example}&rdquo;</p>}
                    {h.whyItLands && <p className="text-[10px] text-muted-foreground">{h.whyItLands}</p>}
                  </div>
                ))}
              </div>
            )}

            {formats.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground flex items-center gap-1">
                  <Film className="h-3 w-3" /> Formats
                </p>
                {formats.map((f, i) => (
                  <div key={i} className="rounded-lg border border-border bg-card px-3 py-2 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold">{f.format}</p>
                      <span className="text-[10px] text-muted-foreground">
                        {f.count ?? 0}×{f.typicalDurationSec ? ` · ${Math.round(f.typicalDurationSec)}s` : ""}
                      </span>
                    </div>
                    {f.notes && <p className="text-[10px] text-muted-foreground">{f.notes}</p>}
                  </div>
                ))}
              </div>
            )}

            {offers.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground flex items-center gap-1">
                  <Tag className="h-3 w-3" /> Offer ladder
                </p>
                {offers.map((o, i) => (
                  <div key={i} className="rounded-lg border border-border bg-card px-3 py-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium min-w-0">{o.offer}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {o.aggressiveness || "n/a"}
                      {o.placement ? ` · ${o.placement}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {ctas.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground flex items-center gap-1">
                  <MousePointerClick className="h-3 w-3" /> CTA patterns
                </p>
                {ctas.map((c, i) => (
                  <div key={i} className="rounded-lg border border-border bg-card px-3 py-2 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium">&ldquo;{c.ctaText}&rdquo;</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">{c.frequency ?? 0}×</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {(c.placement || "n/a").replace(/_/g, " ")}
                      {c.destination && c.destination !== "unknown" ? ` → ${c.destination}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {cadence && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> Cadence
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Stat label="Avg length" value={`${Math.round(cadence.avgDurationSec || 0)}s`} />
                <Stat label="Hook window" value={`${Math.round(cadence.hookWindowSec || 0)}s`} />
                <Stat label="Product reveal" value={`${Math.round(cadence.productRevealSec || 0)}s`} />
                <Stat label="CTA starts" value={`${Math.round(cadence.ctaStartPct || 0)}%`} />
                <Stat label="Beats / ad" value={`${Math.round(cadence.beatsPerAd || 0)}`} />
              </div>
              {cadence.notes && <p className="text-[11px] text-foreground/70">{cadence.notes}</p>}
            </div>
          )}
        </section>
      )}

      {competitor.insights.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-yellow-500" />
            <p className="text-sm font-bold">Opportunities against {competitor.name}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {competitor.insights.map((ins) => (
              <div key={ins.id} className="rounded-xl border border-border bg-card p-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] bg-muted border border-border px-1.5 py-0.5 rounded capitalize">
                    {ins.category.replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{Math.round(ins.importance || 0)}</span>
                </div>
                <p className="text-sm font-semibold">{ins.title}</p>
                <p className="text-[11px] text-foreground/75 leading-relaxed">{ins.description}</p>
                {ins.recommendation && (
                  <p className="text-[11px] text-blue-700 leading-relaxed">→ {ins.recommendation}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold">Top {TOP_N} ads</p>
          <span className="text-[10px] text-muted-foreground">— ranked within this competitor</span>
        </div>
        {cards.length === 0 ? (
          <div className="rounded-xl border border-border bg-card py-12 text-center">
            <AlertCircle className="h-7 w-7 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">No ads collected for this competitor</p>
            <p className="text-xs text-muted-foreground mt-1">Run research to discover their paid creative</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cards.map((card) => (
              <AdTeardownCard key={card.id} asset={card} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
