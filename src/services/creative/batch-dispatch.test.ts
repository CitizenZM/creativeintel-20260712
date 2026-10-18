import { describe, expect, it, vi } from "vitest";

const scopeSeen = vi.hoisted(() => ({ value: null as { projectId: string; actorId?: string | null } | null }));
vi.mock("@vercel/queue", () => ({ send: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { job: { findUnique: vi.fn(async () => ({
  id: "job-1", projectId: "project-1", kind: "scripts", status: "queued",
  steps: [{ key: "template-1", label: "Template", status: "queued" }],
  input: { actorId: "member-1", totalDurationSec: 15 },
})) } } }));
vi.mock("@/services/shared-lease", () => ({ acquireSharedSlot: vi.fn(async () => async () => {}) }));
vi.mock("@/app/api/projects/[projectId]/creative/_script-context", () => ({
  loadScriptContext: vi.fn(async () => ({ totalDurationSec: 15 })), auditContext: vi.fn(() => ({})),
}));
vi.mock("@/services/ai/prompts/script-templates", () => ({
  getScriptTemplate: vi.fn((id: string) => ({ id, name: "Template", videoType: "UGC" })),
  isVideoType: vi.fn(() => false),
}));
vi.mock("@/services/creative/batch-workers", () => ({ writeBatchScript: vi.fn(), writeBatchStoryboard: vi.fn() }));
vi.mock("@/services/brand-kit", () => ({ getBrandTruthForPrompts: vi.fn() }));
vi.mock("@/lib/visual-direction", () => ({ renderVisualDirection: vi.fn() }));
vi.mock("@/services/creative-library", () => ({ LIVE: { deletedAt: null } }));
vi.mock("@/services/jobs", () => ({
  failJob: vi.fn(),
  runJobItems: vi.fn(async () => {
    const { currentSpendScope } = await import("@/services/ops/spend-scope");
    const scope = currentSpendScope();
    scopeSeen.value = scope ? { projectId: scope.projectId, actorId: scope.actorId } : null;
    return "completed";
  }),
}));

import { processCreativeBatch } from "./batch-dispatch";

describe("creative batch spend scope", () => {
  it("restores the project and triggering member for queue execution", async () => {
    await processCreativeBatch({ jobId: "job-1" });
    expect(scopeSeen.value).toEqual({ projectId: "project-1", actorId: "member-1" });
  });
});
