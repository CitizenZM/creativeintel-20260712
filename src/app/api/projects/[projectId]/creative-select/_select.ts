/**
 * Request parsing + pure selection for POST /api/projects/[projectId]/creative-select. Kept out of
 * route.ts so it can be unit-tested without Prisma.
 */
import { z } from "zod";
import { PLATFORM_PROFILES } from "@/services/creative/platforms.data";
import { selectCreative } from "@/services/creative/library";
import { TO_CREATIVE_CATEGORY, type SpCategory } from "@/services/creative/product-brief";
import type { CategoryId, CreativeChoice, PlatformId } from "@/services/creative/types";

const PLATFORM_IDS = PLATFORM_PROFILES.map((p) => p.id) as [PlatformId, ...PlatformId[]];
const CATEGORY_IDS = ["electronics", "camera", "auto", "kitchen", "home_air", "beauty", "jewelry", "sports", "home", "food", "health", "gifts", "apps"] as const satisfies readonly CategoryId[];

const promoSchema = z
  .object({
    pct: z.number().min(0).max(95).nullable().optional(),
    code: z.string().max(40).nullable().optional(),
    price: z.number().positive().nullable().optional(),
    comparePrice: z.number().positive().nullable().optional(),
    priceCheckedAt: z.string().nullable().optional(),
    deadline: z.string().nullable().optional(),
  })
  .optional();

export const selectBodySchema = z
  .object({
    /** One platform → `{ choice }`; several → `{ choices: { [platform]: choice } }`. */
    platform: z.enum(PLATFORM_IDS).optional(),
    platforms: z.array(z.enum(PLATFORM_IDS)).min(1).max(12).optional(),
    goal: z.enum(["cold", "retarget", "promo", "awareness", "app_install", "lead"]),
    promo: promoSchema,
    runDate: z.string().optional(),
    /** Override the category derived from the stored product brief. */
    category: z.enum(CATEGORY_IDS).optional(),
    assets: z
      .object({
        creatorFootage: z.boolean().optional(),
        realTestFootage: z.boolean().optional(),
        rating: z.object({ value: z.number(), count: z.number() }).nullable().optional(),
        multiSku: z.boolean().optional(),
      })
      .optional(),
    ctv: z.boolean().optional(),
  })
  .refine((b) => b.platform || b.platforms?.length, { message: "platform or platforms is required" });

export type SelectBody = z.infer<typeof selectBodySchema>;

/** sp-1 category stored on the brief → creative-library category. */
export function categoryFromBrief(brief: unknown): CategoryId | undefined {
  const sp = (brief as { category?: string } | null | undefined)?.category;
  return sp && sp in TO_CREATIVE_CATEGORY ? TO_CREATIVE_CATEGORY[sp as SpCategory] : undefined;
}

/**
 * Run the selector for each requested platform. A price the user typed in the planner counts as freshly
 * checked (the compare-at end card needs a < 24 h price check), unless the caller sent its own timestamp.
 */
export function runSelection(category: CategoryId, body: SelectBody, now = new Date()): { platform: PlatformId; choice: CreativeChoice }[] {
  const platforms = body.platforms?.length ? body.platforms : [body.platform!];
  const promo = body.promo
    ? { ...body.promo, priceCheckedAt: body.promo.priceCheckedAt ?? (body.promo.price && body.promo.comparePrice ? now.toISOString() : null) }
    : undefined;
  return platforms.map((platform) => ({
    platform,
    choice: selectCreative({ category, platform, goal: body.goal, promo, runDate: body.runDate ?? now.toISOString(), assets: body.assets, ctv: body.ctv }),
  }));
}
