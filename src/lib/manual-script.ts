/**
 * A script the user writes by hand — Plan B when AI script writing fails or
 * isn't wanted. It is stored in the same structured shape the AI writes
 * (hook / body beats / CTA), so storyboards, Studio and the voiceover treat it
 * exactly like a generated one.
 */
import type { StructuredBeat, StructuredCta, StructuredHook } from "./storyboard-grid";

export interface ManualScriptInput {
  title: string;
  hook: string;
  /** One line per shot: "what we see | what is said" (or one text for both). */
  lines: string[];
  cta: string;
  totalDurationSec: number;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
const short = (s: string, words = 7) => tidy(s).split(" ").slice(0, words).join(" ");

export function buildManualScript(input: ManualScriptInput) {
  const total = input.totalDurationSec;
  const hookSec = Math.max(2, Math.round(total * 0.15));
  const ctaSec = Math.max(2, Math.round(total * 0.15));
  const hook: StructuredHook = { text: tidy(input.hook), visual: tidy(input.hook), durationSec: hookSec };
  const lines = input.lines.map(tidy).filter(Boolean);
  const span = total - hookSec - ctaSec;
  const bodyBeats: StructuredBeat[] = lines.map((line, i) => {
    const [seen, said] = line.includes("|") ? line.split("|").map(tidy) : [line, line];
    return {
      beat: short(seen, 10),
      actorAction: seen,
      voiceover: said || seen,
      textOverlay: short(said || seen),
      startSec: Math.round(hookSec + (span * i) / lines.length),
      endSec: Math.round(hookSec + (span * (i + 1)) / lines.length),
    };
  });
  const cta: StructuredCta = { text: tidy(input.cta), visual: tidy(input.cta), durationSec: ctaSec };
  const body = [
    `[HOOK] ${hook.text}`,
    ...bodyBeats.map((b, i) => `[BODY ${i + 1}] ${b.actorAction}${b.voiceover && b.voiceover !== b.actorAction ? `\n  VO: ${b.voiceover}` : ""}`),
    `[CTA] ${cta.text}`,
  ].join("\n");
  return {
    title: tidy(input.title),
    template: "MANUAL",
    hook,
    bodyBeats,
    cta,
    body,
    totalDurationSec: total,
  };
}
