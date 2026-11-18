/**
 * P3 — start Ad Studio from a Creative script that has no storyboard yet. The script's own plan becomes the
 * 2-second-grid frames Ad Studio already reads from a storyboard (StoryboardFrameView fields):
 *   1. Script.scenes (the shot list: segment, shot, camera, location, action, voice-over, overlay) when present,
 *   2. otherwise hook → bodyBeats → cta (structured v2 script),
 *   3. otherwise the chosen hook variant + body text as one HOOK and one BODY frame.
 * A run made this way stores `script:<id>` as its storyboardId, so runs list and filter the same way.
 */
type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export const SCRIPT_SOURCE = "script:";
export const isScriptSource = (id: string) => id.startsWith(SCRIPT_SOURCE);
export const scriptIdOf = (id: string) => (isScriptSource(id) ? id.slice(SCRIPT_SOURCE.length) : null);

export interface ScriptLike {
  title?: string | null;
  scenes?: unknown;
  hook?: unknown;
  bodyBeats?: unknown;
  cta?: unknown;
  hookVariants?: unknown;
  selectedHookIdx?: number | null;
  body?: string | null;
  ctaVariants?: unknown;
  selectedCtaIdx?: number | null;
  totalDurationSec?: number | null;
}

export interface ScriptFrame {
  frameNumber: number; startSec: number; endSec: number; segment: string; scene?: string; shotType?: string; cameraMove?: string;
  productAction?: string; sellingPoint?: string; textOverlay?: string; voiceover?: string;
}

const pick = (list: unknown, idx: number | null | undefined) => {
  const a = Array.isArray(list) ? list : [];
  const v = a[idx ?? 0] ?? a[0];
  return typeof v === "string" ? v : s((v as J | undefined)?.text ?? (v as J | undefined)?.hook ?? "");
};
const seg = (v: unknown, i: number, total: number) => {
  const t = s(v).toUpperCase();
  if (/HOOK/.test(t)) return "HOOK";
  if (/CTA|CALL|END/.test(t)) return "CTA";
  if (t) return "BODY";
  return i === 0 ? "HOOK" : i === total - 1 ? "CTA" : "BODY";
};
const clean = (f: ScriptFrame): ScriptFrame => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "" && v !== undefined)) as unknown as ScriptFrame;

/** frames with start/end on a continuous timeline; missing timings fall on a 2 s grid */
export function framesFromScript(script: ScriptLike): ScriptFrame[] {
  const scenes = arr(script.scenes);
  const out: Omit<ScriptFrame, "frameNumber" | "startSec" | "endSec">[] = [];
  const durs: (number | undefined)[] = [];
  if (scenes.length) {
    scenes.forEach((x, i) => {
      out.push({
        segment: seg(x.segmentLabel, i, scenes.length),
        scene: [s(x.location), s(x.lighting), s(x.actorAction)].filter(Boolean).join(" · "),
        shotType: s(x.shotType), cameraMove: s(x.cameraMovement), productAction: s(x.productAction),
        voiceover: s(x.voiceover), textOverlay: s(x.textOverlay),
      });
      const a = n(x.startSec), b = n(x.endSec);
      durs.push(a !== undefined && b !== undefined && b > a ? b - a : undefined);
    });
  } else if (script.hook || arr(script.bodyBeats).length || script.cta) {
    const h = (script.hook as J) ?? {};
    if (script.hook) { out.push({ segment: "HOOK", scene: s(h.visual), shotType: s(h.shot), textOverlay: s(h.text), voiceover: s(h.text) }); durs.push(n(h.durationSec)); }
    for (const b of arr(script.bodyBeats)) {
      out.push({ segment: "BODY", scene: s(b.howExpressed), shotType: s(b.shot), sellingPoint: s(b.sellingPoint), voiceover: s(b.voiceover), textOverlay: s(b.textOverlay), productAction: s(b.proof) });
      const a = n(b.startSec), e = n(b.endSec);
      durs.push(a !== undefined && e !== undefined && e > a ? e - a : undefined);
    }
    const c = (script.cta as J) ?? {};
    if (script.cta) { out.push({ segment: "CTA", scene: s(c.visual), shotType: s(c.shot), textOverlay: s(c.text), voiceover: s(c.text), sellingPoint: s(c.offer) }); durs.push(n(c.durationSec)); }
  } else {
    const hook = pick(script.hookVariants, script.selectedHookIdx);
    const cta = pick(script.ctaVariants, script.selectedCtaIdx);
    if (hook) { out.push({ segment: "HOOK", textOverlay: hook, voiceover: hook }); durs.push(undefined); }
    if (s(script.body)) { out.push({ segment: "BODY", voiceover: s(script.body).slice(0, 600) }); durs.push(undefined); }
    if (cta) { out.push({ segment: "CTA", textOverlay: cta, voiceover: cta }); durs.push(undefined); }
  }
  let t = 0;
  return out.map((f, i) => {
    const d = Math.max(1, Math.min(8, durs[i] ?? 2));
    const frame = clean({ ...f, frameNumber: i + 1, startSec: +t.toFixed(2), endSec: +(t + d).toFixed(2) });
    t += d;
    return frame;
  });
}
