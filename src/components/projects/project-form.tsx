"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORIES, CAMPAIGN_GOALS } from "@/lib/constants";
import { projectPath } from "@/lib/project-slug";
import { looksLikeUrl } from "@/lib/validations";
import { Plus, Trash2, Loader2, ArrowRight, Link, Package, AlertCircle } from "lucide-react";

interface CompetitorField {
  name: string;
  url: string;
}

export function ProjectForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [brandName, setBrandName] = useState("");
  const [brandUrl, setBrandUrl] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("");
  const [campaignGoal, setCampaignGoal] = useState("");
  const [briefingText, setBriefingText] = useState("");
  const [briefingFile, setBriefingFile] = useState<File | null>(null);
  const [scrapeWarning, setScrapeWarning] = useState<{ projectId: string; message: string } | null>(null);
  const [duplicate, setDuplicate] = useState<{ projectId: string; message: string } | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorField[]>([
    { name: "", url: "" },
  ]);

  function addCompetitor() {
    setCompetitors((prev) => [...prev, { name: "", url: "" }]);
  }

  function removeCompetitor(index: number) {
    setCompetitors((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCompetitor(
    index: number,
    field: keyof CompetitorField,
    value: string
  ) {
    setCompetitors((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  }

  async function handleSubmit(e: React.FormEvent, allowDuplicate = false) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setScrapeWarning(null);
    if (!allowDuplicate) setDuplicate(null);

    const validCompetitors = competitors.filter((c) => c.name.trim());
    if (validCompetitors.length === 0) {
      setError("Add at least one competitor.");
      setLoading(false);
      return;
    }

    if (looksLikeUrl(brandName)) {
      setError('Brand name looks like a URL — enter the actual brand name (e.g. "Segway"), and put the URL in Brand Website URL instead.');
      setLoading(false);
      return;
    }

    const urlNamedCompetitor = validCompetitors.find((c) => looksLikeUrl(c.name));
    if (urlNamedCompetitor) {
      setError(
        `Competitor "${urlNamedCompetitor.name}" is a URL — enter the competitor's name (e.g. "Ekster") and put the URL in the URL field beside it.`
      );
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: brandName.trim(),
          brandUrl: brandUrl.trim() || undefined,
          productUrl: productUrl.trim() || undefined,
          productName: productName.trim() || undefined,
          category: category || undefined,
          campaignGoal: campaignGoal || undefined,
          briefingText: briefingText.trim() || undefined,
          competitors: validCompetitors.map((c) => ({
            name: c.name.trim(),
            url: c.url.trim() || undefined,
          })),
          allowDuplicate: allowDuplicate || undefined,
        }),
      });

      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        setDuplicate({
          projectId: data.duplicateProjectId,
          message: data.error || "A project for this brand already exists.",
        });
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || "Failed to create project");
      }

      const project = await res.json().catch(() => null);
      if (!project?.id) throw new Error("Failed to create project");

      // Upload briefing file if selected
      if (briefingFile) {
        const formData = new FormData();
        formData.append("file", briefingFile);
        await fetch(`/api/projects/${project.id}/briefing/upload`, {
          method: "POST",
          body: formData,
        }).catch(() => {}); // non-blocking
      }

      // The project exists either way — but don't redirect blindly past a failed scrape.
      const scrapeResult = project.scrapeResult as
        | { ok: boolean; error: string | null; attempts?: { adapter: string; ok: boolean; error?: string }[] }
        | null;

      if (scrapeResult && !scrapeResult.ok) {
        const detail = (scrapeResult.attempts || [])
          .filter((a) => !a.ok)
          .map((a) => `${a.adapter}: ${a.error}`)
          .join(" · ");
        setScrapeWarning({
          projectId: project.id,
          message: scrapeResult.error || detail || "Could not read that product page.",
        });
        setLoading(false);
        return;
      }

      router.push(projectPath(project.id, brandName.trim(), "/content"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="brandName" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Brand name
          </Label>
          <Input
            id="brandName"
            placeholder="e.g. Segway, Nike, Tesla"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            required
            className="h-10 rounded-md"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="brandUrl" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Brand Website URL
          </Label>
          <Input
            id="brandUrl"
            type="url"
            placeholder="https://www.brand.com"
            value={brandUrl}
            onChange={(e) => setBrandUrl(e.target.value)}
            className="h-10 rounded-md"
          />
        </div>
      </div>

      {/* ── Product Definition — critical section ── */}
      <div className="space-y-4 pt-2 border-t border-border">
        <div className="pt-3">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-foreground" />
            <Label className="text-sm font-semibold">Product Definition</Label>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">Required for accuracy</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Specify exactly which product this campaign is about. Without this, the AI will guess — and may get it wrong.
          </p>
        </div>

        <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-4 space-y-3">
          <div className="flex items-start gap-2 text-xs text-amber-800">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>
              <strong>Paste the product page URL</strong> (from the brand&apos;s website or Amazon).
              The AI will read the exact product name, images, and features directly from the page — not guess from the brand name.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="productUrl" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Link className="h-3 w-3" /> Product Page URL <span className="text-amber-600">*</span>
            </Label>
            <Input
              id="productUrl"
              type="url"
              placeholder="https://www.sharkninja.com/shark-vacuums/... or https://amazon.com/dp/..."
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              className="h-10 rounded-md bg-white"
            />
            <p className="text-[10px] text-muted-foreground">
              Paste the DTC product page or Amazon listing. The AI will extract the exact product images, name, and description.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="productName" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Product Name (optional — auto-detected from URL)
            </Label>
            <Input
              id="productName"
              placeholder="e.g. Shark PowerDetect Cordless Vacuum"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              className="h-10 rounded-md bg-white"
            />
          </div>

          <p className="text-[10px] text-muted-foreground border-t border-amber-200/70 pt-2">
            <strong>Logo and product packshots are uploaded on the next screen</strong> — the Brand Kit panel on
            the project overview. Nothing to upload here.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Category
            </Label>
            <Select value={category} onValueChange={(v) => setCategory(v ?? "")}>
              <SelectTrigger className="h-10 rounded-md">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Campaign goal
            </Label>
            <Select value={campaignGoal} onValueChange={(v) => setCampaignGoal(v ?? "")}>
              <SelectTrigger className="h-10 rounded-md">
                <SelectValue placeholder="Select goal" />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_GOALS.map((goal) => (
                  <SelectItem key={goal} value={goal}>{goal}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Briefing */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="pt-3">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Project Briefing
          </Label>
          <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
            Paste campaign brief, brand guidelines, or product info. Or upload a file (PDF, DOCX, TXT).
          </p>
        </div>
        <Textarea
          placeholder="Paste your campaign brief, brand guidelines, target audience details, creative direction, or any background context..."
          value={briefingText}
          onChange={(e) => setBriefingText(e.target.value)}
          rows={4}
          className="rounded-md text-sm"
        />
        <div>
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Upload brief file
          </Label>
          <div className="flex items-center gap-3">
            <Input
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={(e) => setBriefingFile(e.target.files?.[0] || null)}
              className="h-9 rounded-md text-sm file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs file:font-medium file:rounded-md cursor-pointer"
            />
            {briefingFile && (
              <span className="text-xs text-muted-foreground shrink-0">
                {briefingFile.name} ({(briefingFile.size / 1024).toFixed(0)}KB)
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3 pt-2 border-t border-border">
        <div className="flex items-center justify-between pt-3">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Competitors
          </Label>
          <button
            type="button"
            onClick={addCompetitor}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        {competitors.map((comp, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input
              placeholder="Competitor name"
              value={comp.name}
              onChange={(e) => updateCompetitor(i, "name", e.target.value)}
              className="h-10 rounded-md flex-1"
            />
            <Input
              type="url"
              placeholder="URL (optional)"
              value={comp.url}
              onChange={(e) => updateCompetitor(i, "url", e.target.value)}
              className="h-10 rounded-md flex-1 hidden sm:block"
            />
            {competitors.length > 1 && (
              <button
                type="button"
                onClick={() => removeCompetitor(i)}
                className="text-muted-foreground hover:text-foreground p-2 transition-colors"
                aria-label="Remove competitor"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] px-3 py-2 text-xs text-[var(--status-urgent-fg)]">
          {error}
        </div>
      )}

      {duplicate && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <p>{duplicate.message}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(`/projects/${duplicate.projectId}/overview`)}
              className="rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background"
            >
              Open the existing project
            </button>
            <button
              type="button"
              onClick={(e) => handleSubmit(e as unknown as React.FormEvent, true)}
              className="rounded-md border border-amber-300 px-2.5 py-1 text-[11px] font-medium"
            >
              Create a second one anyway
            </button>
          </div>
        </div>
      )}

      {scrapeWarning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <p>
              <strong>Project created, but the product page could not be read.</strong>
              <br />
              {scrapeWarning.message}
              <br />
              You can fix the URL or upload packshots from the project overview.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(`/projects/${scrapeWarning.projectId}/overview`)}
              className="rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background"
            >
              Fix on project overview
            </button>
            <button
              type="button"
              onClick={() => router.push(`/projects/${scrapeWarning.projectId}/content`)}
              className="rounded-md border border-amber-300 px-2.5 py-1 text-[11px] font-medium"
            >
              Continue anyway
            </button>
          </div>
        </div>
      )}

      <Button
        type="submit"
        disabled={loading || !brandName.trim()}
        className="w-full h-10 rounded-md bg-foreground text-background hover:bg-foreground/90 font-medium"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating project...
          </>
        ) : (
          <>
            Launch research
            <ArrowRight className="ml-2 h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}
