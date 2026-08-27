"use client";

import { useState, useEffect } from "react";
import {
  Loader2, CheckCircle2, AlertCircle, RefreshCw, ShieldCheck,
  Package, Users, MapPin, Eye, Globe, Sparkles, Camera, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductImage {
  url: string;
  caption: string;
  type: "website" | "ai-full" | "ai-detail" | "ai-environment" | "product" | "environment";
  source?: "brand-website" | "web-search" | "ai-generated";
  environmentName?: string;
  verified?: boolean;
}

interface UseEnvironment {
  name: string;
  description: string;
  typicalUser: string;
  imagePrompt: string;
}

interface ActorSetting {
  role: string;
  ageRange: string;
  scenario: string;
  visualDescription: string;
  painPoint: string;
  productInteraction: string;
}

interface DisplayGuideline {
  rule: string;
  example: string;
  antiExample: string;
}

interface ProductIntelligenceData {
  productCategory: string | null;
  productDescription: string | null;
  productVerified: boolean;
  productImages: ProductImage[] | null;
  useEnvironments: UseEnvironment[] | null;
  actorSettings: ActorSetting[] | null;
  displayGuidelines: DisplayGuideline[] | null;
}

// ─── Image type labels ────────────────────────────────────────────────────────

const IMAGE_TYPE_CONFIG: Record<string, { label: string; color: string; icon: typeof Globe }> = {
  "website":         { label: "Brand Website", color: "bg-blue-600",   icon: Globe },
  "brand-website":   { label: "Brand Website", color: "bg-blue-600",   icon: Globe },
  "ai-full":         { label: "AI — Full View", color: "bg-purple-600", icon: Sparkles },
  "ai-detail":       { label: "AI — Detail",    color: "bg-violet-600", icon: Camera },
  "ai-environment":  { label: "AI — Scene",     color: "bg-emerald-600", icon: MapPin },
  "product":         { label: "Product",         color: "bg-blue-600",   icon: Package },
  "environment":     { label: "Scene",           color: "bg-emerald-600", icon: MapPin },
};

function ImageTypeBadge({ type, source }: { type: string; source?: string }) {
  const key = source === "brand-website" ? "brand-website" : type;
  const config = IMAGE_TYPE_CONFIG[key] || IMAGE_TYPE_CONFIG["product"];
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold text-white", config.color)}>
      <Icon className="h-2.5 w-2.5" />
      {config.label}
    </span>
  );
}

// ─── Image Grid ───────────────────────────────────────────────────────────────

