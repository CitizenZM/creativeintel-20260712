import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemoryArtifactStore, artifactConfig, fingerprintOf, recordArtifact, recordArtifacts, stableStringify, type FileFetcher } from "./record";
import type { ArtifactCandidate } from "./collect";

const P = "proj1";
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

function fetcherFor(files: Record<string, Uint8Array | number>): FileFetcher & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string, o: { keepMaxBytes: number; hashMaxBytes: number }) => {
    calls.push(url);
    const v = files[url];
    if (v === undefined) return { ok: false, status: 404, error: "HTTP 404" };
    if (typeof v === "number") return { ok: true, status: 200, bytes: v, contentType: "video/mp4", truncated: v > o.hashMaxBytes };
    return { ok: true, status: 200, bytes: v.length, sha256: sha(v), contentType: "image/png", data: v.length <= o.keepMaxBytes ? v : undefined };
  }) as FileFetcher & { calls: string[] };
  f.calls = calls;
  return f;
}

const plan = (v: unknown): ArtifactCandidate => ({ kind: "plan", title: "Campaign plan", sourceKey: `project:${P}:campaignPlan`, sourceField: "Project.campaignPlan", content: v });
const master = (url: string): ArtifactCandidate => ({ kind: "master", title: "Master", sourceKey: "run:r1:master", sourceField: "LibtvRun.masterMp4Url", url, runId: "r1" });

