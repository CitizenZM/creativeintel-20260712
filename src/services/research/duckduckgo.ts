import * as cheerio from "cheerio";
import { fetchWithRetry } from "./http";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Distinguishes "DuckDuckGo actively refused this request" from "DuckDuckGo
 * answered and there happen to be zero matches" — callers must not report
 * the former as a successful empty search. Confirmed against production,
 * 2026-09-13: DuckDuckGo answers Vercel's datacenter egress with HTTP 202
 * and a JS-challenge interstitial (zero `.result` nodes) rather than the
 * normal HTTP 200 results page a residential IP gets for the same query.
 */
export class DuckDuckGoBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuckDuckGoBlockedError";
  }
}

function parseResultsHtml(html: string, maxResults: number): SearchResult[] {
  const $ = cheerio.load(html);

  const results: SearchResult[] = [];
  $(".result").each((_, el) => {
    const titleEl = $(el).find(".result__title a");
    const title = titleEl.text().trim();
    let href = titleEl.attr("href") || "";

    // DuckDuckGo wraps URLs in redirects
    const udMatch = href.match(/uddg=([^&]+)/);
    if (udMatch) href = decodeURIComponent(udMatch[1]);

    const snippet = $(el).find(".result__snippet").text().trim();

    if (title && href) {
      results.push({ title, url: href, snippet });
    }
  });

  return results.slice(0, maxResults);
}

export interface SearchOptions {
  /**
   * Re-run the search through the operator's browser when this server's IP is
   * challenged. Only for background work — it waits on the local worker.
   */
  projectId?: string | null;
  viaWorkerOnBlock?: boolean;
}

export async function searchDuckDuckGo(
  query: string,
  maxResults = 10,
  opts: SearchOptions = {}
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetchWithRetry(
    url,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    },
    { timeoutMs: 8000 }
  );

  if (response.status === 200) {
    return parseResultsHtml(await response.text(), maxResults);
  }

  if (opts.viaWorkerOnBlock) {
    const { fetchViaWorker } = await import("./browser-fetch");
    const page = await fetchViaWorker(url, { projectId: opts.projectId, waitMs: 2500 });
    if (page?.html) {
      const viaBrowser = parseResultsHtml(page.html, maxResults);
      if (viaBrowser.length > 0) return viaBrowser;
    }
    throw new DuckDuckGoBlockedError(
      `DuckDuckGo answered this server with HTTP ${response.status} (anti-bot challenge) and the local browser worker could not complete the search either — is the research worker running?`
    );
  }

  throw new DuckDuckGoBlockedError(
    `DuckDuckGo answered with HTTP ${response.status} instead of 200 — this is its anti-bot challenge response, not a real results page (seen from this server's IP; the identical query returns normal results from a residential IP).`
  );
}
