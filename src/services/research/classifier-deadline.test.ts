import { describe, expect, it, vi } from "vitest";

// The model never answers — as when every free model is rate-limited.
vi.mock("@/services/ai/claude-client", () => ({ analyzeWithClaude: vi.fn(() => new Promise(() => {})) }));

import { classifyAdCandidateGroups } from "./video-relevance";

const candidate = (i: number) =>
  ({
    sourceId: `youtube:v${i}`,
    source: "youtube",
    platform: "youtube",
    format: "video",
    durationSec: 30,
    isPaidAd: false,
    adEvidence: "none",
    title: `TCL QM7L official TV commercial ${i}`,
    channelTitle: "TCL",
    description: "Official TCL QM7L QD-Mini LED TV spot",
    url: `https://youtube.com/watch?v=v${i}`,
  }) as never;

describe("classifyAdCandidateGroups deadline", () => {
  it("scores deterministically instead of waiting past its deadline", async () => {
    const t0 = Date.now();
    const out = await classifyAdCandidateGroups(
      [{ key: "0", candidates: Array.from({ length: 5 }, (_, i) => candidate(i)), ctx: { brandName: "TCL", productName: "QM7L", keywords: { primary: ["TCL"], brandContext: "" } as never } }],
      { deadlineMs: 200 }
    );
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out.degraded).toBe(true);
    expect(out.byKey.get("0")!.length).toBeGreaterThan(0);
  });
});
