import { describe, expect, it } from "vitest";
import type { BrainLoop, PatternHit } from "@/services/brain/contract";
import { ageLabel, groupPatterns, pct, projectHref, relTime, sortEvents, sortLoops, staleMessage, usd } from "./brain-format";
import { brainFixture } from "./fixture";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const loop = (name: string, status: BrainLoop["status"], checkpointMin = 0): BrainLoop => ({
  projectId: name, name, brand: null, step: "setup", stage: "project", status, agent: "a", doing: "", nextAction: "",
  nextCheckpointAt: new Date(NOW + checkpointMin * 60_000).toISOString(), verifyHow: "", waitingOn: null, idleSince: null,
  runs: { active: 0, awaiting: 0, done: 0, failed: 0 }, spendUsd7d: 0, lastActivityAt: null,
});

describe("sortLoops", () => {
  it("orders idle-defect, blocked, active, waiting, done", () => {
    const out = sortLoops([loop("d", "done"), loop("w", "waiting"), loop("a", "active"), loop("i", "idle-defect"), loop("b", "blocked")]);
    expect(out.map((l) => l.status)).toEqual(["idle-defect", "blocked", "active", "waiting", "done"]);
  });
  it("breaks ties by soonest checkpoint and does not mutate the input", () => {
    const input = [loop("late", "active", 30), loop("soon", "active", 5)];
    expect(sortLoops(input).map((l) => l.name)).toEqual(["soon", "late"]);
    expect(input[0].name).toBe("late");
  });
});

describe("relTime / ageLabel", () => {
  it.each([
    [0, "now"],
    [5 * 60, "in 5m"],
    [-3 * 3600, "3h ago"],
    [2 * 86_400, "in 2d"],
  ])("%ss → %s", (sec, label) => expect(relTime(new Date(NOW + sec * 1000).toISOString(), NOW)).toBe(label));
  it("handles missing / bad input", () => {
    expect(relTime(null, NOW)).toBe("—");
    expect(relTime("nope", NOW)).toBe("—");
    expect(ageLabel(null)).toBe("—");
  });
  it.each([[42, "42s"], [420, "7m"], [3 * 3600, "3h"], [2 * 86_400, "2d"]])("age %s → %s", (s, l) => expect(ageLabel(s)).toBe(l));
});

describe("usd / pct", () => {
  it("formats money", () => {
    expect(usd(7.423)).toBe("$7.42");
    expect(usd(20)).toBe("$20");
    expect(usd(0)).toBe("$0");
    expect(usd(null)).toBe("—");
  });
  it("accepts 0..1 and 0..100, clamped", () => {
    expect(pct(0.62)).toBe(62);
    expect(pct(45)).toBe(45);
    expect(pct(250)).toBe(100);
    expect(pct(-1)).toBe(0);
  });
});

describe("staleMessage", () => {
  it("flags a missing snapshot and a stale one, not a fresh one", () => {
    expect(staleMessage({ snapshot: null, ageSec: null, stale: true })).toMatch(/brain not reporting/);
    const fresh = brainFixture(NOW);
    expect(staleMessage(fresh)).toBeNull();
    expect(staleMessage({ ...fresh, ageSec: 3600, stale: true })).toMatch(/1h ago/);
  });
});

describe("groupPatterns", () => {
  it("groups by pattern with open/fixed counts, open groups first", () => {
    const hits: PatternHit[] = [
      { pattern: "p1", fixedIn: "x", file: "a.ts", line: 1, status: "fixed" },
      { pattern: "p2", fixedIn: "y", file: "b.ts", line: 2, status: "open" },
      { pattern: "p1", fixedIn: "x", file: "c.ts", line: 3, status: "fixed" },
    ];
    expect(groupPatterns(hits).map((g) => [g.pattern, g.open, g.fixed])).toEqual([["p2", 1, 0], ["p1", 0, 2]]);
  });
});

describe("sortEvents", () => {
  it("puts the newest first", () => {
    const events = brainFixture(NOW).snapshot!.events;
    const sorted = sortEvents(events);
    for (let i = 1; i < sorted.length; i++) expect(Date.parse(sorted[i - 1].at)).toBeGreaterThanOrEqual(Date.parse(sorted[i].at));
  });
});

describe("projectHref", () => {
  it("links server projects and returns null for local/batch ids", () => {
    expect(projectHref("cmabc123")).toBe("/projects/cmabc123");
    expect(projectHref("local:p1")).toBeNull();
    expect(projectHref("batch:b1")).toBeNull();
  });
});
