/**
 * A fixture project for the campaign report: the TCL NXTPAPER 14 brief, a scaffolded 2-platform plan,
 * two runs (one completed with QC, preflight, director review, variants and keyframes; one failed),
 * a spend ledger against an $8.50 budget, and imported A/B results. No DB, no model calls.
 */
import nxt from "@/services/creative/__fixtures__/nxt-brief.json";
import { planCampaign } from "@/services/creative/campaign-planner";
import { finalizeBrief } from "@/services/creative/product-brief";
import { learn } from "@/services/performance/learn";
import type { SpendEntryRecord } from "@/services/ops/budget-guard";
import type { ReportInputs, ReportJob } from "../campaign-report";

const at = (h: number) => new Date(Date.UTC(2026, 9, 5, h, 0, 0));
const thumb = (n: number) => `https://picsum.photos/seed/nxt-k${n}/270/480`;

export async function fixtureReportInputs(): Promise<ReportInputs> {
  const brief = finalizeBrief(nxt, "tablet_laptop");
  const plan = await planCampaign({
    brief,
    platforms: ["tiktok", "meta_feed"],
    goal: "promo",
    promo: { pct: 20, price: 279.99, comparePrice: 349.97, code: "NXT20" },
    runDate: "2026-10-05T12:00:00Z",
    llm: async () => {
      throw new Error("fixture: no model calls");
    },
    now: at(9),
  });

  const jobs: ReportJob[] = [];
  for (let n = 1; n <= 7; n++) {
    const fail = n === 4;
    jobs.push({ nodeName: `K${n}`, kind: "image", status: "completed", resultUrl: thumb(n), settings: { qcOk: !fail, qcIssues: fail ? ["tablet bezel thicker than reference"] : [], ...(n === 3 || n === 4 ? { qcAttempts: 1 } : {}) } });
    jobs.push({ nodeName: `V${n}`, kind: "video", status: "completed", resultUrl: `https://example.com/clips/V${n}.mp4` });
  }
  jobs.push({ nodeName: "K8", kind: "image", status: "completed", resultUrl: thumb(8), settings: { compositeLocally: true } });

  const qcReport = {
    engine: "edit-v2",
    durationSec: 21,
    passed: 9,
    total: 11,
    checks: [
      { key: "hook", label: "Hook in first 1.5 s", value: 1.2, target: "≤1.5 s", pass: true },
      { key: "loud", label: "Loudness −14 LUFS", value: -16.8, target: "−14 ±1", pass: false },
      { key: "freeze", label: "No frozen frames", value: 1, target: "0", pass: false },
    ],
    cutsSec: [1.2, 2.9, 4.5],
    measuredAt: at(14).toISOString(),
    hookStyle: "q",
    preflight: { score: 86, label: "Preflight" },
    director: { score: 78, summary: "Strong product shots; frame 4 bezel off-model.", shots: [], shotIndexes: [3], reviewedAt: at(15).toISOString() },
    variants: [
      { adName: "TCL_NXTPAPER14_21s_HookQ", hookStyle: "q", hookText: "Still squinting at glare?", masterUrl: "https://example.com/v/q.mp4", previewUrl: null, passed: 9, total: 11, createdAt: at(16).toISOString() },
      { adName: "TCL_NXTPAPER14_21s_HookC", hookStyle: "c", hookText: "Glossy vs paper", masterUrl: "https://example.com/v/c.mp4", previewUrl: null, passed: 10, total: 11, createdAt: at(16).toISOString() },
    ],
  };

  const spend: SpendEntryRecord[] = [];
  let id = 0;
  const add = (runId: string | null, kind: string, model: string, estUsd: number, actualUsd: number | null, n = 1) => {
    for (let i = 0; i < n; i++) spend.push({ id: `s${++id}`, projectId: "proj_tcl", runId, jobId: null, kind, model, estUsd, actualUsd, createdAt: at(10 + (id % 6)) });
  };
  add("run_a", "image", "bytedance-seed/seedream-5-0-flash", 0.018, 0.018, 9);
  add("run_a", "video", "google/veo-3.1-lite", 0.24, 0.238, 5);
  add("run_a", "video", "kwaivgi/kling-v3.0-std", 0.416, 0.416, 2);
  add("run_a", "vision_qc", "google/gemini-2.5-flash", 0.0031, 0.0042, 11);
  add("run_a", "vision_qc", "google/gemini-2.5-flash", 0.0063, 0.0071, 1);
  add(null, "llm", "deepseek/deepseek-v4-pro", 0.013, 0.0091, 3);
  add("run_b", "image", "bytedance-seed/seedream-5-0-flash", 0.018, 0.018, 4);
  add("run_b", "video", "google/veo-3.1-lite", 0.12, null, 1);

  const perfRows = [
    ...Array.from({ length: 3 }, () => ({ hookStyle: "q", impressions: 14000, views3s: 4200, clicks: 168, spend: 42 })),
    ...Array.from({ length: 3 }, () => ({ hookStyle: "c", impressions: 15000, views3s: 3600, clicks: 150, spend: 45 })),
    { hookStyle: "p", impressions: 9000, views3s: 1710, clicks: 63, spend: 27 },
  ];

  return {
    project: { id: "proj_tcl", name: "TCL NXTPAPER 14 — Prime Big Deal Days", brandName: "TCL", productName: "NXTPAPER 14", productUrl: "https://www.amazon.com/dp/B0EXAMPLE", category: "tablet_laptop", budgetUsd: 8.5 },
    brief,
    plan,
    runs: [
      { id: "run_a", status: "completed", executor: "openrouter", imageModel: "Seedream 5 Flash (OpenRouter)", videoModel: "Veo 3.1 Lite 720p (OpenRouter)", createdAt: at(10), completedAt: at(14), isFinal: true, masterMp4Url: "https://example.com/master.mp4", qcReport, approvedBudgetUsd: 6, jobs },
      { id: "run_b", status: "failed", executor: "openrouter", imageModel: "Seedream 5 Flash (OpenRouter)", videoModel: "Veo 3.1 Lite 720p (OpenRouter)", createdAt: at(17), error: "1 job(s) failed: V2 — Budget exceeded — refused before calling the provider", approvedBudgetUsd: 0.2, jobs: [] },
    ],
    spend,
    learning: learn(perfRows),
    performanceTotals: { impressions: perfRows.reduce((s, r) => s + r.impressions, 0), spend: perfRows.reduce((s, r) => s + r.spend, 0), clicks: perfRows.reduce((s, r) => s + r.clicks, 0), conversions: 37 },
  };
}
