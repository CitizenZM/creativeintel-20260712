"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  Loader2,
  Palette,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface BrandAsset {
  id: string;
  kind: string;
  variant: string | null;
  url: string;
  provider: string;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number | null;
  caption: string | null;
}

interface BrandColor {
  name?: string;
  hex: string;
  usage?: "primary" | "secondary" | "accent" | "background" | "text";
}

interface CtaOption {
  text: string;
  priority?: number;
}

interface SkuDimensions {
  height?: number;
  width?: number;
  depth?: number;
  weightG?: number;
}

interface Completeness {
  score: number;
  missing: string[];
  ready: { creative: boolean; studio: boolean };
}

interface BrandKitResponse {
  kit: {
    colorsHex: BrandColor[] | null;
    ctaOptions: CtaOption[] | null;
    offerText: string | null;
    landingUrl: string | null;
    claimsAllowed: string[] | null;
    claimsForbidden: string[] | null;
    toneGuidelines: string | null;
    doNotShow: string[] | null;
    skuName: string | null;
    skuDimensionsCm: SkuDimensions | null;
    productSummary: string | null;
  };
  assets: BrandAsset[];
  completeness: Completeness;
  storage: { provider: string; configured: boolean };
}

interface FormState {
  colors: BrandColor[];
  ctas: CtaOption[];
  offerText: string;
  landingUrl: string;
  claimsAllowed: string[];
  claimsForbidden: string[];
  toneGuidelines: string;
  doNotShow: string[];
  skuName: string;
  dims: { height: string; width: string; depth: string; weightG: string };
  productSummary: string;
}

const EMPTY: FormState = {
  colors: [],
  ctas: [],
  offerText: "",
  landingUrl: "",
  claimsAllowed: [],
  claimsForbidden: [],
  toneGuidelines: "",
  doNotShow: [],
  skuName: "",
  dims: { height: "", width: "", depth: "", weightG: "" },
  productSummary: "",
};

const PACKSHOT_VARIANTS = ["front", "side", "in-hand", "transparent"] as const;

function numOrUndefined(v: string): number | undefined {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
}

function CompletenessRing({ score }: { score: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const tone = score >= 90 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-500";

  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={radius} className="stroke-muted" strokeWidth="6" fill="none" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          className={cn("transition-all duration-500", tone)}
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          fill="none"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn("text-sm font-semibold tabular-nums", tone)}>{score}</span>
      </div>
    </div>
  );
}

