import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory stand-in for the Prisma models the archive touches.
const state = vi.hoisted(() => ({
  run: null as null | Record<string, unknown>,
  artifacts: [] as Record<string, unknown>[],
  blobs: new Map<string, Uint8Array>(),
  failReads: false,
}));

vi.mock("@/lib/safe-fetch", () => ({ assertSafeUrl: async (u: string) => new URL(u) }));

vi.mock("@/lib/db", () => {
  let seq = 0;
  const projectArtifact = {
    async findMany({ where }: { where: { projectId: string; sourceKey: { in: string[] } } }) {
      if (state.failReads) throw new Error("db down");
      return state.artifacts.filter((a) => a.projectId === where.projectId && where.sourceKey.in.includes(a.sourceKey as string)).map((a) => ({ ...a, blob: state.blobs.has(a.id as string) ? { artifactId: a.id } : null }));
    },
    async create({ data }: { data: Record<string, unknown> & { blob?: { create: { data: Uint8Array } } } }) {
      const { blob, ...row } = data;
      if (state.artifacts.some((a) => a.projectId === row.projectId && a.sourceKey === row.sourceKey && (a.version === row.version || a.fingerprint === row.fingerprint))) throw Object.assign(new Error("unique"), { code: "P2002" });
      const id = `a${++seq}`;
      state.artifacts.push({ ...row, id, createdAt: row.createdAt ?? new Date() });
      if (blob) state.blobs.set(id, blob.create.data);
      return { id };
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      Object.assign(state.artifacts.find((a) => a.id === where.id)!, data);
    },
  };
  return {
    prisma: {
      projectArtifact,
      artifactBlob: { async upsert({ create }: { create: { artifactId: string; data: Uint8Array } }) { state.blobs.set(create.artifactId, create.data); } },
      libtvRun: { async findUnique() { return state.run ? { ...state.run } : null; } },
    },
  };
});

import { archiveAround, archiveInBackground, archiveRun, archivingEnabled } from "./archive";

const M1 = "https://store.public.blob.vercel-storage.com/m1.mp4";
const M2 = "https://store.public.blob.vercel-storage.com/m2.mp4";

beforeEach(() => {
  vi.stubEnv("ARTIFACT_ARCHIVE", "on");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } })));
  state.run = { id: "r1", projectId: "p1", storyboardId: null, status: "completed", masterMp4Url: M1, qcReport: null, createdAt: new Date(), completedAt: new Date() };
  state.artifacts = [];
  state.blobs = new Map();
  state.failReads = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("live archiving", () => {
  it("is off under vitest unless ARTIFACT_ARCHIVE=on, and off when set to off", () => {
    expect(archivingEnabled({ VITEST: "true" })).toBe(false);
    expect(archivingEnabled({ VITEST: "true", ARTIFACT_ARCHIVE: "on" })).toBe(true);
    expect(archivingEnabled({ ARTIFACT_ARCHIVE: "off" })).toBe(false);
    expect(archivingEnabled({})).toBe(true);
  });

  it("an auto-fix keeps the replaced master: archived before the swap, the new one after", async () => {
    await archiveAround("auto-fix", (o) => archiveRun("r1", { ...o, jobs: false }), async () => {
      // Before-replace ran first: the old master is already on record, URL only (no download).
      expect(state.artifacts.map((a) => [a.sourceKey, a.version, a.url, a.sha256])).toEqual([["run:r1:master", 1, M1, null]]);
      state.run = { ...state.run, masterMp4Url: M2, qcReport: { autofix: { status: "fixed", previousMasterUrl: M1 } } };
    });
    await vi.waitFor(() => expect(state.artifacts.some((a) => a.url === M2)).toBe(true));
    const masters = state.artifacts.filter((a) => a.sourceKey === "run:r1:master").sort((a, b) => (a.version as number) - (b.version as number));
    expect(masters.map((a) => [a.version, a.url])).toEqual([
      [1, M1],
      [2, M2],
    ]);
    // The after-pass downloads: the new master's bytes and sha256 are on record, and the old one is completed.
    await vi.waitFor(() => expect(masters.every((m) => m.sha256 && m.bytes === 3)).toBe(true));
  });

  it("archiving errors never reach the producer", async () => {
    state.failReads = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await archiveAround("run", (o) => archiveRun("r1", o), async () => "written");
    expect(out).toBe("written");
    expect(() => archiveInBackground("sync throw", () => { throw new Error("boom"); })).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
