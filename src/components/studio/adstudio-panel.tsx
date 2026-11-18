"use client";

/**
 * Ad Studio in Studio: the selected storyboard goes to the Mac Ad Studio pipeline for a second pass —
 * re-analysis, hook optimisation for each picked hook type, then generation with each picked video engine.
 * Sits below the LibTV panel; the storyboard and LibTV runs are untouched.
 * P3: "Start from" also lists Creative scripts that have no storyboard yet (frames built from the script's scenes / beats).
 * Workflows: optimise storyboard/script · imitate a reference · imitate + replace (services/video-gen/adstudio-catalog.ts).
 * Opening (house hook library H01–H35), ending (end cards E01–E12 + theme) and imitation style apply to the whole batch.
 */
import { cleanBranding, type Branding } from "@/services/video-gen/adstudio-branding";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, Upload } from "lucide-react";
import { upload as blobUpload } from "@vercel/blob/client";
import { cn } from "@/lib/utils";
import type { StoryboardView } from "./types";
import { EndingGallery, OpeningGallery, type ClipMap, type EndCardOpt, type OpeningOpt } from "./adstudio-gallery";

interface Option { id: string; label: string; note?: string }
/** services/video-gen/adstudio-context.ts summarizeContext */
interface Carried { images: number; winningAds: number; paceVideos?: number; testedHooks?: number; sellingPoints: number; insights: number; painPoints: number; hookFormulas: number; angle?: string; actor?: string; environment?: string; plan: boolean; suggestedHookTypes: string[]; warnings: string[] }
interface FrameRow { frame: number; segment: string; original: { textOverlay: string; voiceover: string; sellingPoint: string; productAction: string }; shots: { shot: number; caption: string; vo: string }[] }
interface Plan {
  concept?: string;
  hook?: { chosen?: string; vo?: string; options?: { caption: string; stop: number; clarity: number; emotion: number; relevance: number }[] };
  coverage?: { planned: number; covered: number; missing: number[] };
  frames?: FrameRow[];
  audio?: { profile?: string; music?: string; voice?: string };
  durationS?: number;
  replace?: { reference_product: string; our_product: string; keywords: { from: string; to: string }[]; selling_point: string; offer: string };
  replaceCheck?: { locked: boolean; ours: number; ref: number };
  opening?: { lib?: string | null; id?: string | null; enforced?: string[]; unmet?: string[] };
  endCard?: string | null;
  format?: string;
}
export interface AdStudioRunView {
  id: string; batchId: string; hookType: string; engine: string; planFromRunId: string | null; status: string; step: string | null; progress: number;
  plan: Plan | null; storyboardAB: { winner?: number; scores?: number[]; why?: string } | null;
  estimate: { usd: number; model?: string; scenes?: { label: string; kind: string; dur: number; usd: number }[]; keyframes?: { scene: number; url: string }[]; warnings?: string[] } | null;
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
interface Source { id: string; title: string; frames: number; kind: "storyboard" | "script" }

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
  const [carried, setCarried] = useState<Carried | null>(null);
  const [scripts, setScripts] = useState<{ id: string; title: string; selected: boolean; frames: unknown[] }[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<Option[]>([]);
  const [workflow, setWorkflow] = useState("storyboard");
  const [refs, setRefs] = useState<{ id: string; title: string; score: number | null }[]>([]);
  const [refId, setRefId] = useState<string | null>(null);
  const [refLink, setRefLink] = useState("");
  const [formats, setFormats] = useState<Option[]>([]);
  const [format, setFormat] = useState("auto");
  const [openings, setOpenings] = useState<OpeningOpt[]>([]);
  const [openingId, setOpeningId] = useState("auto");
  const [endCards, setEndCards] = useState<EndCardOpt[]>([]);
  const [endThemes, setEndThemes] = useState<string[]>([]);
  const [hookClips, setHookClips] = useState<ClipMap>({});
  const [endClips, setEndClips] = useState<ClipMap>({});
  const [auto, setAuto] = useState<{ hookId?: string; endCardId?: string }>({});
  const [endCardId, setEndCardId] = useState("auto");
  const [endTheme, setEndTheme] = useState("brand");
  const [brandDraft, setBrandDraft] = useState<Branding>({});
  const [branding, setBranding] = useState<Branding>({}); // committed on blur, so the end-card stills reload once per edit
  const sources: Source[] = useMemo(() => [
    ...(storyboard ? [{ id: storyboard.id, title: storyboard.title, frames: storyboard.frames.length, kind: "storyboard" as const }] : []),
    ...scripts.map((x) => ({ id: x.id, title: x.title, frames: x.frames.length, kind: "script" as const })),
  ], [storyboard, scripts]);
  const source = sources.find((x) => x.id === sourceId) ?? sources[0] ?? null;
  const isRef = workflow !== "storyboard";
  const activeRef = refId ?? refs[0]?.id ?? null;
  const activeId = isRef ? activeRef : source?.id ?? null;
  const activeTitle = isRef ? refs.find((r) => r.id === activeRef)?.title ?? activeRef?.replace(/^ref:/, "") ?? "" : source?.title ?? "";

  const base = `/api/projects/${projectId}/studio/adstudio-runs`;
  const load = useCallback(() => {
    const id = activeId;
    fetch(id ? `${base}?storyboardId=${encodeURIComponent(id)}` : base)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setRuns(id ? j.runs : []); setHookTypes(j.hookTypes); setEngines(j.engines); setMaxVariants(j.maxVariants); setOnline(j.workerOnline); setCarried(j.carried ?? null); setScripts(j.scripts ?? []);
        setWorkflows(j.workflows ?? []); setFormats(j.formats ?? []); setOpenings(j.openings ?? []); setEndCards(j.endCards ?? []); setEndThemes(j.endCardThemes ?? []); setHookClips(j.hookClips ?? {}); setEndClips(j.endClips ?? {}); setAuto(j.auto ?? {});
        setRefs((cur) => { const extra = cur.filter((r) => !(j.references ?? []).some((x: { id: string }) => x.id === r.id)); return [...(j.references ?? []), ...extra]; });
      })
      .catch(() => {});
  }, [base, activeId]);

  useEffect(load, [load]);
  const live = runs.some((r) => ACTIVE.includes(r.status) && r.status !== "awaiting_approval");
  // poll only the runs; skip ticks while the tab is hidden; slow down while no worker is online (nothing can move)
  const poll = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    const id = activeId;
    fetch(`${base}?runsOnly=1${id ? `&storyboardId=${encodeURIComponent(id)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { setRuns(id ? j.runs : []); setOnline(j.workerOnline); } })
      .catch(() => {});
  }, [base, activeId]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(poll, online ? 5000 : 30000);
    return () => clearInterval(t);
  }, [live, poll, online]);

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

  if (!source && !isRef && !workflows.length) return null;

  async function addRef(url: string, title?: string) {
    const id = `ref:${url}`;
    setRefs((cur) => (cur.some((r) => r.id === id) ? cur : [...cur, { id, title: title ?? url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), score: null }]));
    setRefId(id);
  }
  async function uploadRef(file: File) {
    setBusy("upload"); setError(null);
    try {
      const b = await blobUpload(`creativeintel/adstudio/refs/${projectId}/${file.name.replace(/[^\w.-]+/g, "_")}`, file, { access: "public", handleUploadUrl: `/api/projects/${projectId}/studio/adstudio-upload` });
      await addRef(b.url, `Upload · ${file.name}`);
    } catch (e) { setError(`Upload failed: ${(e as Error).message}`); } finally { setBusy(null); }
  }
  const label = (opts: Option[], id: string) => opts.find((o) => o.id === id)?.label ?? id;

  return (
    <section id="adstudio" data-testid="adstudio-panel" className="scroll-mt-28 rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Sparkles className="h-4 w-4" /> Ad Studio · {label(workflows, workflow) || "optimise and generate"}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {workflows.find((w) => w.id === workflow)?.note}{activeTitle ? ` — “${activeTitle}”.` : "."} Planning stops for your approval before any paid video; stock remix is free.
          </p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", online ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground")}>
          {online == null ? "…" : online ? "● Mac worker online" : "○ Mac worker offline — runs wait in the queue"}
        </span>
      </div>

      <div data-testid="adstudio-workflows" className="grid gap-2 sm:grid-cols-3">
        {workflows.map((w) => (
          <button key={w.id} type="button" onClick={() => setWorkflow(w.id)} title={w.note}
            className={cn("rounded-lg border p-2.5 text-left text-xs transition-colors", workflow === w.id ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/40")}>
            <span className="block font-semibold">{w.label}</span>
            <span className={cn("mt-0.5 block line-clamp-2", workflow === w.id ? "text-background/80" : "text-muted-foreground")}>{w.note}</span>
          </button>
        ))}
      </div>
      {isRef && (
        <div data-testid="adstudio-reference" className="space-y-2 rounded-lg border border-border p-3 text-xs">
          <p className="font-medium">Reference video</p>
          {refs.length > 0 && (
            <select value={activeRef ?? ""} onChange={(e) => setRefId(e.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              {refs.map((r) => <option key={r.id} value={r.id}>{r.score != null ? `Research · score ${r.score} · ` : ""}{r.title}</option>)}
            </select>
          )}
          <div className="flex flex-wrap gap-2">
            <input value={refLink} onChange={(e) => setRefLink(e.target.value)} placeholder="Paste a TikTok / Instagram / YouTube link"
              className="h-8 min-w-[220px] flex-1 rounded-md border border-border bg-background px-2 text-xs" />
            <button type="button" disabled={!/^https?:\/\//.test(refLink.trim())} onClick={() => { addRef(refLink.trim()); setRefLink(""); }}
              className="h-8 rounded-md border border-border px-2.5 font-medium disabled:opacity-40">Use link</button>
            <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 font-medium">
              {busy === "upload" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload video
              <input type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadRef(f); e.target.value = ""; }} />
            </label>
          </div>
          {!refs.length && <p className="text-muted-foreground">Research has no competitor ad with a video yet — paste a link or upload one.</p>}
        </div>
      )}
      {!isRef && sources.length > 1 && source && (
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">Start from</span>
          <select data-testid="adstudio-source" value={source.id} onChange={(e) => setSourceId(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs">
            {sources.map((x) => (
              <option key={x.id} value={x.id}>
                {x.kind === "storyboard" ? "Storyboard" : "Script (no storyboard)"} · {x.title} · {x.frames} {x.kind === "storyboard" ? "frames" : "scenes"}
              </option>
            ))}
          </select>
        </label>
      )}
      {carried && (
        <div data-testid="adstudio-carried" className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs space-y-1.5">
          <p className="font-medium">Carried from Setup → Research → Insights → Planning → Creative</p>
          <p className="text-muted-foreground">
            {[
              `${carried.images} product photos`, `${carried.winningAds} winning competitor ads`, carried.paceVideos ? `${carried.paceVideos} competitor videos for pacing` : "", `${carried.sellingPoints} selling points`,
              `${carried.insights} insights`, `${carried.painPoints} audience pain points`, carried.hookFormulas ? `${carried.hookFormulas} hook formulas` : null,
              carried.angle ? `angle “${carried.angle}”` : null, carried.actor ? `cast: ${carried.actor}` : null, carried.environment ? `setting: ${carried.environment}` : null,
              carried.plan ? "campaign / test plan" : null, carried.testedHooks ? `real ad results for ${carried.testedHooks} hook types` : null,
            ].filter(Boolean).join(" · ")}
          </p>
          {carried.warnings?.map((w) => <p key={w} data-testid="adstudio-carried-warning" className="text-amber-700 dark:text-amber-400">⚠ {w}</p>)}
          {carried.suggestedHookTypes.length > 0 && (
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Research suggests:</span>
              <span className="font-medium">{carried.suggestedHookTypes.map((id) => label(hookTypes, id)).join(" · ")}</span>
              <button type="button" className="rounded border border-border px-2 py-0.5 hover:bg-background"
                onClick={() => setPickHooks(["keep", ...carried.suggestedHookTypes.filter((id) => id !== "keep")].slice(0, 3))}>Use these</button>
            </p>
          )}
        </div>
      )}

      <details open className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-xs font-semibold">
          Opening · house hook library <span className="font-normal text-muted-foreground">— {openingId === "auto" ? "Auto" : openingId || "None"}{openingId && openingId !== "auto" ? ` · ${openings.find((o) => o.id === openingId)?.name ?? ""}` : ""}</span>
        </summary>
        <div className="mt-2"><OpeningGallery openings={openings} value={openingId} onChange={setOpeningId} clips={hookClips} autoId={auto.hookId} branding={branding} /></div>
      </details>
      <details open className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-xs font-semibold">
          Ending · end card <span className="font-normal text-muted-foreground">— {endCardId === "auto" ? "Auto" : endCardId ? `${endCardId} · ${endTheme}` : "Ad Studio close"}</span>
        </summary>
        <div className="mt-2"><EndingGallery projectId={projectId} cards={endCards} themes={endThemes} value={endCardId} theme={endTheme} onChange={setEndCardId} onTheme={setEndTheme} clips={endClips} autoId={auto.endCardId} branding={branding} /></div>
      </details>
      <details open data-testid="adstudio-branding" className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-xs font-semibold">
          Logo, product, link &amp; coupon <span className="font-normal text-muted-foreground">— shown on the closing card and in the end-card previews above; empty = this project&apos;s own logo, photos and offer</span>
        </summary>
        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["logoUrl", "Logo image URL", "https://…/logo.png"], ["productImageUrl", "Product image URL", "https://…/product.png"],
            ["linkUrl", "Link on screen", "https://brand.com/offer"], ["couponCode", "Coupon code", "SAVE20"],
            ["couponText", "Coupon / offer text", "20% off your first order"], ["headline", "Headline on the card", "Glow in seconds"], ["cta", "Button words", "Shop now"],
          ] as [keyof Branding, string, string][]).map(([k, label, ph]) => (
            <label key={k} className="block">
              <span className="mb-1 block font-medium text-muted-foreground">{label}</span>
              <input value={brandDraft[k] ?? ""} placeholder={ph} data-field={k}
                onChange={(e) => setBrandDraft((d) => ({ ...d, [k]: e.target.value }))}
                onBlur={() => setBranding(cleanBranding(brandDraft))}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs" />
            </label>
          ))}
        </div>
      </details>
      <label data-testid="adstudio-look" className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">Imitation style</span>
        <select value={format} onChange={(e) => setFormat(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5">
          {formats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <Picker title="Hook types" hint="One plan per hook type" options={isRef ? hookTypes.map((h) => (h.id === "keep" ? { ...h, label: "Keep reference hook", note: "Follow the reference's own opening" } : h)) : hookTypes} picked={pickHooks} onToggle={(id) => toggle(pickHooks, setPickHooks, id)} />
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
          disabled={count === 0 || count > maxVariants || busy === "create" || !activeId}
          onClick={() => post(base, { storyboardId: activeId, workflow, hookTypes: pickHooks, engines: pickEngines, notes, openingId, endCardId, endCardTheme: endTheme, format, branding: cleanBranding(brandDraft) }, "create")}
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
              onApprove={() => post(`${base}/${r.id}/approve`, {}, `a${r.id}`)} onCancel={() => post(`${base}/${r.id}/cancel`, {}, `c${r.id}`)}
              onRetry={() => post(`${base}/${r.id}/retry`, {}, `r${r.id}`)} />
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

function RunCard({ run: r, hook, engine, busy, onApprove, onCancel, onRetry }: { run: AdStudioRunView; hook: string; engine: string; busy: string | null; onApprove: () => void; onCancel: () => void; onRetry: () => void }) {
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
      {r.status === "failed" && (
        <button type="button" onClick={onRetry} disabled={busy === `r${r.id}`} className="h-7 rounded-md border border-border px-2.5 text-xs font-semibold">
          Retry{r.estimate?.usd ? " (back to approval)" : ""}
        </button>
      )}

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
            {(p.opening?.lib || p.endCard || (p.format && p.format !== "montage")) && (
              <p><span className="text-muted-foreground">Look</span> {[p.opening?.lib && `opening ${p.opening.lib}${p.opening.enforced?.length ? ` (${p.opening.enforced.join(", ")})` : ""}`, p.endCard && `end card ${p.endCard}`, p.format && `style ${p.format}`].filter(Boolean).join(" · ")}
                {p.opening?.unmet?.length ? <span className="text-amber-700"> · not met: {p.opening.unmet.join("; ")}</span> : null}</p>
            )}
            {p.replace && (
              <div data-testid="adstudio-replace" className="rounded border border-border p-2">
                <p className="font-medium">Replace list {p.replaceCheck && <span className={p.replaceCheck.locked ? "text-green-700" : "text-amber-700"}>· {p.replaceCheck.locked ? `timing locked to the reference's ${p.replaceCheck.ref} shots` : `${p.replaceCheck.ours} shots vs ${p.replaceCheck.ref} in the reference`}</span>}</p>
                <p><span className="text-muted-foreground">Product</span> {p.replace.reference_product} → <b>{p.replace.our_product}</b></p>
                {p.replace.keywords?.length > 0 && <p><span className="text-muted-foreground">Keywords</span> {p.replace.keywords.map((k) => `${k.from} → ${k.to}`).join(" · ")}</p>}
                <p><span className="text-muted-foreground">Selling point</span> {p.replace.selling_point}{p.replace.offer ? ` · offer ${p.replace.offer}` : ""}</p>
              </div>
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
          {r.estimate.warnings?.length ? (
            <ul className="space-y-0.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
              {r.estimate.warnings.map((w) => <li key={w}>⚠ {w}</li>)}
            </ul>
          ) : null}
          {r.estimate.keyframes?.length ? (
            <div>
              <p className="mb-1 font-medium">First frame of each AI scene (what the video will start from)</p>
              <div className="flex gap-1.5 overflow-x-auto">
                {r.estimate.keyframes.map((k) => (
                  <a key={k.url} href={k.url} target="_blank" rel="noreferrer" className="shrink-0 text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={k.url} alt={`Scene ${k.scene + 1} key frame`} className="h-40 w-auto rounded border border-border" />
                    <span className="text-[10px] text-muted-foreground">Scene {k.scene + 1}</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          <table className="w-full">
            <tbody>
              {(r.estimate.scenes ?? []).map((s, i) => (
                <tr key={i}><td>Scene {i + 1}</td><td>{s.kind}</td><td>{s.label}</td><td>{s.dur}s</td><td className="text-right">{money(s.usd)}</td></tr>
              ))}
              <tr className="font-semibold"><td colSpan={4}>Video total</td><td className="text-right">{money(r.estimate.usd)}</td></tr>
            </tbody>
          </table>
          <p className="text-muted-foreground">
            Already spent on the plan (key frames): {money(r.actualUsd)}. Approving books {money(r.estimate.usd)}; re-generating a broken scene may use up to {money(r.estimate.usd * 1.3)}.
            {" "}<b className="text-foreground">This video in total: up to {money((r.actualUsd ?? 0) + r.estimate.usd * 1.3)}.</b>
          </p>
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
