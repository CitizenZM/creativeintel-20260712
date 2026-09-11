"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, Clock } from "lucide-react";

interface ScriptResult {
  reconstructedScript: string;
  transcript?: string | null;
  summary: string;
  keyMoments: { timestamp: string; description: string }[];
}

export function ScriptGenerator({
  projectId,
  assetId,
  existingTranscript,
}: {
  projectId: string;
  assetId: string;
  existingTranscript: string | null;
}) {
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/content/${assetId}/script`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate script");
      }
      const data = await res.json().catch(() => ({}));
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const transcript = existingTranscript || result?.transcript || null;
  const reconstructed = result?.reconstructedScript || null;
  const scriptText = transcript || reconstructed;

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold tracking-tight">
            Script / Transcript
          </p>
        </div>
        {!scriptText && (
          <Button
            onClick={generate}
            disabled={loading}
            size="sm"
            className="h-8 rounded-md bg-foreground text-background hover:bg-foreground/90 text-xs"
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileText className="mr-1.5 h-3 w-3" />
                Generate script
              </>
            )}
          </Button>
        )}
        {scriptText && !result && (
          <Button
            onClick={generate}
            disabled={loading}
            variant="outline"
            size="sm"
            className="h-8 rounded-md text-xs"
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              "Regenerate"
            )}
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] px-3 py-2 text-xs text-[var(--status-urgent-fg)]">
          {error}
        </div>
      )}

      {loading && !scriptText && (
        <div className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground">
            AI is reconstructing the video script...
          </p>
        </div>
      )}

      {result?.summary && (
        <div>
          <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-1.5">
            Summary
          </p>
          <p className="text-sm text-foreground">{result.summary}</p>
        </div>
      )}

      {result?.keyMoments && result.keyMoments.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
            Key moments
          </p>
          <div className="space-y-1.5">
            {result.keyMoments.map((moment, i) => (
              <div key={i} className="flex gap-3 items-start">
                <span className="flex items-center gap-1 text-xs num text-muted-foreground shrink-0 w-12">
                  <Clock className="h-3 w-3" />
                  {moment.timestamp}
                </span>
                <span className="text-xs">{moment.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {scriptText && (
        <div>
          <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
            {transcript ? "Transcript" : "Reconstructed script"}
          </p>
          <div className="rounded-md bg-muted p-4 text-sm leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
            {scriptText}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            {transcript
              ? "Real transcript captured from the video's audio"
              : "AI-reconstructed from metadata · Not the words actually spoken"}
          </p>
        </div>
      )}

      {!scriptText && !loading && !error && (
        <p className="text-xs text-muted-foreground py-4 text-center">
          Click &ldquo;Generate script&rdquo; to reconstruct the video&apos;s transcript using AI.
        </p>
      )}
    </div>
  );
}
