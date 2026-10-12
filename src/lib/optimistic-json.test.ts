import { describe, expect, it } from "vitest";
import { createFakeModel } from "@/test-utils/fake-rows";
import { OptimisticConflictError, patchJsonField, patchRow, updateWithRetry, type RowModel } from "./optimistic-json";

const asModel = (m: ReturnType<typeof createFakeModel>) => m as unknown as RowModel;

describe("patchJsonField", () => {
  it("re-applies the mutation to the fresh value when a concurrent writer got in first (both survive)", async () => {
    const m = createFakeModel([{ id: "a", doc: { x: 1 } }]);
    let seen = 0;
    m.onBeforeWrite = (n) => {
      if (n === 0) m.concurrentWrite("a", { doc: { x: 1, other: "kept" } });
    };
    const out = await patchJsonField<Record<string, unknown>>(asModel(m), { id: "a" }, "doc", (doc) => {
      seen++;
      return { ...doc, mine: true };
    });
    expect(seen).toBe(2);
    expect(m.rows.get("a")!.doc).toEqual({ x: 1, other: "kept", mine: true });
    expect(out).toEqual({ x: 1, other: "kept", mine: true });
  });

  it("writes nothing and returns the current value when mutate returns null", async () => {
    const m = createFakeModel([{ id: "a", doc: { x: 1 } }]);
    const out = await patchJsonField(asModel(m), { id: "a" }, "doc", () => null);
    expect(out).toEqual({ x: 1 });
    expect(m.writes).toBe(0);
  });

  it("resolves to undefined when the row does not exist", async () => {
    const m = createFakeModel();
    expect(await patchJsonField(asModel(m), { id: "nope" }, "doc", (d) => d)).toBeUndefined();
  });

  it("throws a clear error once retries are exhausted", async () => {
    const m = createFakeModel([{ id: "a", doc: {} }]);
    m.onBeforeWrite = () => m.concurrentWrite("a", { doc: { n: Math.random() } });
    const p = patchJsonField(asModel(m), { id: "a" }, "doc", (d) => d, { retries: 2, label: "storyboard a" });
    await expect(p).rejects.toThrow(OptimisticConflictError);
    await expect(patchJsonField(asModel(m), { id: "a" }, "doc", (d) => d, { retries: 2, label: "storyboard a" })).rejects.toThrow(
      /storyboard a kept changing — gave up after 3 attempts/
    );
  });
});

describe("patchRow", () => {
  it("looks the row up by any unique filter and returns what was written", async () => {
    const m = createFakeModel([{ id: "k1", projectId: "p1", fieldStatus: {}, tone: null }]);
    const res = await patchRow<{ updatedAt: Date; fieldStatus: Record<string, string> }>(
      asModel(m),
      { projectId: "p1" },
      (row) => ({ tone: "warm", fieldStatus: { ...row.fieldStatus, tone: "suggested" } }),
      { select: { fieldStatus: true } }
    );
    expect(res?.written).toBe(true);
    expect(m.rows.get("k1")).toMatchObject({ tone: "warm", fieldStatus: { tone: "suggested" } });
  });

  it("decides against the CURRENT row on retry (fill only if still empty)", async () => {
    const m = createFakeModel([{ id: "k1", tone: null }]);
    m.onBeforeWrite = (n) => {
      if (n === 0) m.concurrentWrite("k1", { tone: "typed by the user" });
    };
    const res = await patchRow<{ updatedAt: Date; tone: string | null }>(asModel(m), { id: "k1" }, (row) => (row.tone ? null : { tone: "AI guess" }), {
      select: { tone: true },
    });
    expect(res).toMatchObject({ written: false, data: null });
    expect(m.rows.get("k1")!.tone).toBe("typed by the user");
  });
});

describe("updateWithRetry", () => {
  it("returns null for a missing row and counts attempts", async () => {
    let reads = 0;
    const res = await updateWithRetry({ label: "x", read: async () => (reads++, null), mutate: () => ({}), write: async () => ({ count: 1 }) });
    expect(res).toBeNull();
    expect(reads).toBe(1);
  });

  it("stops retrying on the first successful write", async () => {
    let writes = 0;
    const res = await updateWithRetry({
      label: "x",
      read: async () => ({ updatedAt: new Date(0), v: writes }),
      mutate: (r) => ({ v: r.v + 1 }),
      write: async () => ({ count: ++writes < 3 ? 0 : 1 }),
    });
    expect(writes).toBe(3);
    expect(res?.written).toBe(true);
  });
});
