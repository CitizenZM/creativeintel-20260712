import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { script: { findFirst: mocks.findFirst, update: mocks.update } } }));
vi.mock("@/services/artifacts/archive", () => ({
  archiveScript: vi.fn(),
  archiveAround: async (_label: string, _archive: unknown, update: () => Promise<unknown>) => update(),
}));
vi.mock("@/lib/script-schema", () => ({ auditScriptText: () => ({ ok: true }) }));
vi.mock("@/app/api/projects/[projectId]/creative/_script-context", () => ({
  loadScriptContext: async () => null,
  auditContext: () => ({}),
  formatComplianceViolations: () => "",
}));
vi.mock("@/services/creative-library", () => ({ LIVE: {}, isSelectionStatus: () => true }));
vi.mock("@/lib/auth/route-guard", () => ({ withAccess: (handler: unknown) => handler }));

import { PATCH } from "./route";

const context = { params: Promise.resolve({ projectId: "p1", scriptId: "s1" }) };
const request = (body: object) => new Request("http://localhost/api/projects/p1/creative/scripts/s1", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("script edits", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset().mockResolvedValue({ id: "s1", hookVariants: ["old hook"], ctaVariants: ["old CTA"] });
    mocks.update.mockReset().mockResolvedValue({ id: "s1" });
  });

  it("clears generated scenes and copy options when a human corrects the body", async () => {
    const response = await PATCH(request({ body: "Corrected product facts" }), context);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: expect.objectContaining({
      body: "Corrected product facts",
      scenes: Prisma.DbNull, hook: Prisma.DbNull, bodyBeats: Prisma.DbNull, cta: Prisma.DbNull,
      hookVariants: [], ctaVariants: [], selectedHookIdx: null, selectedCtaIdx: null,
    }) });
  });

  it("keeps structured copy when only the selection changes", async () => {
    const response = await PATCH(request({ selectedHookIdx: 0 }), context);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { selectedHookIdx: 0 } });
  });
});
