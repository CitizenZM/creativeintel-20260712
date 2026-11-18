/** A realistic BrainView for demos and render checks: /brain?fixture=1. Times are relative to `now`. */
import type { BrainView } from "@/services/brain/contract";

export function brainFixture(now = Date.now()): BrainView {
  const t = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  return {
    ageSec: 42,
    stale: false,
    snapshot: {
      v: 1,
      at: t(-0.7),
      tickMs: 60_000,
      host: "mac-studio.local",
      stageCounts: { strategy: 1, project: 4, gate: 2, execute: 2, verify: 1, recover: 1, learn: 3 },
      spend: { todayUsd: 7.42, capUsd: 20, autoApprovedTodayUsd: 5.1 },
      worker: { lastSeenAt: t(-0.5), ok: true },
      loops: [
        {
          projectId: "cmfixture0000000000000001", name: "Moneta spring UGC", brand: "Moneta", step: "produce", stage: "execute",
          status: "active", agent: "ad-studio", doing: "Rendering 3 hook variants (Kling 2.5)", nextAction: "Run AI review on variant B",
          nextCheckpointAt: t(12), verifyHow: "Re-read AdStudioRun status = DONE and 3 assets present", waitingOn: null, idleSince: null,
          runs: { active: 2, awaiting: 0, done: 9, failed: 1 }, spendUsd7d: 18.6, lastActivityAt: t(-3),
        },
        {
          projectId: "cmfixture0000000000000002", name: "Levoit air purifier", brand: "Levoit", step: "deliver", stage: "project",
          status: "waiting", agent: "brain", doing: "Delivered 4 ads, waiting for client feedback", nextAction: "Follow up with a new angle",
          nextCheckpointAt: t(60 * 20), verifyHow: "Check share-link comments", waitingOn: "client", idleSince: null,
          runs: { active: 0, awaiting: 0, done: 14, failed: 0 }, spendUsd7d: 6.2, lastActivityAt: t(-60 * 26),
        },
        {
          projectId: "cmfixture0000000000000003", name: "Cosori air fryer", brand: "Cosori", step: "creative", stage: "gate",
          status: "blocked", agent: "brain", doing: "Run would exceed the per-run cap", nextAction: "Ask Barron to raise maxRunUsd or split the run",
          nextCheckpointAt: t(5), verifyHow: "Policy re-read", waitingOn: "budget", idleSince: null,
          runs: { active: 0, awaiting: 1, done: 3, failed: 0 }, spendUsd7d: 2.4, lastActivityAt: t(-45),
        },
        {
          projectId: "cmfixture0000000000000004", name: "Insta360 X5 launch", brand: "Insta360", step: "research", stage: "project",
          status: "idle-defect", agent: "researcher", doing: "Nothing moved for 9h with no legal wait", nextAction: "Restart TikTok CC scrape",
          nextCheckpointAt: t(-30), verifyHow: "New ResearchJob rows", waitingOn: null, idleSince: t(-60 * 9),
          runs: { active: 0, awaiting: 0, done: 1, failed: 2 }, spendUsd7d: 0.8, lastActivityAt: t(-60 * 9),
        },
      ],
      queue: [
        {
          id: "run_q1", projectId: "cmfixture0000000000000003", kind: "generate", title: "Cosori 15s demo, 3 hooks", status: "gated",
          step: null, progress: 0, estUsd: 4.2, actualUsd: null, agent: "brain", updatedAt: t(-6),
          gates: [
            { gate: "budget/run", pass: false, detail: "est $4.20 > maxRunUsd $3.00" },
            { gate: "budget/day", pass: true, detail: "$7.42 + $4.20 ≤ $20" },
            { gate: "brief-complete", pass: true, detail: "hook, product, CTA present" },
          ],
        },
        {
          id: "run_q2", projectId: "cmfixture0000000000000001", kind: "verify", title: "Second check: variant A assets", status: "ready",
          step: null, progress: 0, estUsd: 0, actualUsd: null, agent: "verifier", updatedAt: t(-2),
          gates: [{ gate: "run-done", pass: true, detail: "AdStudioRun DONE" }],
        },
      ],
      executing: [
        {
          id: "run_e1", projectId: "cmfixture0000000000000001", kind: "generate", title: "Moneta hook B — Kling render", status: "running",
          step: "render 2/3", progress: 0.62, estUsd: 2.4, actualUsd: 1.55, gates: [], agent: "ad-studio", updatedAt: t(-1),
        },
        {
          id: "run_e2", projectId: "cmfixture0000000000000001", kind: "plan", title: "Moneta beat map + VO script", status: "verifying",
          step: "ai-review", progress: 0.9, estUsd: 0.3, actualUsd: 0.27, gates: [], agent: "ad-studio", updatedAt: t(-4),
        },
      ],
      checks: [
        {
          runId: "run_c1", projectId: "cmfixture0000000000000002", at: t(-50), pass: true,
          fields: [
            { field: "status", expected: "DONE", actual: "DONE", pass: true, source: "GET /api/projects/…/studio/runs" },
            { field: "assets", expected: "4", actual: "4", pass: true, source: "Blob list" },
            { field: "duration", expected: "15s ±1", actual: "15.2s", pass: true, source: "ffprobe" },
          ],
        },
        {
          runId: "run_c2", projectId: "cmfixture0000000000000004", at: t(-200), pass: false,
          fields: [
            { field: "rows", expected: "> 20", actual: "0", pass: false, source: "ResearchJob.results" },
            { field: "status", expected: "COMPLETE", actual: "FAILED", pass: false, source: "ResearchJob" },
          ],
        },
      ],
      recovery: [
        {
          id: "run_r1", projectId: "cmfixture0000000000000004", kind: "fix", title: "Retry TikTok CC with fresh session", status: "retrying",
          step: "attempt 2/3", progress: 0.3, estUsd: 0, actualUsd: null, gates: [], agent: "researcher", updatedAt: t(-8),
        },
      ],
      incidents: [
        {
          signature: "tiktok-cc:login-wall", kind: "platform", count: 3, firstSeen: t(-60 * 30), lastSeen: t(-200), status: "open",
          runbook: "Re-run aff-login, then retry scrape", sample: "Redirected to /login after 2 pages", runs: ["run_c2", "run_r1"],
        },
        {
          signature: "kling:timeout-600s", kind: "model", count: 1, firstSeen: t(-60 * 50), lastSeen: t(-60 * 50), status: "resolved",
          runbook: "Poll with backoff; cap 15 min", sample: "Task still PROCESSING at 600s", runs: ["run_old"],
        },
      ],
      probes: [
        { name: "db", ok: true, detail: "12ms", at: t(-1) },
        { name: "blob", ok: true, detail: "put/get 340ms", at: t(-1) },
        { name: "kling", ok: true, detail: "balance ok", at: t(-1) },
        { name: "tiktok-cc", ok: false, detail: "login wall", at: t(-1) },
      ],
      patterns: [
        { pattern: "unbounded fetch without timeout", fixedIn: "a1b2c3d", file: "src/services/ai/kling.ts", line: 88, status: "fixed" },
        { pattern: "unbounded fetch without timeout", fixedIn: "a1b2c3d", file: "src/services/research/tiktok.ts", line: 140, status: "open" },
        { pattern: "JSON.parse on model output", fixedIn: "d4e5f6a", file: "src/services/studio/plan.ts", line: 51, status: "fixed" },
      ],
      learnings: [
        {
          id: "l1", at: t(-90), who: "brain", scope: "model:kling-2.5", rule: "Keep hooks ≤ 3s; longer first shots drop AI-review score",
          evidence: ["run_a", "run_b", "run_c"], status: "promoted", promotedTo: "ad-studio prompt", syncedTo: ["AGENT-SWARM-LEARNINGS.md"],
        },
        {
          id: "l2", at: t(-30), who: "verifier", scope: "pipeline:research", rule: "TikTok CC needs a warm session before scraping",
          evidence: ["run_c2"], status: "candidate",
        },
      ],
      events: [
        { at: t(-0.5), agent: "brain", kind: "think", projectId: "cmfixture0000000000000001", summary: "Variant B render 62%, on budget" },
        { at: t(-2), agent: "brain", kind: "decide", projectId: "cmfixture0000000000000003", summary: "Held Cosori run: est $4.20 > per-run cap" },
        { at: t(-4), agent: "ad-studio", kind: "call", projectId: "cmfixture0000000000000001", summary: "POST Kling render hook B" },
        { at: t(-50), agent: "verifier", kind: "check", projectId: "cmfixture0000000000000002", summary: "Second check passed: 4 assets, 15.2s" },
        { at: t(-8), agent: "researcher", kind: "fix", projectId: "cmfixture0000000000000004", summary: "Retrying TikTok CC with fresh login" },
        { at: t(-90), agent: "brain", kind: "learn", summary: "Promoted: keep hooks ≤ 3s" },
        { at: t(-60 * 20), agent: "brain", kind: "wait", projectId: "cmfixture0000000000000002", summary: "Waiting on client feedback (legal wait)" },
      ],
    },
  };
}
