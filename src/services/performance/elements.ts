/**
 * Creative elements of an ad, for attribution: hook id (H01–H35) and family, end card (E01–E12),
 * platform, aspect, duration, voice and selling point. Read from the ad name with a tolerant
 * tokenizer — tagged tokens in any order, e.g. `brand_tiktok_H06-E08-v:aria-9x16-15s_sp2` — and
 * from the PerfElementMap table (run/variant → elements) for names that don't carry them. Old
 * names (Brand_Script_20s_HookC[_4x5]) keep working: they yield the legacy hook style.
 */
import { hookById } from "@/services/creative/library";

export interface AdElements {
  hookId?: string;
  hookFamily?: string;
  endCardId?: string;
  platform?: string;
  aspect?: string;
  durationSec?: number;
  voice?: string;
  sellingPointId?: string;
  /** Legacy q | c | p hook style. */
  hookStyle?: string;
}

/** Attribution dimensions (the level of each is a string). */
export const ELEMENT_DIMS = ["hookId", "hookFamily", "endCardId", "platform", "aspect", "duration", "voice", "sellingPoint", "hookStyle"] as const;
export type ElementDim = (typeof ELEMENT_DIMS)[number];

export function levelOf(e: AdElements, dim: ElementDim): string | null {
  const v =
    dim === "duration" ? (e.durationSec ? `${e.durationSec}s` : null)
    : dim === "sellingPoint" ? e.sellingPointId
    : e[dim];
  return v ? String(v) : null;
}

const PLATFORM_IDS = [
  "youtube_instream_nonskippable_15s",
  "youtube_instream_skippable",
  "youtube_bumper_6s",
  "instagram_stories",
  "instagram_reels",
  "google_demand_gen",
  "youtube_shorts",
  "facebook_reels",
  "meta_feed",
  "pinterest",
  "snapchat",
  "tiktok",
];
const PLATFORM_ALIAS: Record<string, string> = {
  tiktok: "tiktok", tt: "tiktok", ttk: "tiktok", spark: "tiktok",
  meta: "meta_feed", fb: "meta_feed", facebook: "meta_feed", feed: "meta_feed", metafeed: "meta_feed",
  ig: "instagram_reels", insta: "instagram_reels", instagram: "instagram_reels", reels: "instagram_reels", igreels: "instagram_reels",
  stories: "instagram_stories", igstories: "instagram_stories", story: "instagram_stories",
  fbreels: "facebook_reels",
  shorts: "youtube_shorts", ytshorts: "youtube_shorts",
  yt: "youtube_instream_skippable", youtube: "youtube_instream_skippable", instream: "youtube_instream_skippable",
  bumper: "youtube_bumper_6s", dg: "google_demand_gen", demandgen: "google_demand_gen",
  pinterest: "pinterest", pin: "pinterest", snap: "snapchat", snapchat: "snapchat",
};
const ASPECTS = new Set(["9x16", "4x5", "1x1", "16x9", "2x3", "3x4", "4x3"]);
const pad2 = (n: number) => String(n).padStart(2, "0");

const normHook = (v?: string | null) => {
  const m = /^h?(\d{1,2})$/i.exec((v ?? "").trim());
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= 35 ? `H${pad2(n)}` : undefined;
};
const normEnd = (v?: string | null) => {
  const m = /^e?(\d{1,2})$/i.exec((v ?? "").trim());
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= 12 ? `E${pad2(n)}` : undefined;
};
const normAspect = (v?: string | null) => {
  const a = (v ?? "").trim().toLowerCase().replace(":", "x");
  return ASPECTS.has(a) ? a : undefined;
};

