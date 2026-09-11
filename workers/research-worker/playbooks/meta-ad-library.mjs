// Meta Ad Library playbook.
//
// Selector strategy verified live on 2026-09-10: Meta's class names are
// obfuscated atoms and change per deploy, so the only stable anchor is the
// literal text node "Library ID: <digits>". We climb from it to the results
// grid and read each card's own <video> element — the mp4 URL and the poster
// are on the card itself, no click into a snapshot view is needed.
//
// Public pages only. No login, no CAPTCHA, one page load per task.

import { runEgoScript, parseDateRange, unwrapFacebookLink, aspectFrom } from './_ego.mjs';

function searchUrl({ advertiser, country }) {
  const params = new URLSearchParams({
    active_status: 'all',
    ad_type: 'all',
    country,
    media_type: 'video',
    q: advertiser,
    search_type: 'keyword_unordered',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

const SCRAPE = `
const task = await openSpace("creativeintel research worker");
const page = task.page("p1");
await page.goto(URL);
await page.waitForTimeout(4000);

// Give the lazily-attached <video> elements a chance to report metadata.
await page.evaluate(() => {
  for (const v of document.querySelectorAll("video")) {
    try { v.preload = "metadata"; v.load(); } catch {}
  }
});
await page.waitForTimeout(2500);

const cards = await page.evaluate((limit) => {
  const idEls = [...document.querySelectorAll("div")]
    .filter((d) => /^Library ID:\\s*\\d+$/.test((d.textContent || "").trim()));
  if (idEls.length === 0) return { cards: [], reason: "no Library ID nodes found" };

  let node = idEls[0];
  for (let i = 0; i < 6 && node.parentElement; i++) node = node.parentElement;
  const grid = node;

  const seen = new Set();
  const out = [];
  for (const card of [...grid.children]) {
    const text = card.innerText || "";
    const libraryId = (text.match(/Library ID:\\s*(\\d+)/) || [])[1];
    if (!libraryId || seen.has(libraryId)) continue;
    seen.add(libraryId);

    const advertiserAnchor = card.querySelector('a[href*="facebook.com/"]:not([href*="/l.php"])');
    const ctaAnchor = card.querySelector('a[href*="/l.php"]');
    const video = card.querySelector("video");

    out.push({
      libraryId,
      dateText:
        (text.match(/Started running on ([^\\n]+)/) || [])[1] ||
        (text.match(/([A-Z][a-z]{2} \\d{1,2}, \\d{4} - [A-Z][a-z]{2} \\d{1,2}, \\d{4})/) || [])[1] ||
        "",
      active: /\\bActive\\b/.test(text),
      advertiser: advertiserAnchor ? (advertiserAnchor.innerText || "").trim() : "",
      advertiserHref: advertiserAnchor ? advertiserAnchor.href : "",
      ctaHref: ctaAnchor ? ctaAnchor.href : "",
      body: text.slice(0, 600),
      videoSrc: video ? video.currentSrc || video.src || "" : "",
      poster: video ? video.poster || "" : "",
      durationSec: video && isFinite(video.duration) && video.duration > 0 ? video.duration : null,
      videoWidth: video ? video.videoWidth : 0,
      videoHeight: video ? video.videoHeight : 0,
    });
    if (out.length >= limit) break;
  }
  return { cards: out, reason: out.length === 0 ? "grid produced no cards" : "" };
}, LIMIT);

emit({ spaceId: task.spaceId, ...cards });
`;

/** Numeric page id when the advertiser link is /<digits>/, otherwise the slug. */
function advertiserIdFrom(href) {
  if (!href) return undefined;
  const numeric = href.match(/facebook\.com\/(\d{6,})\/?/);
  if (numeric) return numeric[1];
  const slug = href.match(/facebook\.com\/([^/?#]+)/);
  return slug?.[1];
}

function bodyTitle(text, advertiser) {
  const cleaned = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !/^Library ID:/.test(l) &&
        !/^(Active|Inactive|Sponsored|Open Dropdown)$/i.test(l) &&
        !/^Started running on/.test(l) &&
        !/^See (ad details|summary details)$/i.test(l)
    );
  return (cleaned.find((l) => l.length > 12) || advertiser || 'Meta ad').slice(0, 160);
}

export async function runMetaAdLibrary(payload) {
  const country = (payload.countries?.[0] || 'US').toUpperCase();
  const limit = Math.min(payload.limit || 20, 40);
  const url = searchUrl({ advertiser: payload.advertiser, country });

  const body = `const URL = ${JSON.stringify(url)};
const LIMIT = ${limit};
${SCRAPE}`;

  const result = await runEgoScript(body, { timeoutMs: 180_000 });
  const advertiserNeedle = payload.advertiser.trim().toLowerCase();

  const candidates = (result.cards || [])
    // A keyword search returns ads that merely MENTION the brand; keep the ones
    // the advertiser actually ran.
    .filter((c) => {
      const name = (c.advertiser || '').toLowerCase();
      return !name || name.includes(advertiserNeedle) || advertiserNeedle.includes(name);
    })
    .map((c) => {
      const { firstSeen, lastSeen } = parseDateRange(c.dateText);
      const aspect = aspectFrom(c.videoWidth, c.videoHeight);
      return {
        sourceId: `meta_ad_library:${c.libraryId}`,
        source: 'meta_ad_library',
        platform: /instagram/i.test(c.ctaHref || '') ? 'instagram' : 'facebook',
        durationSec: c.durationSec ?? undefined,
        aspect,
        isPaidAd: true,
        adEvidence: 'ad_library',
        adConfidence: 1,
        advertiserName: c.advertiser || payload.advertiser,
        advertiserId: advertiserIdFrom(c.advertiserHref),
        adLibraryId: c.libraryId,
        competitorId: payload.competitorId ?? null,
        metrics: {},
        firstSeen,
        lastSeen: lastSeen ?? (c.active ? undefined : firstSeen),
        landingUrl: unwrapFacebookLink(c.ctaHref),
        videoUrl: c.videoSrc || undefined,
        thumbnailUrl: c.poster || '',
        permalink: `https://www.facebook.com/ads/library/?id=${c.libraryId}`,
        title: bodyTitle(c.body, c.advertiser),
        description: (c.body || '').slice(0, 500),
        publishedAt: firstSeen,
        channelTitle: c.advertiser || undefined,
      };
    });

  return { candidates, note: result.reason || `${candidates.length} video ads` };
}
