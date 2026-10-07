/**
 * Screen plates across re-edits: the corner track detected on a source clip is kept on that clip's
 * LibtvJob (settings.screenPlateTracks, keyed by detect mode + key colour), so hook variants, locales,
 * exports and auto-fix re-edits of the run reuse it instead of paying the vision detection again. The
 * vision call itself runs under the run's spend guard (refused over budget → the plate is skipped).
 */
import type { ScreenPlate, TrackKey, VisionQuadFn } from "./screen-plate";

/** One clip's cached track. */
export interface PlateTrackCache {
  get(): Promise<TrackKey[] | null>;
  set(track: TrackKey[]): Promise<void>;
}

/** Per-run cache, bound to a source clip URL and a plate's detect settings. */
export interface TrackCache {
  bind(url: string, plate: Pick<ScreenPlate, "detect" | "key">): PlateTrackCache;
}

const variantKey = (plate: Pick<ScreenPlate, "detect" | "key">) => `${plate.detect ?? ""}|${plate.key ?? ""}`;

/** The cached track, else `detect()` — a non-empty result is cached. Cache errors never fail a render. */
export async function detectedTrack(detect: () => Promise<TrackKey[]>, cache?: PlateTrackCache): Promise<TrackKey[]> {
  const hit = cache ? await cache.get().catch(() => null) : null;
  if (hit?.length) return hit;
  const track = await detect();
  if (track.length && cache) await cache.set(track).catch(() => undefined);
  return track;
}

/** The cache on the run's clip jobs (the job whose result is the segment's source URL). */
export function jobTrackCache(runId: string): TrackCache {
  return {
    bind(url, plate) {
      const k = variantKey(plate);
      const find = async () => {
        const { prisma } = await import("@/lib/db");
        return prisma.libtvJob.findFirst({ where: { runId, resultUrl: url }, select: { id: true, settings: true, updatedAt: true } });
      };
      return {
        async get() {
          const job = await find();
          const tracks = ((job?.settings ?? {}) as { screenPlateTracks?: Record<string, TrackKey[]> }).screenPlateTracks;
          const t = tracks?.[k];
          return Array.isArray(t) && t.length ? t : null;
        },
        async set(track) {
          const { prisma } = await import("@/lib/db");
          // Conditional on the job version (a concurrent settings write is re-read, not overwritten).
          for (let i = 0; i < 3; i++) {
            const job = await find();
            if (!job) return;
            const s = (job.settings ?? {}) as Record<string, unknown> & { screenPlateTracks?: Record<string, TrackKey[]> };
            const { count } = await prisma.libtvJob.updateMany({
              where: { id: job.id, updatedAt: job.updatedAt },
              data: { settings: { ...s, screenPlateTracks: { ...(s.screenPlateTracks ?? {}), [k]: track } } as never },
            });
            if (count === 1) return;
          }
        },
      };
    },
  };
}

/** The vision corner detector under the run's spend guard (one small-image call, ~1.2k tokens in). */
export function guardedScreenVision(scope: { projectId?: string | null; runId: string }): VisionQuadFn {
  return async (imageDataUrl, systemPrompt) => {
    const [{ guardLlm }, { defaultScreenVision }] = await Promise.all([import("@/services/ops/spend"), import("./screen-plate")]);
    return guardLlm({ projectId: scope.projectId, runId: scope.runId, kind: "vision_qc" }, { inTokens: 1200, outTokens: 200 }, () => defaultScreenVision(imageDataUrl, systemPrompt));
  };
}
