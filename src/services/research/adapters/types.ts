import type { AdCandidate } from "../ad-candidate";
import type { SearchKeywords } from "../keyword-extractor";

/** Status of one adapter within a research run, surfaced in the job steps. */
export type SourceStatus =
  | "ran"
  | "skipped_no_key"
  | "failed"
  | "pending_worker";

export interface SourceReport {
  name: string;
  status: SourceStatus;
  count: number;
  note?: string;
}

export interface AdapterContext {
  /** Brand name for the brand partition, or the competitor's name. */
  ownerName: string;
  /** Competitor row id, or null for the brand. */
  competitorId: string | null;
  projectId: string;
  productName?: string;
  keywords: SearchKeywords;
  countries?: string[];
  limit?: number;
  /** Names of every competitor — used by brand-agnostic feeds for matching. */
  allAdvertiserNames?: string[];
}

export interface AdapterResult {
  candidates: AdCandidate[];
  report: SourceReport;
}

export type Adapter = (ctx: AdapterContext) => Promise<AdapterResult>;

export function emptyResult(name: string, note?: string): AdapterResult {
  return { candidates: [], report: { name, status: "ran", count: 0, note } };
}

export function failedResult(name: string, err: unknown): AdapterResult {
  return {
    candidates: [],
    report: {
      name,
      status: "failed",
      count: 0,
      note: err instanceof Error ? err.message : String(err),
    },
  };
}
