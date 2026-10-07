"use client";

import { useMemo, useState } from "react";
import { Download, Layers, Loader2, Play } from "lucide-react";
import { BATCH_ASPECTS, BATCH_DURATIONS, EDGE_VOICES, MUSIC_MOODS, RE_EDIT_END_CARDS, type BatchMatrix } from "@/services/creative/batch-matrix";
import { cn } from "@/lib/utils";
import { btn, btnPrimary, Chip, ErrorNote, inputCls, Label, linkChip, Pill, toggle } from "./bits";
import { dimsPayload, EMPTY_DIMS, estimateMatrix, parseList, postJson, summarizeBatch, VARIANT_STATUS_LABEL, variantCells, type BatchDimsForm } from "./view-model";

const HOOK_STYLES = [
  { id: "q", label: "Question" },
  { id: "c", label: "Contrast" },
  { id: "p", label: "Product blast" },
];
const CELL_LABELS = ["Hook", "End card", "CTA", "Voice", "Music", "Aspect", "Length"];
const voiceLabel = (v: string) => v.replace(/^([a-z]{2}-[A-Z]{2})-(\w+?)(Multilingual)?Neural$/, "$2 · $1");

/**
 * Batch Mode: choose the dimensions to vary and the design, preview the variant matrix and its cost
 * (planning spends nothing), render the free re-edit variants N at a time and follow their progress.
 */
