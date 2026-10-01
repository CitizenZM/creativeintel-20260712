import { describe, expect, it } from "vitest";
import { missingStyles, variantAdName } from "./variants";

describe("missingStyles", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  it("skips done styles and fresh claims, retries stale claims", () => {
    expect(missingStyles({}, now)).toEqual(["c", "p"]);
    expect(missingStyles({ variants: [{ hookStyle: "c" } as never] }, now)).toEqual(["p"]);
    expect(missingStyles({ variantsPending: { c: "2026-10-01T11:58:00Z" } }, now)).toEqual(["p"]);
    expect(missingStyles({ variantsPending: { c: "2026-10-01T11:40:00Z" } }, now)).toEqual(["c", "p"]);
  });
});

describe("variantAdName", () => {
  it("builds an A/B-ready name", () => {
    expect(variantAdName({ brand: "TCL", title: "TCL QM7L Series TV Comparison", durationSec: 20, hookStyle: "c" })).toBe("TCL_TCLQM7LSeriesTV_20s_HookC");
  });
});
