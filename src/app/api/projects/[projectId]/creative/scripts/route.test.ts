import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  analyze: vi.fn(),
  audit: vi.fn(),
  buildInput: vi.fn((..._args: unknown[]) => ({})),
  persist: vi.fn(async (_projectId: string, script: unknown) => script),
}));

vi.mock("@/lib/db", () => ({ prisma: { script: { count: mocks.count } } }));
vi.mock("@/services/ai/claude-client", () => ({ analyzeWithClaude: mocks.analyze }));
vi.mock("@/services/ai/prompts/script-writing", () => ({ buildScriptWritingPrompt: () => ({ system: "Brand rules", user: "Approved facts" }) }));
vi.mock("@/services/ai/prompts/script-templates", () => ({
  getScriptTemplate: () => ({ id: "ugc", videoType: "UGC" }),
  isVideoType: (value: string) => value === "UGC",
  defaultTemplateBatch: () => [],
}));
vi.mock("@/lib/script-schema", () => ({
  scriptV2Schema: {},
  repairScriptCta: (script: unknown) => script,
  auditScriptClaims: mocks.audit,
}));
vi.mock("@/lib/idempotency", () => ({ withIdempotency: async () => ({ replay: false, commit: vi.fn() }) }));
vi.mock("@/app/api/projects/[projectId]/creative/_script-context", () => ({
  loadScriptContext: async () => ({ campaignPlan: {}, platformId: "tiktok", totalDurationSec: 15 }),
  buildScriptInput: mocks.buildInput,
  persistScript: mocks.persist,
  auditContext: () => ({}),
  formatComplianceViolations: () => '- [hook.text] "Guaranteed" — unsupported claim',
}));
vi.mock("@/services/creative-library", () => ({ LIVE: {}, isSelectionStatus: () => true }));
vi.mock("@/lib/auth/route-guard", () => ({ withAccess: (handler: unknown) => handler }));

import { POST } from "./route";

describe("single script generation", () => {
  beforeEach(() => {
    mocks.count.mockReset();
    mocks.analyze.mockReset();
    mocks.audit.mockReset();
    mocks.buildInput.mockClear();
    mocks.persist.mockClear();
  });

  it("rotates campaign hooks across requests and repairs the rejected draft", async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const draft = { title: "First angle", hook: { text: "Guaranteed results" }, body: [] };
    const corrected = { ...draft, hook: { text: "See the difference" } };
    mocks.analyze.mockResolvedValueOnce(draft).mockResolvedValueOnce(corrected).mockResolvedValueOnce({ title: "Second angle" });
    mocks.audit.mockReturnValueOnce({ ok: false, violations: [{ path: "hook.text", reason: "unsupported claim" }] })
      .mockReturnValue({ ok: true, violations: [] });

    const request = () => new Request("http://localhost/api/projects/p1/creative/scripts", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ templateId: "ugc" }),
    });
    const context = { params: Promise.resolve({ projectId: "p1" }) };
    const first = await POST(request(), context);
    const second = await POST(request(), context);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.buildInput.mock.calls.map(([, options]) => (options as { planHookIndex: number }).planHookIndex)).toEqual([0, 1]);
    const retry = mocks.analyze.mock.calls[1][0] as { userPrompt: string; maxTokens: number };
    expect(retry.userPrompt).toContain(JSON.stringify(draft));
    expect(retry.userPrompt).toContain("unsupported claim");
    expect(retry.maxTokens).toBe(2500);
  });
});
