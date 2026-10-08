/**
 * Structure library: proven ad structures saved from teardowns (hook, beat
 * timeline, proof devices, the source ad's views), reusable across brands in
 * the same category. A project picks one (CampaignSelection.structureId) and
 * script writing follows it instead of the automatic best-in-category ad.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { ReferenceAd } from "@/lib/attention-blueprint";
import { tenantOfProject, tenantProjectWhere, type TenantId } from "@/services/tenancy";

type Beat = ReferenceAd["beats"][number];

export async function saveStructureFromTeardown(projectId: string, teardownId: string) {
  const t = await prisma.adTeardown.findFirst({
    where: { id: teardownId, projectId },
    include: { competitor: { select: { name: true } }, contentAsset: { select: { title: true, url: true, viewCount: true, durationSec: true } } },
  });
  if (!t) throw new Error("Teardown not found");
  const beats = (Array.isArray(t.beats) ? t.beats : []) as Beat[];
  if (beats.length < 2) throw new Error("This teardown has no beat timeline to save");
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { category: true, goalType: true } });
  const owner = t.competitor?.name ?? null;
  const name = `${owner ?? "Ad"} — ${(t.hookType ?? "hook").replace(/_/g, " ")} · ${beats.length} beats`;
  return prisma.adStructure.upsert({
    where: { sourceTeardownId: t.id },
    create: {
      sourceProjectId: projectId,
      sourceTeardownId: t.id,
      name,
      category: project?.category ?? null,
      goalType: project?.goalType ?? null,
      sourceTitle: t.contentAsset?.title ?? "Ad",
      sourceOwner: owner,
      sourceUrl: t.contentAsset?.url ?? null,
      sourceViews: t.contentAsset?.viewCount ?? null,
      hookType: t.hookType,
      hookText: t.hookText,
      durationSec: t.contentAsset?.durationSec ?? Math.max(...beats.map((b) => b.endSec ?? 0)),
      beats: beats as never,
      proofDevices: (t.proofDevices ?? []) as never,
      whyItWorks: t.whyItWorks,
    },
    update: { name, sourceViews: t.contentAsset?.viewCount ?? null },
  });
}

/**
 * The library is per account: a structure belongs to the tenant of the project it was saved from
 * (src/services/tenancy.ts), and one with no source project to the master admin. Another account's
 * saved structures — hooks, beats, source ads — never show up in, or steer, this account's work.
 */
export async function structureWhereForTenant(tenant: TenantId): Promise<Prisma.AdStructureWhereInput> {
  const projects = await prisma.project.findMany({ where: tenantProjectWhere(tenant), select: { id: true } });
  const own: Prisma.AdStructureWhereInput = { sourceProjectId: { in: projects.map((p) => p.id) } };
  return tenant ? own : { OR: [own, { sourceProjectId: null }] };
}

/** A structure this project may use (same account), or null. */
export async function findStructureForProject(projectId: string, structureId: string) {
  const tenant = await tenantOfProject(projectId);
  if (tenant === undefined) return null;
  return prisma.adStructure.findFirst({ where: { AND: [{ id: structureId }, await structureWhereForTenant(tenant)] } });
}

export async function listStructures(category: string | null | undefined, tenant: TenantId) {
  const all = await prisma.adStructure.findMany({
    where: await structureWhereForTenant(tenant),
    orderBy: [{ sourceViews: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  // Same category first, then the rest — a structure travels across categories too.
  const c = (category ?? "").toLowerCase();
  return [...all].sort((a, b) => Number((b.category ?? "").toLowerCase() === c) - Number((a.category ?? "").toLowerCase() === c));
}

export function structureToReference(s: { sourceTitle: string; sourceOwner: string | null; sourceViews: number | null; hookType: string | null; hookText: string | null; whyItWorks: string | null; beats: unknown }): ReferenceAd {
  return {
    title: s.sourceTitle,
    owner: s.sourceOwner,
    viewCount: s.sourceViews,
    hookType: s.hookType,
    hookText: s.hookText,
    whyItWorks: s.whyItWorks,
    beats: (Array.isArray(s.beats) ? s.beats : []) as Beat[],
  };
}

/** The structure this project's scripts follow, if one was picked. */
export async function chosenStructure(projectId: string): Promise<ReferenceAd | null> {
  try {
    const sel = await prisma.campaignSelection.findUnique({ where: { projectId }, select: { structureId: true } });
    if (!sel?.structureId) return null;
    const s = await findStructureForProject(projectId, sel.structureId);
    if (!s) return null;
    await prisma.adStructure.update({ where: { id: s.id }, data: { timesUsed: { increment: 1 } } }).catch(() => {});
    return structureToReference(s);
  } catch {
    return null;
  }
}
