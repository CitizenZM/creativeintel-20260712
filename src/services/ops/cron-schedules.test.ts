import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRON_SCHEDULES } from "./health";

// Interval in minutes implied by a cron minute field ("*/10", "4-59/10", "7,37"); null = not a sub-hourly cron.
function intervalMinutes(schedule: string): number | null {
  const [minute, hour] = schedule.split(/\s+/);
  if (hour !== "*") return null;
  const step = minute.match(/\/(\d+)$/);
  if (step) return Number(step[1]);
  const list = minute.split(",").map(Number);
  return list.length > 1 ? 60 / list.length : 60;
}

describe("vercel.json cron cadence", () => {
  const crons: { path: string; schedule: string }[] = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")).crons;

  it("matches the cadence ops-health expects, so heartbeats are not flagged stale", () => {
    for (const { path, schedule } of crons) {
      const name = path.replace("/api/cron/", "");
      const every = intervalMinutes(schedule);
      if (every === null) continue;
      expect({ name, every }).toEqual({ name, every: CRON_SCHEDULES[name] });
    }
  });
});
