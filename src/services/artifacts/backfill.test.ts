import { describe, expect, it } from "vitest";
import { rateLimited, runBackfill, type BackfillDeps } from "./backfill";
import { MemoryArtifactStore, type FileFetcher } from "./record";
import type { ProjectSnapshot } from "./collect";

const snap = (id: string, files: string[]): ProjectSnapshot => ({
  project: { id, name: `Project ${id}`, brandName: "B", productBrief: { id } },
  scripts: [],
  storyboards: [],
  runs: files.length
    ? [{ id: `run-${id}`, projectId: id, masterMp4Url: files[0], qcReport: { autofix: { previousMasterUrl: files[1] ?? null }, variants: files.slice(2).map((u, i) => ({ hookStyle: String(i), masterUrl: u })) }, jobs: [] }]
    : [],
  brandAssets: [],
  catalogRuns: [],
  reportDeliveries: [],
  autopilotRuns: [],
});

function deps(projects: ProjectSnapshot[], over: Partial<BackfillDeps> = {}): BackfillDeps & { fetched: string[]; heads: string[]; sleeps: number[] } {
  const fetched: string[] = [];
  const heads: string[] = [];
  const sleeps: number[] = [];
  const fetch: FileFetcher = async (url) => {
    fetched.push(url);
    return url.includes("gone") ? { ok: false, status: 404, error: "HTTP 404" } : { ok: true, status: 200, bytes: 4, sha256: "s".repeat(64), contentType: "video/mp4", data: new Uint8Array(4) };
  };
  return {
    fetched,
    heads,
    sleeps,
    store: new MemoryArtifactStore(),
    async listProjects(after, limit) {
      return projects
        .map((p) => ({ id: p.project.id, name: p.project.name ?? p.project.id }))
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((p) => !after || p.id > after)
        .slice(0, limit);
    },
    async loadSnapshot(id) {
      return projects.find((p) => p.project.id === id) ?? null;
    },
    fetch,
    async head(url) {
      heads.push(url);
      return url.includes("gone") ? { ok: false, status: 404 } : { ok: true, status: 200, bytes: 1000, contentType: "video/mp4" };
    },
    async sleep(ms) {
      sleeps.push(ms);
    },
    ...over,
  };
}

const projects = [snap("p1", ["https://b.blob.vercel-storage.com/m2.mp4", "https://b.blob.vercel-storage.com/m1.mp4", "https://b.blob.vercel-storage.com/gone.mp4"]), snap("p2", []), snap("p3", ["https://b.blob.vercel-storage.com/p3.mp4"])];

describe("runBackfill", () => {
  it("dry run (the default) writes and downloads nothing, and summarizes per project", async () => {
    const d = deps(projects);
    const res = await runBackfill(d, { all: true, headSample: 10 });
    expect(res.dryRun).toBe(true);
    expect((d.store as MemoryArtifactStore).rows).toHaveLength(0);
    expect(d.fetched).toEqual([]);
    const p1 = res.projects.find((p) => p.projectId === "p1")!;
    expect(p1.byKind).toMatchObject({ brief: 1, master: 2, variant: 1, other: 1 });
    expect(p1.wouldCreate).toBe(p1.artifacts);
    expect(p1.broken).toEqual([expect.objectContaining({ url: "https://b.blob.vercel-storage.com/gone.mp4", status: 404 })]);
    expect(p1.headChecked).toBe(3);
    expect(p1.bytesMeasured).toBe(2000);
    expect(res.done).toBe(true);
  });

  it("caps HEAD checks across the whole run", async () => {
    const d = deps(projects);
    const res = await runBackfill(d, { all: true, headSample: 2 });
    expect(d.heads).toHaveLength(2);
    expect(res.totals.headChecked).toBe(2);
  });

  it("a real run stores everything, rate-limits downloads, and a re-run adds nothing", async () => {
    const d = deps(projects);
    const first = await runBackfill(d, { all: true, dryRun: false, downloadIntervalMs: 100 });
    const rows = (d.store as MemoryArtifactStore).rows;
    expect(first.totals.created).toBe(rows.length);
    expect(rows.filter((r) => r.sourceKey === "run:run-p1:master").map((r) => [r.version, r.url])).toEqual([
      [1, "https://b.blob.vercel-storage.com/m1.mp4"],
      [2, "https://b.blob.vercel-storage.com/m2.mp4"],
    ]);
    expect(d.fetched).toHaveLength(4);
    expect(d.sleeps.length).toBeGreaterThanOrEqual(3); // spaced downloads
    const again = await runBackfill(d, { all: true, dryRun: false });
    expect(again.totals.created).toBe(0);
    expect((d.store as MemoryArtifactStore).rows).toHaveLength(rows.length);
  });

  it("is resumable: stops at the project budget with a cursor, and continues from it", async () => {
    const d = deps(projects);
    const a = await runBackfill(d, { all: true, dryRun: false, maxProjects: 2 });
    expect(a.projects.map((p) => p.projectId)).toEqual(["p1", "p2"]);
    expect(a).toMatchObject({ done: false, nextCursor: "p2" });
    const b = await runBackfill(d, { all: true, dryRun: false, after: a.nextCursor });
    expect(b.projects.map((p) => p.projectId)).toEqual(["p3"]);
    expect(b).toMatchObject({ done: true, nextCursor: null });
  });

  it("one project only", async () => {
    const res = await runBackfill(deps(projects), { projectId: "p3" });
    expect(res.projects.map((p) => p.projectId)).toEqual(["p3"]);
  });

  it("needs a project or all", async () => {
    await expect(runBackfill(deps(projects), {})).rejects.toThrow(/projectId or all/);
  });
});

describe("rateLimited", () => {
  it("spaces calls at least the interval apart", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const f = rateLimited(async (x: number) => x * 2, 100, { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
    expect(await f(1)).toBe(2);
    t += 30;
    await f(2);
    await f(3);
    expect(sleeps).toEqual([70, 100]);
  });
});
