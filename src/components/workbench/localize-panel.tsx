"use client";

import { useMemo, useState } from "react";
import { Download, Languages, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { btnPrimary, Chip, ErrorNote, inputCls, Label, linkChip, Pill, toggle } from "./bits";
import { LOCALE_OPTIONS, localeRows, postJson } from "./view-model";

type LocaleQc = Parameters<typeof localeRows>[0];

/** Localized versions of a finished master: pick locales, start, and follow each locale's status. */
export function LocalizePanel({ projectId, runId, qc, now, onChanged }: { projectId: string; runId: string; qc: LocaleQc; now: number; onChanged: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const rows = useMemo(() => localeRows(qc, now), [qc, now]);
  const status = new Map(rows.map((r) => [r.id, r.status]));

  async function start() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const data = await postJson<{ queued: string[]; skipped: string[]; note?: string }>(`/api/projects/${projectId}/studio/libtv-runs/${runId}/localize`, {
        locales: picked,
        ...(gender ? { gender } : {}),
        ...(force ? { force: true } : {}),
      });
      setNote(
        [data.queued.length ? `Started ${data.queued.join(", ")}.` : "Nothing to start.", data.skipped.length ? `Skipped ${data.skipped.join(", ")} (done or already rendering).` : "", data.note ?? ""].filter(Boolean).join(" ")
      );
      setPicked([]);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start localization");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="localize-panel">
      <div>
        <Label>Locales</Label>
        <div className="flex flex-wrap gap-1.5">
          {LOCALE_OPTIONS.map((l) => (
            <Chip key={l.id} checked={picked.includes(l.id)} onChange={(on) => setPicked((p) => toggle(p, l.id, on))} title={l.id} disabled={status.get(l.id) === "rendering"}>
              {l.label}
              {status.get(l.id) === "done" && " ✓"}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <Label>Voice</Label>
          <select aria-label="Voice gender" className={inputCls} value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}>
            <option value="">Default</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Re-render finished locales
        </label>
        <button type="button" className={btnPrimary} onClick={start} disabled={busy || picked.length === 0}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />} Localize {picked.length || ""}
        </button>
        <span className="pb-1.5 text-[11px] text-muted-foreground">Same clips; one translation call, free TTS voices. ~2–3 min per locale.</span>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {note && <p className="text-xs">{note}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">Locale</th>
              <th className="py-1 pr-3 font-medium">Status</th>
              <th className="py-1 pr-3 font-medium">QC</th>
              <th className="py-1 font-medium">Video</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-t border-border/60", r.status === "not_started" && "text-muted-foreground")}>
                <td className="py-1 pr-3">
                  {r.label} <span className="font-mono text-[10px] text-muted-foreground">{r.id}</span>
                </td>
                <td className="py-1 pr-3">
                  <Pill tone={r.status === "done" ? "ok" : r.status === "rendering" ? "warn" : r.status === "stalled" ? "bad" : "muted"}>{r.statusLabel}</Pill>
                </td>
                <td className="py-1 pr-3 num">
                  {r.qc ?? "—"}
                  {r.overruns > 0 && <span className="ml-1 text-[10px] text-[var(--status-attention-fg)]">{r.overruns} long line{r.overruns === 1 ? "" : "s"}</span>}
                </td>
                <td className="py-1">
                  {r.masterUrl ? (
                    <span className="flex flex-wrap gap-1">
                      <a href={r.masterUrl} target="_blank" rel="noreferrer" className={linkChip} title={r.adName ?? undefined}>
                        <Download className="h-3 w-3" /> Master
                      </a>
                      {r.previewUrl && (
                        <a href={r.previewUrl} target="_blank" rel="noreferrer" className={linkChip}>
                          Preview
                        </a>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
