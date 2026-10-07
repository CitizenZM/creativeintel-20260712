import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { buildCampaignReportModel, checkNarrative, type CampaignReportModel, type Narrator } from "./campaign-report";
import { renderReportHtml, barChartSvg } from "./report-html";
import { renderReportDocx } from "./report-docx";
import { fixtureReportInputs } from "./__fixtures__/report-fixture";

const NOW = new Date("2026-10-06T09:00:00Z");

/** Read one entry of a zip (stored or deflated) by walking its local file headers. */
function unzipEntry(buf: Buffer, name: string): string {
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8);
    const size = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extra = buf.readUInt16LE(o + 28);
    const entry = buf.subarray(o + 30, o + 30 + nameLen).toString();
    const start = o + 30 + nameLen + extra;
    const data = buf.subarray(start, start + size);
    if (entry === name) return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    o = start + size;
  }
  throw new Error(`${name} not in zip`);
}

/** Every opened tag is closed in order (enough to catch a broken document.xml). */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[\s\S]*?\?>/g, "").matchAll(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

async function model(narrator?: Narrator): Promise<CampaignReportModel> {
  return buildCampaignReportModel(await fixtureReportInputs(), { narrator, now: NOW });
}

describe("buildCampaignReportModel", () => {
  it("collects brief, plan, production, spend, performance and next actions", async () => {
    const m = await model();
    expect(m.project.title).toBe("TCL NXTPAPER 14");
    expect(m.brief?.bigIdea).toBeTruthy();
    expect(m.brief!.sellingPoints.length).toBeGreaterThan(0);
    expect(m.plan!.platforms.map((p) => p.platform)).toEqual(["tiktok", "meta_feed"]);
    expect(m.plan!.platforms[0].hooks.length).toBe(3);
    const [a, b] = m.production.runs;
    expect(a.qc).toMatchObject({ passed: 9, total: 11 });
    expect(a.qc!.failed).toEqual(["Loudness −14 LUFS", "No frozen frames"]);
    expect(a.preflight?.score).toBe(86);
    expect(a.director).toMatchObject({ score: 78, flagged: 1 });
    expect(a.variants.map((v) => v.name)).toEqual(["question", "contrast"]);
    expect(a.keyframes.map((k) => k.node)).toEqual(["K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8"]);
    expect(a.keyframeQc).toEqual({ reviewed: 7, passed: 6, rerolled: 2 });
    expect(b.status).toBe("failed");
    expect(m.production.totals).toMatchObject({ runs: 2, completed: 1, failed: 1, variants: 2 });
    // ledger: open reservations count at their estimate
    expect(m.spend.totalUsd).toBeCloseTo(9 * 0.018 + 5 * 0.238 + 2 * 0.416 + 11 * 0.0042 + 0.0071 + 3 * 0.0091 + 4 * 0.018 + 0.12, 6);
    expect(m.spend.openReservedUsd).toBeCloseTo(0.12, 6);
    expect(m.spend.budgetUsd).toBe(8.5);
    expect(m.spend.byKindLabelled.map((k) => k.label)).toContain("Vision QC & director review");
    expect(m.performance?.hookWinner).toBe("question");
    expect(m.nextActions.some((a) => /Loudness/.test(a))).toBe(true);
    expect(m.nextActions.some((a) => /re-render the 1 shot/.test(a))).toBe(true);
    expect(m.nextActions.some((a) => /question hooks/.test(a))).toBe(true);
  });

  it("tolerates a bare project: no brief, plan, runs, spend or results", async () => {
    const m = await buildCampaignReportModel({ project: { id: "p", name: "Empty", brandName: "Acme" }, runs: [], spend: [] }, { now: NOW });
    expect(m.brief).toBeNull();
    expect(m.plan).toBeNull();
    expect(m.performance).toBeNull();
    expect(m.spend.totalUsd).toBe(0);
    expect(m.nextActions[0]).toMatch(/product brief/);
    expect(m.executiveSummary.source).toBe("template");
    expect(renderReportHtml(m)).toContain("No ad results imported yet");
  });

  it("uses the (mocked) LLM narrative when it cites the model's numbers", async () => {
    const narrator = vi.fn(async ({ user }: { system: string; user: string }) => {
      expect(user).toContain("KEY NUMBERS");
      return "TCL NXTPAPER 14 shipped 1 completed master from 2 runs with 2 hook variants, averaging 82% on master QC. Spend stands at $2.51 against the approved $8.50. Question hooks lead on real results, so the next masters open with them.";
    });
    const base = await model();
    const spent = base.keyNumbers.find((k) => k.key === "spent")!.value;
    narrator.mockImplementationOnce(async () => `TCL NXTPAPER 14 shipped 1 completed master from 2 runs with 2 hook variants, averaging ${base.keyNumbers.find((k) => k.key === "qc")!.value} on master QC. Spend stands at ${spent} against the approved $8.50 budget. Question hooks lead on real results.`);
    const m = await model(narrator);
    expect(narrator).toHaveBeenCalledOnce();
    expect(m.executiveSummary.source).toBe("llm");
    expect(m.executiveSummary.cited).toContain(spent);
  });

  it("rejects a narrative that invents figures, keeping the template summary", async () => {
    const m = await model(async () => "The campaign returned a 340% ROAS on $12,400 of spend, with 2 runs and 1 completed master across 2 hook variants.");
    expect(m.executiveSummary.source).toBe("template");
    expect(m.executiveSummary.note).toMatch(/invented/);
    expect(m.executiveSummary.text).toContain("$8.50");
  });

  it("falls back to the template when the narrator fails", async () => {
    const m = await model(async () => {
      throw new Error("Budget exceeded — refused");
    });
    expect(m.executiveSummary.source).toBe("template");
    expect(m.executiveSummary.note).toMatch(/Budget exceeded/);
  });
});

describe("checkNarrative", () => {
  it("needs three cited numbers and no unknown money or percentages", () => {
    const nums = [{ key: "a", label: "Spent", value: "$1.00" }, { key: "b", label: "Runs", value: "2" }, { key: "c", label: "QC", value: "80%" }];
    expect(checkNarrative("We ran 2 runs, spent $1.00 and scored 80% on the measured QC across the board this week.", nums).ok).toBe(true);
    expect(checkNarrative("We ran 2 runs, spent $1.00 and scored 80% on QC, a 15% lift on the last campaign overall.", nums).ok).toBe(false);
    expect(checkNarrative("We ran 2 runs and spent $1.00 across the campaign so far, with more to come next week.", nums).ok).toBe(false);
  });
});

describe("renderers", () => {
  it("HTML is self-contained, themed light/dark, with tables, SVG charts and keyframe thumbnails", async () => {
    const html = renderReportHtml(await model());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).not.toMatch(/<script|<link /);
    expect((html.match(/<svg /g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('src="https://picsum.photos/seed/nxt-k1/270/480"');
    for (const h of ["Executive summary", "Product brief", "Campaign plan", "Production", "Spend vs budget", "Performance learnings", "Next actions"]) expect(html).toContain(h);
  });

  it("escapes HTML in user content", () => {
    const svg = barChartSvg([{ label: "<b>x</b>", value: 1, display: "1" }], { title: "t&t" });
    expect(svg).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(svg).toContain("t&amp;t");
  });

  it("DOCX is a zip with a well-formed document.xml carrying the report", async () => {
    const buf = await renderReportDocx(await model());
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const xml = unzipEntry(buf, "word/document.xml");
    expect(xml).toContain("Campaign Report");
    expect(xml).toContain("Spend vs budget");
    expect(wellFormed(xml)).toBe(true);
  }, 60_000);

  it.runIf(process.env.WRITE_REPORT_FIXTURE)("writes the fixture report to out/reports/", async () => {
    const m = await model();
    const dir = path.resolve(process.cwd(), "out/reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "fixture-campaign-report.html"), renderReportHtml(m));
    writeFileSync(path.join(dir, "fixture-campaign-report.docx"), await renderReportDocx(m));
    writeFileSync(path.join(dir, "fixture-campaign-report.json"), JSON.stringify(m, null, 2));
  }, 60_000);
});
