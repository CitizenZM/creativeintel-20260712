// TikTok Commercial Content Library playbook.
//
// Probed live 2026-09-10. Two findings shape this playbook:
//  1. URL query params (`query`, `adv_name`, `region`) do NOT hydrate the
//     controls — the search has to be typed into the box and submitted, or
//     issued against the site's own JSON API.
//  2. From a non-US egress the site returns "Total ads: 0" for every query
//     (its analytics reported the browser geo as CN). If this playbook keeps
//     returning zero, check the machine's egress region before assuming the
//     selectors broke.
//
// Primary path is the page's own POST /api/v1/search via page.fetch() (same
// origin, same cookies); the typed-UI scrape is the fallback.

import { runEgoScript } from './_ego.mjs';

const SCRIPT = `
const task = await openSpace("creativeintel research worker");
const page = task.page("p1");
await page.goto("https://library.tiktok.com/ads?region=" + REGION);
await page.waitForTimeout(3500);

const endSec = Math.floor(Date.now() / 1000);
const startSec = endSec - 180 * 24 * 60 * 60;

// Path 1: the site's own JSON API. Body shape is not publicly documented, so
// a failure here is expected to be common — fall through to the UI.
let api = null;
try {
  const res = await page.fetch(
    "/api/v1/search?region=" + REGION + "&type=1&start_time=" + startSec + "&end_time=" + endSec,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: ADVERTISER,
        query_type: 1,
        region: REGION,
        limit: LIMIT,
        offset: 0,
        search_id: "",
        order_by: "create_time,desc",
      }),
      timeout: 20000,
    }
  );
  if (res.ok) {
    api = typeof res.body === "string" ? JSON.parse(res.body) : res.body;
  }
} catch (err) {
  api = null;
}

const apiAds = api && api.data && Array.isArray(api.data.materials) ? api.data.materials : [];
if (apiAds.length > 0) {
  emit({ spaceId: task.spaceId, via: "api", ads: apiAds.slice(0, LIMIT) });
} else {
  // Path 2: type the advertiser into the public search box and read the cards.
  let uiNote = "";
  try {
    await page.fill('input[type="text"]', ADVERTISER);
    await page.press('input[type="text"]', "Enter");
    await page.waitForTimeout(6000);
  } catch (err) {
    uiNote = "could not drive the search box: " + err.message;
  }

  const scraped = await page.evaluate((limit) => {
    const total = (document.body.innerText.match(/Total ads:?\\s*([\\d,]+)/i) || [])[1] || "";
    const anchors = [...document.querySelectorAll('a[href*="/ads/detail"]')];
    const out = [];
    for (const a of anchors) {
      const card = a.closest("div");
      if (!card) continue;
      const id = (a.href.match(/[?&]ad_id=([^&]+)/) || [])[1] || a.href;
      const img = card.querySelector("img");
      const video = card.querySelector("video");
      out.push({
        adId: id,
        permalink: a.href,
        advertiser: (card.querySelector('[class*="advertiser"], [class*="brand"]') || {}).innerText || "",
        text: (card.innerText || "").slice(0, 400),
        thumbnail: img ? img.src : "",
        videoSrc: video ? video.currentSrc || video.src || "" : "",
      });
      if (out.length >= limit) break;
    }
    return { total, cards: out };
  }, LIMIT);

  emit({
    spaceId: task.spaceId,
    via: "ui",
    ads: [],
    cards: scraped.cards,
    total: scraped.total,
    note: uiNote,
  });
}
`;

function fromApiAd(raw, payload) {
  const adId = String(raw.id ?? raw.ad_id ?? '');
  if (!adId) return null;
  const toIso = (v) => {
    if (!v) return undefined;
    const n = Number(v);
    const ts = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : Date.parse(v);
    return Number.isNaN(ts) ? undefined : new Date(ts).toISOString();
  };
  return {
    sourceId: `tiktok_ad_library:${adId}`,
    source: 'tiktok_ad_library',
    platform: 'tiktok',
    aspect: '9:16',
    isPaidAd: true,
    adEvidence: 'ad_library',
    adConfidence: 1,
    advertiserName: raw.advertiser_name || raw.brand_name || payload.advertiser,
    advertiserId: raw.advertiser_id ? String(raw.advertiser_id) : undefined,
    adLibraryId: adId,
    competitorId: payload.competitorId ?? null,
    metrics: {
      impressionsLower: Number(raw.impression ?? raw.show_cnt) || undefined,
    },
    firstSeen: toIso(raw.first_shown_date ?? raw.first_show_date ?? raw.create_time),
    lastSeen: toIso(raw.last_shown_date ?? raw.last_show_date),
    landingUrl: raw.landing_page || undefined,
    videoUrl: raw.video_url || raw.video_info?.video_url || undefined,
    thumbnailUrl: raw.cover || raw.video_info?.cover_url || '',
    permalink: `https://library.tiktok.com/ads/detail?ad_id=${adId}`,
    title: (raw.ad_title || raw.ad_text || `TikTok ad ${adId}`).slice(0, 160),
    description: raw.ad_text || undefined,
  };
}

function fromCard(card, payload) {
  return {
    sourceId: `tiktok_ad_library:${card.adId}`,
    source: 'tiktok_ad_library',
    platform: 'tiktok',
    aspect: '9:16',
    isPaidAd: true,
    adEvidence: 'ad_library',
    adConfidence: 1,
    advertiserName: card.advertiser || payload.advertiser,
    adLibraryId: String(card.adId),
    competitorId: payload.competitorId ?? null,
    metrics: {},
    videoUrl: card.videoSrc || undefined,
    thumbnailUrl: card.thumbnail || '',
    permalink: card.permalink,
    title: (card.text || `TikTok ad ${card.adId}`).split('\n')[0].slice(0, 160),
    description: card.text,
  };
}

export async function runTikTokAdLibrary(payload) {
  const region = (payload.countries?.[0] || 'US').toUpperCase();
  const limit = Math.min(payload.limit || 20, 40);

  const body = `const REGION = ${JSON.stringify(region)};
const ADVERTISER = ${JSON.stringify(payload.advertiser)};
const LIMIT = ${limit};
${SCRIPT}`;

  const result = await runEgoScript(body, { timeoutMs: 180_000 });

  if (result.via === 'api' && result.ads?.length) {
    const candidates = result.ads.map((a) => fromApiAd(a, payload)).filter(Boolean);
    return { candidates, note: `${candidates.length} ads via library.tiktok.com API` };
  }

  const candidates = (result.cards || []).map((c) => fromCard(c, payload));
  const note =
    candidates.length === 0
      ? `no ads rendered (site reported total "${result.total ?? '?'}"). ${result.note || ''} If this persists, verify the worker machine's egress region is ${region}.`.trim()
      : `${candidates.length} ads scraped from the UI`;
  return { candidates, note };
}
