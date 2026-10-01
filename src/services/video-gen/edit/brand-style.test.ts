import { describe, expect, it } from "vitest";
import { luminance, pickColors, pickCta } from "./brand-style";

describe("pickColors", () => {
  it("uses a readable accent for highlights and the button; keeps yellow when the accent is too dark to read", () => {
    const tcl = pickColors([{ hex: "#000000", usage: "primary" }, { hex: "#0073E6", usage: "accent" }]);
    expect(tcl.button).toBe("#0073E6");
    expect(tcl.buttonText).toBe("#FFFFFF");
    expect(tcl.highlight).toBe("#FFD400"); // #0073E6 is too dark for text over footage
    const lime = pickColors([{ hex: "#C8F000", usage: "accent" }]);
    expect([lime.highlight, lime.buttonText, lime.offerText]).toEqual(["#C8F000", "#111111", "#111111"]);
    expect(pickColors([]).highlight).toBe("#FFD400");
  });
  it("computes luminance", () => {
    expect(luminance("#FFFFFF")).toBeCloseTo(1);
    expect(luminance("#000000")).toBeCloseTo(0);
  });
});

describe("pickCta", () => {
  it("skips a CTA that names another brand and long lines", () => {
    const opts = [
      { text: "Get Your Ramp Card", priority: 1 },
      { text: "Apply now and start saving on every purchase today", priority: 2 },
      { text: "Start Saving", priority: 3 },
    ];
    expect(pickCta(opts, "TCL", ["Ramp", "a16z", "TCL"])).toBe("Start Saving");
    expect(pickCta([], "TCL")).toBe("Shop now");
  });
});
