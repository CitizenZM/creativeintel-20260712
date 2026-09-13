/**
 * Look controls the operator sets per generation — lighting and visual style —
 * plus whatever they type themselves. Rendered into one clause that rides
 * along with the storyboard prompt and, through the board's stored `style`,
 * into the LibTV image and clip prompts, so a run keeps one consistent look.
 */

export interface LookOption {
  id: string;
  label: string;
  /** Written in the language a DP would use, since it lands in an image prompt. */
  clause: string;
}

export const LIGHTING_OPTIONS: LookOption[] = [
  {
    id: "golden_hour",
    label: "Golden hour",
    clause: "warm low-angle golden-hour sunlight, long soft shadows, 4500K",
  },
  {
    id: "bright_daylight",
    label: "Bright daylight",
    clause: "clean overhead midday daylight, crisp shadows, 5600K",
  },
  {
    id: "soft_overcast",
    label: "Soft overcast",
    clause: "flat diffused overcast light, no hard shadows, 6000K",
  },
  {
    id: "studio_softbox",
    label: "Studio softbox",
    clause: "controlled studio softbox key with gentle fill, seamless background, 5200K",
  },
  {
    id: "high_key",
    label: "High key",
    clause: "high-key lighting, bright airy exposure, minimal shadow, white-forward set",
  },
  {
    id: "moody_low_key",
    label: "Moody low key",
    clause: "low-key contrast lighting, deep shadows, single hard key, rim separation",
  },
  {
    id: "neon_night",
    label: "Neon night",
    clause: "night exterior lit by neon and practical signage, wet reflective surfaces, cyan/magenta cast",
  },
];

export const STYLE_OPTIONS: LookOption[] = [
  {
    id: "cinematic",
    label: "Cinematic",
    clause: "cinematic commercial photography, shallow depth of field, anamorphic feel, graded contrast",
  },
  {
    id: "ugc_handheld",
    label: "UGC handheld",
    clause: "authentic handheld phone-shot look, natural imperfection, front-facing energy, no studio polish",
  },
  {
    id: "clean_product",
    label: "Clean product",
    clause: "clean commercial product photography, uncluttered set, product hero framing",
  },
  {
    id: "editorial",
    label: "Editorial",
    clause: "editorial fashion-campaign framing, considered negative space, confident styling",
  },
  {
    id: "documentary",
    label: "Documentary",
    clause: "observational documentary framing, available light, unstaged blocking",
  },
  {
    id: "energetic_sport",
    label: "Energetic / sport",
    clause: "high-energy sports-commercial treatment, motion blur on movement, dynamic low angles",
  },
];

export interface VisualDirection {
  lighting?: string | null;
  style?: string | null;
  /** Free text from the operator — always wins over the presets. */
  notes?: string | null;
}

function findClause(options: LookOption[], id?: string | null): string | null {
  if (!id) return null;
  return options.find((o) => o.id === id)?.clause ?? null;
}

export function findLabel(options: LookOption[], id?: string | null): string | null {
  if (!id) return null;
  return options.find((o) => o.id === id)?.label ?? null;
}

/** One line for a prompt, or "" when nothing was chosen. */
export function renderVisualDirection(direction: VisualDirection | null | undefined): string {
  if (!direction) return "";
  const parts = [
    findClause(STYLE_OPTIONS, direction.style),
    findClause(LIGHTING_OPTIONS, direction.lighting),
    direction.notes?.trim() || null,
  ].filter(Boolean);
  return parts.length ? parts.join(". ") : "";
}

/** Short human label for the board list — e.g. "Cinematic · Golden hour". */
export function summarizeVisualDirection(direction: VisualDirection | null | undefined): string {
  if (!direction) return "";
  return [
    findLabel(STYLE_OPTIONS, direction.style),
    findLabel(LIGHTING_OPTIONS, direction.lighting),
    direction.notes?.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");
}
