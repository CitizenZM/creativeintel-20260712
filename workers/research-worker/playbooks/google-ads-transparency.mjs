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

import { runEgoScript } from './_ego.mjs';

const RESOLVE_AND_SCRAPE = `
const task = await openSpace("creativeintel research worker");
const page = task.page("p1");

await page.goto("https://adstransparency.google.com/?region=" + REGION);
await page.waitForTimeout(2500);

let advertiserId = "";
try {
  await page.fill('input[type="text"]', ADVERTISER);
  await page.waitForTimeout(2500);
  // The suggestion list is the only route from a name to an AR id.
  await page.press('input[type="text"]', "ArrowDown");
  await page.press('input[type="text"]', "Enter");
  await page.waitForTimeout(5000);
  advertiserId = await page.evaluate(() => {
    const a = document.querySelector('a[aria-label^="Advertisement ("]');
    const m = a && a.href.match(/advertiser\\/(AR\\d+)/);
    return m ? m[1] : "";
  });
} catch (err) {
  advertiserId = "";
}

if (!advertiserId) {
  emit({ spaceId: task.spaceId, advertiserId: "", cards: [], reason: "could not resolve an advertiser id from the search box" });
} else {
  await page.goto(
    "https://adstransparency.google.com/advertiser/" + advertiserId +
    "?region=" + REGION + "&format=VIDEO"
  );
  await page.waitForTimeout(5000);

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
  const limit = Math.min(payload.limit || 20, 40);
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
