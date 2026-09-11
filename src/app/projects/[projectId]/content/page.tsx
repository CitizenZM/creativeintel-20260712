import { prisma } from "@/lib/db";
import Link from "next/link";
import { NARRATIVE_TYPE_LABELS, CONTENT_TYPE_LABELS } from "@/lib/constants";
import { getCampaignPlatform } from "@/lib/campaign-platform";
import { ContentPlatformControls } from "@/components/content/content-platform-controls";
import { ScoreBar } from "@/components/dashboard/status-badge";
import { LoadMoreButton } from "@/components/dashboard/action-buttons";
import { Eye, ThumbsUp, ExternalLink, ChevronRight, Clock, Crop } from "lucide-react";

// ContentType values added for the ad-library sources; the shared label map in
// lib/constants.ts predates them.
const EXTRA_TYPE_LABELS: Record<string, string> = {
  META_AD: "Meta Ad",
  TIKTOK_AD: "TikTok Ad",
  GOOGLE_AD: "Google Ad",
  INSTAGRAM_REEL: "IG Reel",
};

function typeLabel(type: string) {
  return EXTRA_TYPE_LABELS[type] ?? CONTENT_TYPE_LABELS[type] ?? type;
}

const SOURCE_LABELS: Record<string, string> = {
  meta_ad_library: "Meta Ad Library",
  tiktok_ad_library: "TikTok Ad Library",
  tiktok_cc: "TikTok Creative Center",
  google_ats: "Google Ads Transparency",
  youtube: "YouTube",
  ig_reels: "Instagram",
  tiktok_organic: "TikTok",
  vimeo: "Vimeo",
};

const EVIDENCE_LABELS: Record<string, string> = {
  ad_library: "Ad library",
  paid_label: "Paid label",
  classifier: "AI-classified",
  none: "Unverified",
};

const EVIDENCE_STYLE: Record<string, string> = {
  ad_library: "bg-[var(--status-healthy-bg)] text-[var(--status-healthy-fg)]",
  paid_label: "bg-[var(--status-healthy-bg)] text-[var(--status-healthy-fg)]",
  classifier: "bg-[var(--status-ai-bg)] text-[var(--status-ai-fg)]",
  none: "bg-muted text-muted-foreground",
};

const TYPE_ACCENT: Record<string, string> = {
  YOUTUBE_VIDEO: "bg-red-600",
  YOUTUBE_SHORT: "bg-red-600",
  TIKTOK_VIDEO: "bg-gray-900",
  TIKTOK_AD: "bg-gray-900",
  INSTAGRAM_REEL: "bg-gradient-to-r from-purple-600 to-pink-500",
  META_AD: "bg-blue-600",
  SOCIAL_POST: "bg-purple-500",
  GOOGLE_AD: "bg-amber-500",
  VIMEO_VIDEO: "bg-sky-600",
};

