/**
 * Conflict-safe partial writers for the rows whose JSON columns several writers extend. Thin wrappers
 * over patchRow (lib/optimistic-json.ts) that bind the prisma model, so a caller only supplies the pure
 * `mutate` over the CURRENT row. `mutate` may run once per conflict and returns the columns to write
 * (or null to write nothing). Each resolves to null when the row does not exist.
 */
import { prisma } from "@/lib/db";
import { patchRow, type RowModel, type UpdateResult } from "@/lib/optimistic-json";

type Mutate<Row, Data> = (row: Row & { updatedAt: Date }) => Data | null;
type Select = Record<string, true>;

/** Project by id — fieldStatus, imageAdSets and friends. `select` is what `mutate` reads. */
export function patchProject<Row extends object = { fieldStatus: unknown }, Data extends Record<string, unknown> = Record<string, unknown>>(
  projectId: string,
  mutate: Mutate<Row, Data>,
  select: Select = { fieldStatus: true }
): Promise<UpdateResult<Row & { updatedAt: Date }, Data> | null> {
  return patchRow<Row & { updatedAt: Date }, Data>(prisma.project as unknown as RowModel, { id: projectId }, mutate, { select, label: `project ${projectId}` });
}

/** BrandKit by its project (1:1). */
export function patchBrandKit<Row extends object = { fieldStatus: unknown }, Data extends Record<string, unknown> = Record<string, unknown>>(
  projectId: string,
  mutate: Mutate<Row, Data>,
  select: Select = { fieldStatus: true }
): Promise<UpdateResult<Row & { updatedAt: Date }, Data> | null> {
  return patchRow<Row & { updatedAt: Date }, Data>(prisma.brandKit as unknown as RowModel, { projectId }, mutate, { select, label: `brand kit of project ${projectId}` });
}

/** ResearchJob by id — steps. */
export function patchResearchJob<Row extends object = { steps: unknown }, Data extends Record<string, unknown> = Record<string, unknown>>(
  jobId: string,
  mutate: Mutate<Row, Data>,
  select: Select = { steps: true }
): Promise<UpdateResult<Row & { updatedAt: Date }, Data> | null> {
  return patchRow<Row & { updatedAt: Date }, Data>(prisma.researchJob as unknown as RowModel, { id: jobId }, mutate, { select, label: `research job ${jobId}` });
}
