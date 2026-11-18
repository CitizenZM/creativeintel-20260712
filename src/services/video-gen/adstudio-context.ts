/**
 * Xark context pack for Ad Studio — everything the steps BEFORE Studio worked out, frozen into the run input so
 * the Mac pipeline's second pass (hook, script, scenes, product images) builds on it instead of starting over:
 *
 *   Setup     → product (confirmed photos, page text, product brief: ranked selling points, objections, compliance)
 *   Research  → winning competitor ads (teardowns: hook type, beats, proof, CTA, why it works) + competitor rollups
 *   Insights  → selling points, insights, narrative patterns, audience pain points, hook formulas, visual treatments
 *   Planning  → campaign plan (per-platform hooks, end card) and the round-1 test plan
 *   Creative  → angle, script template, cast (actor) and setting (environment) picked in Campaign Selection
 *
 * shapeContext() is pure (tested); loadXarkContext() reads the rows. Items the user picked (selected) come first;
 * when nothing was picked, the strongest non-dismissed items are used. Every list is capped so the prompt stays small.
 */
import { prisma } from "@/lib/db";
import { hookWinRates, type PerfRow } from "./adstudio-results";

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const str = (v: unknown, n = 400) => (typeof v === "string" ? v.trim().slice(0, n) : v == null ? undefined : String(v).slice(0, n));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
/** picked first, then by score; drop dismissed; cap */
function rank<T extends J>(rows: T[], score: (r: T) => number, cap: number): (T & { picked: boolean })[] {
  return rows
    .filter((r) => !r.dismissed)
    .map((r) => ({ ...r, picked: !!r.selected }))
    .sort((a, b) => Number(b.picked) - Number(a.picked) || score(b) - score(a))
    .slice(0, cap);
}
const empty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) ||
  (typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !Object.keys(v as object).length);
/** drop empty fields and empty sub-objects, so "carried" counts only what a step really produced */
const clean = <T extends J>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => !empty(v))) as T;

/** research hook-type names (teardowns, hook formulas) → Ad Studio hook type ids (pipeline/hooks.mjs HOOK_TYPES) */
const HOOK_MAP: [RegExp, string][] = [
  [/interrupt|shock|unexpected/i, "interrupt"],
  [/curiosity|secret|reveal|mystery/i, "curiosity"],
  [/question/i, "question"],
  [/problem|pain|agitat/i, "pain"],
  [/social|testimonial|ugc|review|reaction/i, "social"],
  [/result|before.?after|demo|transformation/i, "result"],
  [/offer|price|deal|discount|sale/i, "offer"],
  [/story|day.?in|pov|narrative/i, "story"],
  [/bold|claim|stat|myth|contrarian/i, "bold"],
];
/** a shop root ("https://brand.com/") has no single product, so no price or offer to read */
export const isHomepage = (u: unknown) => {
  try { return typeof u === "string" && /^\/?$/.test(new URL(u).pathname); } catch { return false; }
};
export const hookTypeOf = (name: unknown) => HOOK_MAP.find(([re]) => re.test(String(name ?? "")))?.[1];

export interface RawContext {
  project: J;
  brand?: J | null;
  teardowns?: J[];
  rollups?: J[];
  insights?: J[];
  sellingPoints?: J[];
  narratives?: J[];
  audience?: J | null;
  deep?: J | null;
  selection?: J | null;
  angle?: J | null;
  script?: J | null;
  performance?: PerfRow[];
}

