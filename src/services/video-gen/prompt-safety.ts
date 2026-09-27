/**
 * Prompt hygiene for generated frames and clips (server engines).
 *
 * Free image/video models draw garbled lettering whenever a prompt mentions a
 * logo, an overlay, a screen's UI or a hex colour ("#FFD700" becomes text), and
 * they warp faces as soon as people move. Captions, subtitles and the real
 * packshot carry all text and branding, so frames are asked for none, and
 * shots with people are held as a still with a slow zoom instead of AI motion.
 */

const HEX_NAMES: Array<[RegExp, string]> = [
  [/#(?:FFD700|FFC107|F5C518|FFB300)\b/gi, "golden"],
  [/#(?:000000|111111|0A0A0A)\b/gi, "black"],
  [/#(?:FFFFFF|FAFAFA|F5F5F5)\b/gi, "white"],
];

// Words that ask the model to draw branding or writing.
const TEXT_WORD =
  /\b(?:logos?|wordmarks?|brand name|lettering|typography|text|captions?|titles?|headlines?|urls?|website address|signage|signs?|billboards?|labels?|overlays?|watermarks?|slogans?)\b/i;
const JOINER = /\b(?:with|featuring|showing|displaying|and|plus|as|while|where)\b/gi;

/**
 * Drop the part of a clause that asks for text: from the joining word before
 * it ("…a city alive with digital overlays") to the clause end, or the whole
 * clause when it is only about the text ("a16z logo subtly integrated").
 */
function stripTextRequests(prompt: string): string {
  return prompt
    .split(/(?<=[.;,])/)
    .map((clause) => {
      const m = TEXT_WORD.exec(clause);
      if (!m) return clause;
      let cut = -1;
      for (const j of clause.slice(0, m.index).matchAll(JOINER)) cut = j.index ?? cut;
      const kept = cut > 0 ? clause.slice(0, cut).trimEnd() : "";
      return kept ? kept + (/[.;,]$/.test(clause.trim()) ? clause.trim().slice(-1) : "") : "";
    })
    .join(" ");
}

const SCREEN = /\b(?:app|dashboard|interface|ui|screen|display|monitor|tablet|phone|smartphone|laptop|website)\b/i;

const STYLE_NOISE = /\b(?:cinematic )?storyboard concept art\b|\bconcept art\b|\byoutube video ad\b/gi;

export function cleanFramePrompt(prompt: string): string {
  let p = prompt;
  for (const [re, name] of HEX_NAMES) p = p.replace(re, name);
  p = p.replace(/#[0-9a-f]{6}\b/gi, "").replace(/\b\d{4}K\b/g, "");
  p = p.replace(STYLE_NOISE, "");
  p = stripTextRequests(p);
  p = p.replace(/\s+([.,;])/g, "$1").replace(/([.,;]){2,}/g, "$1").replace(/\s{2,}/g, " ").trim();
  if (SCREEN.test(p)) p += " Any screen shows only soft, out-of-focus abstract colour, with nothing readable.";
  return `${p} Cinematic film still, photorealistic, natural light, sharp focus.`.trim();
}

// Words for people whose faces a video model would have to move.
const PEOPLE =
  /\b(?:man|men|woman|women|male|female|person|people|guy|girl|boy|kid|child|founder|entrepreneur|ceo|mentor|panel|team|colleagues?|customer|traveller|traveler|model|actor|actress|face|faces|portrait|smiles?|smiling|he|she|they|his|her|members?|audience|crowd)\b/i;

export function hasPeople(prompt: string): boolean {
  return PEOPLE.test(prompt);
}

export function motionSafePrompt(prompt: string): string {
  return `Steady, slow camera movement; smooth motion without blur. ${prompt}`;
}
