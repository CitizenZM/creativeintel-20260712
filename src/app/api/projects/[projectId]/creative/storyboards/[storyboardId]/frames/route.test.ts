import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeModel, type FakeModel } from "@/test-utils/fake-rows";

const h = vi.hoisted(() => ({ storyboard: null as unknown as FakeModel }));
vi.mock("@/lib/db", () => ({
  prisma: {
    get storyboard() {
      return h.storyboard;
    },
  },
}));
vi.mock("@/services/artifacts/archive", () => ({
  archiveStoryboard: vi.fn(),
  archiveAround: async (_l: string, _a: unknown, write: () => Promise<unknown>) => write(),
}));

import { PATCH } from "./route";

const frame = (n: number) => ({ frameNumber: n, scene: `scene ${n}`, startSec: (n - 1) * 2, endSec: n * 2 });
const call = (body: unknown, id = "sb1", projectId = "p1") =>
  PATCH(
    new Request("https://x/api", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ projectId, storyboardId: id }) }
  );
const framesOf = () => h.storyboard.rows.get("sb1")!.frames as Array<Record<string, unknown>>;
const historyOf = () => (h.storyboard.rows.get("sb1")!.frameHistory ?? []) as Array<{ frameNumber: number }>;

beforeEach(() => {
  h.storyboard = createFakeModel([{ id: "sb1", projectId: "p1", deletedAt: null, frames: [1, 2, 3, 4].map(frame), frameHistory: null }]);
});

describe("PATCH storyboard frames", () => {
  it("keeps every frame's image when the per-frame PATCHes run in parallel", async () => {
    const res = await Promise.all([1, 2, 3, 4].map((n) => call({ frameNumber: n, imageUrl: `https://img/${n}.png` })));
    expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(framesOf().map((f) => f.imageUrl)).toEqual([1, 2, 3, 4].map((n) => `https://img/${n}.png`));
    // image-only updates never touch the undo history
    expect(historyOf()).toHaveLength(0);
  });

  it("merges onto the CURRENT frames and history when another writer lands between read and write", async () => {
    h.storyboard.onBeforeWrite = (n) => {
      if (n === 0) {
        const frames = framesOf().map((f) => (f.frameNumber === 2 ? { ...f, imageUrl: "https://img/2.png" } : f));
        h.storyboard.concurrentWrite("sb1", { frames, frameHistory: [{ frameNumber: 2, frame: frame(2), editedAt: "t" }] });
      }
    };
    const res = await call({ frameNumber: 1, scene: "new scene 1" });
    expect(res.status).toBe(200);
    expect(framesOf()[0]).toMatchObject({ frameNumber: 1, scene: "new scene 1" });
    expect(framesOf()[1].imageUrl).toBe("https://img/2.png");
    expect(historyOf().map((e) => e.frameNumber)).toEqual([2, 1]);
    const body = await res.json();
    expect(body.frames[1].imageUrl).toBe("https://img/2.png");
  });

  it("records the previous content for a real edit and only for a real edit", async () => {
    await call({ frameNumber: 3, scene: "changed" });
    await call({ frameNumber: 3, scene: "changed" });
    const hist = h.storyboard.rows.get("sb1")!.frameHistory as Array<{ frameNumber: number; frame: { scene: string } }>;
    expect(hist).toHaveLength(1); // the identical second PATCH is not an edit
    expect(hist[0].frame.scene).toBe("scene 3");
  });

  it("404s for an unknown storyboard or frame and 400s for nothing to patch", async () => {
    expect((await call({ frameNumber: 1, scene: "x" }, "nope")).status).toBe(404);
    expect((await call({ frameNumber: 1, scene: "x" }, "sb1", "other-project")).status).toBe(404);
    const missing = await call({ frameNumber: 99, scene: "x" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Frame 99 not found" });
    expect((await call({ frameNumber: 1, bogus: 1 })).status).toBe(400);
    expect(h.storyboard.writes).toBe(0);
  });

  it("404s when the frame disappears between the first read and the write", async () => {
    h.storyboard.onBeforeWrite = null;
    const orig = h.storyboard.findFirst;
    h.storyboard.findFirst = async (a) => {
      const row = await orig(a);
      // the snapshot sees frame 4, then a regenerate drops it before our write
      h.storyboard.concurrentWrite("sb1", { frames: [1, 2, 3].map(frame) });
      return row;
    };
    const res = await call({ frameNumber: 4, scene: "x" });
    expect(res.status).toBe(404);
    expect(framesOf()).toHaveLength(3);
  });
});
