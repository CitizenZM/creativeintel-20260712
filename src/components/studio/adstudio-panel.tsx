"use client";

/**
 * Ad Studio in Studio: the selected storyboard goes to the Mac Ad Studio pipeline for a second pass —
 * re-analysis, hook optimisation for each picked hook type, then generation with each picked video engine.
 * Sits below the LibTV panel; the storyboard and LibTV runs are untouched.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StoryboardView } from "./types";

interface Option { id: string; label: string; note?: string }
interface FrameRow { frame: number; segment: string; original: { textOverlay: string; voiceover: string; sellingPoint: string; productAction: string }; shots: { shot: number; caption: string; vo: string }[] }
interface Plan {
  concept?: string;
  hook?: { chosen?: string; vo?: string; options?: { caption: string; stop: number; clarity: number; emotion: number; relevance: number }[] };
  coverage?: { planned: number; covered: number; missing: number[] };
  frames?: FrameRow[];
  audio?: { profile?: string; music?: string; voice?: string };
  durationS?: number;
}
export interface AdStudioRunView {
  id: string; batchId: string; hookType: string; engine: string; planFromRunId: string | null; status: string; step: string | null; progress: number;
  plan: Plan | null; storyboardAB: { winner?: number; scores?: number[]; why?: string } | null;
  estimate: { usd: number; model?: string; scenes?: { label: string; kind: string; dur: number; usd: number }[] } | null;
  review: { scores?: Record<string, number>; verdict?: string } | null; metrics: Record<string, unknown> | null;
  autofix: { kept?: boolean; summary?: string } | null; log: string[] | null; estUsd: number; actualUsd: number | null;
  finalMp4Url: string | null; posterUrl: string | null; error: string | null; cancelRequested: boolean; createdAt: string;
}

const STEPS = ["ingest", "analyze", "product", "script", "generate", "voice", "render", "review"];
const TONE: Record<string, string> = {
  queued: "bg-muted text-muted-foreground", planning: "bg-blue-100 text-blue-700", awaiting_approval: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-700", generating: "bg-blue-100 text-blue-700", completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700", cancelled: "bg-muted text-muted-foreground",
};
const STATUS_TEXT: Record<string, string> = {
  queued: "Queued", planning: "Analysing storyboard", awaiting_approval: "Waiting for your approval", approved: "Approved · queued",
  generating: "Generating", completed: "Completed", failed: "Failed", cancelled: "Cancelled",
};
const SELL = ["hook", "sell", "offer", "readability", "audio", "brand"];
const ACTIVE = ["queued", "planning", "awaiting_approval", "approved", "generating"];
const money = (n: number | null | undefined) => `$${(n ?? 0).toFixed(2)}`;

export function AdStudioPanel({ projectId, storyboard }: { projectId: string; storyboard: StoryboardView | null }) {
  const [runs, setRuns] = useState<AdStudioRunView[]>([]);
  const [hookTypes, setHookTypes] = useState<Option[]>([]);
  const [engines, setEngines] = useState<Option[]>([]);
  const [maxVariants, setMaxVariants] = useState(6);
  const [online, setOnline] = useState<boolean | null>(null);
  const [pickHooks, setPickHooks] = useState<string[]>(["keep"]);
  const [pickEngines, setPickEngines] = useState<string[]>(["auto"]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/projects/${projectId}/studio/adstudio-runs`;
  const load = useCallback(() => {
    if (!storyboard) return;
    fetch(`${base}?storyboardId=${storyboard.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setRuns(j.runs); setHookTypes(j.hookTypes); setEngines(j.engines); setMaxVariants(j.maxVariants); setOnline(j.workerOnline);
      })
      .catch(() => {});
  }, [base, storyboard]);

  useEffect(load, [load]);
  const live = runs.some((r) => ACTIVE.includes(r.status) && r.status !== "awaiting_approval");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [live, load]);

  const count = pickHooks.length * pickEngines.length;
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function post(url: string, body?: unknown, key = url) {
    setBusy(key); setError(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error || `Request failed (${r.status})`);
      load();
    } finally { setBusy(null); }
  }

  const batches = useMemo(() => {
    const m = new Map<string, AdStudioRunView[]>();
    for (const r of runs) m.set(r.batchId, [...(m.get(r.batchId) ?? []), r]);
    return [...m.values()].map((rs) => [...rs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }, [runs]);

  if (!storyboard) return null;
  const label = (opts: Option[], id: string) => opts.find((o) => o.id === id)?.label ?? id;

  return (
    <section id="adstudio" data-testid="adstudio-panel" className="scroll-mt-28 rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Sparkles className="h-4 w-4" /> Ad Studio · optimise this storyboard and generate
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Second pass on “{storyboard.title}”: re-analyses all {storyboard.frames.length} frames, rewrites the hook for each hook type you pick,
            keeps every planned selling point, then renders with each engine you pick. Planning is free; video is generated only after you approve its cost.
          </p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", online ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground")}>
          {online == null ? "…" : online ? "● Mac worker online" : "○ Mac worker offline — runs wait in the queue"}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Picker title="Hook types" hint="One plan per hook type" options={hookTypes} picked={pickHooks} onToggle={(id) => toggle(pickHooks, setPickHooks, id)} />
        <Picker title="Video engines" hint="Same plan rendered by each engine" options={engines} picked={pickEngines} onToggle={(id) => toggle(pickEngines, setPickEngines, id)} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[240px] text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Notes for the second pass (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. keep the kitchen scene, lead with the price"
            className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm" />
        </label>
        <button
          type="button"
          disabled={count === 0 || count > maxVariants || busy === "create"}
          onClick={() => post(base, { storyboardId: storyboard.id, hookTypes: pickHooks, engines: pickEngines, notes }, "create")}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-sm font-semibold text-background disabled:opacity-40"
        >
          {busy === "create" && <Loader2 className="h-4 w-4 animate-spin" />}
          Plan {count} video{count === 1 ? "" : "s"} ({pickHooks.length} hook × {pickEngines.length} engine)
        </button>
      </div>
      {count > maxVariants && <p className="text-xs text-red-600">At most {maxVariants} videos per batch.</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

      {batches.map((rs) => (
        <div key={rs[0].batchId} className="space-y-3 border-t border-border pt-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Batch · {new Date(rs[0].createdAt).toLocaleString()} · {rs.length} variant{rs.length === 1 ? "" : "s"}
          </p>
          {rs.map((r) => (
            <RunCard key={r.id} run={r} hook={label(hookTypes, r.hookType)} engine={label(engines, r.engine)} busy={busy}
              onApprove={() => post(`${base}/${r.id}/approve`, {}, `a${r.id}`)} onCancel={() => post(`${base}/${r.id}/cancel`, {}, `c${r.id}`)} />
          ))}
        </div>
      ))}
    </section>
  );
}

function Picker({ title, hint, options, picked, onToggle }: { title: string; hint: string; options: Option[]; picked: string[]; onToggle: (id: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium">{title} <span className="font-normal text-muted-foreground">· {hint}</span></legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label key={o.id} title={o.note} className={cn("cursor-pointer rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
            picked.includes(o.id) ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground")}>
            <input type="checkbox" className="sr-only" checked={picked.includes(o.id)} onChange={() => onToggle(o.id)} aria-label={o.label} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RunCard({ run: r, hook, engine, busy, onApprove, onCancel }: { run: AdStudioRunView; hook: string; engine: string; busy: string | null; onApprove: () => void; onCancel: () => void }) {
  const stepIdx = STEPS.indexOf(r.step ?? "");
  const p = r.plan;
  return (
    <div data-testid="adstudio-run" data-status={r.status} className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          {hook} · {engine}
          {p?.hook?.chosen && <span className="ml-2 font-normal text-muted-foreground">“{p.hook.chosen}”</span>}
          {r.planFromRunId && <span className="ml-2 text-[11px] font-normal text-muted-foreground">(same plan as its hook&apos;s first engine)</span>}
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TONE[r.status])}>
          {STATUS_TEXT[r.status] ?? r.status}{r.cancelRequested && ACTIVE.includes(r.status) ? " · stopping" : ""}
        </span>
      </div>
      <div className="flex gap-1">
        {STEPS.map((s, i) => {
          const done = r.status === "completed" || i < stepIdx;
          const cur = i === stepIdx && r.status !== "completed";
          return (
            <div key={s} className={cn("flex-1 text-center text-[10px]", done ? "text-green-700" : cur ? "font-semibold text-amber-700" : "text-muted-foreground")}>
              <div className={cn("mb-1 h-1.5 rounded", done ? "bg-green-600" : cur ? "bg-amber-500" : "bg-muted")} />{s}
            </div>
          );
        })}
      </div>
      {r.error && <p className="text-xs text-red-600">{r.error}</p>}

      {p && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2 text-xs">
            {p.concept && <p><span className="text-muted-foreground">Concept</span> {p.concept}</p>}
            {p.coverage && (
              <p data-testid="adstudio-coverage">
                <span className="text-muted-foreground">Storyboard kept</span>{" "}
                <b className={p.coverage.missing.length ? "text-amber-700" : "text-green-700"}>{p.coverage.covered}/{p.coverage.planned} planned frames</b>
                {p.coverage.missing.length > 0 && <> · missing #{p.coverage.missing.join(", #")}</>}
              </p>
            )}
            {p.audio && <p><span className="text-muted-foreground">Sound</span> {[p.audio.profile, p.audio.music, p.audio.voice].filter(Boolean).join(" · ")}</p>}
            {p.hook?.options?.length ? (
              <table className="w-full">
                <thead><tr className="text-muted-foreground"><th className="text-left font-medium">Hook options</th><th>Stop</th><th>Clear</th><th>Emotion</th><th>Fit</th></tr></thead>
                <tbody>
                  {p.hook.options.map((o) => (
                    <tr key={o.caption} className={o.caption === p.hook?.chosen ? "font-semibold" : ""}>
                      <td className="py-0.5">{o.caption === p.hook?.chosen ? "🔒 " : ""}{o.caption}</td>
                      <td className="text-center">{o.stop}</td><td className="text-center">{o.clarity}</td><td className="text-center">{o.emotion}</td><td className="text-center">{o.relevance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {r.storyboardAB?.why && <p><span className="text-muted-foreground">A/B first frames</span> {"AB"[r.storyboardAB.winner ?? 0]} picked — {r.storyboardAB.why}</p>}
          </div>
          {p.frames?.length ? (
            <details className="text-xs" open={r.status === "awaiting_approval"}>
              <summary className="cursor-pointer font-medium">Frame by frame: storyboard → optimised</summary>
              <table className="mt-1 w-full">
                <thead><tr className="text-left text-muted-foreground"><th className="w-8">#</th><th>Storyboard</th><th>Now</th></tr></thead>
                <tbody>
                  {p.frames.map((f) => (
                    <tr key={f.frame} className="border-t border-border/60 align-top">
                      <td className="py-1">{f.frame}<div className="text-[10px] text-muted-foreground">{f.segment}</div></td>
                      <td className="py-1 pr-2">{[f.original.textOverlay, f.original.voiceover, f.original.sellingPoint].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="py-1">{f.shots.length ? f.shots.map((s) => `#${s.shot} ${s.caption}${s.vo ? ` — “${s.vo}”` : ""}`).join(" / ") : <span className="text-muted-foreground">merged</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </div>
      )}

      {r.status === "awaiting_approval" && r.estimate && (
        <div className="space-y-2 rounded-md bg-muted/50 p-2.5 text-xs">
          <table className="w-full">
            <tbody>
              {(r.estimate.scenes ?? []).map((s, i) => (
                <tr key={i}><td>Scene {i + 1}</td><td>{s.kind}</td><td>{s.label}</td><td>{s.dur}s</td><td className="text-right">{money(s.usd)}</td></tr>
              ))}
              <tr className="font-semibold"><td colSpan={4}>Video total</td><td className="text-right">{money(r.estimate.usd)}</td></tr>
            </tbody>
          </table>
          <p className="text-muted-foreground">Already spent on the plan (key frames): {money(r.actualUsd)}. Approving books {money(r.estimate.usd)} against the project budget.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onApprove} disabled={busy === `a${r.id}`} className="h-8 rounded-md bg-blue-600 px-3 font-semibold text-white disabled:opacity-50">
              Approve & generate · {money(r.estimate.usd)}
            </button>
            <button type="button" onClick={onCancel} disabled={busy === `c${r.id}`} className="h-8 rounded-md border border-border px-3 font-semibold">Cancel</button>
          </div>
        </div>
      )}
      {["queued", "planning", "approved", "generating"].includes(r.status) && !r.cancelRequested && (
        <button type="button" onClick={onCancel} disabled={busy === `c${r.id}`} className="h-7 rounded-md border border-border px-2.5 text-xs font-semibold">Cancel</button>
      )}

      {r.status === "completed" && r.finalMp4Url && (
        <div className="grid gap-3 md:grid-cols-[200px_1fr]">
          <video src={r.finalMp4Url} poster={r.posterUrl ?? undefined} controls className="w-[200px] rounded-md bg-black" />
          <div className="space-y-2 text-xs">
            {r.review?.scores && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {SELL.filter((k) => typeof r.review?.scores?.[k] === "number").map((k) => (
                  <div key={k} className="flex justify-between"><span className="capitalize text-muted-foreground">{k}</span><b>{r.review!.scores![k]}</b></div>
                ))}
                {typeof r.review.scores.mechanic === "number" && <div className="flex justify-between text-muted-foreground"><span>fidelity (info)</span><span>{r.review.scores.mechanic}</span></div>}
              </div>
            )}
            {r.metrics && (
              <p className="text-muted-foreground">
                {String(r.metrics.duration_s)} s · {String(r.metrics.lufs)} LUFS · voice over music {String(r.metrics.vo_over_music_lu ?? "—")} LU · cuts on beat {String(r.metrics.cut_beat_median_ms ?? "—")} ms
                {Array.isArray(r.metrics.flags) && r.metrics.flags.length ? <span className="text-amber-700"> · ⚠ {(r.metrics.flags as string[]).join("；")}</span> : null}
              </p>
            )}
            {r.autofix?.summary && <p><span className="text-muted-foreground">Auto-fix {r.autofix.kept ? "kept" : "reverted"}:</span> {r.autofix.summary}</p>}
            {r.review?.verdict && <p className="text-muted-foreground">{r.review.verdict}</p>}
            <p>Cost {money(r.actualUsd)} <span className="text-muted-foreground">(approved {money(r.estUsd)})</span> · <a className="underline" href={r.finalMp4Url} download>Download mp4</a></p>
          </div>
        </div>
      )}
      {r.log?.length ? (
        <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">Log</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{r.log.slice(-20).join("\n")}</pre></details>
      ) : null}
    </div>
  );
}
