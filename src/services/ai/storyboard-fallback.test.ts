import { describe, expect, it, vi } from "vitest";

// Every prisma lookup returns nothing; the AI call fails as if every model were busy.
vi.mock("@/lib/db", () => {
  const model = new Proxy({}, { get: () => vi.fn(async () => null) });
  return { prisma: new Proxy({}, { get: () => model }) };
});
vi.mock("./claude-client", () => ({
  analyzeWithClaude: vi.fn(async () => {
    throw Object.assign(new Error("429 该模型当前访问量过大"), { status: 429 });
  }),
}));

import { buildStoryboardCreateData, SCRIPT_BUILT_STYLE } from "./storyboard-generator";
import { buildManualScript } from "@/lib/manual-script";

describe("storyboard Plan B", () => {
  it("builds a full, editable board from the script when the AI is unavailable", async () => {
    const s = buildManualScript({
      title: "TCL QM7L",
      hook: "Your living room just became a cinema.",
      lines: ["Wide shot of the TV on a living-room wall | Brighter than any TV you've owned.", "Close-up of a football match"],
      cta: "Shop the QM7L today",
      totalDurationSec: 30,
    });
    const data = await buildStoryboardCreateData(
      "p1",
      { id: "s1", title: s.title, body: s.body, hook: s.hook, bodyBeats: s.bodyBeats, cta: s.cta, totalDurationSec: 30, template: "MANUAL", hookVariants: [], ctaVariants: [] } as never,
      { brandName: "TCL", productName: "QM7L" } as never,
      null
    );
    const frames = data.frames as unknown as { frameNumber: number; scene: string; voiceover: string; segment: string }[];
    expect(data.style).toBe(SCRIPT_BUILT_STYLE);
    expect(frames).toHaveLength(15);
    expect(frames[0].segment).toBe("HOOK");
    expect(frames[0].voiceover).toMatch(/cinema/);
    expect(frames.at(-1)!.segment).toBe("CTA");
    expect(frames.every((f) => f.scene.length > 0)).toBe(true);
  });
});
