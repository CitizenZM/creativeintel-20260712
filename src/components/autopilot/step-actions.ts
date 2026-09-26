/**
 * The AI action behind every pipeline check. Each one runs the real work the
 * user would otherwise start by hand (research, analysis, scripts, …) through
 * the existing API routes, reports progress while it runs, and leaves the
 * result for the user to confirm or edit.
 */
import { STYLE_CATEGORIES, isGoalType, isRecommendedFor } from "@/lib/style-categories";
import { engineLabel, isServerEngine } from "@/services/video-gen/libtv-pricing";
import { isFlaggedScript, pickBestScript } from "@/lib/script-pick";

export interface ActionProgress {
  percent: number | null;
  etaSeconds: number | null;
  message: string;
}

export interface StepAction {
  /** Button label. */
  label: string;
  /** What the user sees before running it: what's missing and what the AI will do. */
  explain: string;
  /** Runs automatically when the user arrives at the step. */
  auto: boolean;
  run: (projectId: string, onProgress: (p: ActionProgress) => void) => Promise<string>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: init?.json !== undefined ? { "Content-Type": "application/json" } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type JobView = {
  status: string;
  percent: number;
  etaSeconds: number | null;
  currentStep: string | null;
  error: string | null;
  done: number;
  total: number;
};

/** Start (or join) a background job and poll it to the end. */
async function runJob(
  projectId: string,
  kind: string,
  url: string,
  body: Record<string, unknown>,
  onProgress: (p: ActionProgress) => void,
  label: string
): Promise<JobView> {
  const active = await api<{ job?: { id: string } | null }>(`/api/projects/${projectId}/jobs?kind=${kind}&active=1`).catch(
    () => ({ job: null })
  );
  let jobId = active.job?.id;
  if (!jobId) {
    const started = await api<{ jobId?: string }>(url, { json: { ...body, background: true } });
    jobId = started.jobId;
  }
  if (!jobId) throw new Error(`${label} did not start`);
  for (;;) {
    const { job } = await api<{ job: JobView }>(`/api/projects/${projectId}/jobs/${jobId}`);
    onProgress({
      percent: job.percent ?? null,
      etaSeconds: job.etaSeconds ?? null,
      message: job.currentStep ? `${label} — ${job.currentStep}` : label,
    });
    if (["completed", "failed", "cancelled"].includes(job.status)) {
      if (job.status !== "completed") throw new Error(job.error || `${label} ${job.status}`);
      return job;
    }
    await wait(2000);
  }
}

/** Start (or join) competitor research and poll it to the end. */
async function runResearch(projectId: string, onProgress: (p: ActionProgress) => void): Promise<void> {
  await api(`/api/projects/${projectId}/research`, { json: {} });
  for (;;) {
    await wait(3000);
    const s = await api<{ status: string; progress?: number; etaSeconds?: number | null; currentStep?: string; error?: string | null }>(
      `/api/projects/${projectId}/research/status`
    );
    onProgress({
      percent: s.progress ?? null,
      etaSeconds: s.etaSeconds ?? null,
      message: `Researching competitor ads — ${s.currentStep ?? "starting"}`,
    });
    if (s.status !== "running" && s.status !== "pending") {
      if (s.status === "error") throw new Error(s.error || "Research stopped");
      return;
    }
  }
}

type ScriptRow = { id: string; title: string; status: string; predictedScore: number | null; deletedAt?: string | null };
type BoardRow = { id: string; scriptId: string | null; isActive: boolean; frames: unknown };

async function selectedScripts(projectId: string): Promise<ScriptRow[]> {
  const all = await api<ScriptRow[]>(`/api/projects/${projectId}/creative/scripts`);
  return all.filter((s) => s.status === "selected" && !s.deletedAt);
}

async function activeBoardFor(projectId: string, scriptId: string): Promise<BoardRow | null> {
  const boards = await api<BoardRow[]>(`/api/projects/${projectId}/creative/storyboards`);
  return boards.find((b) => b.scriptId === scriptId && b.isActive) ?? boards.find((b) => b.scriptId === scriptId) ?? null;
}

// ─── the registry ───────────────────────────────────────────────────────────

const researchWithMoreCompetitors: StepAction["run"] = async (projectId, onProgress) => {
  onProgress({ percent: null, etaSeconds: 20, message: "Finding competitors that advertise in your category…" });
  const { added } = await api<{ added: { name: string }[] }>(`/api/projects/${projectId}/competitors/suggest`, { json: {} });
  await runResearch(projectId, onProgress);
  return added.length
    ? `Added ${added.map((a) => a.name).join(", ")} (suggested — remove any that don't fit) and researched their ads.`
    : "Research finished.";
};

export const STEP_ACTIONS: Record<string, StepAction> = {
  "setup.goal": {
    label: "Suggest it",
    explain: "The campaign goal steers every script. The AI drafts one from your product page — edit it if needed.",
    auto: false,
    run: async (projectId) => {
      await api(`/api/projects/${projectId}/setup-suggest`, { json: {} });
      return "Drafted a campaign goal — check the yellow field.";
    },
  },
  "setup.goalType": {
    label: "Suggest it",
    explain: "Pick storytelling, conversion or hybrid. The AI proposes one from your goal.",
    auto: false,
    run: async (projectId) => {
      await api(`/api/projects/${projectId}/setup-suggest`, { json: {} });
      return "Suggested an ad mix — check the yellow choice.";
    },
  },
  "setup.brandKit": {
    label: "Fill it with AI",
    explain: "Logo, packshots, colours, CTAs and claims are read from your site and drafted by the AI; you confirm them.",
    auto: false,
    run: async (projectId) => {
      const r = await api<{ suggested?: { fields: string[]; packshots: number; logo: boolean }; aiError?: string | null }>(
        `/api/projects/${projectId}/brand-kit/suggest`,
        { json: {} }
      );
      if (r.aiError) throw new Error(`The AI couldn't draft suggestions (${r.aiError})`);
      const n = (r.suggested?.fields.length ?? 0) + (r.suggested?.packshots ?? 0) + (r.suggested?.logo ? 1 : 0);
      return n ? `Pre-filled ${n} Brand Kit item(s) — confirm the yellow fields.` : "Nothing left to pre-fill — add the red items yourself.";
    },
  },
  "research.run": {
    label: "Run research",
    explain: "Collects competitor ads from YouTube, Meta, TikTok and Google ad libraries and ranks them.",
    auto: true,
    run: async (projectId, onProgress) => {
      await runResearch(projectId, onProgress);
      return "Research finished — the ranked ads are below.";
    },
  },
  "research.competitors": {
    label: "Find competitors with AI",
    explain: "You need at least 3 competitors. The AI proposes the brands that actually advertise against you, then researches their ads.",
    auto: true,
    run: researchWithMoreCompetitors,
  },
  "research.coverage": {
    label: "Research them",
    explain: "Competitors added since the last run haven't been searched yet. Re-running research collects their ads.",
    auto: true,
    run: async (projectId, onProgress) => {
      await runResearch(projectId, onProgress);
      return "Researched every competitor — their ads are below.";
    },
  },
  "research.ads": {
    label: "Find more ads",
    explain: "Adds two more competitors and researches their ads to reach at least 10.",
    auto: true,
    run: async (projectId, onProgress) => {
      await api(`/api/projects/${projectId}/competitors/suggest`, { json: { count: 2 } });
      await runResearch(projectId, onProgress);
      return "Researched more competitors' ads.";
    },
  },
  "research.paid": {
    label: "Find paid ads",
    explain: "Paid ads come from the ad libraries. The AI adds competitors that run paid video and re-runs research.",
    auto: false,
    run: async (projectId, onProgress) => {
      await api(`/api/projects/${projectId}/competitors/suggest`, { json: { count: 2 } });
      await runResearch(projectId, onProgress);
      return "Re-ran research with more advertisers.";
    },
  },
  "insights.analyze": {
    label: "Analyse the ads",
    explain: "The AI tears down every top competitor ad — hook, offer, CTA, pacing — so scripts are written against what works.",
    auto: true,
    run: async (projectId, onProgress) => {
      const job = await runJob(projectId, "analysis", `/api/projects/${projectId}/insights/reanalyze`, { force: true }, onProgress, "Analysing competitor ads");
      return `Analysis finished${job.total ? ` (${job.done}/${job.total} steps)` : ""} — insights are below.`;
    },
  },
  "insights.style": {
    label: "Pick for me",
    explain: "Choose the ad styles to write. The AI picks the ones that fit your goal — change them if you like.",
    auto: true,
    run: async (projectId) => {
      const project = await api<{ goalType?: string | null }>(`/api/projects/${projectId}`);
      const goal = isGoalType(project.goalType) ? project.goalType : null;
      const picks = STYLE_CATEGORIES.filter((c) => isRecommendedFor(c, goal)).slice(0, 2).map((c) => c.id);
      await api(`/api/projects/${projectId}/campaign-selection`, { method: "PATCH", json: { styleCategories: picks, suggested: true } });
      const names = STYLE_CATEGORIES.filter((c) => picks.includes(c.id)).map((c) => c.label);
      return `Picked ${names.join(" + ")} for a ${goal ?? "hybrid"} campaign — change it in the style picker.`;
    },
  },
  "insights.picks": {
    label: "Pick the strongest",
    explain: "Scripts are built from the selling points and patterns you send. The AI finds them and sends the strongest ones.",
    auto: true,
    run: async (projectId, onProgress) => {
      type Row = { id: string; dismissed?: boolean };
      type InsightsData = { sellingPoints: Row[]; patterns: Row[]; insights: { general: Row[] } };
      const load = () => api<InsightsData>(`/api/projects/${projectId}/insights`);
      let data = await load();
      // Selling points and patterns come from the full analysis; run it first
      // when research's quick pass didn't produce them.
      if (!data.sellingPoints.length && !data.patterns.length) {
        await runJob(projectId, "analysis", `/api/projects/${projectId}/insights/reanalyze`, { force: true }, onProgress, "Finding selling points and patterns");
        data = await load();
      }
      const sp = data.sellingPoints.filter((x) => !x.dismissed).slice(0, 3).map((x) => x.id);
      const pt = data.patterns.filter((x) => !x.dismissed).slice(0, 2).map((x) => x.id);
      const url = `/api/projects/${projectId}/insights/selection`;
      if (sp.length) await api(url, { method: "PATCH", json: { kind: "sellingPoint", ids: sp, selected: true } });
      if (pt.length) await api(url, { method: "PATCH", json: { kind: "pattern", ids: pt, selected: true } });
      if (sp.length || pt.length) {
        return `Sent ${sp.length} selling point(s) and ${pt.length} pattern(s) to scripts — untick any you disagree with.`;
      }
      const ins = data.insights.general.slice(0, 2).map((x) => x.id);
      if (!ins.length) throw new Error("The analysis found nothing to send yet — add a selling point by hand below.");
      await api(url, { method: "PATCH", json: { kind: "insight", ids: ins, selected: true } });
      return `Sent the ${ins.length} strongest insight(s) to scripts — change them below.`;
    },
  },
  "creative.scripts": {
    label: "Write scripts",
    explain: "The AI writes three scripts from your picks, each in a different template.",
    auto: true,
    run: async (projectId, onProgress) => {
      const job = await runJob(projectId, "scripts", `/api/projects/${projectId}/creative/scripts-batch`, { count: 3 }, onProgress, "Writing scripts");
      return `Wrote ${job.done || "the"} script(s) — review them below.`;
    },
  },
  "creative.select": {
    label: "Pick the best",
    explain: "Choose which scripts go to production. The AI selects the highest-scoring one.",
    auto: true,
    run: async (projectId) => {
      const all = await api<ScriptRow[]>(`/api/projects/${projectId}/creative/scripts`);
      const live = all.filter((s) => !s.deletedAt);
      if (!live.length) throw new Error("No scripts yet — write scripts first.");
      const best = pickBestScript(live);
      await api(`/api/projects/${projectId}/creative/scripts`, { method: "PATCH", json: { ids: [best.id], status: "selected" } });
      const why = isFlaggedScript(best)
        ? "every script still has a compliance warning — fix the flagged lines before producing it"
        : "highest predicted score among scripts that passed the compliance check";
      return `Selected "${best.title}" (${why}) — select others too if you want.`;
    },
  },
  "creative.approve": {
    label: "Draft the storyboard",
    explain: "Each selected script needs a storyboard whose frames you approve. The AI drafts it; approving is yours.",
    auto: true,
    run: async (projectId, onProgress) => {
      const selected = await selectedScripts(projectId);
      if (!selected.length) throw new Error("Select a script first.");
      const missing: string[] = [];
      for (const s of selected) if (!(await activeBoardFor(projectId, s.id))) missing.push(s.id);
      if (missing.length) {
        await runJob(projectId, "storyboards", `/api/projects/${projectId}/creative/storyboards-batch`, { scriptIds: missing }, onProgress, "Drafting storyboards");
      }
      return "Storyboard ready — check each frame, then approve (or use “Approve all frames”).";
    },
  },
  "studio.compile": {
    label: "Compile the run",
    explain: "Turns the approved storyboard into a production run with a credit estimate. Compiling is free.",
    auto: true,
    run: async (projectId) => {
      const selected = await selectedScripts(projectId);
      for (const s of selected) {
        const board = await activeBoardFor(projectId, s.id);
        if (!board) continue;
        const r = await api<{ creditsEstimated?: number; jobCount?: number }>(`/api/projects/${projectId}/studio/libtv-runs`, {
          json: { storyboardId: board.id, scriptId: s.id },
        });
        return `Compiled a run for "${s.title}" — ${r.jobCount ?? "?"} jobs, about ${r.creditsEstimated ?? "?"} credits. Approve it to render.`;
      }
      throw new Error("No storyboard to compile — finish the Creative step first.");
    },
  },
  "studio.render": {
    label: "Render for free",
    explain:
      "Free runs (GLM, or your own ComfyUI GPU) render on the server at 0 credits. Runs that spend LibTV credits still wait for your approval.",
    auto: true,
    run: async (projectId, onProgress) => {
      type Run = { id: string; status: string; creditsEstimated: number; executor?: string; error?: string | null; jobs?: { status: string }[] };
      const { runs } = await api<{ runs: Run[] }>(`/api/projects/${projectId}/studio/libtv-runs`);
      const active = runs.find((r) => ["approved", "claimed", "running", "assembling"].includes(r.status));
      let target = active;
      if (!target) {
        const pending = runs.find((r) => r.status === "awaiting_approval");
        if (!pending) throw new Error("No compiled run yet — compile one first.");
        // Only zero-cost server-engine runs are auto-approved. LibTV runs spend
        // credits; a server-engine run with a cost uses a bring-your-own paid model.
        if (!isServerEngine(pending.executor) || pending.creditsEstimated > 0) {
          throw new Error(
            isServerEngine(pending.executor)
              ? `This run uses a paid model (about ${pending.creditsEstimated} US¢ on your own API key) — approve it yourself in Studio.`
              : `This run spends ${pending.creditsEstimated} LibTV credits — approve it yourself in Studio.`
          );
        }
        await api(`/api/projects/${projectId}/studio/libtv-runs/${pending.id}/approve`, { json: {} });
        target = pending;
      }
      for (;;) {
        await wait(10_000);
        const { run } = await api<{ run: Run }>(`/api/projects/${projectId}/studio/libtv-runs/${target.id}`);
        const jobs = run.jobs ?? [];
        const done = jobs.filter((j) => j.status === "completed" || j.status === "skipped").length;
        onProgress({
          percent: jobs.length ? Math.round((done / jobs.length) * 95) : null,
          etaSeconds: null,
          message:
            run.status === "assembling"
              ? "Assembling the master video"
              : `Rendering with ${engineLabel(run.executor ?? target.executor)} — ${done}/${jobs.length} steps`,
        });
        if (run.status === "completed") return "Rendered the master video for free — it's in Deliver.";
        if (run.status === "failed" || run.status === "cancelled") throw new Error(run.error || `Render ${run.status}`);
      }
    },
  },
};

/** The one step the user must do by hand, with where to do it. */
export const MANUAL_HINTS: Record<string, string> = {
  "setup.product": "Enter the product name or paste the product page URL.",
  "setup.confirmProduct": "Check the product details we read from your page, then click Confirm.",
  "creative.approve": "Open the storyboard and approve each frame (✓), or use “Approve all frames”.",
  "studio.render": "Free GLM / ComfyUI runs render automatically. A LibTV run spends credits — approve it in Studio.",
  "deliver.master": "Appears here once a studio run finishes rendering.",
};

/** Approve every frame of the active storyboard of each selected script. */
export async function approveAllFrames(projectId: string): Promise<number> {
  const selected = await selectedScripts(projectId);
  let n = 0;
  for (const s of selected) {
    const board = await activeBoardFor(projectId, s.id);
    const frames = Array.isArray(board?.frames) ? (board!.frames as { frameNumber: number; approved?: boolean | null }[]) : [];
    for (const f of frames) {
      if (f.approved === true) continue;
      await api(`/api/projects/${projectId}/creative/storyboards/${board!.id}/frames`, {
        method: "PATCH",
        json: { frameNumber: f.frameNumber, approved: true },
      });
      n++;
    }
  }
  return n;
}
