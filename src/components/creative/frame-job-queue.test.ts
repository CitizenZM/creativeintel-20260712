import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_FRAME_JOBS, runFrameJob } from "./frame-job-queue";

describe("runFrameJob", () => {
  it("never runs more than the limit at once and finishes every job", async () => {
    let running = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        runFrameJob(async () => {
          peak = Math.max(peak, ++running);
          await new Promise((r) => setTimeout(r, 2));
          running--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(MAX_FRAME_JOBS);
    expect(results).toHaveLength(12);
  });

  it("keeps going after a job fails", async () => {
    await expect(runFrameJob(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(runFrameJob(async () => "ok")).resolves.toBe("ok");
  });
});

describe("page wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("opening the creative page does not generate images by itself", () => {
    const page = read("src/app/projects/[projectId]/creative/page.tsx");
    expect(page).not.toMatch(/autoLoad=\{true\}/);
    expect(page).toMatch(/autoLoad=\{autoGenerateBoards\.has\(storyboard\.id\)\}/);
  });

  it("frame requests go through the queue", () => {
    expect(read("src/components/creative/storyboard-frame-card.tsx")).toMatch(/runFrameJob\(\(\) => fetch\(`\/api\/projects\/\$\{projectId\}\/studio\/frames`/);
  });

  it("the content page does not prefetch its filter, sort and asset links", () => {
    const page = read("src/app/projects/[projectId]/content/page.tsx");
    const links = page.match(/<Link\s+[^>]*?>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain("prefetch={false}");
  });
});
