import { describe, expect, it } from "vitest";
import { endCardLayers, endCardSlots, layerFilter } from "./endcard-render";
import { SAFE_BOX } from "@/services/creative/library";

const c = { w: 1080, h: 1920 };

describe("end-card slots", () => {
  it("keep every readable layer inside the strict 9:16 safe box", () => {
    const s = endCardSlots(c);
    for (const y of [s.logo, s.headline, s.main, s.fine, s.button, s.caption]) {
      expect(y * c.h).toBeGreaterThanOrEqual(SAFE_BOX.top);
      expect(y * c.h).toBeLessThanOrEqual(SAFE_BOX.bottom - 50);
    }
    expect(endCardSlots({ w: 1920, h: 1080 }).button).toBe(0.74);
  });
});

describe("endCardLayers", () => {
  it("refuses fact cards without their facts", async () => {
    expect(await endCardLayers("E02", { pct: null }, c)).toBeNull();
    expect(await endCardLayers("E03", { code: " " }, c)).toBeNull();
    expect(await endCardLayers("E04", { price: 999, comparePrice: 899 }, c)).toBeNull();
  });
});

describe("layerFilter", () => {
  it("animates scale on the layer and position on the overlay", () => {
    const pop = layerFilter(5, "pop", 0.4, 12, 15, "[o3]", "[o4]");
    expect(pop[0]).toMatch(/^\[5:v\]format=rgba,scale=w=.*eval=frame\[ly5\]$/);
    expect(pop[1]).toContain("[o3][ly5]overlay=x=(W-w)/2:y='H*0.4-h/2'");
    expect(layerFilter(6, "bob", 0.6, 14, 15, "[o4]", "[o5]")[0]).toContain("abs(sin(2*PI*(t-14.000)))");
  });
});
