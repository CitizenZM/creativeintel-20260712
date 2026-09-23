/**
 * Persistence rules for generated creative (angles, scripts, storyboards).
 *
 * Nothing a user generated is ever overwritten or hard-deleted: regenerating
 * adds a new row/version, archiving sets deletedAt, and the user's picks are
 * stored on the rows themselves so they survive a reload.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/** Where-clause fragment for rows the user has not archived. */
export const LIVE = { deletedAt: null } as const;

export const SELECTION_STATUSES = ["draft", "selected"] as const;
export type SelectionStatus = (typeof SELECTION_STATUSES)[number];

export function isSelectionStatus(value: unknown): value is SelectionStatus {
  return typeof value === "string" && (SELECTION_STATUSES as readonly string[]).includes(value);
}

/** Storyboards for a project, active version of each script first. */
export function listStoryboards(projectId: string) {
  return prisma.storyboard.findMany({
    where: { projectId, ...LIVE },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
}

/** The storyboard Studio should use for a script: its active live version. */
export function findActiveStoryboard(projectId: string, scriptId: string) {
  return prisma.storyboard.findFirst({
    where: { projectId, scriptId, ...LIVE },
    orderBy: [{ isActive: "desc" }, { version: "desc" }],
  });
}

/**
 * Save a freshly generated storyboard as the next version of its script's
 * board and make it the active one. Earlier versions are kept.
 */
export async function createStoryboardVersion(data: Prisma.StoryboardUncheckedCreateInput) {
  return prisma.$transaction(async (tx) => {
    let version = 1;
    if (data.scriptId) {
      const last = await tx.storyboard.findFirst({
        where: { projectId: data.projectId, scriptId: data.scriptId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      version = (last?.version ?? 0) + 1;
      await tx.storyboard.updateMany({
        where: { projectId: data.projectId, scriptId: data.scriptId, isActive: true },
        data: { isActive: false },
      });
    }
    return tx.storyboard.create({ data: { ...data, version, isActive: true } });
  });
}

/** Make one storyboard the active version for its script. */
export async function activateStoryboard(projectId: string, storyboardId: string) {
  return prisma.$transaction(async (tx) => {
    const board = await tx.storyboard.findFirst({
      where: { id: storyboardId, projectId, ...LIVE },
      select: { id: true, scriptId: true },
    });
    if (!board) return null;
    if (board.scriptId) {
      await tx.storyboard.updateMany({
        where: { projectId, scriptId: board.scriptId, isActive: true, NOT: { id: board.id } },
        data: { isActive: false },
      });
    }
    return tx.storyboard.update({ where: { id: board.id }, data: { isActive: true } });
  });
}

/**
 * Archive a storyboard. If it was the active version, the newest remaining
 * version of the same script takes over so the script is never left without
 * a board while others exist.
 */
export async function archiveStoryboard(projectId: string, storyboardId: string) {
  return prisma.$transaction(async (tx) => {
    const board = await tx.storyboard.findFirst({
      where: { id: storyboardId, projectId, ...LIVE },
      select: { id: true, scriptId: true, isActive: true },
    });
    if (!board) return null;
    const archived = await tx.storyboard.update({
      where: { id: board.id },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (board.isActive && board.scriptId) {
      const next = await tx.storyboard.findFirst({
        where: { projectId, scriptId: board.scriptId, ...LIVE },
        orderBy: { version: "desc" },
        select: { id: true },
      });
      if (next) await tx.storyboard.update({ where: { id: next.id }, data: { isActive: true } });
    }
    return archived;
  });
}

const FRAME_HISTORY_LIMIT = 50;

export interface FrameHistoryEntry {
  frameNumber: number;
  frame: Record<string, unknown>;
  editedAt: string;
}

/** Append the pre-edit state of a frame to the storyboard's history, capped. */
export function appendFrameHistory(
  history: unknown,
  frameNumber: number,
  previous: Record<string, unknown>
): FrameHistoryEntry[] {
  const prior = Array.isArray(history) ? (history as FrameHistoryEntry[]) : [];
  return [...prior, { frameNumber, frame: previous, editedAt: new Date().toISOString() }].slice(
    -FRAME_HISTORY_LIMIT
  );
}

/**
 * Analysis re-runs delete and recreate insights and selling points. Match the
 * new rows to what the user had selected by normalised text so a re-analysis
 * does not silently drop their picks.
 */
export function selectionKey(text: string | null | undefined): string {
  return (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
