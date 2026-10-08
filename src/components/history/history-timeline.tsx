"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileJson, History as HistoryIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupHistory, formatBytes } from "@/services/artifacts/history-view";
import { mediaCategory } from "@/services/artifacts/kinds";
import type { ArtifactListItem } from "@/services/artifacts/serve";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Where a preview loads from: the blob URL when public, else the archived bytes. */
function previewSrc(a: ArtifactListItem) {
  return a.url && /^https?:/i.test(a.url) ? a.url : `${a.downloadUrl}?inline=1`;
}

function Preview({ a }: { a: ArtifactListItem }) {
  if (a.isDocument) return null;
  const cat = mediaCategory(a.contentType, a.url);
  if (cat === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={previewSrc(a)} alt={a.title} loading="lazy" className="h-28 w-auto max-w-[220px] rounded-md border border-border object-contain bg-muted" />;
  }
  if (cat === "video") return <video src={previewSrc(a)} controls preload="metadata" className="h-40 max-w-[260px] rounded-md border border-border bg-black" />;
  if (cat === "audio") return <audio src={previewSrc(a)} controls preload="none" className="w-64" />;
  return null;
}

function JsonViewer({ a }: { a: ArtifactListItem }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && text === null) {
      const res = await fetch(`${a.downloadUrl}?inline=1`).catch(() => null);
      if (!res?.ok) return setError("Could not load this version.");
      const body = await res.text();
      try {
        setText(JSON.stringify(JSON.parse(body), null, 2));
      } catch {
        setText(body);
      }
    }
  }
  return (
    <div className="w-full">
      <button type="button" onClick={toggle} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <FileJson className="h-3.5 w-3.5" />
        {open ? "Hide" : (a.contentType ?? "").includes("html") ? "View source" : "View JSON"}
      </button>
      {open && (
        <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
          {error ?? text ?? "Loading…"}
        </pre>
      )}
    </div>
  );
}

function DownloadLink({ a }: { a: ArtifactListItem }) {
  return (
    <a href={a.downloadUrl} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted" title={a.sha256 ? `sha256 ${a.sha256}` : undefined}>
      <Download className="h-3.5 w-3.5" /> Download
    </a>
  );
}

function VersionRow({ a, latest }: { a: ArtifactListItem; latest?: boolean }) {
  const note = (a.meta as { fetchError?: string; beforeEdit?: string } | null) ?? null;
  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={cn("rounded px-1.5 py-0.5 font-semibold num", latest ? "bg-foreground text-background" : "bg-muted")}>v{a.version}</span>
        <span className="text-muted-foreground">{fmt(a.producedAt ?? a.createdAt)}</span>
        {!a.isDocument && <span className="text-muted-foreground num">{formatBytes(a.bytes)}</span>}
        {a.hasBlob && <span className="rounded bg-[color-mix(in_oklab,var(--status-healthy-bg)_60%,transparent)] px-1.5 py-0.5 text-[10px]">bytes in DB</span>}
        {note?.fetchError && <span className="rounded bg-[color-mix(in_oklab,var(--status-urgent-bg)_60%,transparent)] px-1.5 py-0.5 text-[10px]">unreachable: {note.fetchError}</span>}
        <span className="text-[10px] text-muted-foreground truncate max-w-[360px]" title={a.sourceField}>{a.sourceField}</span>
        <span className="ml-auto"><DownloadLink a={a} /></span>
      </div>
      {note?.beforeEdit && <p className="text-[11px] text-muted-foreground">State before the chat edit “{note.beforeEdit}”</p>}
      <Preview a={a} />
      {a.isDocument && <JsonViewer a={a} />}
    </div>
  );
}

export function HistoryTimeline({ projectId, items }: { projectId: string; items: ArtifactListItem[] }) {
  const [kind, setKind] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => groupHistory(items), [items]);
  const shown = kind ? groups.filter((g) => g.kind === kind) : groups;
  const archive = `/api/projects/${projectId}/artifacts/archive`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
            <HistoryIcon className="h-4 w-4" /> Content history
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            Every brief, plan, script, storyboard, keyframe, clip, master, variant, export, image ad and report this project produced — each
            change kept as a new version, nothing overwritten. Documents are stored in the database; files keep their size and sha256, and small
            files (≤ 2 MB) their bytes too.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`${archive}?latest=1${kind ? `&kind=${kind}` : ""}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
            <Download className="h-3.5 w-3.5" /> Latest versions (.zip)
          </a>
          <a href={`${archive}${kind ? `?kind=${kind}` : ""}`} className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90">
            <Download className="h-3.5 w-3.5" /> Download all{kind ? ` ${kind}` : ""} (.zip)
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setKind(null)} className={cn("rounded-full border px-2.5 py-1 text-xs", !kind ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
          All <span className="num opacity-70">{items.length}</span>
        </button>
        {groups.map((g) => (
          <button key={g.kind} type="button" onClick={() => setKind(g.kind === kind ? null : g.kind)} className={cn("rounded-full border px-2.5 py-1 text-xs", kind === g.kind ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
            {g.label} <span className="num opacity-70">{g.count}</span>
          </button>
        ))}
      </div>

      {items.length === 0 && (
        <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border p-4">
          Nothing archived yet. New content is archived as it is produced; existing content is registered by the backfill (operator action
          <code className="mx-1">artifacts-backfill</code>).
        </p>
      )}

      {shown.map((g) => (
        <section key={g.kind} className="space-y-2">
          <h3 className="text-sm font-semibold tracking-tight">
            {g.label} <span className="text-xs font-normal text-muted-foreground num">({g.count})</span>
          </h3>
          <ol className="relative space-y-3 border-l border-border pl-4">
            {g.slots.map((s) => {
              const open = !!expanded[s.sourceKey];
              const older = s.versions.slice(1);
              return (
                <li key={s.sourceKey} className="rounded-lg border border-border bg-card p-3">
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border border-border bg-background" aria-hidden />
                  <p className="text-sm font-medium">{s.latest.title}</p>
                  <VersionRow a={s.latest} latest />
                  {older.length > 0 && (
                    <div className="border-t border-border pt-2">
                      <button type="button" onClick={() => setExpanded((e) => ({ ...e, [s.sourceKey]: !open }))} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {older.length} earlier version{older.length === 1 ? "" : "s"}
                      </button>
                      {open && (
                        <div className="divide-y divide-border">
                          {older.map((v) => (
                            <VersionRow key={v.id} a={v} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