function StringListEditor({
  label,
  hint,
  values,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange([...values, v]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="h-8 text-sm"
        />
        <Button type="button" size="sm" variant="outline" onClick={add} className="h-8 px-2">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {values.length > 0 && (
        <ul className="space-y-1">
          {values.map((v, i) => (
            <li key={`${v}-${i}`} className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs">
              <span className="flex-1 break-words">{v}</span>
              <button
                type="button"
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${v}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BrandKitPanel({ projectId }: { projectId: string }) {
  // The "% complete / Still missing" summary above this panel and the stage
  // rail are server-rendered, so a client-side save left them showing a stale
  // score until a manual reload — router.refresh() re-renders them in place.
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [completeness, setCompleteness] = useState<Completeness | null>(null);
  const [storage, setStorage] = useState<{ provider: string; configured: boolean }>({
    provider: "inline",
    configured: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const uploadTarget = useRef<{ kind: string; variant?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyResponse = useCallback((d: BrandKitResponse) => {
    const kit = d.kit;
    setForm({
      colors: kit.colorsHex || [],
      ctas: kit.ctaOptions || [],
      offerText: kit.offerText || "",
      landingUrl: kit.landingUrl || "",
      claimsAllowed: kit.claimsAllowed || [],
      claimsForbidden: kit.claimsForbidden || [],
      toneGuidelines: kit.toneGuidelines || "",
      doNotShow: kit.doNotShow || [],
      skuName: kit.skuName || "",
      dims: {
        height: kit.skuDimensionsCm?.height?.toString() ?? "",
        width: kit.skuDimensionsCm?.width?.toString() ?? "",
        depth: kit.skuDimensionsCm?.depth?.toString() ?? "",
        weightG: kit.skuDimensionsCm?.weightG?.toString() ?? "",
      },
      productSummary: kit.productSummary || "",
    });
    setAssets(d.assets || []);
    setCompleteness(d.completeness);
    if (d.storage) setStorage(d.storage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/brand-kit`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load brand kit");
        return r.json() as Promise<BrandKitResponse>;
      })
      .then((d) => {
        if (!cancelled) applyResponse(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load brand kit");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, applyResponse]);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const dims: SkuDimensions = {
        height: numOrUndefined(form.dims.height),
        width: numOrUndefined(form.dims.width),
        depth: numOrUndefined(form.dims.depth),
        weightG: numOrUndefined(form.dims.weightG),
      };
      const hasDims = Object.values(dims).some((v) => typeof v === "number");

      const res = await fetch(`/api/projects/${projectId}/brand-kit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colorsHex: form.colors.filter((c) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c.hex.trim())),
          ctaOptions: form.ctas
            .filter((c) => c.text.trim())
            .map((c, i) => ({ text: c.text.trim(), priority: i + 1 })),
          offerText: form.offerText.trim(),
          landingUrl: form.landingUrl.trim(),
          claimsAllowed: form.claimsAllowed,
          claimsForbidden: form.claimsForbidden,
          toneGuidelines: form.toneGuidelines.trim(),
          doNotShow: form.doNotShow,
          skuName: form.skuName.trim(),
          skuDimensionsCm: hasDims ? dims : null,
          productSummary: form.productSummary.trim(),
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to save brand kit");
      applyResponse(payload as BrandKitResponse);
      setNotice("Brand kit saved.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save brand kit");
    } finally {
      setSaving(false);
    }
  }

  function pickFile(kind: string, variant?: string) {
    uploadTarget.current = { kind, variant };
    fileInputRef.current?.click();
  }

  async function handleFiles(files: FileList) {
    const target = uploadTarget.current;
    if (!target) return;
    setUploading(`${target.kind}:${target.variant || ""}`);
    setError(null);
    setNotice(null);

    try {
      for (const file of Array.from(files).slice(0, 6)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", target.kind);
        if (target.variant) fd.append("variant", target.variant);
        fd.append("caption", file.name);

        const res = await fetch(`/api/projects/${projectId}/brand-kit/assets`, {
          method: "POST",
          body: fd,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `Upload failed for ${file.name}`);

        setAssets((prev) => [...prev, payload.asset as BrandAsset]);
        if (payload.completeness) setCompleteness(payload.completeness as Completeness);
        if (payload.warning) setNotice(payload.warning as string);
        if (payload.provider) setStorage((s) => ({ ...s, provider: payload.provider as string }));
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
      uploadTarget.current = null;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeAsset(assetId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/brand-kit/assets/${assetId}`, { method: "DELETE" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to delete asset");
      setAssets((prev) => prev.filter((a) => a.id !== assetId));
      if (payload.completeness) setCompleteness(payload.completeness as Completeness);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete asset");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading brand kit…
      </div>
    );
  }

  const logos = assets.filter((a) => a.kind === "LOGO");
  const packshots = assets.filter((a) => a.kind === "PACKSHOT");
  const score = completeness?.score ?? 0;
  const ready = completeness?.ready.creative ?? false;

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,font/*"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {/* Completeness */}
      <div
        className={cn(
          "flex items-start gap-4 rounded-xl border px-4 py-3",
          ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
        )}
      >
        <CompletenessRing score={score} />
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-semibold", ready ? "text-emerald-800" : "text-amber-800")}>
            {ready
              ? completeness?.ready.studio
                ? "Brand kit complete — creative and studio unlocked"
                : "Brand kit ready for creative — add SKU dimensions for studio"
              : "Brand kit incomplete — AI will have to guess"}
          </p>
          {completeness && completeness.missing.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {completeness.missing.map((m) => (
                <li key={m} className="text-[11px] text-muted-foreground">
                  · {m}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button size="sm" onClick={save} disabled={saving} className="h-8 gap-1.5 text-xs shrink-0">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save brand kit
        </Button>
      </div>

      {storage.provider === "inline" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            No asset storage configured — uploads are stored inline in the database as data URLs. Set
            <code className="mx-1 rounded bg-amber-100 px-1">CLOUDINARY_URL</code> or
            <code className="mx-1 rounded bg-amber-100 px-1">BLOB_READ_WRITE_TOKEN</code> for hosted assets.
          </span>
        </div>
      )}
      {storage.provider !== "inline" && (
        <p className="text-[10px] text-muted-foreground">
          Asset storage: <span className="font-medium">{storage.provider}</span>
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss notice">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Logos */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Logo</p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => pickFile("LOGO", "light")}
              disabled={!!uploading}
            >
              {uploading === "LOGO:light" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Upload className="h-2.5 w-2.5" />}
              Light background
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => pickFile("LOGO", "dark")}
              disabled={!!uploading}
            >
              {uploading === "LOGO:dark" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Upload className="h-2.5 w-2.5" />}
              Dark background
            </Button>
          </div>
        </div>
        {logos.length > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {logos.map((a) => (
              <AssetTile key={a.id} asset={a} onRemove={() => removeAsset(a.id)} />
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Upload a transparent PNG or SVG for each background. Used on end cards and overlays.
          </p>
        )}
      </div>

      {/* Packshots */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Product packshots ({packshots.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PACKSHOT_VARIANTS.map((v) => (
              <Button
                key={v}
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={() => pickFile("PACKSHOT", v)}
                disabled={!!uploading}
              >
                {uploading === `PACKSHOT:${v}` ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Upload className="h-2.5 w-2.5" />
                )}
                {v}
              </Button>
            ))}
          </div>
        </div>
        {packshots.length > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {packshots.map((a) => (
              <AssetTile key={a.id} asset={a} onRemove={() => removeAsset(a.id)} />
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            At least two packshots are required. Transparent PNGs on a clean background give the AI the most
            reliable product reference.
          </p>
        )}
      </div>

      {/* Colours + fonts + SKU */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Palette className="h-3.5 w-3.5" /> Brand colours ({form.colors.length})
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => setForm((f) => ({ ...f, colors: [...f.colors, { hex: "#000000", usage: "primary" }] }))}
            >
              <Plus className="h-2.5 w-2.5" /> Add colour
            </Button>
          </div>
          <div className="space-y-2">
            {form.colors.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="h-7 w-7 shrink-0 rounded border border-border"
                  style={{ backgroundColor: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c.hex) ? c.hex : "transparent" }}
                />
                <Input
                  value={c.hex}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      colors: f.colors.map((x, idx) => (idx === i ? { ...x, hex: e.target.value } : x)),
                    }))
                  }
                  placeholder="#1A2B3C"
                  className="h-7 w-28 text-xs"
                />
                <select
                  value={c.usage || "primary"}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      colors: f.colors.map((x, idx) =>
                        idx === i ? { ...x, usage: e.target.value as BrandColor["usage"] } : x
                      ),
                    }))
                  }
                  className="h-7 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
                >
                  {["primary", "secondary", "accent", "background", "text"].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, colors: f.colors.filter((_, idx) => idx !== i) }))}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Remove colour"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {form.colors.length === 0 && (
              <p className="text-[11px] text-muted-foreground">Add at least three brand hex colours.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SKU</p>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">SKU name</Label>
            <Input
              value={form.skuName}
              onChange={(e) => setForm((f) => ({ ...f, skuName: e.target.value }))}
              placeholder="Exact SKU / model name"
              className="h-8 text-sm"
            />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(["height", "width", "depth", "weightG"] as const).map((key) => (
              <div key={key} className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {key === "weightG" ? "Weight g" : `${key} cm`}
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.dims[key]}
                  onChange={(e) => setForm((f) => ({ ...f, dims: { ...f.dims, [key]: e.target.value } }))}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Dimensions keep AI-generated scenes at the right scale — required for the studio.
          </p>
        </div>
      </div>

      {/* CTAs + offer + landing */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Approved CTAs ({form.ctas.length})
            </Label>
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => setForm((f) => ({ ...f, ctas: [...f.ctas, { text: "" }] }))}
            >
              <Plus className="h-2.5 w-2.5" /> Add CTA
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Scripts and creative variants may only use this approved copy. Order sets priority.
          </p>
          {form.ctas.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-center text-[10px] text-muted-foreground">{i + 1}</span>
              <Input
                value={c.text}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    ctas: f.ctas.map((x, idx) => (idx === i ? { ...x, text: e.target.value } : x)),
                  }))
                }
                placeholder="Shop now"
                className="h-8 flex-1 text-sm"
              />
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, ctas: f.ctas.filter((_, idx) => idx !== i) }))}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Remove CTA"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Offer</Label>
            <Input
              value={form.offerText}
              onChange={(e) => setForm((f) => ({ ...f, offerText: e.target.value }))}
              placeholder="20% off with code SAVE20"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Landing URL</Label>
            <Input
              type="url"
              value={form.landingUrl}
              onChange={(e) => setForm((f) => ({ ...f, landingUrl: e.target.value }))}
              placeholder="https://brand.com/products/hero-sku"
              className="h-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Claims, tone, do-not-show */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <StringListEditor
            label="Allowed claims"
            hint="Leave empty and save to record 'no approved claims' — the AI will then avoid product claims entirely."
            values={form.claimsAllowed}
            placeholder="Clinically tested for 24h hydration"
            onChange={(v) => setForm((f) => ({ ...f, claimsAllowed: v }))}
          />
          <StringListEditor
            label="Forbidden claims"
            values={form.claimsForbidden}
            placeholder="Cures acne"
            onChange={(v) => setForm((f) => ({ ...f, claimsForbidden: v }))}
          />
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tone guidelines
            </Label>
            <Textarea
              value={form.toneGuidelines}
              onChange={(e) => setForm((f) => ({ ...f, toneGuidelines: e.target.value }))}
              rows={3}
              placeholder="Warm, direct, no hype. Second person. No exclamation marks."
              className="text-sm"
            />
          </div>
          <StringListEditor
            label="Do not show"
            hint="Visual do-nots enforced in storyboard and studio prompts."
            values={form.doNotShow}
            placeholder="Competitor packaging"
            onChange={(v) => setForm((f) => ({ ...f, doNotShow: v }))}
          />
        </div>
      </div>

      {/* Product summary */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Product summary
        </Label>
        <p className="text-[10px] text-muted-foreground">
          One canonical paragraph. Injected verbatim into every script and studio prompt.
        </p>
        <Textarea
          value={form.productSummary}
          onChange={(e) => setForm((f) => ({ ...f, productSummary: e.target.value }))}
          rows={4}
          placeholder="What the product is, who it is for, and the single most important benefit."
          className="text-sm"
        />
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving} className="h-8 gap-1.5 text-xs">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save brand kit
        </Button>
      </div>
    </div>
  );
}

function AssetTile({ asset, onRemove }: { asset: BrandAsset; onRemove: () => void }) {
  const isImage = !asset.format || !["pdf", "woff", "woff2", "ttf", "otf"].includes(asset.format);

  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.url}
          alt={asset.caption || asset.kind}
          className="h-full w-full bg-white object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-white text-[10px] text-muted-foreground">
          {asset.format?.toUpperCase()}
        </div>
      )}
      {asset.variant && (
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[8px] font-semibold text-white">
          {asset.variant}
        </span>
      )}
      <button
        onClick={onRemove}
        className="absolute right-1 top-1 rounded bg-black/50 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Remove asset"
      >
        <X className="h-2.5 w-2.5" />
      </button>
      {asset.width && asset.height && (
        <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1 text-[8px] text-white">
          {asset.width}×{asset.height}
        </span>
      )}
    </div>
  );
}
