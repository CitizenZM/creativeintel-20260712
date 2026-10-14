import { describe, expect, it } from "vitest";
import { getHookFormulas, getPlatformPlaybook } from "./platform-playbooks";

describe("script platform playbook mapping", () => {
  it("uses Instagram rules for the campaign's Reels and Stories IDs", () => {
    for (const id of ["instagram_reels", "instagram_stories"]) {
      expect(getPlatformPlaybook(id)).toContain("PLATFORM PLAYBOOK — Instagram");
      expect(getHookFormulas(id)).toEqual(getHookFormulas("instagram"));
    }
  });

  it("uses YouTube rules for its specific placements", () => {
    expect(getPlatformPlaybook("youtube_shorts")).toContain("PLATFORM PLAYBOOK — YouTube");
    expect(getHookFormulas("youtube_instream_skippable")).toEqual(getHookFormulas("youtube"));
  });

  it("retains the generic fallback for an unknown platform", () => {
    expect(getPlatformPlaybook("unknown")).toContain("General short-form video");
  });
});
