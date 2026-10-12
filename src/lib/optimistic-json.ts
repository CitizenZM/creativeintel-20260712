/**
 * Optimistic read → mutate → write for rows whose JSON columns many writers extend (Storyboard.frames,
 * Project.fieldStatus / imageAdSets, BrandKit.fieldStatus, ResearchJob.steps…). A plain read → spread
 * → write loses whatever another writer stored in between (last write wins), so every partial writer
 * goes through here instead: read the row, apply a pure `mutate` to what was read, then write
 * conditional on the row's `updatedAt` (bumped by every write) and, when someone else got in first,
 * re-read and re-apply `mutate` to the fresh row. Same pattern as patchQcReport (video-gen/qc-report.ts).
 *
 * The model must have an `updatedAt` column (`@updatedAt`) — Prisma bumps it on every update/updateMany.
 */

/** Conflicting writes are retried this many times after the first try. */
export const OPTIMISTIC_RETRIES = 5;

/** The slice of a Prisma model delegate this needs (prisma.storyboard, prisma.project, …). */
export interface RowModel {
  findUnique(args: never): Promise<unknown>;
  updateMany(args: never): Promise<{ count: number }>;
}

/** A unique filter that names one row: `{ id }`, or `{ projectId }` for 1:1 models such as BrandKit. */
export type RowWhere = Record<string, string>;

export class OptimisticConflictError extends Error {
  constructor(label: string, attempts: number) {
    super(`${label} kept changing — gave up after ${attempts} attempts (concurrent writers)`);
    this.name = "OptimisticConflictError";
  }
}

export interface UpdateWithRetryOptions<Row extends { updatedAt: Date }, Data> {
  /** Names the row in the error when retries are exhausted. */
  label: string;
  /** Fresh read of the row (must include `updatedAt`); null when the row does not exist. */
  read: () => Promise<Row | null>;
  /** Pure function of the row just read; may run once per conflict. Return null to write nothing. */
  mutate: (row: Row) => Data | null;
  /** Write `data` only if the row's `updatedAt` still equals `row.updatedAt`; resolve to the count written. */
  write: (row: Row, data: Data) => Promise<{ count: number }>;
  retries?: number;
}

export interface UpdateResult<Row, Data> {
  /** The row `mutate` saw on the attempt that settled. */
  row: Row;
  /** What was written (null when `mutate` returned null and nothing was written). */
  data: Data | null;
  written: boolean;
}

/** Low-level loop; see {@link patchRow} / {@link patchJsonField} for the prisma-shaped wrappers. Resolves to null when the row does not exist. */
export async function updateWithRetry<Row extends { updatedAt: Date }, Data>(
  opts: UpdateWithRetryOptions<Row, Data>
): Promise<UpdateResult<Row, Data> | null> {
  const tries = 1 + (opts.retries ?? OPTIMISTIC_RETRIES);
  for (let i = 0; i < tries; i++) {
    const row = await opts.read();
    if (!row) return null;
    const data = opts.mutate(row);
    if (data === null) return { row, data: null, written: false };
    const { count } = await opts.write(row, data);
    if (count === 1) return { row, data, written: true };
  }
  throw new OptimisticConflictError(opts.label, tries);
}

/**
 * Apply `mutate` to the current row and write the returned column data only if nobody wrote the row
 * meanwhile. `where` is a unique filter (`{ id }` / `{ projectId }`); `select` limits what is read
 * (`updatedAt` is always added). `mutate` returns the `data` for the update — any columns, so a
 * fieldStatus merge can ride along with other columns — or null to skip the write.
 */
export function patchRow<Row extends { updatedAt: Date }, Data extends Record<string, unknown> = Record<string, unknown>>(
  model: RowModel,
  where: RowWhere,
  mutate: (row: Row) => Data | null,
  opts: { select?: Record<string, true>; retries?: number; label?: string } = {}
): Promise<UpdateResult<Row, Data> | null> {
  const findArgs = { where, ...(opts.select ? { select: { ...opts.select, updatedAt: true } } : {}) };
  return updateWithRetry<Row, Data>({
    label: opts.label ?? `row ${JSON.stringify(where)}`,
    retries: opts.retries,
    read: () => model.findUnique(findArgs as never) as Promise<Row | null>,
    mutate,
    write: (row, data) => model.updateMany({ where: { ...where, updatedAt: row.updatedAt }, data } as never),
  });
}

/**
 * Patch ONE JSON column: `mutate` gets the column's current value and returns its new value (or null
 * to write nothing). Resolves to the value written, the current value when nothing was written, or
 * undefined when the row does not exist.
 */
export async function patchJsonField<T = unknown>(
  model: RowModel,
  where: RowWhere,
  field: string,
  mutate: (current: T) => T | null,
  opts: { retries?: number; label?: string } = {}
): Promise<T | undefined> {
  const res = await patchRow<{ updatedAt: Date } & Record<string, unknown>>(
    model,
    where,
    (row) => {
      const next = mutate(row[field] as T);
      return next === null ? null : { [field]: next };
    },
    { select: { [field]: true }, ...opts }
  );
  if (!res) return undefined;
  return res.data ? (res.data[field] as T) : (res.row[field] as T);
}
