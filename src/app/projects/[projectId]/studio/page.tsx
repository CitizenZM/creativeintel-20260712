"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Image as ImageIcon,
  Palette,
  Download,
  Film,
  Copy,
  Check,
  Camera,
  Sparkles,
  Wand2,
} from "lucide-react";

interface Script {
  id: string;
  title: string;
  angle: string;
  format: string;
  duration: string;
  hookVariants: string[];
  body: string;
  ctaVariants: string[];
  targetEmotion: string;
}

interface Shot {
  shotNumber: number;
  duration: string;
  shotType: string;
  cameraAngle: string;
  cameraMovement: string;
  sceneDescription: string;
  action: string;
  dialogue: string;
  soundDesign: string;
  lighting: string;
  lensNotes: string;
  aiVideoPrompt: string;
}

interface VideoBrief {
  title: string;
  logline: string;
  totalDuration: string;
  visualStyle: string;
  colorPalette: string;
  musicDirection: string;
  castingNotes: string;
  locationNotes: string;
  shotList: Shot[];
  callToAction: string;
  brandGuidelines: string[];
}

interface Keyframe {
  id: string;
  imageUrl: string | null;
  prompt: string;
  style: string | null;
}

interface VeoShot {
  shot_id: string;
  duration_seconds: number;
  purpose: string;
  scene_description: string;
  character_action: string;
  product_action: string;
  camera_angle: string;
  camera_movement: string;
  shot_type: string;
  lighting: string;
  motion_effect: string;
  dialogue_or_vo: string;
  text_overlay: string;
  cta: string;
  negative_prompt: string;
  veo_prompt: string;
}

interface VeoCampaign {
  project_meta: Record<string, unknown>;
  character_system: { main_character: Record<string, string> };
  environment_system: { location: string; time_of_day: string; weather: string; lighting: Record<string, string>; props: string[] };
  creative_strategy: { creative_type: string; tone: string; hook_style: string; hook_technique?: string; cta_technique?: string; story_arc: Record<string, string> };
  shot_list: (VeoShot & { transition_to_next?: string })[];
}

