"use client";

import { useState, useEffect, useRef } from "react";
import {
  Loader2, Link, Package, RefreshCw, ExternalLink, Upload,
  CheckCircle2, AlertCircle, X, Plus, Pencil, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ProductImage {
  url: string;
  alt?: string;
  caption?: string;
}

interface ProductDefinitionData {
  productUrl: string | null;
  productName: string | null;
  productPageTitle: string | null;
  productPageImages: ProductImage[] | null;
  productPageText: string | null;
  userProductImages: ProductImage[] | null;
}

interface AdapterAttempt {
  adapter: string;
  ok: boolean;
  error?: string;
}

interface ScrapeResult {
  ok: boolean;
  adapter: string | null;
  error: string | null;
  attempts: AdapterAttempt[];
  imageCount: number;
  title: string | null;
  hasDescription: boolean;
  featureCount: number;
}

interface ScrapePreview {
  productUrl: string;
  title: string;
  description: string;
  features: string[];
  images: ProductImage[];
  price: string | null;
  brand: string | null;
}

export function ProductDefinition({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProductDefinitionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<AdapterAttempt[]>([]);
  const [preview, setPreview] = useState<ScrapePreview | null>(null);
  const [previewAdapter, setPreviewAdapter] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/product`)
      .then(r => r.json())
      .then((d: ProductDefinitionData) => {
        setData(d);
        setUrlDraft(d.productUrl || "");
        setNameDraft(d.productName || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  /** Step 1 — scrape without writing so the user can confirm what was found. */
  async function scrapeUrl(url: string) {
    if (!url) return;
    setScraping(true);
    setError(null);
    setAttempts([]);
    setPreview(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview", productUrl: url }),
      });
      const result = await res.json().catch(() => ({}));
      const scrapeResult: ScrapeResult | undefined = result.scrapeResult;
      if (scrapeResult?.attempts) setAttempts(scrapeResult.attempts);

      if (!res.ok || !result.preview) {
        throw new Error(result.error || "Failed to read this product page");
      }

      setPreview(result.preview as ScrapePreview);
      setPreviewAdapter(scrapeResult?.adapter ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to scrape product page");
    } finally {
      setScraping(false);
    }
  }

  /** Step 2 — write the confirmed scrape as the canonical product definition. */
  async function commitPreview() {
    if (!preview) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "commit", productUrl: preview.productUrl }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "Failed to save product definition");

      const updated = await fetch(`/api/projects/${projectId}/product`).then(r => r.json());
      setData(updated);
      setNameDraft(updated.productName || "");
      setPreview(null);
      setEditingUrl(false);
      setAttempts([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save product definition");
    } finally {
      setCommitting(false);
    }
  }

  async function saveName() {
    await fetch(`/api/projects/${projectId}/product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productName: nameDraft }),
    });
    setData(prev => prev ? { ...prev, productName: nameDraft } : prev);
    setEditingName(false);
  }

  /** Uploads go to the Brand Kit asset store (kind PACKSHOT), not base64 into Postgres. */
  async function handleFileUpload(files: FileList) {
    setUploadingImages(true);
    setError(null);
    try {
      const newImages: ProductImage[] = [];
      for (const file of Array.from(files).slice(0, 6)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "PACKSHOT");
        fd.append("caption", file.name);

        const res = await fetch(`/api/projects/${projectId}/brand-kit/assets`, {
          method: "POST",
          body: fd,
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `Upload failed for ${file.name}`);

        newImages.push({ url: payload.asset.url, caption: file.name, alt: file.name });
      }

      const existing = data?.userProductImages || [];
      const merged = [...existing, ...newImages].slice(0, 8);
      const patch = await fetch(`/api/projects/${projectId}/product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userProductImages: merged }),
      });
      if (!patch.ok) {
        const payload = await patch.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to attach uploaded images");
      }
      setData(prev => prev ? { ...prev, userProductImages: merged } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingImages(false);
    }
  }

  async function removeUserImage(index: number) {
    const updated = (data?.userProductImages || []).filter((_, i) => i !== index);
    const res = await fetch(`/api/projects/${projectId}/product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userProductImages: updated }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error || "Failed to remove image");
      return;
    }
    setData(prev => prev ? { ...prev, userProductImages: updated } : prev);
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading product definition…
    </div>
  );

  const hasProduct = !!(data?.productUrl || data?.productPageImages?.length || data?.userProductImages?.length);
  const allImages = [
    ...(data?.productPageImages || []).slice(0, 4),
    ...(data?.userProductImages || []).slice(0, 4),
  ];

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className={cn(
        "rounded-xl border px-4 py-3 flex items-center gap-3",
        hasProduct ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
      )}>
        {hasProduct
          ? <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          : <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />}
        <div className="flex-1">
          <p className={cn("text-sm font-semibold", hasProduct ? "text-emerald-800" : "text-amber-800")}>
            {hasProduct
              ? `Product defined: ${data?.productPageTitle || data?.productName || "Product identified"}`
              : "No product defined — AI will guess which product to use"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasProduct
              ? `${allImages.length} images · ${data?.productPageText ? "Description available" : "No description"}`
              : "Add a product page URL or upload product photos below"}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 space-y-1">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="h-3 w-3" /></button>
          </div>
          {attempts.length > 0 && (
            <ul className="pl-5 text-[10px] text-red-600/80">
              {attempts.map((a, i) => (
                <li key={`${a.adapter}-${i}`}>
                  {a.adapter}: {a.ok ? "ok" : a.error || "failed"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Confirm card — what the scraper found, before anything is written */}
      {preview && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-900">
                We found: {preview.title || "Untitled"} · {preview.images.length} images ·{" "}
                {preview.description ? "description" : "no description"}
              </p>
              <p className="text-[11px] text-blue-800/80 mt-0.5">
                Read with the <strong>{previewAdapter || "generic"}</strong> adapter
                {preview.brand ? ` · brand: ${preview.brand}` : ""}
                {preview.price ? ` · price: ${preview.price}` : ""}
                {preview.features.length ? ` · ${preview.features.length} features` : ""}
              </p>
            </div>
          </div>

          {preview.images.length > 0 && (
            <div className="grid grid-cols-6 gap-1.5">
              {preview.images.slice(0, 6).map((img, i) => (
                <div key={i} className="aspect-square rounded-md overflow-hidden border border-blue-200 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.alt || "Preview"}
                    className="w-full h-full object-contain"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
                  />
                </div>
              ))}
            </div>
          )}

          {preview.description && (
            <p className="text-[11px] text-blue-900/80 line-clamp-3">{preview.description}</p>
          )}

          <div className="flex gap-2">
            <Button size="sm" onClick={commitPreview} disabled={committing} className="h-7 text-xs gap-1.5">
              {committing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Confirm & use this product
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setPreview(null); setEditingUrl(true); }}
              className="h-7 text-xs"
            >
              Edit URL
            </Button>
          </div>
        </div>
      )}

      {/* Product URL */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Link className="h-3.5 w-3.5" /> Product Page URL
          </p>
          {data?.productUrl && !editingUrl && (
            <button onClick={() => setEditingUrl(true)} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )}
        </div>

        {editingUrl || !data?.productUrl ? (
          <div className="space-y-2">
            <Input
              type="url"
              value={urlDraft}
              onChange={e => setUrlDraft(e.target.value)}
              placeholder="https://www.sharkninja.com/shark-vacuums/... or https://amazon.com/dp/..."
              className="h-9 text-sm"
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => scrapeUrl(urlDraft)}
                disabled={scraping || !urlDraft.trim()}
                className="h-7 text-xs gap-1.5"
              >
                {scraping ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {scraping ? "Reading product page…" : "Fetch & preview"}
              </Button>
              {editingUrl && (
                <Button size="sm" variant="outline" onClick={() => setEditingUrl(false)} className="h-7 text-xs">
                  Cancel
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Paste the specific product page URL. Nothing is saved until you confirm what was found.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <a href={data.productUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline flex items-center gap-1 truncate">
              <ExternalLink className="h-3 w-3 flex-shrink-0" />
              {data.productUrl}
            </a>
          </div>
        )}
      </div>

      {/* Product Name */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5" /> Product Name
          </p>
        </div>
        {editingName ? (
          <div className="flex gap-2">
            <Input
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              className="h-8 text-sm flex-1"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
            />
            <button onClick={saveName} className="p-2 rounded hover:bg-muted"><Check className="h-3.5 w-3.5 text-emerald-600" /></button>
            <button onClick={() => { setNameDraft(data?.productName || ""); setEditingName(false); }} className="p-2 rounded hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : (
          <button onClick={() => setEditingName(true)} className="text-sm text-left w-full hover:bg-muted/50 rounded px-2 py-1 transition-colors flex items-center gap-2 group">
            {data?.productPageTitle || data?.productName || <span className="text-muted-foreground italic">Click to add product name…</span>}
            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 ml-auto" />
          </button>
        )}
      </div>

      {/* Product Images — from product page + user uploads */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Product Images ({allImages.length})
          </p>
          <div className="flex gap-1.5">
            {data?.productUrl && (
              <Button
                size="sm" variant="outline"
                onClick={() => scrapeUrl(data.productUrl!)}
                disabled={scraping}
                className="h-6 text-[10px] gap-1 px-2"
              >
                {scraping ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                Re-fetch
              </Button>
            )}
            <Button
              size="sm" variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImages}
              className="h-6 text-[10px] gap-1 px-2"
            >
              <Upload className="h-2.5 w-2.5" />
              Upload Photos
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => e.target.files && handleFileUpload(e.target.files)}
            />
          </div>
        </div>

        {allImages.length > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {/* Product page images */}
            {(data?.productPageImages || []).slice(0, 4).map((img, i) => (
              <div key={`pp-${i}`} className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                <img
                  src={img.url}
                  alt={img.alt || "Product"}
                  className="w-full h-full object-contain bg-white"
                  onError={e => { (e.currentTarget as HTMLImageElement).style.opacity = "0.3"; }}
                />
                <div className="absolute top-1 left-1">
                  <span className="text-[8px] bg-blue-600 text-white px-1 py-0.5 rounded font-semibold">Web</span>
                </div>
              </div>
            ))}
            {/* User-uploaded images */}
            {(data?.userProductImages || []).slice(0, 4).map((img, i) => (
              <div key={`up-${i}`} className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                <img
                  src={img.url}
                  alt={img.caption || img.alt || "Uploaded"}
                  className="w-full h-full object-contain bg-white"
                />
                <div className="absolute top-1 left-1">
                  <span className="text-[8px] bg-purple-600 text-white px-1 py-0.5 rounded font-semibold">Upload</span>
                </div>
                <button
                  onClick={() => removeUserImage(i)}
                  className="absolute top-1 right-1 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            {/* Add more button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-lg border-2 border-dashed border-border flex items-center justify-center hover:border-foreground/40 transition-colors text-muted-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div
            className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-foreground/30 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">Upload product photos</p>
            <p className="text-xs text-muted-foreground mt-1">
              Or paste a product URL above to auto-import images.
              <br />Upload multiple angles: front, back, detail close-ups.
            </p>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          <strong>Blue (Web)</strong> = fetched from product page · <strong>Purple (Upload)</strong> = your photos
          <br />These exact images are used as reference for all AI-generated content in this project.
        </p>
      </div>

      {/* Product description preview */}
      {data?.productPageText && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Product Description (from page)
          </p>
          <p className="text-xs text-foreground/80 leading-relaxed line-clamp-4">{data.productPageText}</p>
        </div>
      )}
    </div>
  );
}
