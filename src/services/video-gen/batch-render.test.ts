import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("./glm-assemble", () => ({ renderFromRun: vi.fn() }));
vi.mock("./server-executor", () => ({ storyboardFrames: vi.fn() }));

import { runBatchSource } from "./batch-render";
import type { CampaignPlan } from "@/services/creative/campaign-plan.types";

describe("runBatchSource", () => {
  const plan = {
    platforms: [
      {
        platform: "tiktok",
        hookVariants: [
          { hookId: "H09", openingText: "Glare again?" },
          { hookId: "H15", openingText: "0 glare. 0 flicker." },
        ],
        scripts: [
          { hookId: "H09", title: "Glare POV → proof → tap" },
          { hookId: "H15", title: "Zero glare claim → proof → tap" },
        ],
      },
    ],
  } as unknown as CampaignPlan;

  it("finds the master's library hook from the plan script title and the end card on the frames", () => {
    const s = runBatchSource({
      brand: "TCL",
      title: "⚠ Zero glare claim → proof → tap",
      aspectRatio: "9:16",
      durationSec: 20,
      masterHookStyle: "q",
      frames: [{ endCard: null }, { endCard: { id: "E04", data: { button: "Get it" } } }],
      plan,
    });
    expect(s).toMatchObject({ kind: "run", masterHookId: "H15", endCardId: "E04", endCardButton: "Get it", masterDurationSec: 20 });
    expect(s.kind === "run" && s.hookTexts).toEqual({ H09: "Glare again?", H15: "0 glare. 0 flicker." });
  });

  it("works without a plan", () => {
    const s = runBatchSource({ brand: "TCL", title: "x", aspectRatio: "9:16", durationSec: 15, masterHookStyle: "c", frames: [] });
    expect(s).toMatchObject({ masterHookId: null, endCardId: null, masterHookStyle: "c" });
  });
});
