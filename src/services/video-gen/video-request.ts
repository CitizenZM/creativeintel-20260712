import { z } from "zod";

/** Validate a paid submission before creating its intent or calling a provider. */
export const videoRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(6500),
  model: z.string().optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  resolution: z.enum(["720p", "1080p", "720P", "1080P"]).default("720p"),
  duration: z.number().int().min(4).max(15).default(5),
  scriptId: z.string().optional(),
  shotIndex: z.number().int().min(0).optional(),
  imageUrl: z.url().startsWith("https://").optional(),
  endImageUrl: z.url().startsWith("https://").optional(),
});
