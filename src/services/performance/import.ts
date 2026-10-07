/**
 * Ad-performance import: Meta Ads Manager and TikTok Ads exports (CSV), with
 * fuzzy header matching, so real results flow back without an API connection.
 * Rows are matched to our versions through the A/B ad name we generate
 * (Brand_Script_20s_HookC[_4x5]).
 */

export interface PerfRow {
  platform: "meta" | "tiktok" | "other";
  adName: string;
  hookStyle: string | null;
  format: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  impressions: number;
  views3s: number;
  thruplays: number;
  clicks: number;
  spend: number;
  conversions: number;
}

/** RFC-4180-ish CSV (quoted fields, doubled quotes, CRLF), also tab-separated exports. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const delim = (src.split("\n")[0].match(/\t/g)?.length ?? 0) > (src.split("\n")[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** "1,234" / "$12.30" / "2.5%" / "—" → number. */
export function num(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const COLS: Record<keyof Omit<PerfRow, "platform" | "hookStyle" | "format">, RegExp[]> = {
  adName: [/^ad name$/i, /^ad$/i, /^ad name\b/i],
  dateFrom: [/reporting starts/i, /^date$/i, /^by day$/i, /^start date/i],
  dateTo: [/reporting ends/i, /^end date/i],
  impressions: [/^impressions$/i],
  views3s: [/3-second video plays/i, /2-second video views/i, /video plays at 3 seconds/i],
  thruplays: [/^thruplays$/i, /6-second video views/i, /video plays at 100%/i],
  clicks: [/^link clicks$/i, /clicks \(all\)/i, /^clicks \(destination\)/i, /^clicks$/i],
  spend: [/amount spent/i, /^cost$/i, /^spend$/i, /total cost/i],
  conversions: [/^results$/i, /^conversions$/i, /^purchases$/i],
};

/** Fields a Batch Mode name adds (creative/batch-matrix.ts batchAdName). */
export interface BatchNameFields {
  hookId: string | null;
  endCard: string;
  aspect: string;
  durationSec: number;
  voice: string;
  music: string | null;
  cta: string | null;
}

/** Brand_Script_15s_HookH09_E04_4x5_VAndrew_MPop_CShopNow (M… and C… optional). */
const BATCH_NAME = /_(\d{1,3})s_Hook([QCP]|H\d{2})_(E\d{2})_(9x16|4x5|1x1|16x9)_V([A-Za-z0-9]+)(?:_M([A-Za-z0-9]+))?(?:_C([A-Za-z0-9]+))?(?:_|$)/i;

/**
 * Hook style and format from our A/B naming: …_HookC, …_HookP_4x5, …_HookQ_15s. Batch Mode names also
 * give the library hook id, end card, aspect, length, voice, music and CTA; their hookStyle is q/c/p
 * for a restyle or the lower-case hook id (h09) so the learning loop compares library hooks too.
 */
export function parseAdName(name: string): { hookStyle: string | null; format: string | null } & Partial<BatchNameFields> {
  const b = BATCH_NAME.exec(name);
  if (b) {
    const hookId = /^H/i.test(b[2]) ? b[2].toUpperCase() : null;
    const aspect = b[4].toLowerCase();
    return {
      hookStyle: b[2].toLowerCase(),
      format: aspect,
      hookId,
      endCard: b[3].toUpperCase(),
      aspect,
      durationSec: Number(b[1]),
      voice: b[5],
      music: b[6]?.toLowerCase() ?? null,
      cta: b[7] ?? null,
    };
  }
  const hook = /_Hook([QCP])(?:_|$)/i.exec(name)?.[1]?.toLowerCase() ?? null;
  const format = /_(4x5|1x1|16x9|9x16|15s|10s)(?:_|$)/i.exec(name)?.[1]?.toLowerCase() ?? (hook ? "9x16" : null);
  return { hookStyle: hook, format };
}

export function rowsFromCsv(text: string): { rows: PerfRow[]; platform: PerfRow["platform"]; unmatchedHeaders: string[] } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], platform: "other", unmatchedHeaders: [] };
  const header = table[0].map((h) => h.trim());
  const platform: PerfRow["platform"] = header.some((h) => /2-second video views|6-second video views/i.test(h))
    ? "tiktok"
    : header.some((h) => /amount spent|3-second video plays|thruplays|reporting starts/i.test(h))
      ? "meta"
      : "other";
  const idx = {} as Record<keyof typeof COLS, number>;
  for (const key of Object.keys(COLS) as (keyof typeof COLS)[]) {
    idx[key] = header.findIndex((h) => COLS[key].some((re) => re.test(h)));
  }
  const date = (v: string | undefined) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const rows: PerfRow[] = [];
  for (const r of table.slice(1)) {
    const adName = (r[idx.adName] ?? "").trim();
    if (!adName || /^total/i.test(adName)) continue;
    rows.push({
      platform,
      adName,
      ...parseAdName(adName),
      dateFrom: date(r[idx.dateFrom]),
      dateTo: date(r[idx.dateTo]),
      impressions: Math.round(num(r[idx.impressions])),
      views3s: Math.round(num(r[idx.views3s])),
      thruplays: Math.round(num(r[idx.thruplays])),
      clicks: Math.round(num(r[idx.clicks])),
      spend: num(r[idx.spend]),
      conversions: Math.round(num(r[idx.conversions])),
    });
  }
  const unmatchedHeaders = (Object.keys(COLS) as (keyof typeof COLS)[]).filter((k) => idx[k] < 0 && k !== "dateTo" && k !== "conversions");
  return { rows, platform, unmatchedHeaders };
}