export function parseAdElements(name: string): AdElements {
  const out: AdElements = {};
  const lower = name.toLowerCase();
  for (const id of PLATFORM_IDS) {
    if (new RegExp(`(^|[_\\-\\s|])${id}($|[_\\-\\s|])`).test(lower)) {
      out.platform = id;
      break;
    }
  }
  for (const raw of lower.split(/[_\-\s|,.]+/)) {
    const t = raw.trim();
    if (!t) continue;
    let m: RegExpExecArray | null;
    if ((m = /^(?:hook)?h(\d{1,2})$/.exec(t))) out.hookId ??= normHook(m[1]);
    else if ((m = /^hook([qcp])$/.exec(t))) out.hookStyle ??= m[1];
    else if ((m = /^(?:ec|end)?e(\d{1,2})$/.exec(t))) out.endCardId ??= normEnd(m[1]);
    else if ((m = /^(?:v|vo|voice)[:=](.+)$/.exec(t))) out.voice ??= m[1];
    else if ((m = /^(?:sp[:=])?(sp\d{1,2})$/.exec(t)) || (m = /^sp[:=](.+)$/.exec(t))) out.sellingPointId ??= m[1];
    else if ((m = /^(\d{1,2}[x:]\d{1,2})$/.exec(t))) out.aspect ??= normAspect(m[1]);
    else if ((m = /^(\d{1,3})s$/.exec(t))) out.durationSec = Number(m[1]); // last wins: a cut-down after the script length
    else if (!out.platform && PLATFORM_ALIAS[t]) out.platform = PLATFORM_ALIAS[t];
  }
  for (const k of Object.keys(out) as (keyof AdElements)[]) if (out[k] === undefined) delete out[k];
  // Our masters are 9:16; exports carry their aspect token (same default as the legacy parser).
  if ((out.hookStyle || out.hookId) && !out.aspect) out.aspect = "9x16";
  if (out.hookId) out.hookFamily = hookById(out.hookId)?.family;
  return out;
}

export interface ElementMapEntry {
  adName: string;
  hookId?: string | null;
  endCardId?: string | null;
  voice?: string | null;
  aspect?: string | null;
  durationSec?: number | null;
  sellingPointId?: string | null;
  platform?: string | null;
}

/** Name-parsed elements win; the mapping fills gaps. Values are normalized; the family follows the hook. */
export function mergeElements(parsed: AdElements, mapped?: Partial<ElementMapEntry> | null): AdElements {
  const out: AdElements = { ...parsed };
  if (mapped) {
    out.hookId ??= normHook(mapped.hookId);
    out.endCardId ??= normEnd(mapped.endCardId);
    out.voice ??= mapped.voice?.trim().toLowerCase() || undefined;
    out.aspect ??= normAspect(mapped.aspect);
    out.durationSec ??= mapped.durationSec && mapped.durationSec > 0 ? Math.round(mapped.durationSec) : undefined;
    out.sellingPointId ??= mapped.sellingPointId?.trim().toLowerCase() || undefined;
    out.platform ??= mapped.platform?.trim().toLowerCase() || undefined;
  }
  if (out.hookId && !out.hookFamily) out.hookFamily = hookById(out.hookId)?.family;
  for (const k of Object.keys(out) as (keyof AdElements)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * Resolver for rows: parse the name, overlay the mapping (exact name, else the longest mapped name
 * the ad name starts with — Ads Manager appends " - Copy" etc.), fall back to the row's platform.
 */
export function elementResolver(maps: ElementMapEntry[] = []): (row: { adName: string; platform?: string | null }) => AdElements {
  const keyed = maps.map((m) => ({ key: m.adName.trim().toLowerCase(), m })).filter((x) => x.key).sort((a, b) => b.key.length - a.key.length);
  const cache = new Map<string, AdElements>();
  return (row) => {
    const ck = `${row.platform ?? ""}\u0000${row.adName}`;
    const hit = cache.get(ck);
    if (hit) return hit;
    const name = row.adName.trim().toLowerCase();
    const mapped = keyed.find((x) => x.key === name)?.m ?? keyed.find((x) => name.startsWith(x.key))?.m;
    const e = mergeElements(parseAdElements(row.adName), mapped);
    if (!e.platform && row.platform && row.platform !== "other") e.platform = row.platform;
    cache.set(ck, e);
    return e;
  };
}
