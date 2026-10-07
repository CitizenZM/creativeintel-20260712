/**
 * AI director review: after a master is assembled, a vision model watches it
 * the way a creative director would — one frame from the middle of every
 * storyboard beat, judged against what that beat was supposed to show — and
 * returns a score, per-shot issues and the shots worth re-rendering. Studio's
 * "Fix these shots" sends exactly those to the re-render flow.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { PromptPart } from "@/services/ai/claude-client";

const run = promisify(execFile);
const MAX_SHOTS = 8;

const reviewSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  summary: z.string().default(""),
  shots: z
    .array(
      z.object({
        frameNumber: z.coerce.number(),
        ok: z.boolean(),
        issues: z.array(z.string()).default([]),
        rerender: z.boolean().default(false),
      })
    )
    .default([]),
});

export type DirectorReview = z.infer<typeof reviewSchema> & { reviewedAt: string; shotIndexes: number[] };

export const DIRECTOR_SYSTEM = `You are the creative director signing off a short vertical video ad before it goes live. For each numbered frame you get the beat it was meant to show. Judge each frame strictly but fairly:
- does it show what the beat intended (subject, action, product)?
- is the product recognisable and undistorted where it should appear?
- any garbled or misspelled text, extra fingers, melted faces, collages/split screens, obvious AI artefacts?
- is the on-camera person consistent with the other frames?
Set rerender=true only when regenerating that shot would clearly improve the ad. Score the whole ad 0–100 for production readiness (80+ = ship it).
Return JSON only: {"score": number, "summary": "one or two sentences", "shots": [{"frameNumber": n, "ok": boolean, "issues": ["..."], "rerender": boolean}]}.`;

/** Middle of each storyboard beat's first shot, at most MAX_SHOTS, CTA end card excluded. Pure. */
export function sampleTimes(frames: { frameNumber: number; startSec: number; endSec: number; segment?: string | null }[]): { frameNumber: number; t: number }[] {
  const picks = frames
    .filter((f) => (f.segment ?? "").toUpperCase() !== "CTA")
    .map((f) => ({ frameNumber: f.frameNumber, t: Math.round(((f.startSec + f.endSec) / 2) * 100) / 100 }));
  if (picks.length <= MAX_SHOTS) return picks;
  const step = picks.length / MAX_SHOTS;
  return Array.from({ length: MAX_SHOTS }, (_, i) => picks[Math.floor(i * step)]);
}

/** Map flagged storyboard frames to the run's shot indexes (the re-render API's unit). Pure. */
export function shotIndexesFor(frameNumbers: number[], jobs: { kind: string; shotIndex: number; settings: unknown }[]): number[] {
  const out = new Set<number>();
  for (const j of jobs) {
    if (j.kind !== "image") continue;
    const s = (j.settings ?? {}) as { frameNumber?: number; coversFrames?: number[] };
    const covers = s.coversFrames?.length ? s.coversFrames : s.frameNumber ? [s.frameNumber] : [];
    if (j.shotIndex >= 0 && covers.some((n) => frameNumbers.includes(n))) out.add(j.shotIndex);
  }
  return [...out].sort((a, b) => a - b);
}

export async function reviewRun(runId: string): Promise<DirectorReview> {
  if (!ffmpegPath) throw new Error("ffmpeg is not available");
  const runRow = await prisma.libtvRun.findUnique({ where: { id: runId }, include: { jobs: true } });
  if (!runRow?.masterMp4Url) throw new Error("This run has no master to review");
  const sb = runRow.storyboardId ? await prisma.storyboard.findUnique({ where: { id: runRow.storyboardId }, select: { frames: true } }) : null;
  const frames = (Array.isArray(sb?.frames) ? sb!.frames : []) as {
    frameNumber: number;
    startSec: number;
    endSec: number;
    segment?: string;
    scene?: string;
    imagePrompt?: string;
    productAction?: string;
  }[];
  const picks = sampleTimes(frames);
  if (!picks.length) throw new Error("No storyboard beats to review");
  const dir = await mkdtemp(path.join(tmpdir(), `director-${runId}-`));
  try {
    const master = path.join(dir, "master.mp4");
    const res = await fetch(runRow.masterMp4Url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`master download ${res.status}`);
    await writeFile(master, Buffer.from(await res.arrayBuffer()));
    const parts: PromptPart[] = [];
    for (const p of picks) {
      const jpg = path.join(dir, `f${p.frameNumber}.jpg`);
      await run(ffmpegPath, ["-y", "-v", "error", "-ss", String(p.t), "-i", master, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", jpg], { timeout: 30_000 });
      const f = frames.find((x) => x.frameNumber === p.frameNumber);
      const intent = [f?.scene, f?.productAction].filter(Boolean).join(" — ") || (f?.imagePrompt ?? "").slice(0, 200);
      parts.push({ type: "text", text: `Frame ${p.frameNumber} (${f?.segment ?? "BODY"}, ~${p.t}s). Intended: ${intent.slice(0, 260)}` });
      parts.push({ type: "image_url", url: `data:image/jpeg;base64,${(await readFile(jpg)).toString("base64")}` });
    }
    const { analyzeWithClaude } = await import("@/services/ai/claude-client");
    const { guardLlm } = await import("@/services/ops/spend");
    const review = await guardLlm({ projectId: runRow.projectId, runId, kind: "vision_qc" }, { inTokens: 600 + picks.length * 330, outTokens: 1500 }, () =>
      analyzeWithClaude({ systemPrompt: DIRECTOR_SYSTEM, userPrompt: parts, responseSchema: reviewSchema, maxTokens: 1500 })
    );
    const flagged = review.shots.filter((s) => s.rerender).map((s) => s.frameNumber);
    return { ...review, reviewedAt: new Date().toISOString(), shotIndexes: shotIndexesFor(flagged, runRow.jobs) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Review a run and keep the verdict on its QC report. */
export async function reviewAndStore(runId: string): Promise<DirectorReview> {
  const review = await reviewRun(runId);
  const { patchQcReport } = await import("./qc-report");
  await patchQcReport(runId, (qc) => ({ ...qc, director: review }));
  return review;
}