export function BatchBuilder({ projectId, runId, batches, onChanged }: { projectId: string; runId: string; batches: BatchMatrix[]; onChanged: () => void }) {
  const [dims, setDims] = useState<BatchDimsForm>(EMPTY_DIMS);
  const [libraryHooks, setLibraryHooks] = useState("");
  const [ctas, setCtas] = useState("");
  const [design, setDesign] = useState<"pairwise" | "full">("pairwise");
  const [max, setMax] = useState(24);
  const [limit, setLimit] = useState(2);
  const [busy, setBusy] = useState<"plan" | "render" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pickedBatch, setPickedBatch] = useState<string | null>(null);

  const form: BatchDimsForm = useMemo(
    () => ({ ...dims, hooks: [...new Set([...dims.hooks, ...parseList(libraryHooks, 12, 12).map((h) => h.toUpperCase())])].slice(0, 12), ctas: parseList(ctas) }),
    [dims, libraryHooks, ctas]
  );
  const est = estimateMatrix(form, design, max);
  const batch = batches.find((b) => b.id === pickedBatch) ?? batches[batches.length - 1] ?? null;
  const summary = batch ? summarizeBatch(batch) : null;
  const set = <K extends keyof BatchDimsForm>(k: K, v: BatchDimsForm[K]) => setDims((d) => ({ ...d, [k]: v }));

  async function plan() {
    setBusy("plan");
    setError(null);
    setNote(null);
    try {
      const data = await postJson<{ batch: BatchMatrix }>(`/api/projects/${projectId}/studio/libtv-runs/${runId}/batch`, { dims: dimsPayload(form), design, maxVariants: max });
      setPickedBatch(data.batch.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not plan the batch");
    } finally {
      setBusy(null);
    }
  }

  async function render() {
    if (!batch) return;
    setBusy("render");
    setError(null);
    try {
      const data = await postJson<{ rendering: { id: string; name: string }[] }>(`/api/projects/${projectId}/studio/libtv-runs/${runId}/batch/render`, { batchId: batch.id, limit });
      setNote(data.rendering.length ? `Rendering ${data.rendering.length} variant${data.rendering.length === 1 ? "" : "s"} (~2–3 min each).` : "Nothing left to render for free in this batch.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the renders");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="batch-builder">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Hooks</Label>
          <div className="flex flex-wrap gap-1.5">
            {HOOK_STYLES.map((h) => (
              <Chip key={h.id} checked={dims.hooks.includes(h.id)} onChange={(on) => set("hooks", toggle(dims.hooks, h.id, on))} title="Restyle of the master's own hook — free">
                {h.label}
              </Chip>
            ))}
          </div>
          <input aria-label="Library hook ids" className={cn(inputCls, "mt-1.5 w-full")} placeholder="Library hooks, e.g. H03, H12 (need a new hook clip — not rendered here)" value={libraryHooks} onChange={(e) => setLibraryHooks(e.target.value)} />
        </div>
        <div>
          <Label>End cards</Label>
          <div className="flex flex-wrap gap-1.5">
            {RE_EDIT_END_CARDS.map((id) => (
              <Chip key={id} checked={dims.endCards.includes(id)} onChange={(on) => set("endCards", toggle(dims.endCards, id, on))}>
                {id}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <Label>CTA copy</Label>
          <input aria-label="CTA copy" className={cn(inputCls, "w-full")} placeholder="Shop now, Get yours, Claim 20% off" value={ctas} onChange={(e) => setCtas(e.target.value)} />
        </div>
        <div>
          <Label>Music</Label>
          <div className="flex flex-wrap gap-1.5">
            {MUSIC_MOODS.map((m) => (
              <Chip key={m} checked={dims.musicMoods.includes(m)} onChange={(on) => set("musicMoods", toggle(dims.musicMoods, m, on))}>
                {m}
              </Chip>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <Label>Voices</Label>
          <div className="flex flex-wrap gap-1.5">
            {EDGE_VOICES.map((v) => (
              <Chip key={v} checked={dims.voices.includes(v)} onChange={(on) => set("voices", toggle(dims.voices, v, on))} title={v}>
                {voiceLabel(v)}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <Label>Aspects</Label>
          <div className="flex flex-wrap gap-1.5">
            {BATCH_ASPECTS.map((a) => (
              <Chip key={a} checked={dims.aspects.includes(a)} onChange={(on) => set("aspects", toggle(dims.aspects, a, on))}>
                {a}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <Label>Durations</Label>
          <div className="flex flex-wrap gap-1.5">
            {BATCH_DURATIONS.map((d) => (
              <Chip key={d} checked={dims.durations.includes(d)} onChange={(on) => set("durations", toggle(dims.durations, d as number, on))}>
                {d}s
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Design</Label>
          <div role="radiogroup" aria-label="Design" className="flex gap-1.5">
            {(["pairwise", "full"] as const).map((d) => (
              <Chip key={d} checked={design === d} onChange={() => setDesign(d)} title={d === "pairwise" ? "Every pair of levels shares a variant — far fewer variants" : "Every combination (capped)"}>
                {d === "pairwise" ? "Pairwise" : "Full factorial"}
              </Chip>
            ))}
          </div>
        </div>
        <label className="block">
          <Label>Max variants</Label>
          <input type="number" min={1} max={200} aria-label="Max variants" className={cn(inputCls, "w-20")} value={max} onChange={(e) => setMax(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
        </label>
        <p className="pb-1.5 text-xs text-muted-foreground">
          ≈ <strong className="num text-foreground">{est.expected}</strong> variant{est.expected === 1 ? "" : "s"}
          {design === "pairwise" ? ` (at least ${est.pairwiseMin}; full factorial ${est.full})` : ""}
          {est.capped ? ` · capped at ${max}` : ""}
        </p>
        <button type="button" className={btnPrimary} onClick={plan} disabled={busy !== null}>
          {busy === "plan" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />} Preview matrix & cost
        </button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {note && <p className="text-xs">{note}</p>}

      {batch && summary && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {batches.length > 1 ? (
                <select aria-label="Batch" className={inputCls} value={batch.id} onChange={(e) => setPickedBatch(e.target.value)}>
                  {[...batches].reverse().map((b) => (
                    <option key={b.id} value={b.id}>
                      {new Date(b.createdAt).toLocaleString()} · {b.variants.length} variants · {b.design}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-semibold">Batch · {batch.design}</span>
              )}
              <span className="text-muted-foreground">{summary.costLabel}</span>
              {summary.coverageLabel && <span className="text-muted-foreground">· {summary.coverageLabel}</span>}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                Render
                <input type="number" min={1} max={10} aria-label="Variants to render" className={cn(inputCls, "h-7 w-14")} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
              </label>
              <button type="button" className={btn} onClick={render} disabled={busy !== null || summary.renderable === 0}>
                {busy === "render" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Render free variants
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <div className="h-1.5 w-40 overflow-hidden rounded bg-muted" aria-hidden>
              <div className="h-full bg-[var(--status-healthy-fg)]" style={{ width: `${summary.progress}%` }} />
            </div>
            {summary.byStatus.rendered} rendered · {summary.byStatus.pending} rendering · {summary.renderable} to render
            {summary.byStatus.needs_generation > 0 && ` · ${summary.byStatus.needs_generation} need a new hook clip`}
            {summary.byStatus.failed > 0 && ` · ${summary.byStatus.failed} failed`}
          </div>
          {batch.notes.length > 0 && <p className="text-[11px] text-muted-foreground">{batch.notes.join(" ")}</p>}
          <div className="max-h-80 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">Variant</th>
                  {CELL_LABELS.map((label) => (
                    <th key={label} className="px-2 py-1 font-medium">
                      {label}
                    </th>
                  ))}
                  <th className="px-2 py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {batch.variants.map((v) => (
                  <tr key={v.id} className="border-t border-border/60">
                    <td className="max-w-[14rem] truncate px-2 py-1 font-mono" title={v.name}>
                      {v.name}
                    </td>
                    {variantCells(v).map((c) => (
                      <td key={c.label} className="px-2 py-1">
                        {c.value}
                      </td>
                    ))}
                    <td className="px-2 py-1">
                      {v.status === "rendered" && v.masterUrl ? (
                        <a href={v.masterUrl} target="_blank" rel="noreferrer" className={linkChip}>
                          <Download className="h-3 w-3" /> MP4
                        </a>
                      ) : (
                        <Pill tone={v.status === "failed" ? "bad" : v.status === "pending" ? "warn" : "muted"}>{VARIANT_STATUS_LABEL[v.status]}</Pill>
                      )}
                      {v.error && (
                        <span className="block max-w-[12rem] truncate text-[10px] text-[var(--status-urgent-fg)]" title={v.error}>
                          {v.error}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
