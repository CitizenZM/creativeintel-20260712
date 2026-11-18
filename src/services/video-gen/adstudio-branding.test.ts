import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { brandingQuery, cleanBranding } from "./adstudio-branding";
import { endCardData } from "./adstudio-endcard";

describe("typed logo / product / link / coupon", () => {
  it("keeps only valid fields", () => {
    const b = cleanBranding({ logoUrl: "javascript:alert(1)", productImageUrl: "https://x.com/p.png", linkUrl: "  https://brand.com/offer ", couponCode: "glow 20!", couponText: "  20%   off ", headline: "", cta: "Shop now", junk: 1 });
    expect(b).toEqual({ productImageUrl: "https://x.com/p.png", linkUrl: "https://brand.com/offer", couponCode: "GLOW20", couponText: "20% off", cta: "Shop now" });
    expect(cleanBranding(null)).toEqual({});
  });
  it("preview query carries every typed field and is empty when nothing is typed", () => {
    expect(brandingQuery({})).toBe("");
    const q = new URLSearchParams(brandingQuery({ logoUrl: "https://x/l.png", couponCode: "A1", cta: "Go" }).slice(1));
    expect(q.get("logo")).toBe("https://x/l.png"); expect(q.get("code")).toBe("A1"); expect(q.get("cta")).toBe("Go");
  });
  it("end-card data: typed headline, button and link beat the brand kit; coupon rides on the offer", () => {
    const input = { offer: { text: "Kit offer", code: "GLOW20" }, brandKit: { landingUrl: "https://kit.com", ctaOptions: ["Learn more"] }, branding: { headline: "Typed headline", cta: "Claim it", linkUrl: "https://brand.com/offer" } };
    const d = endCardData(input, "brand");
    expect(d.headline).toBe("Typed headline"); expect(d.button).toBe("Claim it"); expect(d.url).toBe("https://brand.com/offer"); expect(d.code).toBe("GLOW20");
    expect(endCardData({ offer: { text: "Kit offer" }, brandKit: { ctaOptions: ["Learn more"] } }, "brand").button).toBe("Learn more");
  });
  it("wiring: panel -> POST -> createBatch -> run input -> preview route and worker", () => {
    expect(readFileSync("src/components/studio/adstudio-panel.tsx", "utf8")).toMatch(/branding: cleanBranding\(brandDraft\)/);
    expect(readFileSync("src/components/studio/adstudio-panel.tsx", "utf8")).toMatch(/branding=\{branding\}/);
    expect(readFileSync("src/components/studio/adstudio-gallery.tsx", "utf8")).toMatch(/brandingQuery\(branding\)/);
    expect(readFileSync("src/components/studio/adstudio-gallery.tsx", "utf8")).toMatch(/MockBrand\.Provider value=\{\{ product: branding\.productImageUrl, logo: branding\.logoUrl/);
    expect(readFileSync("src/components/studio/adstudio-panel.tsx", "utf8")).toMatch(/autoId=\{auto\.hookId\} branding=\{branding\}/);
    expect(readFileSync("src/app/api/projects/[projectId]/studio/adstudio-runs/route.ts", "utf8")).toMatch(/branding: body\.branding/);
    expect(readFileSync("src/services/video-gen/adstudio-queue.ts", "utf8")).toMatch(/cleanBranding\(input\.branding\)[\s\S]*branding \}/);
    expect(readFileSync("src/app/api/projects/[projectId]/studio/adstudio-endcard-preview/route.ts", "utf8")).toMatch(/typed\.logoUrl \?\? look\.logoUrl/);
    expect(readFileSync("workers/adstudio-worker/worker.mjs", "utf8")).toMatch(/logoUrl: br\.logoUrl/);
  });
});
