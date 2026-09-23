/**
 * Generate more cast (actor role) or setting (environment) options and append
 * them to the brand's lists, so a script can be cast from more than the
 * handful the analysis happened to extract.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { analyzeWithClaude } from "@/services/ai/claude-client";
import { creativeDirectionLine } from "@/lib/style-categories";

export const maxDuration = 60;

const environmentSchema = z.object({
  options: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      typicalUser: z.string().optional().default(""),
      imagePrompt: z.string().optional().default(""),
    })
  ),
});

const actorSchema = z.object({
  options: z.array(
    z.object({
      role: z.string(),
      ageRange: z.string().optional().default(""),
      scenario: z.string().optional().default(""),
      visualDescription: z.string().optional().default(""),
      painPoint: z.string().optional().default(""),
      productInteraction: z.string().optional().default(""),
    })
  ),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown; count?: unknown };
  const kind = body.kind === "environment" || body.kind === "actor" ? body.kind : null;
  if (!kind) return NextResponse.json({ error: "kind must be environment or actor" }, { status: 400 });
  const count = Math.min(5, Math.max(1, Number(body.count) || 3));

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { brand: true, audienceProfile: true, campaignSelection: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing =
    kind === "environment"
      ? ((project.brand?.useEnvironments as { name?: string }[] | null) ?? [])
      : ((project.brand?.actorSettings as { role?: string }[] | null) ?? []);
  const taken = existing.map((e) => ("name" in e ? e.name : (e as { role?: string }).role)).filter(Boolean);

  const context = [
    `Brand: ${project.brandName}`,
    project.productName ? `Product: ${project.productName}` : "",
    project.category ? `Category: ${project.category}` : "",
    project.brand?.targetAudience ? `Audience: ${project.brand.targetAudience}` : "",
    creativeDirectionLine(project.goalType, project.campaignSelection?.styleCategories),
    taken.length ? `Already have (do not repeat): ${taken.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    kind === "environment"
      ? "You are a commercial director. Propose distinct, filmable settings for short-form video ads. Each is a real place a customer would use the product, described concretely enough to shoot (light, props, time of day)."
      : "You are a casting director. Propose distinct on-camera roles for short-form video ads: who they are, age range, the scenario, how they look, their pain point and how they use the product.";
  const user = `${context}\n\nPropose ${count} new ${kind === "environment" ? "settings" : "roles"}. Return JSON {"options": [...]}.`;

  try {
    const result =
      kind === "environment"
        ? await analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: environmentSchema, maxTokens: 1500 })
        : await analyzeWithClaude({ systemPrompt: system, userPrompt: user, responseSchema: actorSchema, maxTokens: 1500 });
    const added = result.options.slice(0, count);
    const next = [...existing, ...added];
    const data =
      kind === "environment" ? { useEnvironments: next as never } : { actorSettings: next as never };
    await prisma.brand.upsert({
      where: { projectId },
      create: { projectId, name: project.brandName, ...data },
      update: data,
    });
    return NextResponse.json({ added, all: next });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not generate options" },
      { status: 500 }
    );
  }
}