export function shapeContext(r: RawContext) {
  const p = r.project;
  const images = [...arr(p.userProductImages), ...arr(p.productPageImages)]
    .map((i) => ({ url: str(i.url, 1000), alt: str(i.caption ?? i.alt, 120) }))
    .filter((i) => i.url && /^https?:/.test(i.url))
    .filter((i, k, all) => all.findIndex((x) => x.url === i.url) === k)
    .slice(0, 8);
  const tear = [...(r.teardowns ?? [])]
    .sort((a, b) => (num((b.contentAsset as J)?.overallScore) ?? 0) - (num((a.contentAsset as J)?.overallScore) ?? 0))
    .slice(0, 5)
    .map((t) => {
      const a = (t.contentAsset as J) ?? {};
      return clean({
        title: str(a.title, 120), score: num(a.overallScore), videoUrl: str(a.videoUrl, 1000), hookType: str(t.hookType, 40), hookText: str(t.hookText, 160), hookVisual: str(t.hookVisual, 240),
        beats: arr(t.beats).slice(0, 8).map((b) => clean({ role: str(b.role, 30), visual: str(b.visual, 160), vo: str(b.vo, 160), onScreenText: str(b.onScreenText, 100) })),
        proof: arr(t.proofDevices).slice(0, 3).map((d) => str(d.description ?? d.type, 140)), cta: str(t.ctaText, 120), offer: str(t.offer, 120), whyItWorks: str(t.whyItWorks, 500),
      });
    });
  // P2: every torn-down ad with a video link (not just the top 5) can be Ad Studio's pace reference — best score first
  const rhythmRefs = [...(r.teardowns ?? [])]
    .map((t) => (t.contentAsset as J) ?? {})
    .filter((a) => /^https?:/.test(String(a.videoUrl ?? "")) || /youtube\.com|youtu\.be|tiktok\.com|instagram\.com/.test(String(a.url ?? "")))
    .sort((a, b) => (num(b.overallScore) ?? 0) - (num(a.overallScore) ?? 0))
    .slice(0, 6)
    .map((a) => clean({ title: str(a.title, 120), score: num(a.overallScore), videoUrl: str(a.videoUrl, 1000), pageUrl: str(a.url, 1000), durationSec: num(a.durationSec) }));
  const hookVotes = new Map<string, number>();
  for (const t of tear) { const id = hookTypeOf(t.hookType); if (id) hookVotes.set(id, (hookVotes.get(id) ?? 0) + 1 + (num(t.score) ?? 0) / 100); }
  const formulas = arr(r.deep?.hookFormulas).slice(0, 5);
  for (const f of formulas) { const id = hookTypeOf(f.type); if (id) hookVotes.set(id, (hookVotes.get(id) ?? 0) + 0.5); }
  // P4: real results beat research — the best click-through hook type gets 2 votes, the others in proportion
  const tested = hookWinRates(r.performance ?? []);
  const best = tested[0]?.ctr ?? 0;
  for (const t of tested) if (best > 0) hookVotes.set(t.hookType, (hookVotes.get(t.hookType) ?? 0) + 2 * (t.ctr / best));
  const sel = r.selection ?? {};
  const warnings: string[] = [];
  if (isHomepage(p.productUrl)) warnings.push("The product link in Setup is the shop's homepage, so Ad Studio can't read a price or offer — set the product page URL in Setup.");
  if (!images.length) warnings.push("No product photos from Setup — Ad Studio will only have what it can scrape.");
  const brief = (p.productBrief as J) ?? null;
  return clean({
    v: 1,
    setup: clean({
      productName: str(p.productName, 160), productTitle: str(p.productPageTitle, 160), campaignGoal: str(p.campaignGoal, 120), goalType: str(p.goalType, 30),
      confirmed: !!p.productConfirmedAt, images, productText: str(p.productPageText, 1200), brief: brief ?? undefined,
    }),
    brand: r.brand ? clean({
      promise: str(r.brand.brandPromise), valueProposition: str(r.brand.valueProposition), tone: str(r.brand.toneOfVoice, 200), targetAudience: str(r.brand.targetAudience, 300),
      productDescription: str(r.brand.productDescription, 600), displayGuidelines: arr(r.brand.displayGuidelines).slice(0, 6),
    }) : undefined,
    research: clean({ winningAds: tear, rhythmRefs, competitorSummaries: (r.rollups ?? []).slice(0, 3).map((x) => str(x.summary, 400)) }),
    insights: clean({
      sellingPoints: rank(r.sellingPoints ?? [], (x) => num(x.strength) ?? 0, 6).map((x) => clean({ point: str(x.point, 200), strength: num(x.strength), picked: x.picked || undefined })),
      // own video reviews (weakest first since importance = 1 - score) take at most 3 of the 6 slots, so research insights stay
      insights: rank(r.insights ?? [], (x) => num(x.importance) ?? 0, 12).filter((x, _i, all) => x.category !== "adstudio_review" || all.filter((y) => y.category === "adstudio_review").indexOf(x) < 3).slice(0, 6).map((x) => clean({ category: str(x.category, 40), title: str(x.title, 120), recommendation: str(x.recommendation ?? x.description, 300), picked: x.picked || undefined })),
      narratives: rank(r.narratives ?? [], (x) => num(x.avgPerformance) ?? num(x.frequency) ?? 0, 3).map((x) => clean({ type: str(x.type, 30), name: str(x.name, 120), description: str(x.description, 300), picked: x.picked || undefined })),
      audience: r.audience ? clean({ painPoints: arr(r.audience.painPoints).slice(0, 5).map((x) => str(x.point ?? x, 200)), segments: arr(r.audience.segments).slice(0, 3).map((x) => clean({ name: str(x.name, 80), ageRange: str(x.ageRange, 20), description: str(x.description, 240) })) }) : undefined,
      hookFormulas: formulas.map((f) => clean({ type: str(f.type, 40), formula: str(f.formula, 200), openingLine: str(f.openingLine, 160) })),
      sellingPointVisuals: arr(r.deep?.sellingPointVisuals).slice(0, 5).map((x) => clean({ point: str(x.point, 120), visualTreatment: str(x.visualTreatment, 240) })),
    }),
    planning: clean({ campaignPlan: (p.campaignPlan as J) ?? undefined, testPlan: (p.testPlan as J) ?? undefined }),
    creative: clean({
      angle: r.angle ? clean({ title: str(r.angle.title, 120), description: str(r.angle.description, 400), targetEmotion: str(r.angle.targetEmotion, 60), targetAudience: str(r.angle.targetAudience, 200) }) : r.script?.angle ? { title: str(r.script.angle, 400) } : undefined,
      template: str(r.script?.template, 60), videoType: str(r.script?.videoType, 40), targetEmotion: str(r.script?.targetEmotion, 60),
      actor: clean({ role: str(sel.selectedActorRole ?? r.script?.roleName, 80), description: str(sel.selectedActorDesc, 300), age: str(sel.selectedActorAge, 20), imageUrl: str(sel.selectedActorImage, 1000) }),
      environment: clean({ name: str(sel.selectedEnvironment ?? r.script?.environmentName, 80), notes: str(sel.selectedEnvNotes, 300), imageUrl: str(sel.selectedEnvImage, 1000) }),
      sellingPointOrder: arr(sel.selectedSellingPoints).slice(0, 5).map((x) => str(x.point, 160)),
      platform: str(sel.platform, 20), durationSec: num(sel.totalDurationSec), styleCategories: arr(sel.styleCategories).map((x) => str(x, 40)),
    }),
    performance: tested.length ? tested : undefined,
    warnings,
    suggestedHookTypes: [...hookVotes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id),
  });
}
export type XarkContext = ReturnType<typeof shapeContext>;

