import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
const brief = vi.hoisted(() => ({ extractProductBrief: vi.fn(async () => ({ sellingPoints: [{ claim: "a" }, { claim: "b" }] })) }));
vi.mock("@/services/creative/product-brief", () => brief);
const planStore = vi.hoisted(() => ({ createCampaignPlan: vi.fn(async () => ({ platforms: [{ platform: "tiktok" }] })), CampaignPlanError: class extends Error { status = 400; } }));
vi.mock("@/services/creative/campaign-plan.store", () => planStore);

import { defaultAutopilotSteps } from "./steps";
import { AutopilotFatalError, type StepContext } from "./types";
import { MemorySpendLedger, setSpendLedger } from "@/services/ops/budget-guard";

const ctx = (input: StepContext["input"] = {}): StepContext => ({ id: "ap1", input, state: { projectId: "p1" }, deadline: Date.now() + 60_000, now: Date.now, save: async () => undefined });

let ledger: MemorySpendLedger;
beforeEach(() => {
  vi.clearAllMocks();
  ledger = new MemorySpendLedger();
  setSpendLedger(ledger);
  db.project.findUnique.mockResolvedValue({ brandName: "TCL", productName: "QM7", productUrl: "https://x", productPageTitle: "QM7 TV", productPageText: "A bright TV with great contrast and low glare.", productBrief: null, campaignPlan: null });
});
afterEach(() => setSpendLedger(null));

describe("autopilot paid steps before the budget gate", () => {
  it("records the brief's model call in the project's spend ledger", async () => {
    await defaultAutopilotSteps.brief(ctx());
    expect(brief.extractProductBrief).toHaveBeenCalledTimes(1);
    const entries = await ledger.entries({ projectId: "p1" });
    expect(entries).toEqual([expect.objectContaining({ kind: "llm", runId: null })]);
  });

  it("refuses the brief and the plan when the project's budget can't cover them", async () => {
    await ledger.setBudget({ projectId: "p1" }, 0);
    await expect(defaultAutopilotSteps.brief(ctx())).rejects.toThrow(AutopilotFatalError);
    await expect(defaultAutopilotSteps.brief(ctx())).rejects.toThrow(/Budget exceeded/);
    expect(brief.extractProductBrief).not.toHaveBeenCalled();
    await expect(defaultAutopilotSteps.plan(ctx({ goal: "sales" }))).rejects.toThrow(/Budget exceeded/);
    expect(planStore.createCampaignPlan).not.toHaveBeenCalled();
  });
});
