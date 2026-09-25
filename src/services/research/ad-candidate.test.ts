import { describe, expect, it } from "vitest";
import { dedupeCandidates, type AdCandidate } from "./ad-candidate";

function yt(id: string, extra = ""): AdCandidate {
  return {
    sourceId: `youtube:${id}`,
    source: "youtube",
    platform: "youtube",
    format: "unknown",
    isPaidAd: false,
    adEvidence: "none",
    competitorId: null,
    metrics: {},
    thumbnailUrl: "",
    permalink: `https://youtube.com/watch?v=${id}${extra}`,
    title: id,
  } as unknown as AdCandidate;
}

describe("dedupeCandidates", () => {
  it("keeps distinct videos whose identity lives in the query string", () => {
    const out = dedupeCandidates([yt("a"), yt("b"), yt("c")]);
    expect(out.map((c) => c.title)).toEqual(["a", "b", "c"]);
  });

  it("drops the same video found twice, even with tracking params", () => {
    const dup = { ...yt("a", "&utm_source=x&si=abc"), sourceId: "other:a" };
    const out = dedupeCandidates([yt("a"), dup]);
    expect(out).toHaveLength(1);
  });

  it("keeps distinct Meta ad snapshots that differ only by id param", () => {
    const meta = (id: string) =>
      ({
        ...yt(id),
        sourceId: `meta_ad_library:${id}`,
        permalink: `https://www.facebook.com/ads/archive/render_ad/?id=${id}&access_token=t`,
      }) as AdCandidate;
    expect(dedupeCandidates([meta("1"), meta("2")])).toHaveLength(2);
  });
});