export default function StudioPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const scriptsParam = searchParams.get("scripts");

  const [scripts, setScripts] = useState<Script[]>([]);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [brief, setBrief] = useState<VideoBrief | null>(null);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingKeyframes, setLoadingKeyframes] = useState(false);
  const [loadingVeo, setLoadingVeo] = useState(false);
  const [veoCampaign, setVeoCampaign] = useState<VeoCampaign | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [copiedVeo, setCopiedVeo] = useState<string | null>(null);

  // Video generation state
  const [selectedModel, setSelectedModel] = useState("veo-3.1-fast");
  const [selectedAspect, setSelectedAspect] = useState("9:16");
  const [selectedResolution, setSelectedResolution] = useState("720p");
  const [generatingVideos, setGeneratingVideos] = useState<Map<string, { operationId: string; status: string; videoUrl?: string }>>(new Map());
  const [copiedAll, setCopiedAll] = useState(false);

  // Load selected scripts
  useEffect(() => {
    async function loadScripts() {
      try {
        const res = await fetch(`/api/projects/${projectId}/creative/scripts`);
        const all = await res.json().catch(() => []);
        if (!Array.isArray(all)) return;

        if (scriptsParam) {
          const ids = scriptsParam.split(",").filter(Boolean);
          const selected = all.filter((s: Script) => ids.includes(s.id));
          setScripts(selected);
          if (selected.length > 0) setActiveScriptId(selected[0].id);
        } else {
          setScripts(all);
          if (all.length > 0) setActiveScriptId(all[0].id);
        }
      } catch {
        /* ignore */
      }
    }
    loadScripts();
  }, [projectId, scriptsParam]);

  const activeScript = scripts.find((s) => s.id === activeScriptId);

  const generateBrief = useCallback(async (scriptId: string) => {
    setLoading(true);
    setBrief(null);
    setKeyframes([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/studio/video-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.error) setBrief(data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  async function generateKeyframes() {
    if (!brief?.shotList) return;
    setLoadingKeyframes(true);
    try {
      const prompts = brief.shotList.map((s) => s.aiVideoPrompt);
      const res = await fetch(`/api/projects/${projectId}/studio/storyboard-keyframes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts, scriptId: activeScriptId }),
      });
      const data = await res.json().catch(() => ({}));
      setKeyframes(data.keyframes || []);
    } finally {
      setLoadingKeyframes(false);
    }
  }

  async function generateVeoPrompts() {
    if (!activeScriptId) return;
    setLoadingVeo(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/studio/veo-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId: activeScriptId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.shot_list) setVeoCampaign(data);
    } finally {
      setLoadingVeo(false);
    }
  }

  async function generateVideo(shotId: string, prompt: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/studio/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model: selectedModel,
          aspectRatio: selectedAspect,
          resolution: selectedResolution,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.operationId) {
        setGeneratingVideos((prev) => {
          const next = new Map(prev);
          next.set(shotId, { operationId: data.operationId, status: "generating" });
          return next;
        });
        pollVideoStatus(shotId, data.operationId);
      }
    } catch {
      // ignore
    }
  }

  async function pollVideoStatus(shotId: string, operationId: string) {
    const encodedOp = encodeURIComponent(operationId);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const res = await fetch(`/api/projects/${projectId}/studio/video-status/${encodedOp}`);
        const data = await res.json().catch(() => ({}));
        if (data.done && data.videoUrl) {
          setGeneratingVideos((prev) => {
            const next = new Map(prev);
            next.set(shotId, { operationId, status: "complete", videoUrl: data.videoUrl });
            return next;
          });
          return;
        }
        if (data.error) {
          setGeneratingVideos((prev) => {
            const next = new Map(prev);
            next.set(shotId, { operationId, status: "error" });
            return next;
          });
          return;
        }
      } catch {
        // continue polling
      }
    }
    setGeneratingVideos((prev) => {
      const next = new Map(prev);
      next.set(shotId, { operationId, status: "timeout" });
      return next;
    });
  }

  function generateAllVideos() {
    if (!veoCampaign?.shot_list) return;
    for (const shot of veoCampaign.shot_list) {
      if (!generatingVideos.has(shot.shot_id)) {
        generateVideo(shot.shot_id, shot.veo_prompt);
      }
    }
  }

  function buildFullPromptCopy(): string {
    const sections: string[] = [];
    sections.push("=" .repeat(60));
    sections.push(`CREATIVEINTEL OS — COMPLETE VIDEO AD BRIEF`);
    sections.push("=" .repeat(60));

    if (activeScript) {
      sections.push(`\nSCRIPT: ${activeScript.title}`);
      sections.push(`Format: ${activeScript.format} · ${activeScript.duration}`);
      sections.push(`Emotion: ${activeScript.targetEmotion}`);
      sections.push(`\nHOOK OPTIONS:`);
      activeScript.hookVariants.forEach((h, i) => sections.push(`  ${i + 1}. ${h}`));
      sections.push(`\nSCRIPT BODY:\n${activeScript.body}`);
      sections.push(`\nCTA OPTIONS:`);
      activeScript.ctaVariants.forEach((c, i) => sections.push(`  ${i + 1}. ${c}`));
    }

    if (brief) {
      sections.push(`\n${"=".repeat(60)}`);
      sections.push(`VIDEO BRIEF: ${brief.title}`);
      sections.push(`Logline: ${brief.logline}`);
      sections.push(`Duration: ${brief.totalDuration}`);
      sections.push(`Visual: ${brief.visualStyle}`);
      sections.push(`Color: ${brief.colorPalette}`);
      sections.push(`Music: ${brief.musicDirection}`);
      sections.push(`Casting: ${brief.castingNotes}`);
      sections.push(`Location: ${brief.locationNotes}`);
      brief.shotList?.forEach((s) => {
        sections.push(`\n--- SHOT ${s.shotNumber} (${s.duration}) ---`);
        sections.push(`  Type: ${s.shotType} | Angle: ${s.cameraAngle} | Move: ${s.cameraMovement}`);
        sections.push(`  Light: ${s.lighting} | Lens: ${s.lensNotes}`);
        sections.push(`  Scene: ${s.sceneDescription}`);
        sections.push(`  Action: ${s.action}`);
        if (s.dialogue !== "none") sections.push(`  VO: "${s.dialogue}"`);
        sections.push(`  AI PROMPT: ${s.aiVideoPrompt}`);
      });
    }

    if (veoCampaign) {
      const cs = veoCampaign.creative_strategy;
      const ch = veoCampaign.character_system.main_character;
      const es = veoCampaign.environment_system;
      sections.push(`\n${"=".repeat(60)}`);
      sections.push(`VEO3 CAMPAIGN PROMPTS`);
      sections.push(`Model: ${selectedModel} | Aspect: ${selectedAspect} | Resolution: ${selectedResolution}`);
      sections.push(`Creative: ${cs.creative_type} | Tone: ${cs.tone}`);
      sections.push(`Hook: ${cs.hook_technique || "?"} | CTA: ${cs.cta_technique || "?"}`);
      sections.push(`\nCHARACTER: ${ch.role}, ${ch.age}, ${ch.gender}`);
      sections.push(`  Appearance: ${ch.appearance}`);
      sections.push(`  Wardrobe: ${ch.wardrobe}`);
      sections.push(`  Emotion: ${ch.emotional_state_start} → ${ch.emotional_state_end}`);
      sections.push(`\nENVIRONMENT: ${es.location} | ${es.time_of_day} | ${es.weather}`);
      sections.push(`  Lighting: ${es.lighting.source} ${es.lighting.direction} ${es.lighting.quality}`);
      sections.push(`  Props: ${es.props.join(", ")}`);
      sections.push(`\nSTORY ARC:`);
      Object.entries(cs.story_arc).forEach(([k, v]) => sections.push(`  ${k}: ${v}`));

      veoCampaign.shot_list.forEach((s, i) => {
        sections.push(`\n${"─".repeat(40)}`);
        sections.push(`VEO3 SHOT ${i + 1} (${s.duration_seconds}s) — ${s.purpose}`);
        sections.push(`Camera: ${s.shot_type} / ${s.camera_angle} / ${s.camera_movement}`);
        sections.push(`Lighting: ${s.lighting}`);
        sections.push(`Motion: ${s.motion_effect}`);
        sections.push(`Scene: ${s.scene_description}`);
        sections.push(`Character: ${s.character_action}`);
        sections.push(`Product: ${s.product_action}`);
        if (s.dialogue_or_vo) sections.push(`VO: "${s.dialogue_or_vo}"`);
        sections.push(`Negative: ${s.negative_prompt}`);
        sections.push(`\nVEO3 PROMPT:\n${s.veo_prompt}`);
        if (s.transition_to_next) sections.push(`\n→ Transition: ${s.transition_to_next}`);
      });
    }

    return sections.join("\n");
  }

  function copyVeo(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedVeo(id);
    setTimeout(() => setCopiedVeo(null), 2000);
  }

  function downloadVeoJson() {
    if (!veoCampaign) return;
    const blob = new Blob([JSON.stringify(veoCampaign, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `veo3_campaign_${activeScriptId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyToClipboard(text: string, index: number) {
    navigator.clipboard.writeText(text);
    setCopied(index);
    setTimeout(() => setCopied(null), 2000);
  }

  function downloadBrief() {
    if (!brief) return;
    const text = formatBriefAsText(brief);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${brief.title.replace(/[^a-z0-9]/gi, "_")}_brief.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Preview Studio</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Synthesize a production-ready video brief + keyframe reel from your selected scripts
        </p>
      </div>

      {/* Script selector */}
      {scripts.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
            Selected Scripts ({scripts.length})
          </p>
          <div className="flex gap-2 flex-wrap">
            {scripts.map((script) => (
              <button
                key={script.id}
                onClick={() => {
                  setActiveScriptId(script.id);
                  setBrief(null);
                  setKeyframes([]);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  activeScriptId === script.id
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                }`}
              >
                {script.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active script preview */}
      {activeScript && (
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Film className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">{activeScript.title}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {activeScript.angle} · {activeScript.format} · {activeScript.duration} · {activeScript.targetEmotion}
              </p>
            </div>
            <Button
              onClick={() => generateBrief(activeScript.id)}
              disabled={loading}
              className="h-9 rounded-md bg-foreground text-background hover:bg-foreground/90 font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Synthesizing brief...
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" />
                  {brief ? "Regenerate brief" : "Generate video brief"}
                </>
              )}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">Hook</p>
              <p className="text-sm">{activeScript.hookVariants[0]}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">CTA</p>
              <p className="text-sm">{activeScript.ctaVariants[0]}</p>
            </div>
          </div>
        </div>
      )}

      {/* Video Brief */}
      {brief && (
        <>
          <div className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-base font-semibold tracking-tight">{brief.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground italic">{brief.logline}</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={downloadBrief} size="sm" variant="outline" className="h-8 rounded-md text-xs">
                  <Download className="mr-1.5 h-3 w-3" />
                  Download brief
                </Button>
                <Button
                  onClick={generateKeyframes}
                  disabled={loadingKeyframes || !brief.shotList?.length}
                  size="sm"
                  className="h-8 rounded-md text-xs bg-foreground text-background hover:bg-foreground/90"
                >
                  {loadingKeyframes ? (
                    <>
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      Rendering...
                    </>
                  ) : (
                    <>
                      <Camera className="mr-1.5 h-3 w-3" />
                      Generate keyframe reel
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <InfoTile label="Duration" value={brief.totalDuration} />
              <InfoTile label="Visual Style" value={brief.visualStyle} />
              <InfoTile label="Color Palette" value={brief.colorPalette} />
              <InfoTile label="Music" value={brief.musicDirection} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-border">
              <div>
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">Casting</p>
                <p className="text-sm">{brief.castingNotes}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">Locations</p>
                <p className="text-sm">{brief.locationNotes}</p>
              </div>
            </div>

            {brief.brandGuidelines?.length > 0 && (
              <div className="pt-3 border-t border-border">
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Brand Guidelines</p>
                <ul className="space-y-1">
                  {brief.brandGuidelines.map((g, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="mt-1.5 h-1 w-1 rounded-full bg-foreground shrink-0" />
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Shot List */}
          <div className="rounded-lg border border-border bg-card p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
                <Camera className="h-4 w-4 text-muted-foreground" />
                Shot List ({brief.shotList.length} shots)
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Each shot includes camera direction + AI video prompt ready for Runway/Luma/Sora
              </p>
            </div>

            <div className="space-y-3">
              {brief.shotList.map((shot, i) => {
                const keyframe = keyframes[i];
                return (
                  <div key={shot.shotNumber} className="rounded-lg border border-border overflow-hidden">
                    <div className="flex flex-col lg:flex-row">
                      {/* Keyframe image */}
                      <div className="lg:w-60 shrink-0 aspect-video lg:aspect-square bg-muted relative">
                        {keyframe?.imageUrl ? (
                          <img src={keyframe.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : loadingKeyframes ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                          </div>
                        )}
                        <div className="absolute top-2 left-2 bg-foreground/80 text-background text-[10px] font-bold px-2 py-0.5 rounded-full">
                          SHOT {shot.shotNumber}
                        </div>
                        <div className="absolute top-2 right-2 bg-foreground/80 text-background text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {shot.duration}
                        </div>
                      </div>

                      {/* Shot details */}
                      <div className="flex-1 p-4 space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <Tag label="Shot" value={shot.shotType} />
                          <Tag label="Angle" value={shot.cameraAngle} />
                          <Tag label="Movement" value={shot.cameraMovement} />
                          <Tag label="Lighting" value={shot.lighting} />
                        </div>

                        <div>
                          <p className="text-sm font-medium">{shot.sceneDescription}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            <span className="font-medium text-foreground">Action:</span> {shot.action}
                          </p>
                        </div>

                        {shot.dialogue && shot.dialogue !== "none" && (
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">Dialogue/VO:</span> &ldquo;{shot.dialogue}&rdquo;
                          </p>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          <p className="text-muted-foreground">
                            <span className="font-medium text-foreground">Sound:</span> {shot.soundDesign}
                          </p>
                          <p className="text-muted-foreground">
                            <span className="font-medium text-foreground">Lens:</span> {shot.lensNotes}
                          </p>
                        </div>

                        {/* AI Video Prompt */}
                        <div className="pt-2 border-t border-border">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                              AI Video Prompt (Runway/Luma/Sora)
                            </p>
                            <button
                              onClick={() => copyToClipboard(shot.aiVideoPrompt, i)}
                              className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                            >
                              {copied === i ? (
                                <>
                                  <Check className="h-3 w-3" /> Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" /> Copy
                                </>
                              )}
                            </button>
                          </div>
                          <div className="rounded-md bg-muted p-2.5 text-xs font-mono leading-relaxed">
                            {shot.aiVideoPrompt}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Call to Action / closing */}
          {brief.callToAction && (
            <div className="rounded-lg border border-border bg-muted/30 p-5">
              <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">Closing Frame</p>
              <p className="text-sm font-medium">{brief.callToAction}</p>
            </div>
          )}
        </>
      )}

      {/* VEO3 Video Prompt System */}
      {activeScript && (
        <div className="rounded-lg border-2 border-[var(--status-ai)] bg-card p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Film className="h-4 w-4 text-[var(--status-ai-fg)]" />
                <h3 className="text-base font-semibold tracking-tight">VEO3 Video Ad Prompts</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Production-ready prompts for Google VEO3/3.1 + direct video generation
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {veoCampaign && (
                <Button onClick={downloadVeoJson} size="sm" variant="outline" className="h-8 rounded-md text-xs">
                  <Download className="mr-1.5 h-3 w-3" />
                  Download JSON
                </Button>
              )}
              <Button
                onClick={generateVeoPrompts}
                disabled={loadingVeo}
                size="sm"
                className="h-8 rounded-md text-xs bg-[var(--status-ai)] text-white hover:bg-[var(--status-ai)]/90"
              >
                {loadingVeo ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    Generating VEO3 prompts...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-3 w-3" />
                    {veoCampaign ? "Regenerate" : "Generate VEO3 Prompts"}
                  </>
                )}
              </Button>
            </div>
          </div>

          {veoCampaign && (
            <div className="space-y-4">
              {/* Campaign Overview */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="rounded-md border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Creative Type</p>
                  <p className="text-xs font-medium mt-0.5">{veoCampaign.creative_strategy.creative_type}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Tone</p>
                  <p className="text-xs font-medium mt-0.5">{veoCampaign.creative_strategy.tone}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Location / Time</p>
                  <p className="text-xs font-medium mt-0.5">{veoCampaign.environment_system.location} · {veoCampaign.environment_system.time_of_day}</p>
                </div>
              </div>

              {/* Hook + CTA Techniques */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {veoCampaign.creative_strategy.hook_technique && (
                  <div className="rounded-md border-2 border-[var(--status-attention)] bg-[var(--status-attention-bg)]/30 p-3">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--status-attention-fg)]">Hook Technique (Shot 1)</p>
                    <p className="text-xs font-medium mt-1">{veoCampaign.creative_strategy.hook_technique}</p>
                  </div>
                )}
                {veoCampaign.creative_strategy.cta_technique && (
                  <div className="rounded-md border-2 border-[var(--status-healthy)] bg-[var(--status-healthy-bg)]/30 p-3">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--status-healthy-fg)]">CTA Technique (Final Shot)</p>
                    <p className="text-xs font-medium mt-1">{veoCampaign.creative_strategy.cta_technique}</p>
                  </div>
                )}
              </div>

              {/* Character + Environment */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-md border border-border p-3 space-y-2">
                  <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Character</p>
                  {Object.entries(veoCampaign.character_system.main_character).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                      <span className="font-medium text-right max-w-[60%]">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-md border border-border p-3 space-y-2">
                  <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Environment & Lighting</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Weather</span>
                    <span className="font-medium">{veoCampaign.environment_system.weather}</span>
                  </div>
                  {Object.entries(veoCampaign.environment_system.lighting).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-muted-foreground capitalize">{k}</span>
                      <span className="font-medium text-right max-w-[60%]">{v}</span>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {veoCampaign.environment_system.props.map((p, i) => (
                      <span key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{p}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Story Arc */}
              <div className="rounded-md border border-border p-3">
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Story Arc</p>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {Object.entries(veoCampaign.creative_strategy.story_arc).map(([k, v]) => (
                    <div key={k} className="text-xs">
                      <span className="font-medium capitalize text-foreground">{k}: </span>
                      <span className="text-muted-foreground">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Model Selector + Video Generation Controls */}
              <div className="rounded-md border-2 border-foreground bg-muted/30 p-4 space-y-3">
                <p className="text-sm font-semibold tracking-tight">Video Generation Settings</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">Model</p>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full h-9 rounded-md border border-border bg-background px-2 text-xs"
                    >
                      <option value="veo-3.1-lite">Veo 3.1 Lite ($0.40/8s)</option>
                      <option value="veo-3.1-fast">Veo 3.1 Fast ($0.80/8s)</option>
                      <option value="veo-3.1-standard">Veo 3.1 Standard ($3.20/8s)</option>
                      <option value="veo-3-fast">Veo 3 Fast ($0.80/8s)</option>
                      <option value="veo-3">Veo 3 Standard ($3.20/8s)</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">Aspect Ratio</p>
                    <select
                      value={selectedAspect}
                      onChange={(e) => setSelectedAspect(e.target.value)}
                      className="w-full h-9 rounded-md border border-border bg-background px-2 text-xs"
                    >
                      <option value="9:16">9:16 (TikTok/Reels)</option>
                      <option value="16:9">16:9 (YouTube)</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">Resolution</p>
                    <select
                      value={selectedResolution}
                      onChange={(e) => setSelectedResolution(e.target.value)}
                      className="w-full h-9 rounded-md border border-border bg-background px-2 text-xs"
                    >
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                    </select>
                  </div>
                </div>
                <Button
                  onClick={generateAllVideos}
                  disabled={!veoCampaign?.shot_list?.length}
                  className="w-full h-10 rounded-md bg-foreground text-background hover:bg-foreground/90 font-medium"
                >
                  <Film className="mr-2 h-4 w-4" />
                  Generate All Videos ({veoCampaign?.shot_list?.length || 0} shots × 8s = {(veoCampaign?.shot_list?.length || 0) * 8}s)
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  Estimated cost: ${((veoCampaign?.shot_list?.length || 0) * (selectedModel.includes("lite") ? 0.4 : selectedModel.includes("fast") ? 0.8 : 3.2)).toFixed(2)} · Generation takes 30-120 seconds per shot
                </p>
              </div>

              {/* Shot-by-Shot VEO Prompts */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold tracking-tight">Shot-by-Shot VEO3 Prompts</p>
                  <button
                    onClick={() => {
                      const all = veoCampaign.shot_list.map(s => s.veo_prompt).join("\n\n---\n\n");
                      navigator.clipboard.writeText(all);
                      setCopiedVeo("all");
                      setTimeout(() => setCopiedVeo(null), 2000);
                    }}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {copiedVeo === "all" ? <><Check className="h-3 w-3" /> Copied all</> : <><Copy className="h-3 w-3" /> Copy all prompts</>}
                  </button>
                </div>

                <div className="space-y-4">
                  {veoCampaign.shot_list.map((shot) => (
                    <div key={shot.shot_id} className="rounded-lg border border-border overflow-hidden">
                      {/* Shot header */}
                      <div className="bg-muted/30 px-4 py-2 border-b border-border flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="bg-foreground text-background text-[10px] font-bold px-2 py-0.5 rounded-full">{shot.shot_id}</span>
                          <span className="text-xs font-medium">{shot.purpose}</span>
                          <span className="text-xs text-muted-foreground">{shot.duration_seconds}s</span>
                        </div>
                        <button
                          onClick={() => copyVeo(shot.veo_prompt, shot.shot_id)}
                          className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
                        >
                          {copiedVeo === shot.shot_id ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy prompt</>}
                        </button>
                      </div>

                      {/* Shot details grid */}
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div><span className="text-muted-foreground">Shot: </span><span className="font-medium">{shot.shot_type}</span></div>
                          <div><span className="text-muted-foreground">Angle: </span><span className="font-medium">{shot.camera_angle}</span></div>
                          <div><span className="text-muted-foreground">Movement: </span><span className="font-medium">{shot.camera_movement}</span></div>
                          <div><span className="text-muted-foreground">Lighting: </span><span className="font-medium">{shot.lighting}</span></div>
                        </div>

                        <div className="text-sm">
                          <p className="font-medium">{shot.scene_description}</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {shot.character_action && (
                            <p><span className="font-medium text-foreground">Character: </span><span className="text-muted-foreground">{shot.character_action}</span></p>
                          )}
                          {shot.product_action && (
                            <p><span className="font-medium text-foreground">Product: </span><span className="text-muted-foreground">{shot.product_action}</span></p>
                          )}
                          {shot.motion_effect && (
                            <p><span className="font-medium text-foreground">Motion: </span><span className="text-muted-foreground">{shot.motion_effect}</span></p>
                          )}
                          {shot.dialogue_or_vo && (
                            <p><span className="font-medium text-foreground">VO/Dialogue: </span><span className="text-muted-foreground italic">&ldquo;{shot.dialogue_or_vo}&rdquo;</span></p>
                          )}
                        </div>

                        {shot.negative_prompt && (
                          <p className="text-[10px] text-[var(--status-urgent-fg)]">Negative: {shot.negative_prompt}</p>
                        )}

                        {/* Transition to next shot */}
                        {shot.transition_to_next && (
                          <p className="text-[10px] text-[var(--status-ai-fg)] italic">
                            Transition → {shot.transition_to_next}
                          </p>
                        )}

                        {/* The VEO3 prompt — the main output */}
                        <div className="pt-2 border-t border-border">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--status-ai-fg)]">
                              VEO3 PROMPT — paste directly into VEO3/Veo 3.1 API
                            </p>
                            <button
                              onClick={() => copyVeo(shot.veo_prompt, shot.shot_id)}
                              className="text-[10px] font-medium text-[var(--status-ai-fg)] hover:underline flex items-center gap-1"
                            >
                              {copiedVeo === shot.shot_id ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
                            </button>
                          </div>
                          <div className="rounded-md bg-[var(--status-ai-bg)] border border-[var(--status-ai)] p-3 text-xs font-mono leading-relaxed select-all cursor-text">
                            {shot.veo_prompt}
                          </div>
                        </div>

                        {/* Video Generation + Preview */}
                        <div className="pt-2 border-t border-border">
                          {(() => {
                            const vidState = generatingVideos.get(shot.shot_id);
                            if (vidState?.status === "complete" && vidState.videoUrl) {
                              return (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <p className="text-[10px] uppercase tracking-wider font-semibold text-[var(--status-healthy-fg)]">
                                      Generated Video
                                    </p>
                                    <a
                                      href={vidState.videoUrl}
                                      download={`shot_${shot.shot_id}.mp4`}
                                      className="text-[10px] font-medium text-foreground hover:underline flex items-center gap-1"
                                    >
                                      <Download className="h-3 w-3" /> Download MP4
                                    </a>
                                  </div>
                                  <video
                                    src={vidState.videoUrl}
                                    controls
                                    autoPlay
                                    loop
                                    muted
                                    playsInline
                                    className="w-full rounded-md border border-border aspect-[9/16] max-h-80 object-contain bg-black"
                                  />
                                </div>
                              );
                            }
                            if (vidState?.status === "generating") {
                              return (
                                <div className="flex items-center gap-2 py-3">
                                  <Loader2 className="h-4 w-4 animate-spin text-[var(--status-ai-fg)]" />
                                  <p className="text-xs text-[var(--status-ai-fg)]">Generating video... (30-120s)</p>
                                </div>
                              );
                            }
                            if (vidState?.status === "error" || vidState?.status === "timeout") {
                              return (
                                <div className="flex items-center justify-between py-2">
                                  <p className="text-xs text-[var(--status-urgent-fg)]">
                                    {vidState.status === "timeout" ? "Generation timed out" : "Generation failed"}
                                  </p>
                                  <Button
                                    onClick={() => generateVideo(shot.shot_id, shot.veo_prompt)}
                                    size="sm"
                                    variant="outline"
                                    className="h-7 rounded-md text-[10px]"
                                  >
                                    Retry
                                  </Button>
                                </div>
                              );
                            }
                            return (
                              <Button
                                onClick={() => generateVideo(shot.shot_id, shot.veo_prompt)}
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-md text-xs w-full"
                              >
                                <Film className="mr-1.5 h-3 w-3" />
                                Generate this shot ({selectedModel})
                              </Button>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* COPY ALL — Complete prompt details from ALL sections */}
                <div className="rounded-lg border-2 border-foreground bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold tracking-tight">Copy Complete Brief</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Script + Video Brief + VEO3 Prompts + Character + Environment — everything in one paste
                      </p>
                    </div>
                    <Button
                      onClick={() => {
                        navigator.clipboard.writeText(buildFullPromptCopy());
                        setCopiedAll(true);
                        setTimeout(() => setCopiedAll(false), 2000);
                      }}
                      size="sm"
                      className="h-9 rounded-md bg-foreground text-background hover:bg-foreground/90"
                    >
                      {copiedAll ? (
                        <><Check className="mr-1.5 h-3.5 w-3.5" /> Copied everything!</>
                      ) : (
                        <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy all details</>
                      )}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Includes: script (hooks + body + CTAs), video brief (shot list + camera specs), VEO3 prompts (character + environment + lighting + all shots), generation settings
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {scripts.length === 0 && (
        <div className="rounded-lg border border-border bg-card py-16 text-center">
          <Palette className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No scripts selected. Head to the Creative tab to generate scripts first.
          </p>
        </div>
      )}
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{label}</p>
      <p className="text-xs font-medium mt-0.5 line-clamp-2">{value}</p>
    </div>
  );
}

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}

function formatBriefAsText(brief: VideoBrief): string {
  const lines: string[] = [];
  lines.push(`VIDEO BRIEF: ${brief.title}`);
  lines.push("=".repeat(60));
  lines.push(`Logline: ${brief.logline}`);
  lines.push(`Duration: ${brief.totalDuration}`);
  lines.push("");
  lines.push(`Visual Style: ${brief.visualStyle}`);
  lines.push(`Color Palette: ${brief.colorPalette}`);
  lines.push(`Music: ${brief.musicDirection}`);
  lines.push(`Casting: ${brief.castingNotes}`);
  lines.push(`Locations: ${brief.locationNotes}`);
  lines.push("");
  lines.push("BRAND GUIDELINES:");
  brief.brandGuidelines.forEach((g) => lines.push(`- ${g}`));
  lines.push("");
  lines.push("SHOT LIST");
  lines.push("=".repeat(60));
  brief.shotList.forEach((s) => {
    lines.push(`\nSHOT ${s.shotNumber} (${s.duration})`);
    lines.push(`  Type: ${s.shotType} | Angle: ${s.cameraAngle} | Movement: ${s.cameraMovement}`);
    lines.push(`  Lighting: ${s.lighting} | Lens: ${s.lensNotes}`);
    lines.push(`  Scene: ${s.sceneDescription}`);
    lines.push(`  Action: ${s.action}`);
    if (s.dialogue && s.dialogue !== "none") lines.push(`  Dialogue/VO: "${s.dialogue}"`);
    lines.push(`  Sound: ${s.soundDesign}`);
    lines.push(`  AI VIDEO PROMPT:\n    ${s.aiVideoPrompt}`);
  });
  lines.push("");
  lines.push(`CLOSING: ${brief.callToAction}`);
  return lines.join("\n");
}
