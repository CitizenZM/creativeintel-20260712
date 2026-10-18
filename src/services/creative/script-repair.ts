import type { ScriptV2 } from "@/lib/script-schema";

/** Repair the rejected draft instead of paying for another unconstrained script. */
export function scriptRepairRequest(userPrompt: string, draft: ScriptV2, violationsText: string) {
  const draftJson = JSON.stringify(draft);
  // The response keeps the draft's JSON shape. Allow room for longer safe rewrites.
  const maxTokens = Math.min(8000, Math.max(2500, Math.ceil(Buffer.byteLength(draftJson, "utf8") / 3) + 600));
  return {
    userPrompt: `${userPrompt}\n\nREPAIR THE EXISTING DRAFT BELOW. Return the complete corrected JSON with the same structure and creative angle. Change only the fields needed to resolve the listed violations; preserve all other approved copy, beats, scene timing and product details. Do not introduce new claims, statistics, offer terms or CTA text.\n\nDRAFT JSON:\n${draftJson}\n\nVIOLATIONS TO FIX:\n${violationsText}`,
    maxTokens,
  };
}
