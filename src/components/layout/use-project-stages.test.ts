import { describe, expect, it } from "vitest";
import { stageForPath } from "./use-project-stages";

describe("stageForPath", () => {
  it("maps both id and slug URLs to their stage", () => {
    expect(stageForPath("/projects/cmuh7v865000204l6hekri9c5/overview", "cmuh7v865000204l6hekri9c5")).toBe("setup");
    expect(stageForPath("/projects/plaud-cmuh7v865000204l6hekri9c5/overview", "cmuh7v865000204l6hekri9c5")).toBe("setup");
    expect(stageForPath("/projects/x/content", "x")).toBe("research");
    expect(stageForPath("/projects/x/research", "x")).toBe("research");
    expect(stageForPath("/projects/x/competitors", "x")).toBe("insights");
    expect(stageForPath("/projects/x/deliver", "x")).toBe("deliver");
  });

  it("returns null off the pipeline", () => {
    expect(stageForPath("/projects/x/library", "x")).toBeNull();
    expect(stageForPath("/status", "x")).toBeNull();
  });
});
