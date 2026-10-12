/**
 * In-memory stand-in for a Prisma model delegate with an `updatedAt` column, for testing optimistic
 * read → mutate → write code. JSON columns come back as fresh copies on every read, updateMany honours
 * `where.updatedAt` (count 0 on mismatch) and bumps `updatedAt` on every write — like the real thing.
 * `onBeforeWrite` lets a test land a concurrent write between a caller's read and its write.
 */
export type FakeRow = { id: string; updatedAt: Date } & Record<string, unknown>;

export interface FakeModel {
  rows: Map<string, FakeRow>;
  /** Called at the start of every update/updateMany — simulate a concurrent writer here. */
  onBeforeWrite: ((n: number) => void) | null;
  writes: number;
  /** A write that bypasses onBeforeWrite (what the "other writer" does). */
  concurrentWrite(id: string, patch: Record<string, unknown>): void;
  findUnique: (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => Promise<FakeRow | null>;
  findFirst: (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => Promise<FakeRow | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<FakeRow>;
  update: (args: { where: Record<string, unknown>; data: Record<string, unknown>; select?: Record<string, unknown> }) => Promise<FakeRow>;
  updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
}

let clock = 1;
const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const reviveDates = (row: FakeRow): FakeRow => ({ ...copy(row), updatedAt: new Date(row.updatedAt.getTime()), ...(row.createdAt ? { createdAt: row.createdAt } : {}) }) as FakeRow;

export function createFakeModel(initial: Array<Record<string, unknown> & { id: string }> = []): FakeModel {
  const rows = new Map<string, FakeRow>();
  for (const r of initial) rows.set(r.id, { ...copy(r), updatedAt: new Date(++clock) } as FakeRow);

  const matches = (r: FakeRow, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => matches(r, w));
      if (v instanceof Date) return (r[k] as Date | undefined)?.getTime() === v.getTime();
      if (v === null) return r[k] == null;
      if (v && typeof v === "object") return true; // operators (in, not…) are not simulated
      return r[k] === v;
    });
  const find = (where: Record<string, unknown>) => [...rows.values()].find((r) => matches(r, where)) ?? null;
  const out = (r: FakeRow | null) => (r ? reviveDates(r) : null);

  const model: FakeModel = {
    rows,
    onBeforeWrite: null,
    writes: 0,
    concurrentWrite(id, patch) {
      const r = rows.get(id)!;
      Object.assign(r, copy(patch));
      r.updatedAt = new Date(++clock);
    },
    findUnique: async ({ where }) => out(find(where)),
    findFirst: async ({ where }) => out(find(where)),
    create: async ({ data }) => {
      const row = { id: `row${rows.size + 1}`, ...copy(data), updatedAt: new Date(++clock) } as FakeRow;
      rows.set(row.id, row);
      return reviveDates(row);
    },
    update: async ({ where, data }) => {
      model.onBeforeWrite?.(model.writes);
      model.writes++;
      const r = find(where);
      if (!r) throw Object.assign(new Error("Record not found"), { code: "P2025" });
      Object.assign(r, copy(data));
      r.updatedAt = new Date(++clock);
      return reviveDates(r);
    },
    updateMany: async ({ where, data }) => {
      model.onBeforeWrite?.(model.writes);
      model.writes++;
      const r = find(where);
      if (!r) return { count: 0 };
      Object.assign(r, copy(data));
      r.updatedAt = new Date(++clock);
      return { count: 1 };
    },
  };
  return model;
}
