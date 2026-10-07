import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: unknown[] = [];
let fail = false;
vi.mock("@/lib/db", () => ({
  prisma: {
    cronHeartbeat: {
      upsert: async (arg: unknown) => {
        if (fail) throw new Error('relation "CronHeartbeat" does not exist');
        calls.push(arg);
        return {};
      },
    },
  },
}));

import { cronHeartbeat } from "./heartbeat";

describe("cronHeartbeat", () => {
  beforeEach(() => {
    calls.length = 0;
    fail = false;
  });

  it("upserts one row per cron with the run time and a run counter", async () => {
    const at = new Date("2026-10-07T12:00:00Z");
    await cronHeartbeat("poll-video-jobs", at);
    expect(calls).toEqual([
      {
        where: { name: "poll-video-jobs" },
        create: { name: "poll-video-jobs", lastRunAt: at, runs: 1 },
        update: { lastRunAt: at, runs: { increment: 1 } },
      },
    ]);
  });

  it("never throws — a heartbeat must not break the cron it reports on", async () => {
    fail = true;
    await expect(cronHeartbeat("hook-variants")).resolves.toBeUndefined();
  });
});
