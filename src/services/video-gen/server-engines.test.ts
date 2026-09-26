import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn(async () => [] as { id: string }[]));
vi.mock("@/lib/db", () => ({ prisma: { libtvRun: { findMany } } }));
vi.mock("@/services/ai/zhipu", () => ({ isZhipuConfigured: () => true }));
vi.mock("@/services/ai/comfyui", () => ({ isComfyConfigured: () => true }));

import { adapterFor, advanceActiveServerRuns, driveServerRun } from "./server-engines";

beforeEach(() => findMany.mockClear());

describe("server engine registry", () => {
  it("maps executors to adapters", () => {
    expect(adapterFor("glm")?.engine).toBe("glm");
    expect(adapterFor("comfyui")?.engine).toBe("comfyui");
    expect(adapterFor("libtv")).toBeNull();
    expect(adapterFor(null)).toBeNull();
  });

  it("never drives a LibTV run on the server", async () => {
    expect(await driveServerRun("libtv", "r1", 1000)).toBe("idle");
  });

  it("sweeps every server engine", async () => {
    expect(await advanceActiveServerRuns(1000)).toEqual({ glm: 0, comfyui: 0, animatic: 0 });
    const executors = findMany.mock.calls.map((c) => (c as unknown as [{ where: { executor: string } }])[0].where.executor).sort();
    expect(executors).toEqual(["animatic", "comfyui", "glm"]);
  });
});
