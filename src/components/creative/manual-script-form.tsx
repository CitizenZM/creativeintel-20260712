"use client";

import { useState } from "react";
import { Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ScriptData } from "./script-card";

/**
 * Plan B for script writing: the user writes the hook, one line per shot and
 * the CTA; no AI is involved. The script is stored in the same structured shape
 * as a generated one, so storyboard, Studio and voiceover work unchanged.
 */
export function ManualScriptForm({ projectId, onCreated }: { projectId: string; onCreated: (script: ScriptData) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [hook, setHook] = useState("");
  const [lines, setLines] = useState("");
  const [cta, setCta] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/creative/scripts/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || hook.slice(0, 60),
          hook,
          lines: lines.split("\n").map((l) => l.trim()).filter(Boolean),
          cta,
          totalDurationSec: seconds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the script");
      onCreated(data as ScriptData);
      setOpen(false);
      setTitle("");
      setHook("");
      setLines("");
      setCta("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the script");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" className="h-9 rounded-md text-xs" onClick={() => setOpen(true)}>
        <PenLine className="mr-2 h-3.5 w-3.5" /> Write a script yourself
      </Button>
    );
  }

  const ready = hook.trim() && lines.trim() && cta.trim();
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid="manual-script-form">
      <p className="text-sm font-medium">Write a script yourself</p>
      <p className="text-[11px] text-muted-foreground">
        No AI needed. One line per shot — write <span className="font-mono">what we see | what is said</span>, or just one text for both.
        The storyboard, Studio and voiceover use it like any other script.
      </p>
      <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input placeholder="Hook — the first line the viewer hears" value={hook} onChange={(e) => setHook(e.target.value)} />
      <Textarea
        placeholder={"Wide shot of the TV on a living-room wall | Brighter than any TV you've owned.\nClose-up of a football match on screen | Every blade of grass, in 4K."}
        value={lines}
        onChange={(e) => setLines(e.target.value)}
        rows={5}
      />
      <Input placeholder="Call to action — e.g. Shop the QM7L today" value={cta} onChange={(e) => setCta(e.target.value)} />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Length
        <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="rounded border border-border bg-background px-1 py-0.5">
          {[15, 20, 30, 45, 60].map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-xs text-[var(--status-urgent-fg)]">{error}</p>}
      <div className="flex gap-2">
        <Button className="h-8 rounded-md text-xs" disabled={!ready || saving} onClick={() => void submit()}>
          {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />} Save script
        </Button>
        <Button variant="outline" className="h-8 rounded-md text-xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
