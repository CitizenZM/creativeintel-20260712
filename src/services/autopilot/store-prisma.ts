/** AutopilotRun rows as the engine's AutopilotStore (production). */
import { prisma } from "@/lib/db";
import type { AutopilotInput, AutopilotPatch, AutopilotRecord, AutopilotState, AutopilotStatus, AutopilotStep, AutopilotStore } from "./types";

type Row = { id: string; projectId: string | null; status: string; step: string; input: unknown; state: unknown; error: string | null; createdAt: Date; updatedAt: Date };

const toRecord = (r: Row): AutopilotRecord => ({
  id: r.id,
  projectId: r.projectId,
  status: r.status as AutopilotStatus,
  step: r.step as AutopilotStep,
  input: (r.input ?? {}) as AutopilotInput,
  state: (r.state ?? {}) as AutopilotState,
  error: r.error,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const patchData = (patch: AutopilotPatch) => ({
  ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
  ...(patch.status ? { status: patch.status } : {}),
  ...(patch.step ? { step: patch.step } : {}),
  ...(patch.state ? { state: patch.state as object } : {}),
  ...(patch.error !== undefined ? { error: patch.error } : {}),
});

const SELECT = { id: true, projectId: true, status: true, step: true, input: true, state: true, error: true, createdAt: true, updatedAt: true } as const;

export const prismaAutopilotStore: AutopilotStore = {
  async create(data) {
    const row = await prisma.autopilotRun.create({
      data: { projectId: data.projectId, input: data.input as object, state: data.state as object, status: "running", step: "scrape" },
      select: SELECT,
    });
    return toRecord(row);
  },
  async get(id) {
    const row = await prisma.autopilotRun.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  },
  async save(id, patch: AutopilotPatch) {
    const row = await prisma.autopilotRun.update({ where: { id }, data: patchData(patch), select: SELECT });
    return toRecord(row);
  },
  async saveIf(id, patch: AutopilotPatch, updatedAt: Date) {
    const { count } = await prisma.autopilotRun.updateMany({ where: { id, updatedAt }, data: patchData(patch) });
    if (count !== 1) return null;
    const row = await prisma.autopilotRun.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  },
  async claim(id, until, now) {
    const { count } = await prisma.autopilotRun.updateMany({
      where: { id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      data: { leaseUntil: until },
    });
    return count === 1;
  },
  async release(id) {
    await prisma.autopilotRun.updateMany({ where: { id }, data: { leaseUntil: null } });
  },
  async listRunnable(limit, now) {
    const rows = await prisma.autopilotRun.findMany({
      where: { status: "running", OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: SELECT,
    });
    return rows.map(toRecord);
  },
};
