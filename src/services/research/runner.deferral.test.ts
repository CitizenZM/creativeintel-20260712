import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ feed: vi.fn(), save: vi.fn(), classify: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { project: { findUnique: vi.fn().mockResolvedValue({ id: "p", brandName: "Example", competitors: [], brand: null }) }, campaignSelection: { findUnique: vi.fn().mockResolvedValue(null) } } }));
vi.mock("./website-crawler", () => ({ crawlWebsite: vi.fn(), parseHtml: vi.fn() }));
vi.mock("./browser-fetch", () => ({ fetchViaWorker: vi.fn() }));
vi.mock("@/services/brand-kit", () => ({ refreshCompleteness: vi.fn() }));
vi.mock("./keyword-extractor", () => ({ quickBrandUnderstanding: vi.fn(), extractSearchKeywords: vi.fn() }));
vi.mock("./video-search", () => ({ searchVerifiedVideos: vi.fn().mockResolvedValue({ candidates: [], reports: [] }) }));
vi.mock("./video-relevance", () => ({ classifyAdCandidateGroups: m.classify }));
vi.mock("./adapters/tiktok-creative-center", () => ({ fetchTikTokForYouFeed: m.feed }));
vi.mock("./persist", () => ({ rankAndSaveCandidates: vi.fn() }));
vi.mock("@/services/ai/analysis-pipeline", () => ({ runAnalysisPipeline: vi.fn() }));
vi.mock("./job-progress", () => ({ startStep: vi.fn(), updateStep: vi.fn(), completeStep: vi.fn(), failStep: vi.fn(), recordStepSources: vi.fn(), failJob: vi.fn(), completeJob: vi.fn() }));
import { runResearch } from "./runner";
import { deferWorkerTask, ResearchWaiting, withWorkerDeferral } from "./worker-await";
beforeEach(() => { vi.clearAllMocks(); m.classify.mockResolvedValue({ byKey: new Map(), degraded: false, classifiedCount: 0, calls: 0 }); });
describe("research phase barriers", () => {
 it("checkpoints classification before starting the extra corpus", async () => {
   await withWorkerDeferral(() => runResearch("p", "j", { checkpoint: { phase: "discovery", keywords: { brandKeywords: [], productKeywords: [], categoryKeywords: [], adSearchQueries: [] } }, save: m.save }));
   expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ phase: "extras", candidates: [] }));
   expect(m.feed).not.toHaveBeenCalled();
   expect(m.classify.mock.calls[0][1].deadlineMs).toBeLessThanOrEqual(75_000);
 });
 it("preserves worker tasks discovered by the optional corpus after classification", async () => {
   m.feed.mockImplementation(async () => { deferWorkerTask("extra-feed"); return { candidates: [], report: { name: "feed", status: "pending_worker", count: 0 } }; });
   await expect(withWorkerDeferral(() => runResearch("p", "j", { checkpoint: { phase: "extras", keywords: { brandKeywords: [], productKeywords: [], categoryKeywords: [], adSearchQueries: [] } }, save: m.save }))).rejects.toEqual(new ResearchWaiting(["extra-feed"]));
   expect(m.save).not.toHaveBeenCalled();
   expect(m.classify).not.toHaveBeenCalled();
 });
});
