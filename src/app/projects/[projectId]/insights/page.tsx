import { prisma } from "@/lib/db";
import { StageGuide } from "@/components/layout/stage-guide";
import { ActionButton } from "@/components/dashboard/action-buttons";
import {
  Film, Zap, Heart, MousePointerClick, Megaphone, TrendingDown,
  Lightbulb, AlertCircle, Clock, Target, MapPin, Users, Eye,
  CheckCircle2, XCircle, Camera, Sparkles, Globe, BarChart3,
  TrendingUp, Layers,
} from "lucide-react";
import { StatusBadge, ScoreBar, StatusLevel } from "@/components/dashboard/status-badge";
import {
  EnvironmentsSection,
  ActorSettingsSection,
  DisplayGuidelinesSection,
  InsightsSelectableSection,
  SellingPointsSection,
  NarrativePatternsSection,
} from "@/components/insights/insights-client";
import { CompetitorsSection, type CompetitorSummaryView } from "@/components/insights/competitors-section";
import { getConfiguredModelLabel } from "@/services/ai/claude-client";

// ─── Types ────────────────────────────────────────────────────────────────────

type UseEnvironment = { name: string; description: string; typicalUser: string; imagePrompt?: string };
type ActorSetting = { role: string; ageRange: string; scenario: string; visualDescription: string; painPoint: string; productInteraction: string };
type DisplayGuideline = { rule: string; example: string; antiExample: string };

type EnvironmentAnalysisItem = { environment: string; frequency: number; description: string; lightingNotes?: string; bestFor?: string; examples?: string[] };
type CameraAngle = { shot: string; movement?: string; frequency: number; whenToUse?: string; adEffect?: string; apertureSuggestion?: string; examples?: string[] };
type HookFormula = { type: string; formula: string; openingLine?: string; visualDescription?: string; why?: string; platformFit?: string[]; scoreImpact?: string; examples?: string[] };
type PlatformInsight = { platform: string; contentStyle?: string; topFormats?: string[]; avgEngagement?: string; bestPractices?: string[]; avoidPatterns?: string[] };
type SellingPointVisual = { point: string; visualTreatment?: string; screenTime?: string; placement?: string; cameraRecommendation?: string; examples?: string[] };
type TimelineSegment = { segment: string; startSec: number; endSec: number; label: string; description: string; cameraNote?: string; voiceover?: string };
type VideoTimeline = { recommendedDurationSec: number; platform: string; segments: TimelineSegment[]; rationale?: string };

type DeepAnalysisData = {
  videoStructure?: { openingPatterns?: { pattern: string; frequency: number; effectiveness: string; example: string }[]; hookDurationRange?: string; productRevealTiming?: string; averageLength?: string; structuralInsights?: string[] };
  vibeAnalysis?: { dominantTones?: { tone: string; frequency: number; avgScore: number; example: string }[]; emotionalTriggers?: { trigger: string; usage: string; examples: string[] }[]; visualStyleNotes?: string; pacingProfile?: string; vibeInsights?: string[] };
  ctaAnalysis?: { commonCTAs?: { cta: string; frequency: number; type: string; effectiveness: string }[]; placement?: string; urgencyLevel?: string; conversionDrivers?: string[]; ctaInsights?: string[] };
  sellingPointDeep?: { topPerformers?: { point: string; whyItWorks: string; bestPlatforms: string[]; exampleContent: string }[]; underutilized?: { point: string; opportunity: string }[]; messagingInsights?: string[] };
  competitiveGaps?: { gap: string; recommendation: string; priority: string }[];
  recommendations?: { title: string; description: string; impact: string; effort: string; category: string }[];
  environmentAnalysis?: EnvironmentAnalysisItem[];
  cameraAngles?: CameraAngle[];
  hookFormulas?: HookFormula[];
  platformInsights?: PlatformInsight[];
  sellingPointVisuals?: SellingPointVisual[];
  videoTimeline?: VideoTimeline;
};

// ─── Helper components (server-safe) ─────────────────────────────────────────

function severityLevel(val: string): StatusLevel {
  if (val === "high") return "healthy";
  if (val === "medium") return "attention";
  return "neutral";
}

