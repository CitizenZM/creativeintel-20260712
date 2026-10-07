import { beforeEach, describe, expect, it, vi } from "vitest";

type Run = { id: string; qcReport: Record<string, unknown> | null; updatedAt: Date };
const store = vi.hoisted(() => ({ runs: new Map<string, Run>(), clock: 1 }));

vi.mock("@/lib/db", () => ({
  prisma: {
    libtvRun: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const r = store.runs.get(where.id);
        // A JSON column comes back as a fresh copy on every read.
        return r ? { ...r, qcReport: r.qcReport ? JSON.parse(JSON.stringify(r.qcReport)) : null } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; updatedAt?: Date }; data: { qcReport: Record<string, unknown> } }) => {
        const r = store.runs.get(where.id);
        if (!r || (where.updatedAt && where.updatedAt.getTime() !== r.updatedAt.getTime())) return { count: 0 };
        r.qcReport = JSON.parse(JSON.stringify(data.qcReport));
        r.updatedAt = new Date(++store.clock);
        return { count: 1 };
      }),
    },
  },
}));
vi.mock("./glm-assemble", () => ({ renderFromRun: vi.fn() }));
vi.mock("./server-executor", () => ({ storyboardFrames: vi.fn() }));

import { patchQcReport } from "./qc-report";
import { claimBatchVariants } from "./batch-render";

/** Another writer lands between our read and our write. */
function concurrentWrite(runId: string, key: string, value: unknown) {
  const r = store.runs.get(runId)!;
  r.qcReport = { ...(r.qcReport ?? {}), [key]: value };
  r.updatedAt = new Date(++store.clock);
}

beforeEach(() => {
  store.runs.clear();
  store.runs.set("r1", { id: "r1", qcReport: { engine: "edit-v2" }, updatedAt: new Date(store.clock) });
});

describe("patchQcReport", () => {
  it("re-applies the mutation on a concurrent write instead of overwriting it", async () => {
    let calls = 0;
    const out = await patchQcReport("r1", (qc) => {
      if (calls++ === 0) concurrentWrite("r1", "locales", [{ locale: "es-US" }]);
      return { ...qc, covers: { x: 1 } };
    });
    expect(calls).toBe(2);
    expect(store.runs.get("r1")!.qcReport).toEqual({ engine: "edit-v2", locales: [{ locale: "es-US" }], covers: { x: 1 } });
    expect(out).toEqual(store.runs.get("r1")!.qcReport);
  });

  it("gives up after its retries when the report keeps changing", async () => {
    let n = 0;
    await expect(
      patchQcReport("r1", (qc) => {
        concurrentWrite("r1", `w${n++}`, true);
        return qc;
      })
    ).rejects.toThrow(/kept changing/);
    expect(n).toBe(4); // first try + 3 retries
  });

  it("writes nothing when the mutation returns null, and null for a missing run", async () => {
    const before = store.runs.get("r1")!.updatedAt;
    expect(await patchQcReport("r1", () => null)).toEqual({ engine: "edit-v2" });
    expect(store.runs.get("r1")!.updatedAt).toBe(before);
    expect(await patchQcReport("nope", (qc) => qc)).toBeNull();
  });
});

describe("batch variant claims", () => {
  it("two concurrent claims never take the same variant", async () => {
    const variants = ["v1", "v2", "v3", "v4"].map((id) => ({ id, status: "planned", needsGeneration: false }));
    store.runs.get("r1")!.qcReport = { batches: [{ id: "b1", variants }] };
    const [a, b] = await Promise.all([claimBatchVariants("r1", "b1", 2), claimBatchVariants("r1", "b1", 2)]);
    const ids = [...a, ...b].map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["v1", "v2", "v3", "v4"]);
    const stored = (store.runs.get("r1")!.qcReport as { batches: { variants: { status: string }[] }[] }).batches[0].variants;
    expect(stored.every((v) => v.status === "pending")).toBe(true);
  });
});

describe("mergeReassembledQc (reassemble-run)", () => {
  it("keeps every key the assembly doesn't produce and takes the new measurements", async () => {
    const { mergeReassembledQc } = await import("./qc-report");
    const old = {
      engine: "edit-v2",
      checks: [{ id: "old" }],
      preflight: { score: 61 },
      variants: [{ hookStyle: "c" }],
      batches: [{ id: "b1" }],
      locales: [{ locale: "es-US" }],
      exportPack: { manifestUrl: "m" },
      autofix: { before: 61 },
      director: { shots: [] },
      covers: { "9:16": "c.jpg" },
      exports: [{ format: "1x1" }],
    };
    const fresh = { engine: "edit-v2", checks: [{ id: "new" }], preflight: { score: 74 } };
    expect(mergeReassembledQc(old, fresh)).toEqual({ ...old, checks: [{ id: "new" }], preflight: { score: 74 } });
    expect(mergeReassembledQc(null, fresh)).toEqual(fresh);
  });
});
