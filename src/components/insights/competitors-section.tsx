import Link from "next/link";
import { ArrowRight, Swords, Zap, Film, Tag, MousePointerClick } from "lucide-react";

export interface CompetitorSummaryView {
  id: string;
  name: string;
  url: string | null;
  adCount: number;
  teardownCount: number;
  insightCount: number;
  rollup: {
    dominantHooks: unknown;
    dominantFormats: unknown;
    offerLadder: unknown;
    ctaPatterns: unknown;
    summary: string;
  } | null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function Chips({
  icon,
  label,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground flex items-center gap-1">
        {icon} {label}
      </p>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 4).map((item, i) => (
          <span key={i} className="text-[10px] bg-muted border border-border px-1.5 py-0.5 rounded-full">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CompetitorsSection({
  projectId,
  competitors,
}: {
  projectId: string;
  competitors: CompetitorSummaryView[];
}) {
  if (competitors.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Swords className="h-4 w-4 text-rose-500" />
        <p className="text-sm font-bold">Competitors</p>
        <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full font-medium">
          {competitors.length}
        </span>
        <span className="text-[10px] text-muted-foreground">— what each one actually runs, torn down ad by ad</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {competitors.map((c) => {
          const hooks = asArray<{ hookType?: string; count?: number }>(c.rollup?.dominantHooks)
            .map((h) => (h.hookType ? `${h.hookType.replace(/_/g, " ")}${h.count ? ` ×${h.count}` : ""}` : ""))
            .filter(Boolean);
          const formats = asArray<{ format?: string }>(c.rollup?.dominantFormats)
            .map((f) => f.format || "")
            .filter(Boolean);
          const offers = asArray<{ offer?: string }>(c.rollup?.offerLadder)
            .map((o) => o.offer || "")
            .filter(Boolean);
          const ctas = asArray<{ ctaText?: string }>(c.rollup?.ctaPatterns)
            .map((x) => (x.ctaText ? `“${x.ctaText}”` : ""))
            .filter(Boolean);

          return (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{c.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {c.adCount} ads · {c.teardownCount} torn down · {c.insightCount} insights
                  </p>
                </div>
                <Link
                  href={`/projects/${projectId}/competitors/${c.id}`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline shrink-0"
                >
                  Open <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              {c.rollup?.summary ? (
                <p className="text-[11px] text-foreground/75 leading-relaxed line-clamp-4">{c.rollup.summary}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground italic">
                  No rollup yet — run the analysis pipeline to tear down this competitor&apos;s top ads.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Chips icon={<Zap className="h-3 w-3" />} label="Hooks" items={hooks} />
                <Chips icon={<Film className="h-3 w-3" />} label="Formats" items={formats} />
                <Chips icon={<Tag className="h-3 w-3" />} label="Offers" items={offers} />
                <Chips icon={<MousePointerClick className="h-3 w-3" />} label="CTAs" items={ctas} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
