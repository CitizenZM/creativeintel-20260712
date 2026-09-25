import Link from "next/link";
import { prisma } from "@/lib/db";
import { StepFrame } from "@/components/layout/step-frame";
import { StageGuide } from "@/components/layout/stage-guide";
import { NARRATIVE_TYPE_LABELS, DATA_SOURCE_LABELS } from "@/lib/constants";
import { OverviewCharts } from "@/components/dashboard/overview-charts";
import { HeroMetric } from "@/components/dashboard/hero-metric";
import { StatusBadge, ScoreBar } from "@/components/dashboard/status-badge";
import { ActionButton } from "@/components/dashboard/action-buttons";
import { EditableField } from "@/components/dashboard/editable-field";
import {
  Activity,
  Target,
  Film,
  Users,
  TrendingUp,
  ArrowRight,
  Lightbulb,
  Package,
  Palette,
} from "lucide-react";
import { ProductIntelligence } from "@/components/dashboard/product-intelligence";
import { ProductDefinition } from "@/components/dashboard/product-definition";
import { BrandKitPanel } from "@/components/dashboard/brand-kit-panel";
import { CampaignSelection } from "@/components/dashboard/campaign-selection";
import { getBrandKitCompleteness } from "@/services/brand-kit";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { GoalTypeSetting } from "@/components/projects/goal-type-picker";
import { isGoalType } from "@/lib/style-categories";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const [project, contentAssets, patterns, sellingPoints, insights, competitors, audienceProfile, deepAnalysis] =
    await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        include: { brand: true },
      }),
      prisma.contentAsset.findMany({
        where: { projectId },
        orderBy: { overallScore: "desc" },
      }),
      prisma.narrativePattern.findMany({
        where: { projectId },
        orderBy: { avgPerformance: "desc" },
      }),
      prisma.sellingPoint.findMany({
        where: { projectId },
        orderBy: { strength: "desc" },
      }),
      prisma.insight.findMany({
        where: { projectId },
        orderBy: { importance: "desc" },
        take: 10,
      }),
      prisma.competitor.findMany({ where: { projectId } }),
      prisma.audienceProfile.findUnique({ where: { projectId } }),
      prisma.deepAnalysis.findUnique({ where: { projectId } }),
    ]);

  if (!project) return <div>Project not found</div>;

  const brandKit = await getBrandKitCompleteness(projectId);

  const brand = project.brand;
  const topSignals = (project.topSignals as string[]) || [];

  const narrativeData = patterns.map((p) => ({
    name: NARRATIVE_TYPE_LABELS[p.type] || p.type,
    value: p.frequency,
    performance: p.avgPerformance || 0,
  }));

  const scoreDistribution = [
    { range: "0–20", count: contentAssets.filter((a) => (a.overallScore || 0) <= 20).length },
    { range: "21–40", count: contentAssets.filter((a) => (a.overallScore || 0) > 20 && (a.overallScore || 0) <= 40).length },
    { range: "41–60", count: contentAssets.filter((a) => (a.overallScore || 0) > 40 && (a.overallScore || 0) <= 60).length },
    { range: "61–80", count: contentAssets.filter((a) => (a.overallScore || 0) > 60 && (a.overallScore || 0) <= 80).length },
    { range: "81–100", count: contentAssets.filter((a) => (a.overallScore || 0) > 80).length },
  ];

  const topContent = contentAssets.slice(0, 5);

  return (
    <div className="space-y-6">
      <StageGuide projectId={projectId} stage="setup" detail="Upload your logo and at least two product photos, then set brand colours and an approved CTA. Everything generated later is held to this." />
      {/* Action bar */}
      <div className="flex justify-end">
        <ActionButton
          endpoint={`/api/projects/${projectId}/research`}
          label="Re-run research"
          redirectTo={`/projects/${projectId}/content`}
          loadingLabel="Researching..."
          icon="refresh"
        />
      </div>

      <StepFrame projectId={projectId} anchor="goal-type">
        <GoalTypeSetting
        projectId={projectId}
        initial={isGoalType(project.goalType) ? project.goalType : null}
        initialCampaignGoal={project.campaignGoal}
        initialFieldStatus={project.fieldStatus}
      />
      </StepFrame>

      {/* Product Definition — user-controlled source of truth */}
      <StepFrame projectId={projectId} anchor="product-definition">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Product Definition</h2>
          <span className="text-xs text-muted-foreground">The exact product this campaign is about — set the URL or upload photos</span>
        </div>
        <ProductDefinition projectId={projectId} />
      </StepFrame>

      {/* Product Intelligence — AI verification and environments */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Product Intelligence</h2>
          <span className="text-xs text-muted-foreground">AI-generated verification — environments, actors, display rules</span>
        </div>
        <ProductIntelligence projectId={projectId} />
      </section>

      {/* Brand Kit — approved logo, colours, CTAs, claims and SKU truth */}
      <StepFrame projectId={projectId} anchor="brand-kit">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Brand Kit</h2>
          <span className="text-xs text-muted-foreground">
            Logo, packshots, colours, approved CTAs, claims and SKU truth — injected into every script and studio prompt
          </span>
        </div>

        <BrandKitPanel projectId={projectId} />
      </StepFrame>

      {/* Campaign Selection — user confirms context before script generation */}
      <StepFrame projectId={projectId} anchor="campaign">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Campaign Context Selection</h2>
          <span className="text-xs text-muted-foreground">
            Select environment, actor, selling points, and timeline — confirm to align AI for script generation
          </span>
        </div>
        <CampaignSelection
          projectId={projectId}
          environments={(brand?.useEnvironments as Array<{name:string;description:string;typicalUser:string;imagePrompt?:string}>) || []}
          actorSettings={(brand?.actorSettings as Array<{role:string;ageRange:string;scenario:string;visualDescription:string;painPoint:string;productInteraction:string}>) || []}
          sellingPoints={sellingPoints.map(sp => ({ id: sp.id, point: sp.point, category: sp.category, strength: sp.strength || 0 }))}
          deepTimeline={(deepAnalysis?.videoTimeline as {recommendedDurationSec:number;platform:string;segments:Array<{segment:string;startSec:number;endSec:number;label:string;description:string;cameraNote?:string;voiceover?:string;purpose?:string}>;rationale?:string}) || null}
        />
      </StepFrame>

      {/* Hero metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HeroMetric
          label="Brand Health"
          value={project.brandHealthScore ?? null}
          suffix="/ 100"
          icon={<Activity className="h-4 w-4" />}
          hint="AI predicted"
        />
        <HeroMetric
          label="Opportunity"
          value={project.opportunityScore ?? null}
          suffix="/ 100"
          icon={<Target className="h-4 w-4" />}
          hint="Content gap"
        />
        <HeroMetric
          label="Content Analyzed"
          value={contentAssets.length}
          icon={<Film className="h-4 w-4" />}
          hint={`${contentAssets.filter(a => a.isBrandOwned).length} brand-owned`}
        />
        <HeroMetric
          label="Competitors"
          value={competitors.length}
          icon={<Users className="h-4 w-4" />}
          hint="Tracked"
        />
      </div>

      {/* Project Briefing */}
      {(project.briefingText || project.briefingParsed) && (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold tracking-tight">Project Briefing</p>
            <StatusBadge level="neutral">User provided</StatusBadge>
          </div>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
            {project.briefingText}
            {project.briefingParsed && (
              <>
                {project.briefingText && <br />}
                <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground block mt-2 mb-1">
                  From uploaded file:
                </span>
                {project.briefingParsed.slice(0, 500)}
                {(project.briefingParsed.length || 0) > 500 && "..."}
              </>
            )}
          </div>
        </div>
      )}

      {/* Brand Intel + Top Signals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {brand && (
          <div className="lg:col-span-2 rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold tracking-tight">Brand Intelligence</p>
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Editable
              </span>
            </div>
            <dl className="divide-y divide-border">
              {[
                { label: "Brand promise", field: "brandPromise", value: brand.brandPromise },
                { label: "Value proposition", field: "valueProposition", value: brand.valueProposition },
                { label: "Target audience", field: "targetAudience", value: brand.targetAudience },
                { label: "Tone of voice", field: "toneOfVoice", value: brand.toneOfVoice },
                { label: "Pricing theme", field: "pricingTheme", value: brand.pricingTheme },
              ].map((item) => (
                <div key={item.label} className="grid grid-cols-3 gap-4 py-3">
                  <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {item.label}
                  </dt>
                  <dd className="col-span-2">
                    <EditableField
                      value={item.value}
                      field={item.field}
                      endpoint={`/api/projects/${projectId}/brand`}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {topSignals.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold tracking-tight">Top Signals</p>
            </div>
            <ul className="space-y-2.5">
              {topSignals.slice(0, 8).map((signal, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-foreground shrink-0" />
                  <span className="text-foreground">{signal}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Audience Research */}
      {audienceProfile && (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold tracking-tight">Audience Research</p>
            <StatusBadge level="ai">AI Inferred</StatusBadge>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Segments */}
            {(audienceProfile.segments as { name: string; ageRange: string; description: string; size: string }[])?.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-3">Audience Segments</p>
                <div className="space-y-2">
                  {(audienceProfile.segments as { name: string; ageRange: string; description: string; size: string }[]).map((seg, i) => (
                    <div key={i} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">{seg.name}</p>
                        <div className="flex gap-1.5">
                          <StatusBadge level="neutral">{seg.ageRange}</StatusBadge>
                          <StatusBadge level={seg.size === "large" ? "healthy" : seg.size === "medium" ? "attention" : "neutral"}>
                            {seg.size}
                          </StatusBadge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{seg.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pain Points + Psychographics */}
            <div className="space-y-5">
              {(audienceProfile.painPoints as { point: string; severity: string }[])?.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-3">Pain Points</p>
                  <div className="space-y-1.5">
                    {(audienceProfile.painPoints as { point: string; severity: string }[]).map((pp, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${pp.severity === "high" ? "bg-[var(--status-urgent)]" : pp.severity === "medium" ? "bg-[var(--status-attention)]" : "bg-muted-foreground"}`} />
                        <span className="text-sm">{pp.point}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(audienceProfile.psychographics as { trait: string; description: string }[])?.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-3">Psychographics</p>
                  <div className="space-y-1.5">
                    {(audienceProfile.psychographics as { trait: string; description: string }[]).map((p, i) => (
                      <div key={i}>
                        <p className="text-sm font-medium">{p.trait}</p>
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom row: Platforms, Interests, Geo, Buying */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5 pt-5 border-t border-border">
            {(audienceProfile.platforms as { platform: string; usage: string; adReceptivity: string }[])?.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Platform Preferences</p>
                <div className="space-y-1">
                  {(audienceProfile.platforms as { platform: string; usage: string; adReceptivity: string }[]).map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="font-medium">{p.platform}</span>
                      <StatusBadge level={p.adReceptivity === "high" ? "healthy" : "neutral"}>
                        {p.usage}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(audienceProfile.interests as string[])?.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Interests</p>
                <div className="flex flex-wrap gap-1">
                  {(audienceProfile.interests as string[]).map((interest, i) => (
                    <StatusBadge key={i} level="neutral">{interest}</StatusBadge>
                  ))}
                </div>
              </div>
            )}

            {(audienceProfile.geoMarkets as string[])?.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Geo Markets</p>
                <div className="flex flex-wrap gap-1">
                  {(audienceProfile.geoMarkets as string[]).map((geo, i) => (
                    <StatusBadge key={i} level="neutral">{geo}</StatusBadge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Buying Behavior</p>
              <p className="text-xs text-foreground">{audienceProfile.buyingBehavior || "—"}</p>
              <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mt-3 mb-1">Income Level</p>
              <p className="text-xs text-foreground">{audienceProfile.incomeLevel || "—"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <OverviewCharts
        narrativeData={narrativeData}
        scoreDistribution={scoreDistribution}
      />

      {/* Top Content Table */}
      {topContent.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <p className="text-sm font-semibold tracking-tight">Top Content</p>
            <Link
              href={`/projects/${projectId}/content`}
              className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-medium px-5 py-2.5">Title</th>
                  <th className="text-left font-medium px-3 py-2.5 hidden md:table-cell">Narrative</th>
                  <th className="text-left font-medium px-3 py-2.5">Score</th>
                  <th className="text-right font-medium px-5 py-2.5 hidden sm:table-cell">Views</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topContent.map((asset) => (
                  <tr key={asset.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-5 py-3">
                      <Link
                        href={`/projects/${projectId}/insights/${asset.id}`}
                        className="block"
                      >
                        <p className="font-medium text-foreground truncate max-w-md">{asset.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {asset.platform || asset.type}
                        </p>
                      </Link>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      {asset.narrativeType && (
                        <span className="text-xs text-muted-foreground">
                          {NARRATIVE_TYPE_LABELS[asset.narrativeType]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <ScoreBar score={asset.overallScore} />
                    </td>
                    <td className="px-5 py-3 text-right num text-muted-foreground hidden sm:table-cell">
                      {asset.viewCount?.toLocaleString() || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold tracking-tight">Key Insights</p>
          </div>
          <div className="space-y-3">
            {insights.slice(0, 5).map((insight) => (
              <div key={insight.id} className="flex gap-3 items-start">
                <StatusBadge level="neutral" className="mt-0.5 shrink-0">
                  {insight.category}
                </StatusBadge>
                <div className="min-w-0">
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

      {/* Selling Points */}
      {sellingPoints.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm font-semibold tracking-tight mb-4">Selling Points</p>
          <div className="space-y-2.5">
            {sellingPoints.slice(0, 8).map((sp) => (
              <div key={sp.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{sp.point}</p>
                </div>
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider w-20 text-right hidden sm:inline">
                  {sp.category}
                </span>
                <ScoreBar score={sp.strength} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