function priorityLevel(val: string): StatusLevel {
  if (val === "high") return "urgent";
  if (val === "medium") return "attention";
  return "neutral";
}

function scoreImpactClass(impact?: string) {
  if (impact === "high") return "bg-green-100 text-green-700 border border-green-200";
  if (impact === "medium") return "bg-amber-100 text-amber-700 border border-amber-200";
  return "bg-gray-100 text-gray-500 border border-gray-200";
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  YouTube: <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-red-600"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>,
  TikTok: <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-gray-900"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.3a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.69a8.25 8.25 0 0 0 4.83 1.55V6.79a4.85 4.85 0 0 1-1.07-.1z" /></svg>,
  Instagram: <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-purple-600"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" /></svg>,
};

// ─── Timeline diagram (server component) ─────────────────────────────────────

function TimelineDiagramServer({ timeline }: { timeline: VideoTimeline }) {
  const COLORS: Record<string, string> = {
    Hook: "bg-red-500", "Problem Setup": "bg-amber-500", "Product Demo": "bg-blue-500",
    "Social Proof": "bg-purple-500", CTA: "bg-emerald-500", Lifestyle: "bg-teal-500",
    "Brand Reveal": "bg-pink-500", Transition: "bg-gray-400",
  };
  const total = timeline.recommendedDurationSec;
  const getColor = (label: string) => {
    const match = Object.keys(COLORS).find(k => label.toLowerCase().includes(k.toLowerCase()));
    return match ? COLORS[match] : "bg-indigo-500";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>0s</span>
        <span className="font-semibold text-foreground">{timeline.platform} · {total}s</span>
        <span>{total}s</span>
      </div>
      {/* Bar */}
      <div className="flex h-8 rounded-lg overflow-hidden border border-border gap-px">
        {timeline.segments.map((seg, i) => {
          const w = ((seg.endSec - seg.startSec) / total) * 100;
          const col = getColor(seg.segment);
          return (
            <div key={i} className={`relative flex items-center justify-center ${col}`} style={{ width: `${w}%`, minWidth: 2 }}
              title={`${seg.segment}: ${seg.startSec}s–${seg.endSec}s`}>
              {w > 8 && <span className="text-[9px] font-bold text-white truncate px-1">{seg.segment}</span>}
            </div>
          );
        })}
      </div>
      {/* Segment list */}
      <div className="space-y-1.5">
        {timeline.segments.map((seg, i) => {
          const col = getColor(seg.segment);
          const dur = seg.endSec - seg.startSec;
          return (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex-shrink-0 w-16 text-right">
                <span className="text-[10px] font-mono text-muted-foreground">{seg.startSec}s–{seg.endSec}s</span>
              </div>
              <div className="flex-1 rounded-lg border border-border bg-card px-3 py-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${col}`} />
                  <p className="text-xs font-semibold">{seg.segment} — {seg.label}</p>
                  <span className="text-[10px] text-muted-foreground ml-auto">{dur}s</span>
                </div>
                <p className="text-[11px] text-foreground/70 leading-relaxed">{seg.description}</p>
                {seg.cameraNote && <p className="text-[10px] text-blue-600 italic">{seg.cameraNote}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {timeline.rationale && (
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
          <p className="text-[10px] text-blue-700 leading-relaxed"><span className="font-semibold">Why this structure: </span>{timeline.rationale}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default async function InsightsListPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [patterns, sellingPoints, insights, deepAnalysis, brand, project, competitorRows] = await Promise.all([
    prisma.narrativePattern.findMany({ where: { projectId }, orderBy: { avgPerformance: "desc" } }),
    prisma.sellingPoint.findMany({ where: { projectId }, orderBy: { strength: "desc" } }),
    prisma.insight.findMany({ where: { projectId }, orderBy: { importance: "desc" } }),
    prisma.deepAnalysis.findUnique({ where: { projectId } }),
    prisma.brand.findUnique({ where: { projectId } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { campaignGoal: true, brandName: true, category: true } }),
    prisma.competitor.findMany({
      where: { projectId },
      include: {
        rollup: true,
        _count: { select: { contentAssets: true, adTeardowns: true, insights: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const competitorSummaries: CompetitorSummaryView[] = competitorRows.map((c) => ({
    id: c.id,
    name: c.name,
    url: c.url,
    adCount: c._count.contentAssets,
    teardownCount: c._count.adTeardowns,
    insightCount: c._count.insights,
    rollup: c.rollup
      ? {
          dominantHooks: c.rollup.dominantHooks,
          dominantFormats: c.rollup.dominantFormats,
          offerLadder: c.rollup.offerLadder,
          ctaPatterns: c.rollup.ctaPatterns,
          summary: c.rollup.summary,
        }
      : null,
  }));

  const generalInsights = insights.filter((i) => !i.competitorId);

  const deep = deepAnalysis as unknown as (DeepAnalysisData & { id: string }) | null;

  const useEnvironments = (brand?.useEnvironments as UseEnvironment[] | null) || [];
  const actorSettings = (brand?.actorSettings as ActorSetting[] | null) || [];
  const displayGuidelines = (brand?.displayGuidelines as DisplayGuideline[] | null) || [];
  const environmentAnalysis = (deep?.environmentAnalysis as EnvironmentAnalysisItem[] | null) || [];
  const cameraAngles = (deep?.cameraAngles as CameraAngle[] | null) || [];
  const hookFormulas = (deep?.hookFormulas as HookFormula[] | null) || [];
  const platformInsights = (deep?.platformInsights as PlatformInsight[] | null) || [];
  const sellingPointVisuals = (deep?.sellingPointVisuals as SellingPointVisual[] | null) || [];
  const videoTimeline = deep?.videoTimeline as VideoTimeline | null;
  const maxCameraFreq = cameraAngles.length > 0 ? Math.max(...cameraAngles.map(c => c.frequency)) : 1;
  const aiModel = getConfiguredModelLabel();

  return (
    <div className="space-y-8">
      <StageGuide
        projectId={projectId}
        stage="insights"
        detail="Each competitor is torn down ad by ad — hooks, offers and CTAs. This is what your scripts get written against."
      />

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Creative Insights</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {project?.brandName} · {project?.campaignGoal || "Campaign"} · Analysis by{" "}
            <span className="font-mono">{aiModel}</span>
          </p>
        </div>
        <ActionButton
          endpoint={`/api/projects/${projectId}/insights/reanalyze`}
          label="Re-analyze"
          loadingLabel="Analyzing…"
          icon="brain"
          autoContinue
          className={
            // Only worth pointing at once research has actually collected ads
            // to tear down — otherwise this competes with the real next step.
            competitorSummaries.some((c) => c.adCount > 0) &&
            competitorSummaries.every((c) => c.teardownCount === 0)
              ? "cta-attention"
              : undefined
          }
        />
      </div>

      <CompetitorsSection projectId={projectId} competitors={competitorSummaries} />

      {/* ══════════════════════════════════════════════════
          PRIORITY BLOCK 1: Production Context (top)
          Environments · Actors · Display Rules
      ══════════════════════════════════════════════════ */}

      <div className="rounded-2xl border-2 border-blue-200 bg-blue-50/30 p-5 space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <Film className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold">Production Context</p>
            <p className="text-xs text-muted-foreground">Environments, actors, and display rules — editable. These feed directly into script generation.</p>
          </div>
        </div>

        {/* Environments */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-600" />
              <p className="text-sm font-semibold">Shooting Environments</p>
              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">{useEnvironments.length}</span>
            </div>
            <p className="text-[10px] text-muted-foreground italic">Click any field to edit inline</p>
          </div>
          {/* Research-derived environment analysis */}
          {environmentAnalysis.length > 0 && (
            <div className="mb-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">From content analysis:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {environmentAnalysis.map((env, i) => (
                  <div key={i} className="rounded-lg border border-blue-100 bg-white p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold">{env.environment}</p>
                      <span className="text-[10px] text-muted-foreground">{env.frequency}×</span>
                    </div>
                    <p className="text-[11px] text-foreground/70 leading-snug">{env.description}</p>
                    {env.lightingNotes && (
                      <div className="rounded bg-amber-50 border border-amber-100 px-2 py-1">
                        <p className="text-[10px] text-amber-700"><span className="font-semibold">Lighting:</span> {env.lightingNotes}</p>
                      </div>
                    )}
                    {env.bestFor && <p className="text-[10px] text-blue-600">Best for: {env.bestFor}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Editable environments */}
          <EnvironmentsSection projectId={projectId} initial={useEnvironments} />
        </div>

        {/* Actor Settings */}
        <div className="space-y-3 border-t border-blue-200 pt-5">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-purple-600" />
            <p className="text-sm font-semibold">Actor Role Settings</p>
            <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">{actorSettings.length}</span>
          </div>
          <ActorSettingsSection projectId={projectId} initial={actorSettings} />
        </div>

        {/* Display Guidelines */}
        <div className="space-y-3 border-t border-blue-200 pt-5">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold">Product Display Guidelines</p>
            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">{displayGuidelines.length}</span>
          </div>
          <DisplayGuidelinesSection projectId={projectId} initial={displayGuidelines} />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          PRIORITY BLOCK 2: Video Timeline
      ══════════════════════════════════════════════════ */}

      {videoTimeline && videoTimeline.segments?.length > 0 && (
        <section className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/20 p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-bold">Video Timeline Design</p>
            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">
              {videoTimeline.recommendedDurationSec}s · {videoTimeline.platform}
            </span>
          </div>
          <TimelineDiagramServer timeline={videoTimeline} />
        </section>
      )}

      {/* ══════════════════════════════════════════════════
          PRIORITY BLOCK 3: Hook Formulas
      ══════════════════════════════════════════════════ */}

      {hookFormulas.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-bold">Hook Formulas</p>
            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">{hookFormulas.length}</span>
            <p className="text-xs text-muted-foreground">— How to stop scrolling in the first 3 seconds</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {hookFormulas.map((hf, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3 hover:border-amber-200 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold">{hf.type}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${scoreImpactClass(hf.scoreImpact)}`}>
                    {hf.scoreImpact || "medium"} impact
                  </span>
                </div>
                {hf.formula && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Formula</p>
                    <ol className="space-y-1">
                      {hf.formula.split("→").map((step, j) => (
                        <li key={j} className="flex gap-2 text-xs">
                          <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{j + 1}</span>
                          <span className="text-foreground/80">{step.trim()}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {hf.openingLine && (
                  <blockquote className="rounded-lg bg-muted/60 border-l-2 border-amber-400 px-3 py-2">
                    <p className="text-xs italic text-foreground/80">&ldquo;{hf.openingLine}&rdquo;</p>
                  </blockquote>
                )}
                {hf.visualDescription && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <p className="text-[10px] font-semibold text-slate-600 mb-0.5">Visual (first 3s)</p>
                    <p className="text-[11px] text-slate-700 leading-relaxed">{hf.visualDescription}</p>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex gap-1 flex-wrap">
                    {(hf.platformFit || []).map((p, j) => {
                      const icon = PLATFORM_ICONS[p.charAt(0).toUpperCase() + p.slice(1)];
                      return (
                        <span key={j} className="inline-flex items-center gap-1 text-[10px] bg-muted px-2 py-0.5 rounded-full border border-border">
                          {icon && icon}<span>{p}</span>
                        </span>
                      );
                    })}
                  </div>
                  {hf.why && <p className="text-[10px] text-muted-foreground text-right max-w-[180px] leading-snug">{hf.why}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════
          BLOCK 4: Camera Angles
      ══════════════════════════════════════════════════ */}

      {cameraAngles.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-blue-500" />
            <p className="text-sm font-bold">Camera Angles & Shots</p>
            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">{cameraAngles.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cameraAngles.map((ca, i) => {
              const whenBadge = ca.whenToUse === "hook"
                ? "bg-red-50 text-red-700 border-red-200"
                : ca.whenToUse === "cta"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-blue-50 text-blue-700 border-blue-200";
              return (
                <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold leading-snug">{ca.shot}</p>
                    {ca.whenToUse && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${whenBadge}`}>
                        {ca.whenToUse}
                      </span>
                    )}
                  </div>
                  {ca.movement && (
                    <p className="text-[11px] text-muted-foreground italic">{ca.movement}</p>
                  )}
                  {ca.adEffect && (
                    <p className="text-[11px] text-foreground/80 leading-snug">{ca.adEffect}</p>
                  )}
                  {ca.apertureSuggestion && (
                    <code className="block text-[10px] bg-muted px-2 py-1 rounded font-mono text-foreground/70">{ca.apertureSuggestion}</code>
                  )}
                  {/* Frequency bar */}
                  <div className="flex items-center gap-2">
                    <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.round((ca.frequency / maxCameraFreq) * 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{ca.frequency}×</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════
          BLOCK 5: Selling Point Visuals
      ══════════════════════════════════════════════════ */}

      {sellingPointVisuals.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-indigo-500" />
            <p className="text-sm font-bold">Selling Point Visual Treatments</p>
          </div>
          <div className="space-y-2">
            {sellingPointVisuals.map((sp, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold text-indigo-700">{sp.point}</p>
                  <div className="flex gap-1.5 shrink-0">
                    {sp.screenTime && <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full border border-border">{sp.screenTime}</span>}
                    {sp.placement && <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200">{sp.placement}</span>}
                  </div>
                </div>
                {sp.visualTreatment && (
                  <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                    <p className="text-[10px] font-semibold text-slate-500 mb-0.5">Visual Treatment</p>
                    <p className="text-xs text-slate-700 leading-relaxed">{sp.visualTreatment}</p>
                  </div>
                )}
                {sp.cameraRecommendation && (
                  <p className="text-[11px] text-muted-foreground italic flex items-center gap-1">
                    <Camera className="h-3 w-3 shrink-0" />{sp.cameraRecommendation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════
          BLOCK 6: Platform Insights
      ══════════════════════════════════════════════════ */}

      {platformInsights.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-teal-500" />
            <p className="text-sm font-bold">Platform Insights</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {platformInsights.map((pi, i) => {
              const icon = PLATFORM_ICONS[pi.platform.charAt(0).toUpperCase() + pi.platform.slice(1)];
              return (
                <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border-b border-border">
                    {icon || <Globe className="h-4 w-4" />}
                    <p className="text-sm font-semibold capitalize">{pi.platform}</p>
                    {pi.avgEngagement && <span className="text-[10px] text-muted-foreground ml-auto">{pi.avgEngagement}</span>}
                  </div>
                  <div className="p-4 space-y-3">
                    {pi.contentStyle && <p className="text-xs text-foreground/80 leading-relaxed">{pi.contentStyle}</p>}
                    {(pi.bestPractices || []).length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">Do</p>
                        {(pi.bestPractices || []).map((bp, j) => (
                          <p key={j} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />{bp}
                          </p>
                        ))}
                      </div>
                    )}
                    {(pi.avoidPatterns || []).length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-semibold text-red-700 uppercase tracking-wide">Avoid</p>
                        {(pi.avoidPatterns || []).map((ap, j) => (
                          <p key={j} className="text-[11px] text-foreground/70 flex items-start gap-1.5">
                            <XCircle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />{ap}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════
          BLOCK 7: Selling Points Matrix (with send-to-script)
      ══════════════════════════════════════════════════ */}

      {sellingPoints.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-orange-500" />
            <p className="text-sm font-bold">Selling Points</p>
            <span className="text-[10px] text-muted-foreground">— click → Script to add to your script context</span>
          </div>
          <SellingPointsSection sellingPoints={sellingPoints.map(sp => ({
            id: sp.id, point: sp.point, category: sp.category,
            strength: sp.strength || 0, uniqueness: sp.uniqueness || 0, frequency: sp.frequency || 0,
          }))} />
        </section>
      )}

      {/* ══════════════════════════════════════════════════
          BLOCK 8: Narrative Patterns
      ══════════════════════════════════════════════════ */}

      {patterns.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-violet-500" />
            <p className="text-sm font-bold">Narrative Patterns</p>
            <span className="text-[10px] text-muted-foreground">— what story structures perform best</span>
          </div>
          <NarrativePatternsSection patterns={patterns.map(p => ({
            id: p.id, type: p.type, name: p.name, description: p.description,
            frequency: p.frequency, avgPerformance: p.avgPerformance, bestPractices: p.bestPractices,
          }))} />
        </section>
      )}

      {/* ══════════════════════════════════════════════════
          BLOCK 9: CTA + Video Structure (compact)
      ══════════════════════════════════════════════════ */}

      {deep?.ctaAnalysis && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <MousePointerClick className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-bold">CTA Strategy</p>
            {deep.ctaAnalysis.urgencyLevel && (
              <StatusBadge level={severityLevel(deep.ctaAnalysis.urgencyLevel)}>
                {deep.ctaAnalysis.urgencyLevel} urgency
              </StatusBadge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Placement</p>
              <p className="text-sm font-medium">{deep.ctaAnalysis.placement || "—"}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Conversion Drivers</p>
              <div className="flex flex-wrap gap-1">
                {(deep.ctaAnalysis.conversionDrivers || []).slice(0, 3).map((d, i) => (
                  <span key={i} className="text-[10px] bg-background border border-border px-1.5 py-0.5 rounded">{d}</span>
                ))}
              </div>
            </div>
          </div>
          {(deep.ctaAnalysis.commonCTAs || []).length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30">
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="text-left font-semibold px-3 py-2">CTA Text</th>
                    <th className="text-left font-semibold px-3 py-2">Type</th>
                    <th className="text-left font-semibold px-3 py-2">Effectiveness</th>
                    <th className="text-right font-semibold px-3 py-2">Uses</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(deep.ctaAnalysis.commonCTAs || []).map((c, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="px-3 py-2 text-sm font-medium">&ldquo;{c.cta}&rdquo;</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground capitalize">{c.type}</td>
                      <td className="px-3 py-2"><StatusBadge level={severityLevel(c.effectiveness)}>{c.effectiveness}</StatusBadge></td>
                      <td className="px-3 py-2 text-right text-xs num text-muted-foreground">{c.frequency}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ══════════════════════════════════════════════════
          BLOCK 10: Strategic Insights (selectable → script)
      ══════════════════════════════════════════════════ */}

      {generalInsights.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-yellow-500" />
            <p className="text-sm font-bold">Strategic Insights</p>
            <span className="text-[10px] text-muted-foreground">— select any to add to your script or ideation context</span>
          </div>
          <InsightsSelectableSection insights={generalInsights.map(ins => ({
            id: ins.id, category: ins.category, title: ins.title,
            description: ins.description, importance: ins.importance || 0,
            recommendation: ins.recommendation,
          }))} />
        </section>
      )}

      {/* ══════════════════════════════════════════════════
          BLOCK 11: Competitive Gaps + Recommendations
      ══════════════════════════════════════════════════ */}

      {(deep?.competitiveGaps?.length || deep?.recommendations?.length) ? (
        <section className="space-y-4">
          {(deep?.competitiveGaps?.length ?? 0) > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-500" />
                <p className="text-sm font-bold">Competitive Gaps</p>
              </div>
              <div className="space-y-2">
                {deep!.competitiveGaps!.map((gap, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card p-4 flex gap-3 items-start">
                    <StatusBadge level={priorityLevel(gap.priority)} className="shrink-0">{gap.priority}</StatusBadge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{gap.gap}</p>
                      <p className="text-xs text-muted-foreground mt-1">{gap.recommendation}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(deep?.recommendations?.length ?? 0) > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                <p className="text-sm font-bold">Recommendations</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {deep!.recommendations!.map((rec, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">{rec.category}</span>
                    </div>
                    <p className="text-sm font-semibold">{rec.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{rec.description}</p>
                    <div className="flex gap-2">
                      <StatusBadge level={severityLevel(rec.impact)}>↑ {rec.impact} impact</StatusBadge>
                      <StatusBadge level="neutral">effort: {rec.effort}</StatusBadge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* Empty state */}
      {patterns.length === 0 && sellingPoints.length === 0 && insights.length === 0 &&
        !deep && useEnvironments.length === 0 && (
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <AlertCircle className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No insights yet</p>
          <p className="text-xs text-muted-foreground mt-1">Run research to generate deep creative analysis</p>
        </div>
      )}
    </div>
  );
}
