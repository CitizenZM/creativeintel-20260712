import { prisma } from "@/lib/db";
import Image from "next/image";
import { notFound } from "next/navigation";
import { NARRATIVE_TYPE_LABELS, DATA_SOURCE_LABELS } from "@/lib/constants";
import { ScoreRadar } from "@/components/dashboard/score-radar";
import { StatusBadge, ScoreBar } from "@/components/dashboard/status-badge";
import { ScriptGenerator } from "@/components/content/script-generator";
import {
  ExternalLink,
  Eye,
  ThumbsUp,
  MessageSquare,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

export default async function AssetInsightPage({
  params,
}: {
  params: Promise<{ projectId: string; assetId: string }>;
}) {
  const { projectId, assetId } = await params;

  const asset = await prisma.contentAsset.findUnique({
    where: { id: assetId },
    include: {
      competitor: { select: { name: true } },
      insights: { orderBy: { importance: "desc" } },
    },
  });

  if (!asset || asset.projectId !== projectId) notFound();

  const radarData = [
    { metric: "Hook", value: asset.hookStrength || 0 },
    { metric: "Product", value: asset.productVisibility || 0 },
    { metric: "Story", value: asset.storytellingArc || 0 },
    { metric: "CTA", value: asset.ctaQuality || 0 },
    { metric: "Emotion", value: asset.emotionalAppeal || 0 },
    { metric: "Pacing", value: asset.pacing || 0 },
  ];

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <Link
        href={`/projects/${projectId}/content`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to content
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-5">
        {asset.thumbnailUrl && (
          <div className="w-full sm:w-56 shrink-0">
            <div className="aspect-video rounded-lg overflow-hidden bg-muted border border-border">
              <Image unoptimized width={1024} height={1024}
                src={asset.thumbnailUrl}
                alt={asset.title}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">{asset.title}</h2>
          <div className="flex flex-wrap gap-1.5">
            {asset.narrativeType && (
              <StatusBadge level="neutral">
                {NARRATIVE_TYPE_LABELS[asset.narrativeType]}
              </StatusBadge>
            )}
            {asset.platform && <StatusBadge level="neutral">{asset.platform}</StatusBadge>}
            {asset.competitor && (
              <StatusBadge level="neutral">{asset.competitor.name}</StatusBadge>
            )}
            {asset.isBrandOwned && <StatusBadge level="ai">Brand</StatusBadge>}
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {asset.viewCount != null && (
              <span className="flex items-center gap-1 num">
                <Eye className="h-3.5 w-3.5" /> {asset.viewCount.toLocaleString()}
              </span>
            )}
            {asset.likeCount != null && (
              <span className="flex items-center gap-1 num">
                <ThumbsUp className="h-3.5 w-3.5" /> {asset.likeCount.toLocaleString()}
              </span>
            )}
            {asset.commentCount != null && (
              <span className="flex items-center gap-1 num">
                <MessageSquare className="h-3.5 w-3.5" /> {asset.commentCount.toLocaleString()}
              </span>
            )}
          </div>
          {asset.url && (
            <a
              href={asset.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
            >
              View original <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">
            Source: {DATA_SOURCE_LABELS[asset.dataSource]}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Score Radar */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold tracking-tight">Score breakdown</p>
            <span className="text-xs text-muted-foreground">AI predicted</span>
          </div>
          <ScoreRadar data={radarData} />
          <div className="mt-3 text-center">
            <p className="text-3xl font-semibold tracking-tight num">
              {asset.overallScore}
            </p>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">
              Overall score
            </p>
          </div>
        </div>

        {/* Hook Analysis */}
        <div className="lg:col-span-3 rounded-lg border border-border bg-card p-5 space-y-4">
          <p className="text-sm font-semibold tracking-tight">Hook analysis</p>
          {asset.hookText && (
            <div>
              <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">
                Opening hook
              </p>
              <p className="text-sm italic border-l-2 border-foreground pl-3">
                &ldquo;{asset.hookText}&rdquo;
              </p>
            </div>
          )}
          <div>
            <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">
              Hook strength
            </p>
            <ScoreBar score={asset.hookStrength} />
          </div>
          {((asset.keyMessages as string[]) || []).length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">
                Key messages
              </p>
              <div className="flex flex-wrap gap-1.5">
                {((asset.keyMessages as string[]) || []).map((msg, i) => (
                  <StatusBadge key={i} level="neutral">
                    {msg}
                  </StatusBadge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {asset.description && (
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm font-semibold tracking-tight mb-2">Description</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {asset.description}
          </p>
        </div>
      )}

      {/* Script / Transcript */}
      <ScriptGenerator
        projectId={projectId}
        assetId={assetId}
        existingTranscript={asset.transcript}
      />

      {/* Related Insights */}
      {asset.insights.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm font-semibold tracking-tight mb-3">Related insights</p>
          <div className="space-y-2">
            {asset.insights.map((insight) => (
              <div key={insight.id} className="flex gap-3 items-start py-2">
                <StatusBadge level="neutral" className="shrink-0 mt-0.5">
                  {insight.category}
                </StatusBadge>
                <div>
                  <p className="text-sm font-medium">{insight.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {insight.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
