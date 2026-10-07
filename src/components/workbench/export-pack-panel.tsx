"use client";

import { useState } from "react";
import { Download, Loader2, PackageOpen } from "lucide-react";
import type { ExportPackResult } from "@/services/delivery/export-pack";
import { btnPrimary, ErrorNote, linkChip } from "./bits";
import { fmtBytes, postJson } from "./view-model";

export interface StoredPack {
  manifestUrl: string | null;
  zipUrl: string | null;
  createdAt?: string;
  videos?: number;
  campaignName?: string;
}

/** Export pack: every rendered video + thumbnails, ad copy, Meta / TikTok bulk CSVs, README and manifest. */
export function ExportPackPanel({ projectId, runId, stored, onChanged }: { projectId: string; runId: string; stored: StoredPack | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportPackResult | null>(null);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      setResult(await postJson<ExportPackResult>(`/api/projects/${projectId}/studio/libtv-runs/${runId}/export-pack`, {}));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the export pack");
    } finally {
      setBusy(false);
    }
  }

  const files = result?.manifest.files.filter((f) => f.url) ?? [];
  return (
    <div className="space-y-3" data-testid="export-pack">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} onClick={build} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageOpen className="h-3.5 w-3.5" />} {stored?.manifestUrl || result ? "Rebuild export pack" : "Export pack"}
        </button>
        <span className="text-[11px] text-muted-foreground">Videos stay as links; ad copy is written by one text-model call.</span>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!result && stored?.manifestUrl && (
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            Last pack{stored.createdAt ? ` ${new Date(stored.createdAt).toLocaleString()}` : ""}
            {stored.videos ? ` · ${stored.videos} videos` : ""}:
          </span>
          <a href={stored.manifestUrl} target="_blank" rel="noreferrer" className={linkChip}>
            <Download className="h-3 w-3" /> manifest.json
          </a>
          {stored.zipUrl && (
            <a href={stored.zipUrl} className={linkChip}>
              <Download className="h-3 w-3" /> zip
            </a>
          )}
        </p>
      )}
      {result && (
        <div className="space-y-2">
          <p className="text-xs">
            <strong>{result.manifest.campaignName}</strong> · {result.manifest.videos.length} videos · {result.manifest.copy.length} copy sets
          </p>
          <div className="flex flex-wrap gap-1.5">
            {result.manifestUrl && (
              <a href={result.manifestUrl} target="_blank" rel="noreferrer" className={linkChip}>
                <Download className="h-3 w-3" /> manifest.json
              </a>
            )}
            {result.zipUrl && (
              <a href={result.zipUrl} className={linkChip}>
                <Download className="h-3 w-3" /> zip
              </a>
            )}
            {files
              .filter((f) => !/^thumbnails\//.test(f.path))
              .map((f) => (
                <a key={f.path} href={f.url!} target="_blank" rel="noreferrer" className={linkChip} title={fmtBytes(f.bytes)}>
                  <Download className="h-3 w-3" /> {f.path}
                </a>
              ))}
          </div>
          {result.manifest.notes.length > 0 && <p className="text-[11px] text-muted-foreground">{result.manifest.notes.join(" ")}</p>}
        </div>
      )}
    </div>
  );
}
