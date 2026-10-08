import { describe, expect, it } from "vitest";
import { formatBytes, groupHistory } from "./history-view";

const item = (id: string, kind: string, sourceKey: string, version: number, createdAt: string) => ({ id, kind, sourceKey, version, createdAt, producedAt: null });

describe("groupHistory", () => {
  it("groups by kind (archive order), then slot, newest version first", () => {
    const g = groupHistory([
      item("1", "master", "run:a:master", 1, "2026-10-01T00:00:00Z"),
      item("2", "master", "run:a:master", 2, "2026-10-03T00:00:00Z"),
      item("3", "brief", "project:p:productBrief", 1, "2026-09-01T00:00:00Z"),
      item("4", "master", "run:b:master", 1, "2026-10-02T00:00:00Z"),
    ]);
    expect(g.map((x) => [x.kind, x.count])).toEqual([
      ["brief", 1],
      ["master", 3],
    ]);
    expect(g[1].slots.map((s) => [s.sourceKey, s.latest.id, s.versions.map((v) => v.version)])).toEqual([
      ["run:a:master", "2", [2, 1]],
      ["run:b:master", "4", [1]],
    ]);
    expect(g[1].label).toBe("Masters");
  });
  it("formats sizes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