function ImageGrid({ images, title, emptyMessage }: {
  images: ProductImage[];
  title: string;
  emptyMessage: string;
}) {
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

  if (images.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
        <Package className="h-7 w-7 mx-auto mb-2 opacity-30" />
        <p className="text-xs">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {images.map((img, i) => {
          const failed = failedUrls.has(img.url);
          return (
            <div key={i} className="rounded-xl overflow-hidden border border-border bg-muted relative group flex flex-col">
              {/* Image */}
              <div className="aspect-square relative overflow-hidden bg-muted/60">
                {failed ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground/40">
                    <Globe className="h-6 w-6" />
                    <p className="text-[9px]">Failed to load</p>
                  </div>
                ) : (
                  <img
                    src={img.url}
                    alt={img.caption}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    onError={() => setFailedUrls(prev => new Set([...prev, img.url]))}
                  />
                )}
                {/* Source badge top-left */}
                <div className="absolute top-1.5 left-1.5">
                  <ImageTypeBadge type={img.type} source={img.source} />
                </div>
                {/* External link for website images */}
                {img.source === "brand-website" && !img.url.startsWith("data:") && (
                  <a
                    href={img.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute top-1.5 right-1.5 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {/* Caption */}
              <div className="px-2 py-1.5 bg-card">
                <p className="text-[10px] text-foreground/70 leading-tight line-clamp-2">{img.caption}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProductIntelligence({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ProductIntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [genSummary, setGenSummary] = useState<{ total: number; website: number; aiProduct: number; environment: number } | null>(null);
  const [activeTab, setActiveTab] = useState<"product" | "environments" | "actors" | "guidelines">("product");

  useEffect(() => {
    fetch(`/api/projects/${projectId}/brand/understand`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  async function generateImages() {
    setGenerating(true);
    setGenSummary(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/brand/understand`, { method: "POST" });
      const result = await res.json();
      setData(prev => prev ? { ...prev, productImages: result.productImages } : prev);
      setGenSummary(result.summary);
    } finally {
      setGenerating(false);
    }
  }

  async function verifyUnderstanding() {
    setVerifying(true);
    try {
      await fetch(`/api/projects/${projectId}/brand/understand`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productVerified: true }),
      });
      setData(prev => prev ? { ...prev, productVerified: true } : prev);
    } finally {
      setVerifying(false);
    }
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading product intelligence…
    </div>
  );

  if (!data?.productCategory && !data?.productDescription) return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-2">
      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <div>
        <p className="font-semibold">Product intelligence not yet generated</p>
        <p className="text-xs mt-1">Run research first to populate brand understanding.</p>
      </div>
    </div>
  );

  // Split images by section — no AI product images (they are inaccurate for specific branded products)
  const allImages = data.productImages || [];
  const realProductImages = allImages.filter(i => i.source === "brand-website" || i.type === "website");
  const environmentImages = allImages.filter(i => i.type === "ai-environment" || i.type === "environment");
  const hasRealProductImages = realProductImages.length > 0;

  const tabs = [
    { id: "product" as const, label: "Product", icon: Package },
    { id: "environments" as const, label: "Environments", icon: MapPin },
    { id: "actors" as const, label: "Actors", icon: Users },
    { id: "guidelines" as const, label: "Display Rules", icon: Eye },
  ];

  return (
    <div className="space-y-4">
      {/* Verification banner */}
      <div className={cn(
        "rounded-xl border px-4 py-3 flex items-center justify-between gap-4 flex-wrap",
        data.productVerified ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
      )}>
        <div className="flex items-center gap-2.5">
          {data.productVerified
            ? <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
            : <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />}
          <div>
            <p className={cn("text-sm font-semibold", data.productVerified ? "text-emerald-800" : "text-amber-800")}>
              {data.productVerified
                ? "Product understanding verified — safe to generate content"
                : "Review product images before proceeding"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.productCategory || "Category not identified"}
              {hasRealProductImages
                ? ` · ${realProductImages.length} real product images · ${environmentImages.length} environment scenes`
                : " · No product images yet — upload photos below"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="outline"
            onClick={generateImages}
            disabled={generating}
            className="h-8 text-xs gap-1.5"
          >
            {generating
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
              : <><RefreshCw className="h-3 w-3" /> {allImages.length ? "Refresh Images" : "Generate Images"}</>}
          </Button>
          {!data.productVerified && (
            <Button
              size="sm"
              onClick={verifyUnderstanding}
              disabled={verifying || allImages.length === 0}
              className="h-8 text-xs gap-1.5"
            >
              {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
              Approve & Proceed
            </Button>
          )}
        </div>
      </div>

      {/* Generation summary */}
      {genSummary && (
        <div className={cn(
          "rounded-lg border px-3 py-2 flex items-center gap-4 text-[10px] flex-wrap",
          (genSummary as { noProductImages?: boolean }).noProductImages
            ? "bg-amber-50 border-amber-200 text-amber-800"
            : "bg-muted border-border text-muted-foreground"
        )}>
          {(genSummary as { noProductImages?: boolean }).noProductImages ? (
            <span className="font-semibold flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {(genSummary as { message?: string }).message || "No product images found. Upload photos in Product Definition above."}
            </span>
          ) : (
            <>
              <span className="font-semibold text-foreground">Real images fetched:</span>
              <span className="flex items-center gap-1"><Globe className="h-3 w-3 text-blue-500" /> {(genSummary as { fromProductPage?: number }).fromProductPage || 0} from product page</span>
              <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-blue-600" /> {(genSummary as { userUploaded?: number }).userUploaded || 0} user uploaded</span>
            </>
          )}
          <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-emerald-500" /> {genSummary.environment} environment scenes</span>
        </div>
      )}

      {/* Warning if no real product images */}
      {!hasRealProductImages && !generating && (
        <div className="rounded-xl border-2 border-dashed border-red-300 bg-red-50/60 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">No real product images — AI cannot verify the correct product</p>
              <p className="text-xs text-red-700 mt-1 leading-relaxed">
                AI-generated product images are <strong>unreliable for specific branded products</strong> — they generate generic shapes or wrong objects (e.g. a shark animal instead of a Shark vacuum).
                The only reliable solution is to provide real photos directly.
              </p>
            </div>
          </div>
          <div className="rounded-lg bg-white border border-red-200 p-3 space-y-2">
            <p className="text-xs font-semibold text-red-800">To fix this — choose one option:</p>
            <ol className="text-xs text-red-700 space-y-1.5 list-decimal list-inside">
              <li><strong>Upload product photos</strong> — go to &quot;Product Definition&quot; section above → click &quot;Upload Photos&quot; → upload 2-4 real product photos from different angles</li>
              <li><strong>Paste a specific product page URL</strong> — in &quot;Product Definition&quot;, paste the exact Amazon listing or DTC product page (not the homepage), then click &quot;Fetch Product Data&quot;</li>
            </ol>
            <p className="text-[10px] text-red-600 italic">
              Once you provide real images, click &quot;Generate Images&quot; here to fetch environment scenes based on the actual product.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeTab === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Product tab ── */}
      {activeTab === "product" && (
        <div className="space-y-5">
          {/* Description */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">AI Product Understanding</p>
            <p className="text-sm leading-relaxed">{data.productDescription || "No description generated yet."}</p>
          </div>

          {/* Real product images — from product page or user uploads */}
          <ImageGrid
            images={realProductImages}
            title={`Real Product Images (${realProductImages.length}) — from product page or uploads`}
            emptyMessage="No real product images yet. Upload photos in Product Definition above, or paste a specific product page URL."
          />

          {/* Review instruction — only shown when real images exist */}
          {hasRealProductImages && !data.productVerified && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 space-y-1">
                <p className="font-semibold">Review before approving:</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>Do all images show the correct physical product (e.g. vacuum cleaner, not a shark)?</li>
                  <li>Does the full-view image match the product&apos;s real form factor?</li>
                  <li>Do the detail shots show realistic mechanical features?</li>
                  <li>If anything looks wrong — click &quot;Refresh Images&quot; or edit the product description above.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Environments tab ── */}
      {activeTab === "environments" && (
        <div className="space-y-5">
          {/* Environment scene images */}
          <ImageGrid
            images={environmentImages}
            title={`Environment Scenes (${environmentImages.length})`}
            emptyMessage="No environment scenes yet. Click Generate Images."
          />

          {/* Environment definitions from Insights */}
          {(data.useEnvironments || []).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Environment Definitions</p>
              {(data.useEnvironments || []).map((env, i) => {
                const envImage = environmentImages.find(img => img.environmentName === env.name || img.caption?.includes(env.name));
                return (
                  <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="flex gap-3 p-3">
                      {/* Thumbnail */}
                      {envImage && (
                        <div className="flex-shrink-0 w-24 h-16 rounded-lg overflow-hidden bg-muted">
                          <img
                            src={envImage.url}
                            alt={env.name}
                            className="w-full h-full object-cover"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <MapPin className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                          <p className="text-sm font-semibold">{env.name}</p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{env.typicalUser}</span>
                        </div>
                        <p className="text-xs text-foreground/80 leading-relaxed">{env.description}</p>
                      </div>
                    </div>
                    <div className="border-t border-border bg-muted/30 px-3 py-2">
                      <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">Video Scene Prompt</p>
                      <p className="text-[10px] text-foreground/60 font-mono leading-relaxed">{env.imagePrompt}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(!data.useEnvironments || data.useEnvironments.length === 0) && environmentImages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No environments defined. Run research to generate.</p>
          )}
        </div>
      )}

      {/* ── Actors tab ── */}
      {activeTab === "actors" && (
        <div className="space-y-3">
          {(data.actorSettings || []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No actor settings. Run research to generate.</p>
          )}
          {(data.actorSettings || []).map((actor, i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="bg-purple-50 border-b border-purple-100 px-4 py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-purple-600" />
                  <p className="text-xs font-semibold text-purple-900">{actor.role}</p>
                </div>
                <span className="text-[10px] text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded-full">{actor.ageRange}</span>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs text-foreground/80">{actor.scenario}</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-muted/50 border border-border p-2 col-span-1">
                    <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">Appearance</p>
                    <p className="text-[10px] text-foreground/70 leading-snug">{actor.visualDescription}</p>
                  </div>
                  <div className="rounded-lg bg-red-50 border border-red-100 p-2 col-span-1">
                    <p className="text-[10px] font-semibold text-red-700 mb-0.5">Pain Point</p>
                    <p className="text-[10px] text-red-800 leading-snug">{actor.painPoint}</p>
                  </div>
                  <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 col-span-1">
                    <p className="text-[10px] font-semibold text-blue-700 mb-0.5">Product Use</p>
                    <p className="text-[10px] text-blue-800 leading-snug">{actor.productInteraction}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Display Guidelines tab ── */}
      {activeTab === "guidelines" && (
        <div className="space-y-3">
          {(data.displayGuidelines || []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No display guidelines. Run research to generate.</p>
          )}
          {(data.displayGuidelines || []).map((guide, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                {guide.rule}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                  <p className="text-[10px] font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Correct
                  </p>
                  <p className="text-xs text-emerald-800 leading-relaxed">{guide.example}</p>
                </div>
                <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                  <p className="text-[10px] font-semibold text-red-700 mb-1.5 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Must Avoid
                  </p>
                  <p className="text-xs text-red-800 leading-relaxed">{guide.antiExample}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
