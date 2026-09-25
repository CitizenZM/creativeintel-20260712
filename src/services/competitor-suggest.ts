/**
 * AI competitor suggestions for the Research step. Evidence first: advertisers
 * that research already found running ads in this category are the strongest
 * candidates; the model ranks those and fills gaps from its own knowledge of
 * the market. Suggestions are added as AI-inferred competitors the user can
 * keep or remove.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { normalizeCompetitor } from "@/lib/brand-name";
import { readStatusMap } from "@/lib/field-status";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Advertiser names seen in research, most frequent first, minus the brand and existing competitors. */
export function candidateAdvertisers(
  names: (string | null | undefined)[],
  brandName: string,
  existing: string[]
): string[] {
  const skip = new Set([norm(brandName), ...existing.map(norm)].filter(Boolean));
  const counts = new Map<string, { name: string; n: number }>();
  for (const raw of names) {
    const name = raw?.trim();
    if (!name || name.length > 60) continue;
    const key = norm(name);
    if (!key || skip.has(key) || [...skip].some((s) => s && (key.includes(s) || s.includes(key)))) continue;
    const cur = counts.get(key);
    counts.set(key, { name: cur?.name ?? name, n: (cur?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.name);
}

const suggestionSchema = z.object({
  competitors: z
    .array(z.unknown())
    .transform((xs) =>
      xs
        .map((x) =>
          z
            .object({ name: z.string().min(1).max(80), url: z.string().optional().nullable(), reason: z.string().optional().default("") })
            .safeParse(typeof x === "string" ? { name: x } : x)
        )
        .filter((r) => r.success)
        .map((r) => r.data!)
    )
    .catch([]),
});

export interface SuggestedCompetitor {
  id: string;
  name: string;
  url: string | null;
  reason: string;
}

export async function suggestCompetitors(projectId: string, want: number): Promise<SuggestedCompetitor[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      brandName: true,
      brandUrl: true,
      category: true,
      productName: true,
      productPageTitle: true,
      productPageText: true,
      campaignGoal: true,
      fieldStatus: true,
      competitors: { select: { name: true } },
      brand: { select: { productCategory: true, productDescription: true } },
    },
  });
  if (!project) throw new Error("Project not found");
  if (want <= 0) return [];

  const existing = project.competitors.map((c) => c.name);
  const seen = await prisma.contentAsset.findMany({
    where: { projectId, isBrandOwned: false },
    select: { advertiserName: true },
    take: 400,
  });
  const evidence = candidateAdvertisers(
    seen.map((a) => a.advertiserName),
    project.brandName,
    existing
  ).slice(0, 25);

  const out = await analyzeWithClaude({
    systemPrompt:
      "You identify the direct competitors of a consumer brand for paid-social ad research. Return real brands that sell a directly comparable product to the same buyer in the same market (US unless stated). Prefer brands that actively run video ads. Never return the brand itself, retailers/marketplaces (Amazon, Walmart), media publishers, or YouTube creators.",
    userPrompt: `Brand: ${project.brandName}${project.brandUrl ? ` (${project.brandUrl})` : ""}
Product: ${project.productName || project.productPageTitle || "(unknown)"}
Category: ${project.brand?.productCategory || project.category || "(unknown)"}
What it is: ${(project.brand?.productDescription || project.productPageText || "").slice(0, 900)}
Campaign goal: ${project.campaignGoal || "(not set)"}
Already tracked (do not repeat): ${existing.join(", ") || "(none)"}
Advertisers our research saw running ads in this space (strong evidence — prefer these when they truly compete): ${evidence.join(", ") || "(none yet)"}

Return JSON: {"competitors":[{"name":"Brand","url":"https://brand.com","reason":"one short line"}]} with the ${want + 2} best candidates, best first.`,
    responseSchema: suggestionSchema,
    tier: "standard",
    maxTokens: 900,
  });

  const taken = new Set([norm(project.brandName), ...existing.map(norm)]);
  const picks = out.competitors
    .map((c) => ({ ...normalizeCompetitor(c.name, c.url ?? null), reason: c.reason }))
    .filter((c) => {
      const k = norm(c.name);
      if (!k || taken.has(k)) return false;
      taken.add(k);
      return true;
    })
    .slice(0, want);

  const added: SuggestedCompetitor[] = [];
  for (const c of picks) {
    const row = await prisma.competitor.create({
      data: { projectId, name: c.name, url: c.url, dataSource: "AI_INFERRED" },
      select: { id: true, name: true, url: true },
    });
    added.push({ ...row, reason: c.reason });
  }

  if (added.length) {
    const map = readStatusMap(project.fieldStatus) as Record<string, string>;
    const raw = (project.fieldStatus && typeof project.fieldStatus === "object" ? project.fieldStatus : {}) as Record<string, unknown>;
    for (const a of added) map[`competitor.${a.id}`] = "suggested";
    await prisma.project.update({ where: { id: projectId }, data: { fieldStatus: { ...raw, ...map } as never } });
  }
  return added;
}