/** counts shown in the Studio panel ("Carried from Setup → … → Creative") */
export function summarizeContext(c: XarkContext) {
  const x = c as J & { setup?: J; research?: J; insights?: J; planning?: J; creative?: J };
  const n = (v: unknown) => arr(v).length;
  const ins = x.insights ?? {}; const cr = x.creative ?? {};
  return {
    images: n(x.setup?.images), winningAds: n(x.research?.winningAds), paceVideos: n(x.research?.rhythmRefs), sellingPoints: n(ins.sellingPoints), insights: n(ins.insights),
    painPoints: n((ins.audience as J)?.painPoints), hookFormulas: n(ins.hookFormulas),
    angle: str((cr.angle as J)?.title, 80), actor: str((cr.actor as J)?.role, 60), environment: str((cr.environment as J)?.name, 60),
    plan: !!x.planning, testedHooks: arr(x.performance).length, suggestedHookTypes: (x.suggestedHookTypes as string[] | undefined) ?? [], warnings: (x.warnings as string[] | undefined) ?? [],
  };
}

export async function loadXarkContext(projectId: string, scriptId: string | null): Promise<XarkContext> {
  const [project, brand, teardowns, rollups, insights, sellingPoints, narratives, audience, deep, selection, script, performance] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { productUrl: true, productName: true, productPageTitle: true, productPageText: true, productPageImages: true, userProductImages: true, productBrief: true, productConfirmedAt: true, campaignGoal: true, goalType: true, campaignPlan: true, testPlan: true },
    }),
    prisma.brand.findUnique({ where: { projectId } }),
    prisma.adTeardown.findMany({ where: { projectId }, include: { contentAsset: { select: { title: true, overallScore: true, videoUrl: true, url: true, durationSec: true, excluded: true } } }, take: 40 }),
    prisma.competitorRollup.findMany({ where: { projectId }, select: { summary: true }, take: 3 }),
    prisma.insight.findMany({ where: { projectId }, take: 60 }),
    prisma.sellingPoint.findMany({ where: { projectId }, take: 60 }),
    prisma.narrativePattern.findMany({ where: { projectId } }),
    prisma.audienceProfile.findUnique({ where: { projectId } }),
    prisma.deepAnalysis.findUnique({ where: { projectId }, select: { hookFormulas: true, sellingPointVisuals: true } }),
    prisma.campaignSelection.findUnique({ where: { projectId } }),
    scriptId ? prisma.script.findUnique({ where: { id: scriptId }, select: { angle: true, template: true, videoType: true, targetEmotion: true, roleName: true, environmentName: true } }) : null,
    prisma.adPerformance.findMany({ where: { projectId, hookStyle: { not: null } }, select: { hookStyle: true, impressions: true, clicks: true, conversions: true }, take: 2000 }),
  ]);
  // the script's angle text matches an Angle row when it came from Planning; use the row for its audience/emotion
  const angle = script?.angle
    ? await prisma.angle.findFirst({ where: { projectId, deletedAt: null, title: script.angle }, orderBy: { createdAt: "desc" } })
    : null;
  const j = (v: unknown) => v as J;
  return shapeContext({
    project: j(project ?? {}), brand: j(brand), teardowns: teardowns.filter((t) => !t.contentAsset?.excluded).map(j), rollups: rollups.map(j), insights: insights.map(j),
    sellingPoints: sellingPoints.map(j), narratives: narratives.map(j), audience: j(audience), deep: j(deep), selection: j(selection), angle: j(angle), script: j(script), performance,
  });
}
