import { afterEach, describe, expect, it, vi } from "vitest";

const delivery = vi.hoisted(() => ({ runDigestCron: vi.fn() }));
vi.mock("@/services/reports/delivery", () => delivery);

import { GET } from "./route";

const req = (auth?: string) => new Request("https://x/api/cron/report-digest", { headers: auth ? { authorization: auth } : {} });

describe("GET /api/cron/report-digest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delivery.runDigestCron.mockReset();
  });

  it("is guarded like the other cron routes", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL", "1");
    expect((await GET(req())).status).toBe(401);
    expect(delivery.runDigestCron).not.toHaveBeenCalled();
  });

  it("runs the digest cron with the secret and counts statuses", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    delivery.runDigestCron.mockResolvedValue([{ projectId: "a", status: "dry-run" }, { projectId: "b", status: "skipped" }, { projectId: "c", status: "dry-run" }]);
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ projects: 3, counts: { "dry-run": 2, skipped: 1 } });
  });
});
