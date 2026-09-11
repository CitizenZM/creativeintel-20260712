// Google Ads Transparency Center playbook.
//
// Probed live 2026-09-10:
//  - `?query=` on the landing page is ignored; the advertiser has to be typed
//    into the public search box to resolve its AR id.
//  - Once the AR id is known, `/advertiser/<AR>?region=<X>&format=VIDEO` is
//    directly addressable and `creative-preview` gives clean, stable selectors.
//  - There is no <video> anywhere: video creatives render inside
//    tpc.googlesyndication.com safeframes. The practical video handle is the
//    YouTube id embedded in the card thumbnail (i.ytimg.com/vi/<ID>/...).
//  - A google-hats-survey iframe can overlay the page and swallow clicks, so
//    filters are applied by URL, never by clicking.
//
// Root-caused live 2026-09-11: every task was returning "0 candidates" for
// advertisers that clearly run YouTube video ads (City Beauty, Grande
// Cosmetics, Crepe Erase, Olay). Unlike the Meta Ad Library bug on the same
// date, this is NOT a locale/rendering issue — `document.documentElement.lang`
// is "en-US" on this machine's egress with or without `hl=en`, no consent
// dialog appears (already signed into a Google account), and searches for
// real advertisers (Nike, Olay, City Beauty, Grande Cosmetics) all return
// correct results on both the landing-page suggestion box and `/search`.
// `hl=en` is still forced below as cheap defense-in-depth.
//
// The actual bug: after `page.fill()` populates the advertiser suggestion
// list, the old code pressed ArrowDown then Enter on the input to select the
// first suggestion. That never worked — the suggestion widget is a custom
// Angular `material-select-item[role=option]` listbox that does not respond
// to arrow-key roving selection from the input, so the page never navigated
// off the landing page and `a[aria-label^="Advertisement ("]` never matched
// anything. Verified live: clicking a `material-select-item` element
// directly (`el.click()`) navigates correctly to
// `/advertiser/<AR...>?region=...`, while ArrowDown+Enter leaves the URL
// unchanged. The fix below polls for suggestion items and clicks the
// best-matching one instead of using the keyboard.
//
// Also verified live: "Crepe Erase" returns zero results everywhere on the
// site (suggestion box, `/search?query=Crepe+Erase`, and `/search?query=
// crepeerase.com`) — this looks like a genuinely absent/unindexed advertiser
// right now, not a scraping bug, and the "could not resolve an advertiser
// id" fallback below is the correct outcome for it.

import { runEgoScript } from './_ego.mjs';

// Scoped to the advertiser column only — the landing-page suggestion box
// renders "Advertisers" and "Websites" as two sibling listboxes that Google
// (confusingly) both label aria-label="Advertiser suggestions", so the class
// name is the only reliable way to exclude domain suggestions.
const ADVERTISER_SUGGESTION_SEL =
  '.search-suggestions-select:not(.search-suggestions-select-websites) material-select-item';

