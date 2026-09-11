"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, Download, Film, Loader2, Sparkles } from "lucide-react";

/**
 * The pre-LibTV API path: Veo / fal.ai text-to-video, one 8s shot at a time,
 * no product reference and no local assembly. Kept behind a disclosure for
 * one-off prompt tests and for comparing a model against a LibTV cut — it is
 * not the production flow.
 *
 * Model keys must exist in src/services/video-gen/models.ts; the three ids the
 * old page offered (veo-3.1-lite, veo-3-fast, veo-3) never did and were
 * silently coerced to veo-3.1-fast.
 */
const MODELS = [
  { id: "veo-3.1-fast", label: "Veo 3.1 Fast", cost: "$0.80 / 8s" },
  { id: "veo-3.1-standard", label: "Veo 3.1 Standard", cost: "$3.20 / 8s" },
  { id: "grok-imagine-video", label: "Grok Imagine (fal)", cost: "$0.07 / s" },
  { id: "wan-2.6", label: "Wan 2.6 (fal)", cost: "$0.10 / s" },
  { id: "kling-v3-pro", label: "Kling v3 Pro (fal)", cost: "$0.112 / s" },
];

interface VeoShot {
  shot_id: string;
  duration_seconds: number;
  purpose: string;
  scene_description: string;
  veo_prompt: string;
}

interface VeoCampaign {
  shot_list: VeoShot[];
}

type ShotState = { status: "generating" | "complete" | "error" | "timeout"; videoUrl?: string };

export function LegacyApiRender({ projectId, scriptId }: { projectId: string; scriptId: string | null }) {
  const [campaign, setCampaign] = useState<VeoCampaign | null>(null);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("veo-3.1-fast");
  const [aspect, setAspect] = useState("9:16");
  const [resolution, setResolution] = useState("720p");
  const [shots, setShots] = useState<Map<string, ShotState>>(new Map());
  const [copied, setCopied] = useState<string | null>(null);

  function setShot(shotId: string, state: ShotState) {
    setShots((prev) => new Map(prev).set(shotId, state));
  }

  async function generatePrompts() {
    if (!scriptId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/studio/veo-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.shot_list) setCampaign(data as VeoCampaign);
    } finally {
      setLoading(false);
    }
  }

  async function generateShot(shot: VeoShot) {
    setShot(shot.shot_id, { status: "generating" });
    try {
      const res = await fetch(`/api/projects/${projectId}/studio/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: shot.veo_prompt, model, aspectRatio: aspect, resolution }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.jobId) {
        await pollFal(shot.shot_id, data.jobId);
        return;
      }
      if (data.operationId) {
        await pollVeo(shot.shot_id, data.operationId);
        return;
      }
      setShot(shot.shot_id, { status: "error" });
    } catch {
      setShot(shot.shot_id, { status: "error" });
    }
  }

  async function pollVeo(shotId: string, operationId: string) {
    const encoded = encodeURIComponent(operationId);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(`/api/projects/${projectId}/studio/video-status/${encoded}`);
      const data = await res.json().catch(() => ({}));
      if (data.done && data.videoUrl) return setShot(shotId, { status: "complete", videoUrl: data.videoUrl });
      if (data.error) return setShot(shotId, { status: "error" });
    }
    setShot(shotId, { status: "timeout" });
  }

  async function pollFal(shotId: string, jobId: string) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(`/api/projects/${projectId}/studio/fal-status/${jobId}`);
      const data = await res.json().catch(() => ({}));
      if (data.status === "completed" && data.videoUrl) {
        return setShot(shotId, { status: "complete", videoUrl: data.videoUrl });
      }
      if (data.status === "failed") return setShot(shotId, { status: "error" });
    }
    setShot(shotId, { status: "timeout" });
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold tracking-tight">
        Legacy API render (Veo / fal.ai)
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          one shot at a time, no product reference, no local assembly
        </span>
      </summary>

      <div className="space-y-4 border-t border-border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-56 rounded-md border border-border bg-background px-2 text-xs"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.cost})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Aspect</span>
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value)}
              className="h-9 w-32 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Resolution</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="h-9 w-32 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </label>
          <Button onClick={generatePrompts} disabled={!scriptId || loading} size="sm" variant="outline" className="h-9 rounded-md text-xs">
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            {campaign ? "Regenerate prompts" : "Generate Veo prompts"}
          </Button>
        </div>

        {!scriptId && <p className="text-xs text-muted-foreground">Select a script to generate prompts.</p>}

        {campaign?.shot_list?.map((shot) => {
          const state = shots.get(shot.shot_id);
          return (
            <div key={shot.shot_id} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-bold text-background">
                    {shot.shot_id}
                  </span>
                  <span className="text-xs font-medium">{shot.purpose}</span>
                  <span className="text-xs text-muted-foreground">{shot.duration_seconds}s</span>
                </div>
                <button
                  onClick={() => copy(shot.veo_prompt, shot.shot_id)}
                  className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {copied === shot.shot_id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  Copy prompt
                </button>
              </div>
              <p className="mb-2 rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">{shot.veo_prompt}</p>

              {state?.status === "complete" && state.videoUrl ? (
                <div className="space-y-2">
                  <video src={state.videoUrl} controls playsInline className="max-h-72 w-full rounded-md border border-border bg-black object-contain" />
                  <a href={state.videoUrl} download className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline">
                    <Download className="h-3 w-3" /> Download MP4
                  </a>
                </div>
              ) : state?.status === "generating" ? (
                <p className="flex items-center gap-1.5 text-xs text-blue-700">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating… (30–120s)
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <Button onClick={() => generateShot(shot)} size="sm" variant="outline" className="h-8 rounded-md text-xs">
                    <Film className="mr-1.5 h-3 w-3" />
                    Render this shot
                  </Button>
                  {(state?.status === "error" || state?.status === "timeout") && (
                    <span className="text-[11px] text-red-700">
                      {state.status === "timeout" ? "Timed out" : "Failed"}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