describe("recordArtifact", () => {
  it("is idempotent: the same value of a slot is stored once", async () => {
    const store = new MemoryArtifactStore();
    const a = await recordArtifact(store, P, plan({ hooks: ["a"], cta: "Buy" }));
    const b = await recordArtifact(store, P, plan({ cta: "Buy", hooks: ["a"] })); // same value, other key order
    expect(a.action).toBe("created");
    expect(b.action).toBe("exists");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ version: 1, kind: "plan", content: { hooks: ["a"], cta: "Buy" } });
  });

  it("a changed value becomes the next version; earlier versions stay", async () => {
    const store = new MemoryArtifactStore();
    await recordArtifact(store, P, plan({ v: 1 }));
    await recordArtifact(store, P, plan({ v: 2 }));
    await recordArtifact(store, P, plan({ v: 1 })); // back to an archived value: nothing new
    expect(store.rows.map((r) => [r.version, r.content])).toEqual([
      [1, { v: 1 }],
      [2, { v: 2 }],
    ]);
  });

  it("keeps the bytes of small files and only the metadata of large ones", async () => {
    const small = new Uint8Array([1, 2, 3, 4]);
    const fetch = fetcherFor({ "https://b/small.png": small, "https://b/big.mp4": 50_000_000 });
    const store = new MemoryArtifactStore();
    await recordArtifacts(store, P, [{ ...master("https://b/big.mp4") }, { kind: "keyframe", title: "K1", sourceKey: "job:j1:result", sourceField: "LibtvJob.resultUrl", url: "https://b/small.png" }], { fetch, blobMaxBytes: 10, hashMaxBytes: 1_000 });
    const big = store.rows.find((r) => r.url === "https://b/big.mp4")!;
    const img = store.rows.find((r) => r.url === "https://b/small.png")!;
    expect(big).toMatchObject({ bytes: 50_000_000, sha256: null, contentType: "video/mp4" });
    expect(store.blobs.has(big.id)).toBe(false);
    expect(img).toMatchObject({ bytes: 4, sha256: sha(small), contentType: "image/png" });
    expect(store.blobs.get(img.id)).toEqual(small);
  });

  it("archives the old master before a new one replaces it: two versions of the master slot", async () => {
    const store = new MemoryArtifactStore();
    await recordArtifact(store, P, master("https://b/m1.mp4"));
    await recordArtifact(store, P, master("https://b/m2.mp4"));
    await recordArtifact(store, P, master("https://b/m2.mp4"));
    expect(store.rows.filter((r) => r.sourceKey === "run:r1:master").map((r) => [r.version, r.url])).toEqual([
      [1, "https://b/m1.mp4"],
      [2, "https://b/m2.mp4"],
    ]);
  });

  it("fills in bytes and sha256 of a row first recorded without a download", async () => {
    const store = new MemoryArtifactStore();
    const img = new Uint8Array([9, 9]);
    await recordArtifact(store, P, master("https://b/m.png"));
    expect(store.rows[0].sha256).toBeNull();
    const res = await recordArtifact(store, P, master("https://b/m.png"), { fetch: fetcherFor({ "https://b/m.png": img }) });
    expect(res.action).toBe("enriched");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ sha256: sha(img), bytes: 2 });
    expect(store.blobs.get(store.rows[0].id)).toEqual(img);
    // Already complete: no second download.
    const fetch = fetcherFor({ "https://b/m.png": img });
    expect((await recordArtifact(store, P, master("https://b/m.png"), { fetch })).action).toBe("exists");
    expect(fetch.calls).toEqual([]);
  });

  it("records a broken URL without bytes (and says so)", async () => {
    const store = new MemoryArtifactStore();
    const res = await recordArtifact(store, P, master("https://b/gone.mp4"), { fetch: fetcherFor({}) });
    expect(res.action).toBe("created");
    expect(store.rows[0]).toMatchObject({ url: "https://b/gone.mp4", bytes: null, meta: expect.objectContaining({ fetchError: "HTTP 404" }) });
  });

  it("stores bytes in hand (a generated DOCX) and dedupes on a value without the timestamp", async () => {
    const store = new MemoryArtifactStore();
    const docx = (t: string): ArtifactCandidate => ({ kind: "report", title: "Report (DOCX)", sourceKey: `project:${P}:report:docx`, sourceField: "report?format=docx", data: new TextEncoder().encode(`docx ${t}`), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", dedupeValue: { spend: 10 } });
    await recordArtifact(store, P, docx("10:00"));
    await recordArtifact(store, P, docx("10:05"));
    expect(store.rows).toHaveLength(1);
    expect(store.blobs.get(store.rows[0].id)).toEqual(new TextEncoder().encode("docx 10:00"));
  });

  it("decodes data: URLs locally instead of fetching", async () => {
    const store = new MemoryArtifactStore();
    const fetch = fetcherFor({});
    await recordArtifact(store, P, { kind: "logo", title: "Logo", sourceKey: "brandAsset:a1", sourceField: "BrandAsset.url", url: "data:image/png;base64,AQID" }, { fetch });
    expect(fetch.calls).toEqual([]);
    expect(store.rows[0]).toMatchObject({ bytes: 3, contentType: "image/png", url: null });
    expect(store.blobs.get(store.rows[0].id)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("dry run writes nothing but numbers versions as it would", async () => {
    const store = new MemoryArtifactStore();
    const fetch = fetcherFor({ "https://b/m1.mp4": 10 });
    const res = await recordArtifacts(store, P, [master("https://b/m1.mp4"), master("https://b/m2.mp4")], { dryRun: true, fetch });
    expect(res.items.map((i) => [i.action, i.version])).toEqual([
      ["would-create", 1],
      ["would-create", 2],
    ]);
    expect(store.rows).toHaveLength(0);
    expect(fetch.calls).toEqual([]);
  });

  it("retries a slot taken by a concurrent writer", async () => {
    const store = new MemoryArtifactStore();
    const create = store.create.bind(store);
    let raced = false;
    vi.spyOn(store, "create").mockImplementation(async (row, blob) => {
      if (!raced) {
        raced = true;
        await create({ ...row, fingerprint: "other-writer" }, null); // someone else took version 1
      }
      return create(row, blob);
    });
    const res = await recordArtifact(store, P, plan({ v: 1 }));
    expect(res).toMatchObject({ action: "created", version: 2 });
  });

  it("throttles a slot that just got a version when asked to", async () => {
    const store = new MemoryArtifactStore();
    const now = new Date("2026-10-08T10:00:00Z");
    await recordArtifact(store, P, plan({ v: 1 }), { now: () => now });
    const res = await recordArtifact(store, P, { ...plan({ v: 2 }), minIntervalMs: 60_000 }, { now: () => new Date(now.getTime() + 1_000) });
    expect(res.action).toBe("throttled");
  });
});

describe("fingerprints and config", () => {
  it("stable JSON ignores key order", () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(fingerprintOf({ kind: "plan", title: "", sourceKey: "k", sourceField: "f", content: { a: 1, b: 2 } })).toBe(fingerprintOf({ kind: "plan", title: "", sourceKey: "k", sourceField: "f", content: { b: 2, a: 1 } }));
  });
  it("a file is identified by its URL", () => {
    expect(fingerprintOf(master("https://b/x.mp4"))).toBe(sha("url\nhttps://b/x.mp4"));
  });
  it("the blob threshold is configurable", () => {
    expect(artifactConfig({}).blobMaxBytes).toBe(2 * 1024 * 1024);
    expect(artifactConfig({ ARTIFACT_BLOB_MAX_BYTES: "500000" }).blobMaxBytes).toBe(500_000);
    expect(artifactConfig({ ARTIFACT_BLOB_MAX_BYTES: "nope" }).blobMaxBytes).toBe(2 * 1024 * 1024);
  });
});
