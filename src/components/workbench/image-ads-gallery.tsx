"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ImageIcon, Loader2 } from "lucide-react";
import { AD_FORMATS } from "@/services/image-ads/formats";
import { TEMPLATES } from "@/services/image-ads/templates";
import type { ImageAdSet } from "@/services/image-ads/generate";
import { btnPrimary, Chip, ErrorNote, Label, linkChip, Panel, toggle } from "./bits";
import { fmtBytes, groupImageAds, postJson } from "./view-model";

const FORMAT_OPTIONS = AD_FORMATS.map((f) => ({ id: f.id, label: `${f.label} (${f.w}×${f.h})` }));
const TEMPLATE_NAME = new Map(TEMPLATES.map((t) => [t.id as string, t.name]));

/** Static image ads from the brief + plan: templates × formats, rendered locally (no paid model), grouped by format. */
export function ImageAdsGallery({ projectId }: { projectId: string }) {
  const [sets, setSets] = useState<ImageAdSet[] | null>(null);
  const [templates, setTemplates] = useState<string[]>(["hero-product", "split-benefit"]);
  const [formats, setFormats] = useState<string[]>(["1080x1080", "1080x1350", "1080x1920"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setIndex, setSetIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/image-ads`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ sets: ImageAdSet[] }>) : { sets: [] }))
      .then((d) => alive && setSets(d.sets ?? []))
      .catch(() => alive && setSets([]));
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ set: ImageAdSet }>(`/api/projects/${projectId}/image-ads`, { templates, formats });
      setSets((s) => [data.set, ...(s ?? [])].slice(0, 5));
      setSetIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate image ads");
    } finally {
      setBusy(false);
    }
  }

  const set = sets?.[setIndex] ?? null;
  const groups = useMemo(() => groupImageAds(set, FORMAT_OPTIONS), [set]);

  return (
    <Panel
      icon={<ImageIcon className="h-4 w-4" />}
      title="Image ads"
      testId="image-ads"
      description="Static ads from the same brief and plan as the video, in every placement size. Rendered locally from the packshot and brand kit — no paid model."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Templates</Label>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <Chip key={t.id} checked={templates.includes(t.id)} onChange={(on) => setTemplates((l) => toggle(l, t.id, on))} title={`${t.useFor}${t.requires.length ? ` · needs ${t.requires.join(", ")}` : ""}`}>
                {t.name}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <Label>Formats</Label>
          <div className="flex flex-wrap gap-1.5">
            {FORMAT_OPTIONS.map((f) => (
              <Chip key={f.id} checked={formats.includes(f.id)} onChange={(on) => setFormats((l) => toggle(l, f.id, on))}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} onClick={generate} disabled={busy || !templates.length || !formats.length}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />} Generate {templates.length * formats.length} ads
        </button>
        {sets && sets.length > 1 && (
          <select aria-label="Image ad set" className="h-8 rounded-md border border-border bg-background px-2 text-xs" value={setIndex} onChange={(e) => setSetIndex(Number(e.target.value))}>
            {sets.map((s, i) => (
              <option key={s.createdAt + i} value={i}>
                {new Date(s.createdAt).toLocaleString()} · {s.items.length} ads
              </option>
            ))}
          </select>
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>
      {sets === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : !set ? (
        <p className="text-xs text-muted-foreground">No image ads yet.</p>
      ) : (
        <div className="space-y-4">
          {set.skipped?.length > 0 && <p className="text-[11px] text-muted-foreground">Skipped: {set.skipped.map((s) => `${TEMPLATE_NAME.get(s.template) ?? s.template} (${s.reason})`).join("; ")}</p>}
          {groups.map((g) => (
            <div key={g.format}>
              <p className="mb-1.5 text-xs font-semibold">
                {g.label} <span className="font-normal text-muted-foreground">{g.items.length}</span>
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {g.items.map((it) => (
                  <figure key={it.url} className="overflow-hidden rounded-lg border border-border bg-muted/40">
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote blob URLs of arbitrary size */}
                    <img src={it.url} alt={`${TEMPLATE_NAME.get(it.template) ?? it.template} ${it.format}`} loading="lazy" className="max-h-56 w-full object-contain" />
                    <figcaption className="flex items-center justify-between gap-1 p-1.5 text-[11px]">
                      <span className="truncate" title={it.notes?.join(" · ")}>
                        {TEMPLATE_NAME.get(it.template) ?? it.template}
                      </span>
                      <a href={it.url} download target="_blank" rel="noreferrer" className={linkChip} title={fmtBytes(it.bytes)}>
                        <Download className="h-3 w-3" /> PNG
                      </a>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
