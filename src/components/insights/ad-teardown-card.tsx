import {
  ExternalLink, Zap, MousePointerClick, BadgeCheck, Tag,
  Layers, Eye, ShieldCheck,
} from "lucide-react";

export interface TeardownBeat {
  startSec?: number;
  endSec?: number;
  role?: string;
  visual?: string;
  vo?: string;
  onScreenText?: string;
}

export interface TeardownSellingPoint {
  point?: string;
  evidenceTimestamp?: string;
}

export interface TeardownProofDevice {
  type?: string;
  description?: string;
  timestamp?: string;
}

export interface TeardownView {
  id: string;
  rank: number | null;
  hookType: string;
  hookText: string;
  hookVisual: string;
  beats: unknown;
  sellingPoints: unknown;
  proofDevices: unknown;
  ctaText: string | null;
  ctaPlacement: string | null;
  offer: string | null;
  landingUrl: string | null;
  whyItWorks: string;
  evidenceLevel: string;
  confidence: string;
}

export interface TeardownAssetView {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  platform: string | null;
  adSource: string | null;
  isPaidMedia: boolean;
  durationSec: number | null;
  viewCount: number | null;
  overallScore: number | null;
  rankInOwner: number | null;
  teardown: TeardownView | null;
}

const HOOK_LABELS: Record<string, string> = {
  curiosity_gap: "Curiosity gap",
  problem_agitate: "Problem–agitate",
  shock_stat: "Shock stat",
  pattern_interrupt: "Pattern interrupt",
  social_proof: "Social proof",
  offer_first: "Offer first",
  demo_first: "Demo first",
  question: "Question",
  before_after: "Before / after",
  trend_native: "Trend-native",
};

const BEAT_COLORS: Record<string, string> = {
  hook: "bg-red-500",
  problem: "bg-amber-500",
  demo: "bg-blue-500",
  proof: "bg-purple-500",
  offer: "bg-orange-500",
  cta: "bg-emerald-500",
  brand: "bg-pink-500",
};

const EVIDENCE_STYLES: Record<string, string> = {
  vision_transcript: "bg-emerald-50 text-emerald-700 border-emerald-200",
  vision: "bg-teal-50 text-teal-700 border-teal-200",
  transcript: "bg-blue-50 text-blue-700 border-blue-200",
  thumbnail: "bg-amber-50 text-amber-700 border-amber-200",
  metadata: "bg-gray-100 text-gray-600 border-gray-200",
};

