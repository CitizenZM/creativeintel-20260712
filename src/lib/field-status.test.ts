import { describe, expect, it } from "vitest";
import { fieldStatus, hasValue, readStatusMap } from "./field-status";

describe("fieldStatus", () => {
  it("is missing when empty regardless of the mark", () => {
    expect(fieldStatus("", "confirmed")).toBe("missing");
    expect(fieldStatus([], "suggested")).toBe("missing");
    expect(fieldStatus({ height: 0, width: null }, undefined)).toBe("missing");
  });

  it("is suggested only while marked suggested", () => {
    expect(fieldStatus("Shop now", "suggested")).toBe("suggested");
    expect(fieldStatus("Shop now", "confirmed")).toBe("confirmed");
  });

  it("treats filled values with no mark as the user's own", () => {
    expect(fieldStatus(["#000"], undefined)).toBe("confirmed");
    expect(fieldStatus({ height: 12 }, null)).toBe("confirmed");
  });
});

describe("hasValue / readStatusMap", () => {
  it("handles nested and odd input", () => {
    expect(hasValue({ a: "", b: [" "] })).toBe(false);
    expect(hasValue({ a: "", b: ["x"] })).toBe(true);
    expect(readStatusMap({ a: "suggested", b: "bogus", c: "confirmed" })).toEqual({ a: "suggested", c: "confirmed" });
    expect(readStatusMap(null)).toEqual({});
  });
});