function formatDate(date: Date | string | null) {
  if (!date) return "—";
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatNumber(n: number | null) {
  if (n == null) return "—";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function formatDuration(sec: number | null) {
  if (sec == null) return null;
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

type RankAsset = {
  rankInOwner: number | null;
  viewCount: number | null;
  engagementRate: number | null;
  adEvidence: string | null;
  adConfidence: number | null;
  adSource: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  adSpendEstimate: unknown;
  durationSec: number | null;
  aspectRatio: string | null;
};

/** Rebuilds the ranking rationale from the persisted signals. */
function whyRanked(a: RankAsset): string {
  const parts: string[] = [];
  if (a.rankInOwner != null) parts.push(`Rank #${a.rankInOwner} for this advertiser`);

  const spend = (a.adSpendEstimate ?? {}) as { impressionsLower?: number | null };
  if (a.viewCount) parts.push(`${a.viewCount.toLocaleString()} views (30% weight)`);
  else if (spend.impressionsLower)
    parts.push(`${spend.impressionsLower.toLocaleString()}+ impressions (30% weight)`);
  else parts.push("no reach data (0 on the reach term)");

  if (a.firstSeenAt) {
    const end = a.lastSeenAt ? new Date(a.lastSeenAt) : new Date();
    const days = Math.max(
      0,
      Math.round((end.getTime() - new Date(a.firstSeenAt).getTime()) / 86_400_000)
    );
    parts.push(`ran ${days} day${days === 1 ? "" : "s"} (longevity, 25%)`);
  }
  if (a.engagementRate) parts.push(`${a.engagementRate.toFixed(2)}% engagement (20%)`);
  parts.push(
    `evidence: ${EVIDENCE_LABELS[a.adEvidence ?? "none"]}${
      a.adConfidence != null ? ` @ ${(a.adConfidence * 100).toFixed(0)}%` : ""
    }`
  );
  if (a.adSource) parts.push(`source: ${SOURCE_LABELS[a.adSource] ?? a.adSource}`);
  if (a.durationSec == null && a.aspectRatio == null)
    parts.push("unknown duration/aspect — 10% score penalty");
  return parts.join(" · ");
}

export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    sort?: string;
    order?: string;
    platform?: string;
    paid?: string;
    owner?: string;
  }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const sortBy = sp.sort || "rank";
  const order = sp.order === "asc" ? "asc" : "desc";
  const showAllPlatforms = sp.platform === "all";
  const platformFilter = showAllPlatforms ? "" : sp.platform || "";
  // Paid/ad candidates are the default view; ?paid=all opts out.
  const paidOnly = sp.paid !== "all";
  const ownerFilter = sp.owner || "";

  const [campaignSelection, competitors, project] = await Promise.all([
    prisma.campaignSelection
      .findUnique({ where: { projectId }, select: { platform: true, totalDurationSec: true } })
      .catch(() => null),
    prisma.competitor.findMany({ where: { projectId }, select: { id: true, name: true } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { brandName: true } }),
  ]);
  const campaignPlatform = getCampaignPlatform(campaignSelection?.platform);
  const campaignScopeActive = !showAllPlatforms && !platformFilter && !!campaignPlatform;

  const whereClause: Record<string, unknown> = { projectId };
  if (platformFilter) whereClause.type = platformFilter;
  else if (campaignScopeActive) whereClause.type = { in: campaignPlatform!.contentTypes };
  if (paidOnly) whereClause.isPaidMedia = true;
  if (ownerFilter) whereClause.competitorId = ownerFilter === "brand" ? null : ownerFilter;

  const orderByMap: Record<string, Record<string, "asc" | "desc">[]> = {
    rank: [{ rankInOwner: "asc" }, { overallScore: "desc" }],
    overallScore: [{ overallScore: order }],
    viewCount: [{ viewCount: order }],
    publishedAt: [{ publishedAt: order }],
    engagementRate: [{ engagementRate: order }],
  };

  const assets = await prisma.contentAsset.findMany({
    where: whereClause,
    orderBy: orderByMap[sortBy] ?? orderByMap.rank,
    include: { competitor: { select: { id: true, name: true } } },
  });

  const allAssets = await prisma.contentAsset.findMany({
    where: { projectId },
    select: { type: true, isPaidMedia: true },
  });
  const paidTotal = allAssets.filter((a) => a.isPaidMedia).length;

  const platformCounts: Record<string, number> = {};
  allAssets.forEach((a) => {
    platformCounts[a.type] = (platformCounts[a.type] || 0) + 1;
  });

  // Group by owner so each advertiser's Top-N reads as its own shelf.
  const ownerNames = new Map<string, string>([
    ["brand", project?.brandName ?? "Your brand"],
    ...competitors.map((c) => [c.id, c.name] as [string, string]),
  ]);
  const groups = new Map<string, typeof assets>();
  for (const a of assets) {
    const key = a.competitorId ?? "brand";
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }
  const orderedGroups = [
    ...(groups.has("brand") ? [["brand", groups.get("brand")!] as const] : []),
    ...competitors
      .filter((c) => groups.has(c.id))
      .map((c) => [c.id, groups.get(c.id)!] as const),
  ];

  function buildUrl(overrides: Record<string, string>) {
    const base: Record<string, string> = { sort: sortBy, order };
    if (platformFilter) base.platform = platformFilter;
    if (showAllPlatforms) base.platform = "all";
    if (!paidOnly) base.paid = "all";
    if (ownerFilter) base.owner = ownerFilter;
    const merged: Record<string, string> = { ...base, ...overrides };
    for (const k of Object.keys(merged)) if (!merged[k]) delete merged[k];
    return `?${new URLSearchParams(merged).toString()}`;
  }

  function sortLink(col: string) {
    const newOrder = sortBy === col && order === "desc" ? "asc" : "desc";
    return buildUrl({ sort: col, order: newOrder });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Competitor Ad Intelligence</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {assets.length} {paidOnly ? "paid ad" : "asset"}
            {assets.length !== 1 ? "s" : ""} across {orderedGroups.length} advertiser
            {orderedGroups.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex gap-1 text-xs flex-wrap">
          {[
            { col: "rank", label: "Rank" },
            { col: "overallScore", label: "Score" },
            { col: "viewCount", label: "Views" },
            { col: "publishedAt", label: "Date" },
          ].map((s) => (
            <Link
              key={s.col}
              href={sortLink(s.col)}
              className={`px-2.5 py-1 rounded-md border transition-colors ${
                sortBy === s.col
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      <ContentPlatformControls
        projectId={projectId}
        initialPlatform={campaignSelection?.platform ?? null}
        initialDuration={campaignSelection?.totalDurationSec ?? null}
        hasContent={allAssets.length > 0}
      />

      {/* Paid / all toggle + campaign scope */}
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={buildUrl({ paid: "" })}
            className={`px-2.5 py-1 rounded-full border font-medium transition-colors ${
              paidOnly
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Paid ads only ({paidTotal})
          </Link>
          <Link
            href={buildUrl({ paid: "all" })}
            className={`px-2.5 py-1 rounded-full border font-medium transition-colors ${
              !paidOnly
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Everything ({allAssets.length})
          </Link>
          {campaignScopeActive && (
            <span className="text-muted-foreground">
              · scoped to{" "}
              <span className="font-medium text-foreground">{campaignPlatform!.label}</span>
            </span>
          )}
        </div>
        {campaignScopeActive && (
          <Link href={buildUrl({ platform: "all" })} className="font-medium hover:underline">
            Show all platforms
          </Link>
        )}
      </div>

      {/* Owner chips */}
      {competitors.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <Link
            href={buildUrl({ owner: "" })}
            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
              !ownerFilter
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            All advertisers
          </Link>
          {[["brand", ownerNames.get("brand")!] as const, ...competitors.map((c) => [c.id, c.name] as const)].map(
            ([id, name]) => (
              <Link
                key={id}
                href={buildUrl({ owner: ownerFilter === id ? "" : id })}
                className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                  ownerFilter === id
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {name}
              </Link>
            )
          )}
        </div>
      )}

      {assets.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-20 text-center">
          <p className="text-sm font-medium text-muted-foreground">No paid ads found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {paidOnly
              ? "Nothing has cleared the paid-evidence gate yet. Run research, or switch to Everything."
              : "Run research first to analyze content."}
          </p>
          {paidOnly && (
            <Link
              href={buildUrl({ paid: "all" })}
              className="mt-3 inline-block text-xs text-foreground underline underline-offset-2"
            >
              Show everything
            </Link>
          )}
        </div>
      ) : (
        <>
          {orderedGroups.map(([ownerKey, ownerAssets]) => (
            <section key={ownerKey} className="space-y-3">
              <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
                <h3 className="text-sm font-semibold tracking-tight">
                  {ownerNames.get(ownerKey) ?? "Unattributed"}
                  {ownerKey === "brand" && (
                    <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      your brand
                    </span>
                  )}
                </h3>
                <span className="text-[11px] text-muted-foreground num">
                  {ownerAssets.filter((a) => a.rankInOwner != null).length} ranked ·{" "}
                  {ownerAssets.length} total
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ownerAssets.map((asset) => {
                  const score = asset.overallScore ?? null;
                  const scoreColor =
                    score === null
                      ? "text-muted-foreground"
                      : score >= 80
                        ? "text-green-600"
                        : score >= 60
                          ? "text-amber-600"
                          : "text-red-500";
                  const duration = formatDuration(asset.durationSec);
                  const evidence = asset.adEvidence ?? "none";

                  return (
                    <Link
                      key={asset.id}
                      href={`/projects/${projectId}/insights/${asset.id}`}
                      className="group rounded-xl border border-border bg-card overflow-hidden hover:border-foreground/30 hover:shadow-md transition-all"
                    >
                      <div className="relative aspect-video bg-muted overflow-hidden">
                        {asset.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={asset.thumbnailUrl}
                            alt={asset.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg viewBox="0 0 24 24" className="h-10 w-10 fill-none stroke-muted-foreground/30 stroke-2" aria-hidden>
                              <polygon points="23 7 16 12 23 17 23 7" />
                              <rect x="1" y="5" width="15" height="14" rx="2" />
                            </svg>
                          </div>
                        )}

                        {asset.rankInOwner != null && (
                          <div
                            className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background text-[11px] font-bold num"
                            title={whyRanked(asset)}
                          >
                            {asset.rankInOwner}
                          </div>
                        )}

                        <div className="absolute top-2 right-2 flex items-center gap-1">
                          {score !== null && (
                            <span className="bg-background/90 backdrop-blur-sm rounded px-1.5 py-0.5">
                              <span className={`text-xs font-bold num ${scoreColor}`}>{score}</span>
                            </span>
                          )}
                        </div>

                        {asset.url && (
                          <a
                            href={asset.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="absolute bottom-2 right-2 p-1 rounded bg-background/80 backdrop-blur-sm text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Open on platform"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <div
                          className={`absolute inset-x-0 bottom-0 h-0.5 ${TYPE_ACCENT[asset.type] ?? "bg-gray-400"}`}
                        />
                      </div>

                      <div className="p-3 space-y-2">
                        {/* Source + evidence badges */}
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-foreground">
                            {typeLabel(asset.type)}
                          </span>
                          {asset.adSource && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] text-muted-foreground border border-border">
                              {SOURCE_LABELS[asset.adSource] ?? asset.adSource}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${EVIDENCE_STYLE[evidence]}`}
                            title={whyRanked(asset)}
                          >
                            {EVIDENCE_LABELS[evidence]}
                          </span>
                        </div>

                        <p className="text-sm font-medium leading-snug line-clamp-2">
                          {asset.title}
                        </p>

                        {asset.hookText && (
                          <p className="text-[11px] text-muted-foreground italic line-clamp-2 border-l-2 border-border pl-2">
                            &ldquo;{asset.hookText}&rdquo;
                          </p>
                        )}

                        <div className="pt-0.5">
                          <ScoreBar score={asset.overallScore} />
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1 num">
                              <Eye className="h-3 w-3" />
                              {formatNumber(asset.viewCount)}
                            </span>
                            <span className="flex items-center gap-1 num">
                              <ThumbsUp className="h-3 w-3" />
                              {formatNumber(asset.likeCount)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {duration && (
                              <span className="flex items-center gap-1 num">
                                <Clock className="h-3 w-3" />
                                {duration}
                              </span>
                            )}
                            {asset.aspectRatio && (
                              <span className="flex items-center gap-1 num">
                                <Crop className="h-3 w-3" />
                                {asset.aspectRatio}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-border text-[10px] text-muted-foreground">
                          <span title={whyRanked(asset)} className="cursor-help underline decoration-dotted underline-offset-2">
                            Why it ranked
                          </span>
                          <div className="flex items-center gap-1">
                            <span>
                              {asset.narrativeType
                                ? NARRATIVE_TYPE_LABELS[asset.narrativeType]
                                : formatDate(asset.publishedAt)}
                            </span>
                            <ChevronRight className="h-3 w-3 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}

          <LoadMoreButton projectId={projectId} currentCount={assets.length} />
        </>
      )}
    </div>
  );
}