const RESOLVE_AND_SCRAPE = `
const task = await openSpace("creativeintel research worker");
const page = task.page("p1");
const ADV_SEL = ${JSON.stringify(ADVERTISER_SUGGESTION_SEL)};

await page.goto("https://adstransparency.google.com/?region=" + REGION + "&hl=en");
await page.waitForTimeout(2000);

let advertiserId = "";
try {
  await page.fill('input[type="text"]', ADVERTISER);

  // Poll for the suggestion list instead of a fixed sleep — the RPC that
  // populates it (SearchService/SearchSuggestions) is not reliably done in
  // under 2.5s, and a fixed sleep is exactly the kind of thing that silently
  // breaks. Bounded at 20s. Match case-insensitively: prefer an exact
  // (case-insensitive) name match, then a substring match either direction,
  // then fall back to the top suggestion.
  let pickIndex = -1;
  const suggestDeadline = Date.now() + 20000;
  while (Date.now() < suggestDeadline && pickIndex < 0) {
    pickIndex = await page.evaluate((arg) => {
      const items = [...document.querySelectorAll(arg.sel)];
      if (items.length === 0) return -1;
      const needle = arg.needle.trim().toLowerCase();
      const names = items.map((el) => (el.querySelector('.name')?.textContent || '').trim().toLowerCase());
      let idx = names.findIndex((n) => n === needle);
      if (idx < 0) idx = names.findIndex((n) => n && (n.includes(needle) || needle.includes(n)));
      if (idx < 0) idx = 0;
      return idx;
    }, { sel: ADV_SEL, needle: ADVERTISER });
    if (pickIndex < 0) await page.waitForTimeout(500);
  }

  if (pickIndex >= 0) {
    // This custom Angular listbox only reacts to a real click on the option
    // element — ArrowDown/Enter on the input never selects or navigates
    // (root-caused live, see file header). el.click() dispatches a real
    // bubbling click event, which Angular's (click) binding does pick up.
    await page.evaluate((arg) => {
      const items = document.querySelectorAll(arg.sel);
      items[arg.idx] && items[arg.idx].click();
    }, { sel: ADV_SEL, idx: pickIndex });

    const navDeadline = Date.now() + 10000;
    while (Date.now() < navDeadline && !advertiserId) {
      const url = await page.url();
      const m = url.match(/advertiser\\/(AR\\d+)/);
      if (m) { advertiserId = m[1]; break; }
      await page.waitForTimeout(300);
    }
  }
} catch (err) {
  advertiserId = "";
}

if (!advertiserId) {
  emit({ spaceId: task.spaceId, advertiserId: "", cards: [], reason: "could not resolve an advertiser id from the search box" });
} else {
  await page.goto(
    "https://adstransparency.google.com/advertiser/" + advertiserId +
    "?region=" + REGION + "&hl=en&format=VIDEO"
  );
  await page.waitForTimeout(5000);

  // Best-effort: nudge a couple more lazily-loaded thumbnails into the DOM.
  // Verified live that most creative-preview cards render immediately
  // (80 cards with zero scrolling for a real advertiser) but only a
  // fraction carry a loaded i.ytimg.com <img> at any given moment — capped
  // at two scrolls per this playbook's operating rules, not because more
  // scrolling reliably yields more thumbnails.
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(1200);
  }

  const cards = await page.evaluate((limit) =>
    [...document.querySelectorAll("creative-preview")].slice(0, limit).map((w) => {
      const a = w.querySelector('a[aria-label^="Advertisement ("]');
      const img = w.querySelector("img");
      const nameEl = w.querySelector(".advertiser-name");
      return {
        href: a ? a.href : "",
        creativeId: a ? (a.href.match(/creative\\/(CR\\d+)/) || [])[1] || "" : "",
        advertiserId: a ? (a.href.match(/advertiser\\/(AR\\d+)/) || [])[1] || "" : "",
        advertiserName: nameEl ? (nameEl.innerText || "").trim() : "",
        thumbnail: img ? img.src : "",
        isVideo: !!w.querySelector("fletch-renderer"),
      };
    }), LIMIT);

  // Only the creative detail page carries the shown dates; bounded and paced so
  // this stays a normal-looking visit rather than a crawl.
  const detailed = [];
  for (const card of cards.slice(0, DETAIL_LIMIT)) {
    if (!card.href) { detailed.push(card); continue; }
    try {
      await page.goto(card.href);
      await page.waitForTimeout(2200);
      const dates = await page.evaluate(() => {
        const t = document.body.innerText || "";
        return {
          lastShown: (t.match(/Last shown:?\\s*([A-Z][a-z]{2} \\d{1,2}, \\d{4})/) || [])[1] || "",
          firstShown: (t.match(/First shown:?\\s*([A-Z][a-z]{2} \\d{1,2}, \\d{4})/) || [])[1] || "",
          format: (t.match(/Format:?\\s*(\\w+)/) || [])[1] || "",
        };
      });
      detailed.push({ ...card, ...dates });
    } catch (err) {
      detailed.push(card);
    }
  }
  const rest = cards.slice(DETAIL_LIMIT);
  emit({ spaceId: task.spaceId, advertiserId, cards: [...detailed, ...rest], reason: "" });
}
`;

function toIso(value) {
  if (!value) return undefined;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? undefined : new Date(ts).toISOString();
}

function youtubeIdFrom(thumbnail) {
  const m = (thumbnail || '').match(/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{6,})\//);
  return m?.[1];
}

export async function runGoogleAdsTransparency(payload) {
  const region = (payload.countries?.[0] || 'US').toUpperCase();
  // Capped at 20 per task regardless of what's requested — this playbook
  // scrolls at most twice, matching the meta-ad-library playbook's rule.
  const limit = Math.min(payload.limit || 20, 20);
  const detailLimit = Math.min(limit, 10);

  const body = `const REGION = ${JSON.stringify(region)};
const ADVERTISER = ${JSON.stringify(payload.advertiser)};
const LIMIT = ${limit};
const DETAIL_LIMIT = ${detailLimit};
${RESOLVE_AND_SCRAPE}`;

  const result = await runEgoScript(body, { timeoutMs: 240_000 });

  const candidates = (result.cards || [])
    .filter((c) => c.creativeId)
    .map((c) => {
      const ytId = youtubeIdFrom(c.thumbnail);
      return {
        sourceId: `google_ats:${c.creativeId}`,
        source: 'google_ats',
        platform: 'google',
        // Google ATC never publishes duration, and the creative sits behind a
        // safeframe, so aspect is unknown — the ranking applies its penalty.
        isPaidAd: true,
        adEvidence: 'ad_library',
        adConfidence: 1,
        advertiserName: c.advertiserName || payload.advertiser,
        advertiserId: c.advertiserId || undefined,
        adLibraryId: c.creativeId,
        competitorId: payload.competitorId ?? null,
        metrics: {},
        firstSeen: toIso(c.firstShown),
        lastSeen: toIso(c.lastShown),
        videoUrl: ytId ? `https://www.youtube.com/watch?v=${ytId}` : undefined,
        thumbnailUrl: c.thumbnail || '',
        permalink:
          c.href ||
          `https://adstransparency.google.com/advertiser/${c.advertiserId}/creative/${c.creativeId}?region=${region}`,
        title: `${c.advertiserName || payload.advertiser} — ${c.creativeId}`,
        description: undefined,
        publishedAt: toIso(c.firstShown),
      };
    });

  return {
    candidates,
    note:
      result.reason ||
      `${candidates.length} video creatives for advertiser ${result.advertiserId}`,
  };
}
