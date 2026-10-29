import { describe, expect, it } from "vitest";
import { scriptRepairRequest } from "./script-repair";

describe("scriptRepairRequest", () => {
  it("keeps the rejected creative in the repair prompt with a compact output budget", () => {
    const draft = { title: "Close-up opening", hook: { text: "Guaranteed results" }, body: [], cta: { text: "Shop now" } } as never;
    const repair = scriptRepairRequest("Approved facts", draft, '- [hook.text] "Guaranteed results" — unsupported claim');
    expect(repair.userPrompt).toContain("Approved facts");
    expect(repair.userPrompt).toContain(JSON.stringify(draft));
    expect(repair.userPrompt).toContain("unsupported claim");
    expect(repair.maxTokens).toBe(2500);
  });

  it("reserves space for a long non-Latin draft", () => {
    const draft = { title: "产品细节".repeat(1500) } as never;
    expect(scriptRepairRequest("facts", draft, "").maxTokens).toBeGreaterThan(6000);
  });
});