const EVIDENCE_LABELS: Record<string, string> = {
  vision_transcript: "frames + transcript",
  vision: "frames only",
  transcript: "transcript only",
  thumbnail: "stills only",
  metadata: "metadata only",
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function beatColor(role?: string): string {
  const key = (role || "").toLowerCase();
  return BEAT_COLORS[key] || "bg-indigo-500";
}

export function AdTeardownCard({ asset }: { asset: TeardownAssetView }) {
  const t = asset.teardown;
  const beats = asArray<TeardownBeat>(t?.beats);
  const sellingPoints = asArray<TeardownSellingPoint>(t?.sellingPoints);
  const proofDevices = asArray<TeardownProofDevice>(t?.proofDevices);
  const total =
    asset.durationSec ||
    beats.reduce((max, b) => Math.max(max, b.endSec ?? 0), 0) ||
    1;

  return (
    <article className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row gap-4 p-4">
        <div className="w-full sm:w-52 shrink-0 space-y-2">
          <div className="relative aspect-video rounded-lg overflow-hidden bg-muted border border-border">
            {asset.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.thumbnailUrl} alt={asset.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Eye className="h-5 w-5 text-muted-foreground/40" />
              </div>
            )}
            {asset.rankInOwner !== null && (
              <span className="absolute top-1.5 left-1.5 text-[10px] font-bold bg-black/75 text-white rounded px-1.5 py-0.5">
                #{asset.rankInOwner}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {asset.platform && (
              <span className="text-[10px] bg-muted border border-border px-1.5 py-0.5 rounded-full">{asset.platform}</span>
            )}
            {asset.adSource && (
              <span className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded-full">
                {asset.adSource}
              </span>
            )}
            {asset.isPaidMedia && (
              <span className="inline-flex items-center gap-0.5 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                <BadgeCheck className="h-2.5 w-2.5" /> paid
              </span>
            )}
            {asset.durationSec ? (
              <span className="text-[10px] bg-muted border border-border px-1.5 py-0.5 rounded-full">
                {Math.round(asset.durationSec)}s
              </span>
            ) : null}
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{asset.viewCount ? `${asset.viewCount.toLocaleString()} views` : "views n/a"}</span>
            {asset.overallScore !== null && <span className="font-semibold text-foreground">{Math.round(asset.overallScore)}</span>}
          </div>
          <a
            href={asset.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> Open original
          </a>
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold leading-snug">{asset.title}</p>
            {t && (
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${
                  EVIDENCE_STYLES[t.evidenceLevel] || EVIDENCE_STYLES.metadata
                }`}
                title={`Confidence: ${t.confidence}`}
              >
                {EVIDENCE_LABELS[t.evidenceLevel] || t.evidenceLevel} · {t.confidence}
              </span>
            )}
          </div>

          {!t ? (
            <p className="text-xs text-muted-foreground">
              No teardown yet — this ad is outside the deep-analysis Top-N or the teardown stage has not reached it.
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-600" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
                    {HOOK_LABELS[t.hookType] || t.hookType}
                  </span>
                </div>
                <p className="text-xs font-medium text-foreground">&ldquo;{t.hookText}&rdquo;</p>
                {t.hookVisual && <p className="text-[11px] text-amber-800/80 leading-snug">{t.hookVisual}</p>}
              </div>

              {beats.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Beats</p>
                  <div className="flex h-2 rounded-full overflow-hidden border border-border gap-px">
                    {beats.map((b, i) => {
                      const width = (((b.endSec ?? 0) - (b.startSec ?? 0)) / total) * 100;
                      return (
                        <div
                          key={i}
                          className={beatColor(b.role)}
                          style={{ width: `${Math.max(width, 1)}%` }}
                          title={`${b.role || "beat"}: ${b.startSec ?? 0}s–${b.endSec ?? 0}s`}
                        />
                      );
                    })}
                  </div>
                  <ul className="space-y-1">
                    {beats.map((b, i) => (
                      <li key={i} className="flex gap-2 items-start">
                        <span className="text-[10px] font-mono text-muted-foreground w-16 shrink-0 text-right">
                          {b.startSec ?? 0}s–{b.endSec ?? 0}s
                        </span>
                        <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${beatColor(b.role)}`} />
                        <span className="text-[11px] leading-snug min-w-0">
                          <span className="font-semibold capitalize">{b.role || "beat"}</span>
                          {b.visual ? ` — ${b.visual}` : ""}
                          {b.vo ? <span className="block text-muted-foreground italic">VO: &ldquo;{b.vo}&rdquo;</span> : null}
                          {b.onScreenText ? (
                            <span className="block text-blue-700">On screen: {b.onScreenText}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {sellingPoints.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground flex items-center gap-1">
                      <Layers className="h-3 w-3" /> Selling points
                    </p>
                    <ul className="space-y-0.5">
                      {sellingPoints.map((s, i) => (
                        <li key={i} className="text-[11px] text-foreground/80">
                          {s.point}
                          {s.evidenceTimestamp && (
                            <span className="text-muted-foreground font-mono"> · {s.evidenceTimestamp}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {proofDevices.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" /> Proof devices
                    </p>
                    <ul className="space-y-0.5">
                      {proofDevices.map((p, i) => (
                        <li key={i} className="text-[11px] text-foreground/80">
                          <span className="font-medium capitalize">{(p.type || "proof").replace(/_/g, " ")}</span>
                          {p.description ? ` — ${p.description}` : ""}
                          {p.timestamp && <span className="text-muted-foreground font-mono"> · {p.timestamp}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {t.ctaText && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <MousePointerClick className="h-3 w-3" />
                    &ldquo;{t.ctaText}&rdquo;
                    {t.ctaPlacement && <span className="text-emerald-600">· {t.ctaPlacement.replace(/_/g, " ")}</span>}
                  </span>
                )}
                {t.offer && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-orange-50 text-orange-800 border border-orange-200 px-2 py-0.5 rounded-full">
                    <Tag className="h-3 w-3" /> {t.offer}
                  </span>
                )}
                {t.landingUrl && (
                  <a
                    href={t.landingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> landing page
                  </a>
                )}
              </div>

              {t.whyItWorks && (
                <div className="rounded-lg bg-muted/60 border border-border px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-0.5">Why it works</p>
                  <p className="text-[11px] leading-relaxed text-foreground/80">{t.whyItWorks}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
