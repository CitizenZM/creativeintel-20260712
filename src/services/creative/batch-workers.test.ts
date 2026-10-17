import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  audit: vi.fn(),
  persist: vi.fn(async (_projectId: string, script: unknown) => script),
  buildInput: vi.fn(() => ({})),
}));

vi.mock("@/services/ai/claude-client", () => ({ analyzeWithClaude: mocks.analyze }));
vi.mock("@/services/ai/prompts/script-writing", () => ({ buildScriptWritingPrompt: () => ({ system: "schema and brand rules", user: "approved source facts" }) }));
vi.mock("@/lib/script-schema", () => ({
  scriptV2Schema: {},
  repairScriptCta: (script: unknown) => script,
  auditScriptClaims: mocks.audit,
}));
vi.mock("@/app/api/projects/[projectId]/creative/_script-context", () => ({
  buildScriptInput: mocks.buildInput,
  persistScript: mocks.persist,
  formatComplianceViolations: (violations: { path: string; reason: string }[]) => violations.map((item) => `[${item.path}] ${item.reason}`).join("\n"),
}));
vi.mock("@/services/ai/storyboard-generator", () => ({ buildStoryboardCreateData: vi.fn() }));
vi.mock("@/services/creative-library", () => ({ createStoryboardVersion: vi.fn() }));

import { scriptRepairRequest, writeBatchScript } from "./batch-workers";

describe("batch script compliance retry", () => {
  beforeEach(() => {
    mocks.analyze.mockReset();
    mocks.audit.mockReset();
    mocks.buildInput.mockClear();
    mocks.persist.mockClear();
  });
  it("reserves enough output for a long non-Latin draft", () => {
    const draft = { title: "产品细节".repeat(1500) } as never;
    expect(scriptRepairRequest("facts", draft, []).maxTokens).toBeGreaterThan(6000);
  });

  it("repairs the actual rejected draft and keeps the approved source context", async () => {
    const draft = { title: "First angle", hook: { text: "Guaranteed results" }, body: [], cta: { text: "Shop now" } };
    const fixed = { ...draft, hook: { text: "See the difference" } };
    mocks.analyze.mockResolvedValueOnce(draft).mockResolvedValueOnce(fixed);
    mocks.audit.mockReturnValueOnce({ ok: false, violations: [{ path: "hook.text", text: "Guaranteed", reason: "forbidden claim" }] })
      .mockReturnValueOnce({ ok: true, violations: [] });

    const result = await writeBatchScript("project-1", {} as never, {} as never, { id: "t1", name: "T1", videoType: "UGC" } as never, 0, {
      angles: [], overrideType: null, totalDurationSec: 15,
    });

    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    const retry = mocks.analyze.mock.calls[1][0] as { userPrompt: string; maxTokens: number };
    expect(retry.userPrompt).toContain("approved source facts");
    expect(retry.userPrompt).toContain(JSON.stringify(draft));
    expect(retry.userPrompt).toContain("[hook.text] forbidden claim");
    expect(retry.maxTokens).toBeLessThan(8000);
    expect(result).toEqual(fixed);
    expect(mocks.buildInput).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ planHookIndex: 0 }));
  });

  it("uses the original batch position after earlier scripts were checkpointed", async () => {
    mocks.analyze.mockResolvedValue({ title: "Third angle" });
    mocks.audit.mockReturnValue({ ok: true, violations: [] });
    await writeBatchScript("project-1", {} as never, {} as never, { id: "t3", name: "T3", videoType: "UGC" } as never, 2, {
      angles: [], overrideType: null, totalDurationSec: 15,
    });
    expect(mocks.buildInput).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ planHookIndex: 2 }));
  });
});
