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
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { markStagesStale } from "@/lib/stage-events";
import { fieldStatus, hasValue, readStatusMap, type FieldStatus, type FieldStatusMap } from "@/lib/field-status";
import { FieldLegend, FieldShell } from "@/components/ui/field-shell";

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
  verified: boolean;
}

/** Status for a group of assets (logo / packshots) per the goal's rule 2. */
function assetGroupStatus(assets: BrandAsset[]): FieldStatus {
  if (assets.length === 0) return "missing";
  if (assets.some((a) => a.verified)) return "confirmed";
  return "suggested";
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
    fieldStatus: unknown;
  };
  assets: BrandAsset[];
  completeness: Completeness;
  storage: { provider: string; configured: boolean };
  suggested?: { fields: string[]; packshots: number; logo: boolean };
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
  const [otherProjects, setOtherProjects] = useState<{ id: string; brandName: string }[]>([]);
  const [copying, setCopying] = useState(false);
  const [statusMap, setStatusMap] = useState<FieldStatusMap>({});
  const [suggesting, setSuggesting] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const suggestedAtRef = useRef<string | null>(null);
  const autoSuggestTried = useRef(false);

  // Offered only when this kit is still thin — once it is filled in, a copy
  // would be more likely to overwrite deliberate work than to save time.
  useEffect(() => {
    if ((completeness?.score ?? 0) >= 60) return;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((rows) => {
        if (!Array.isArray(rows)) return;
        setOtherProjects(
          rows
            .filter((r: { id: string }) => r.id !== projectId)
            .slice(0, 30)
            .map((r: { id: string; brandName: string }) => ({ id: r.id, brandName: r.brandName }))
        );
      })
      .catch(() => {});
  }, [projectId, completeness?.score]);

  async function copyFrom(sourceProjectId: string) {
    setCopying(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/brand-kit/copy-from`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceProjectId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not copy that Brand Kit");
      setNotice(`Copied the brand rules and ${payload.copiedAssets ?? 0} asset(s).`);
      const fresh = await fetch(`/api/projects/${projectId}/brand-kit`).then((r) => r.json());
      applyResponse(fresh as BrandKitResponse);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy that Brand Kit");
    } finally {
      setCopying(false);
    }
  }

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
    setStatusMap(readStatusMap(kit.fieldStatus));
    const raw = kit.fieldStatus as Record<string, unknown> | null;
    suggestedAtRef.current = raw && typeof raw.__suggestedAt === "string" ? raw.__suggestedAt : null;
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

  const suggest = useCallback(
    async (auto: boolean) => {
      setSuggesting(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/brand-kit/suggest`, { method: "POST" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || "Could not generate suggestions");
        applyResponse(payload as BrandKitResponse);
        const s = (payload as BrandKitResponse).suggested;
        const filledCount = (s?.fields.length ?? 0) + (s?.packshots ?? 0) + (s?.logo ? 1 : 0);
        if (!auto || filledCount > 0) {
          setNotice(filledCount > 0 ? `Pre-filled ${filledCount} suggestion(s) from your product page.` : "No new suggestions found.");
        }
        markStagesStale();
        router.refresh();
      } catch (e) {
        if (!auto) setError(e instanceof Error ? e.message : "Could not generate suggestions");
      } finally {
        setSuggesting(false);
      }
    },
    [projectId, applyResponse, router]
  );

  // Auto-run once per kit: only when some suggestible fields/assets are
  // still empty and suggestions have never been generated for this kit.
  useEffect(() => {
    if (loading || autoSuggestTried.current) return;
    if (suggestedAtRef.current) return; // already generated once for this kit
    const logos = assets.filter((a) => a.kind === "LOGO");
    const packshots = assets.filter((a) => a.kind === "PACKSHOT");
    const stillEmpty =
      form.colors.length === 0 ||
      form.ctas.length === 0 ||
      !form.landingUrl.trim() ||
      !form.productSummary.trim() ||
      logos.length === 0 ||
      packshots.length < 2;
    if (!stillEmpty) return;
    autoSuggestTried.current = true;
    suggest(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function confirmField(key: string) {
    setConfirming(key);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/brand-kit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: [key] }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not confirm field");
      applyResponse(payload as BrandKitResponse);
      markStagesStale();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not confirm field");
    } finally {
      setConfirming(null);
    }
  }

  async function confirmAll() {
    setConfirming("all");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/brand-kit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "all" }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not confirm suggestions");
      applyResponse(payload as BrandKitResponse);
      setNotice("All suggestions confirmed.");
      markStagesStale();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not confirm suggestions");
    } finally {
      setConfirming(null);
    }
  }

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
      markStagesStale();
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
      markStagesStale();
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
      markStagesStale();
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
  // Point at the first thing still missing — a logo, then packshots — and at
  // nothing once both are satisfied.
  const nextUpload: "logo" | "packshot" | null = !uploading
    ? logos.length === 0
      ? "logo"
      : packshots.length < 2
        ? "packshot"
        : null
    : null;
  const score = completeness?.score ?? 0;
  const ready = completeness?.ready.creative ?? false;

  const fieldStatuses: Record<string, FieldStatus> = {
    colors: fieldStatus(form.colors, statusMap.colors),
    cta: fieldStatus(form.ctas, statusMap.cta),
    offer: fieldStatus(form.offerText, statusMap.offer),
    landingUrl: fieldStatus(form.landingUrl, statusMap.landingUrl),
    // An explicit empty array ("no claims") counts as confirmed even with no mark.
    claimsAllowed: form.claimsAllowed.length === 0 && !statusMap.claimsAllowed ? "confirmed" : fieldStatus(form.claimsAllowed, statusMap.claimsAllowed),
    claimsForbidden: fieldStatus(form.claimsForbidden, statusMap.claimsForbidden),
    tone: fieldStatus(form.toneGuidelines, statusMap.tone),
    doNotShow: fieldStatus(form.doNotShow, statusMap.doNotShow),
    skuName: fieldStatus(form.skuName, statusMap.skuName),
    skuDimensions: fieldStatus(
      Object.values(form.dims).some((v) => v.trim() !== "") ? form.dims : null,
      statusMap.skuDimensions
    ),
    productSummary: fieldStatus(form.productSummary, statusMap.productSummary),
    logo: assetGroupStatus(logos),
    packshots: assetGroupStatus(packshots),
  };
  const statusValues = Object.values(fieldStatuses);
  const missingCount = statusValues.filter((s) => s === "missing").length;
  const suggestedCount = statusValues.filter((s) => s === "suggested").length;

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

      {/* Field-status legend, summary and suggestion controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2">
        <div className="space-y-1.5">
          <FieldLegend />
          <p className="text-[11px] text-muted-foreground">
            {missingCount === 0 && suggestedCount === 0
              ? "Every field is confirmed."
              : `${missingCount} need${missingCount === 1 ? "s" : ""} your input · ${suggestedCount} suggestion${suggestedCount === 1 ? "" : "s"} to check`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-[11px]"
            onClick={() => suggest(false)}
            disabled={suggesting}
          >
            {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Suggest answers
          </Button>
          {suggestedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-[var(--status-healthy)] text-[11px] text-[var(--status-healthy-fg)]"
              onClick={confirmAll}
              disabled={confirming === "all"}
            >
              {confirming === "all" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Confirm all suggestions
            </Button>
          )}
        </div>
      </div>
      {suggesting && (
        <p className="text-[11px] text-muted-foreground">Pre-filling suggestions from your product page…</p>
      )}

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
      {otherProjects.length > 0 && (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2.5">
          <p className="text-xs font-medium">Reuse a Brand Kit you already built</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Copies colours, CTAs, claims, tone and any logo or packshot slots still empty here.
            Product-specific fields stay untouched.
          </p>
          <select
            disabled={copying}
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) copyFrom(e.target.value);
              e.target.value = "";
            }}
            className="mt-2 h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">{copying ? "Copying…" : "Choose a project…"}</option>
            {otherProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.brandName}
              </option>
            ))}
          </select>
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
      <FieldShell
        status={fieldStatuses.logo}
        className="bg-card"
        onConfirm={fieldStatuses.logo === "suggested" ? () => confirmField("logo") : undefined}
        confirming={confirming === "logo"}
        label={<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Logo</span>}
      >
        <div className="flex items-center justify-end">
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className={cn("h-6 gap-1 px-2 text-[10px]", nextUpload === "logo" && "cta-attention")}
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
      </FieldShell>

      {/* Packshots */}
      <FieldShell
        status={fieldStatuses.packshots}
        className="bg-card"
        onConfirm={fieldStatuses.packshots === "suggested" ? () => confirmField("packshots") : undefined}
        confirming={confirming === "packshots"}
        label={
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Product packshots ({packshots.length})
          </span>
        }
      >
        <div className="flex items-center justify-end gap-2">

          <div className="flex flex-wrap gap-1.5">
            {PACKSHOT_VARIANTS.map((v) => (
              <Button
                key={v}
                size="sm"
                variant="outline"
                className={cn(
                  "h-6 gap-1 px-2 text-[10px]",
                  nextUpload === "packshot" && v === "front" && "cta-attention"
                )}
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
      </FieldShell>

      {/* Colours + fonts + SKU */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FieldShell
          status={fieldStatuses.colors}
          className="bg-card"
          onConfirm={fieldStatuses.colors === "suggested" ? () => confirmField("colors") : undefined}
          confirming={confirming === "colors"}
          label={
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Palette className="h-3.5 w-3.5" /> Brand colours ({form.colors.length})
            </span>
          }
        >
          <div className="flex items-center justify-end">
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
        </FieldShell>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SKU</p>
          <FieldShell
            status={fieldStatuses.skuName}
            onConfirm={fieldStatuses.skuName === "suggested" ? () => confirmField("skuName") : undefined}
            confirming={confirming === "skuName"}
            label={<span className="text-[10px] uppercase tracking-wide text-muted-foreground">SKU name</span>}
          >
            <Input
              value={form.skuName}
              onChange={(e) => setForm((f) => ({ ...f, skuName: e.target.value }))}
              placeholder="Exact SKU / model name"
              className="h-8 text-sm"
            />
          </FieldShell>
          <FieldShell
            status={fieldStatuses.skuDimensions}
            onConfirm={fieldStatuses.skuDimensions === "suggested" ? () => confirmField("skuDimensions") : undefined}
            confirming={confirming === "skuDimensions"}
            label={<span className="text-[10px] uppercase tracking-wide text-muted-foreground">Dimensions</span>}
            hint="Dimensions keep AI-generated scenes at the right scale — required for the studio. Leave blank if not stated on the product page."
          >
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
          </FieldShell>
        </div>
      </div>

      {/* CTAs + offer + landing */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <FieldShell
          status={fieldStatuses.cta}
          onConfirm={fieldStatuses.cta === "suggested" ? () => confirmField("cta") : undefined}
          confirming={confirming === "cta"}
          label={
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Approved CTAs ({form.ctas.length})
            </span>
          }
        >
          <div className="flex items-center justify-end">
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
        </FieldShell>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldShell
            status={fieldStatuses.offer}
            onConfirm={fieldStatuses.offer === "suggested" ? () => confirmField("offer") : undefined}
            confirming={confirming === "offer"}
            label={<span className="text-[10px] uppercase tracking-wide text-muted-foreground">Offer</span>}
          >
            <Input
              value={form.offerText}
              onChange={(e) => setForm((f) => ({ ...f, offerText: e.target.value }))}
              placeholder="20% off with code SAVE20"
              className="h-8 text-sm"
            />
          </FieldShell>
          <FieldShell
            status={fieldStatuses.landingUrl}
            onConfirm={fieldStatuses.landingUrl === "suggested" ? () => confirmField("landingUrl") : undefined}
            confirming={confirming === "landingUrl"}
            label={<span className="text-[10px] uppercase tracking-wide text-muted-foreground">Landing URL</span>}
          >
            <Input
              type="url"
              value={form.landingUrl}
              onChange={(e) => setForm((f) => ({ ...f, landingUrl: e.target.value }))}
              placeholder="https://brand.com/products/hero-sku"
              className="h-8 text-sm"
            />
          </FieldShell>
        </div>
      </div>

      {/* Claims, tone, do-not-show */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <FieldShell
            status={fieldStatuses.claimsAllowed}
            onConfirm={fieldStatuses.claimsAllowed === "suggested" ? () => confirmField("claimsAllowed") : undefined}
            confirming={confirming === "claimsAllowed"}
          >
            <StringListEditor
              label="Allowed claims"
              hint="Leave empty and save to record 'no approved claims' — the AI will then avoid product claims entirely."
              values={form.claimsAllowed}
              placeholder="Clinically tested for 24h hydration"
              onChange={(v) => setForm((f) => ({ ...f, claimsAllowed: v }))}
            />
          </FieldShell>
          <FieldShell
            status={fieldStatuses.claimsForbidden}
            onConfirm={fieldStatuses.claimsForbidden === "suggested" ? () => confirmField("claimsForbidden") : undefined}
            confirming={confirming === "claimsForbidden"}
          >
            <StringListEditor
              label="Forbidden claims"
              values={form.claimsForbidden}
              placeholder="Cures acne"
              onChange={(v) => setForm((f) => ({ ...f, claimsForbidden: v }))}
            />
          </FieldShell>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <FieldShell
            status={fieldStatuses.tone}
            onConfirm={fieldStatuses.tone === "suggested" ? () => confirmField("tone") : undefined}
            confirming={confirming === "tone"}
            label={<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tone guidelines</span>}
          >
            <Textarea
              value={form.toneGuidelines}
              onChange={(e) => setForm((f) => ({ ...f, toneGuidelines: e.target.value }))}
              rows={3}
              placeholder="Warm, direct, no hype. Second person. No exclamation marks."
              className="text-sm"
            />
          </FieldShell>
          <FieldShell
            status={fieldStatuses.doNotShow}
            onConfirm={fieldStatuses.doNotShow === "suggested" ? () => confirmField("doNotShow") : undefined}
            confirming={confirming === "doNotShow"}
          >
            <StringListEditor
              label="Do not show"
              hint="Visual do-nots enforced in storyboard and studio prompts."
              values={form.doNotShow}
              placeholder="Competitor packaging"
              onChange={(v) => setForm((f) => ({ ...f, doNotShow: v }))}
            />
          </FieldShell>
        </div>
      </div>

      {/* Product summary */}
      <FieldShell
        status={fieldStatuses.productSummary}
        className="bg-card"
        onConfirm={fieldStatuses.productSummary === "suggested" ? () => confirmField("productSummary") : undefined}
        confirming={confirming === "productSummary"}
        label={<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product summary</span>}
        hint="One canonical paragraph. Injected verbatim into every script and studio prompt."
      >
        <Textarea
          value={form.productSummary}
          onChange={(e) => setForm((f) => ({ ...f, productSummary: e.target.value }))}
          rows={4}
          placeholder="What the product is, who it is for, and the single most important benefit."
          className="text-sm"
        />
      </FieldShell>

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
