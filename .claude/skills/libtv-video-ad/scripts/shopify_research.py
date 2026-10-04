#!/usr/bin/env python3
"""Product intake from a Shopify brand store (us.tcl.com and most DTC sites) — no browser.

  python3 scripts/shopify_research.py https://us.tcl.com --bestsellers tv-for-sale \
      --products qm7l-series-...,nxtpaper-14 --service install --out research/tcl --tag-images

What it writes to --out:
  bestsellers.txt        product handles in the store's own best-selling order (?sort_by=best-selling)
  <handle>.json          variants (size, price, compare-at = the real discount), body copy, image list
  <handle>.specs.txt     spec label/value pairs and claim lines scraped from the product page
  <handle>.service.txt   every page sentence mentioning --service (e.g. "install"): verify offers here
  images/<handle>/NN.*   every official product image (the only source of truth for the product)
  assets.json            (--tag-images, needs OPENROUTER_API_KEY) per image: what it shows, type, text,
                         and a rights flag — league marks (NFL…), film/TV posters and app UI are not usable

Rules this encodes (lessons from the TCL BF/CM plan, 2026-10-04):
  * "Best seller" = the store's best-selling sort / best-seller page, not a guess.
  * A promo or service claim is only made if the store page says it; copy its exact limits into the
    disclaimer (TCL install: standard wall-mount labour only, hardware extra, varies by location).
  * Official images often carry licensed marks or third-party content; flag them before planning.
"""
import argparse, base64, html, io, json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128 Safari/537.36"}


def get(url, binary=False, timeout=40):
    raw = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()
    return raw if binary else raw.decode("utf-8", "ignore")


def page_lines(markup):
    markup = re.sub(r"<script.*?</script>|<style.*?</style>|<svg.*?</svg>", " ", markup, flags=re.S)
    out, seen = [], set()
    for line in html.unescape(re.sub(r"<[^>]+>", "\n", markup)).split("\n"):
        line = re.sub(r"\s+", " ", line).strip()
        if 2 < len(line) < 400 and line not in seen and not re.match(r"^[{(\[]|^(var|window|function)\b", line):
            seen.add(line); out.append(line)
    return out


SPEC_LABELS = re.compile(r"^(Resolution|Refresh Rate|Weight|Size|Battery|Processor|Storage|Memory|Display|Screen|Panel|"
                         r"Brightness|Peak Brightness \(nits\)|Dimming Zones|HDMI|HDMI 2\.1|Speaker System|Color|Operating System)$")

RISK = [(re.compile(r"\bNFL|NBA|MLB|NHL|FIFA|Olympic", re.I), "not usable: league/event marks"),
        (re.compile(r"poster|movie|film|Wicked|Netflix|YouTube|app icons|interface", re.I), "not usable: third-party content / UI")]


def tag_image(path, key):
    from PIL import Image
    im = Image.open(path).convert("RGB"); im.thumbnail((512, 512))  # vision tokens scale with pixels
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=80)
    q = ('Product image from a brand store. JSON only: {"shows":"<=20 words","type":"packshot|lifestyle|feature-graphic|detail|accessory",'
         '"has_text":true/false,"ad_use":"<=12 words"}')
    body = {"model": os.environ.get("RESEARCH_VISION_MODEL", "z-ai/glm-4.6v"), "max_tokens": 250, "reasoning": {"enabled": False},
            "messages": [{"role": "user", "content": [{"type": "text", "text": q},
                                                      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}}]}]}
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", json.dumps(body).encode(),
                                 {"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    content = json.load(urllib.request.urlopen(req, timeout=120))["choices"][0]["message"]["content"]
    d = json.loads(re.search(r"\{.*\}", content, re.S).group(0))
    text = f"{d.get('shows','')} {d.get('ad_use','')}"
    d["rights"] = next((label for rx, label in RISK if rx.search(text)), "check text" if d.get("has_text") else "usable (composite your own screen content)")
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("store"); ap.add_argument("--bestsellers", help="collection handle to sort by best-selling")
    ap.add_argument("--products", default="", help="comma-separated product handles")
    ap.add_argument("--service", default="install"); ap.add_argument("--out", required=True)
    ap.add_argument("--tag-images", action="store_true")
    a = ap.parse_args(); base = a.store.rstrip("/"); os.makedirs(a.out, exist_ok=True)

    if a.bestsellers:
        order = list(dict.fromkeys(re.findall(r"/products/([a-z0-9-]+)", get(f"{base}/collections/{a.bestsellers}?sort_by=best-selling"))))
        open(f"{a.out}/bestsellers.txt", "w").write("\n".join(order)); print("best-selling:", order[:8])

    tags = []
    for h in [x for x in a.products.split(",") if x]:
        prod = json.loads(get(f"{base}/products/{h}.json"))["product"]
        json.dump(prod, open(f"{a.out}/{h}.json", "w"), indent=1)
        lines = page_lines(get(f"{base}/products/{h}"))
        specs = [f"{l}: {lines[i+1]}" for i, l in enumerate(lines[:-1]) if SPEC_LABELS.match(l) and not SPEC_LABELS.match(lines[i + 1])]
        claims = [l for l in lines if re.search(r"\b(nits|Hz|zones|mAh|HDMI|Dolby|inch|\")", l) and len(l) > 25]
        open(f"{a.out}/{h}.specs.txt", "w").write("\n".join(specs + ["", "# claim lines"] + claims[:80]))
        service = [l for l in lines if re.search(a.service, l, re.I) and not re.search(r"window\[|overrideFetch|\.js|\.css", l)]
        open(f"{a.out}/{h}.service.txt", "w").write("\n".join(service))
        print(f"{prod['title']}: {len(prod['variants'])} variants, {len(prod['images'])} images, {len(specs)} specs, {len(service)} '{a.service}' lines")
        for v in prod["variants"]:
            print(f"   {v['title']}: ${v['price']} (was {v.get('compare_at_price')})")
        d = f"{a.out}/images/{h}"; os.makedirs(d, exist_ok=True)

        def save(item):
            i, img = item
            url = img["src"].split("?")[0]; path = f"{d}/{i:02d}.{url.rsplit('.', 1)[-1][:4]}"
            open(path, "wb").write(get(url, binary=True, timeout=60)); return path
        with ThreadPoolExecutor(8) as ex:
            paths = list(ex.map(save, enumerate(prod["images"], 1)))
        if a.tag_images:
            key = os.environ.get("OPENROUTER_API_KEY")
            if not key: sys.exit("--tag-images needs OPENROUTER_API_KEY")
            with ThreadPoolExecutor(8) as ex:
                for path, t in zip(paths, ex.map(lambda p: tag_image(p, key), paths)):
                    tags.append({"product": h, "file": os.path.relpath(path, a.out), **t})
    if tags:
        json.dump(tags, open(f"{a.out}/assets.json", "w"), indent=1)
        for t in tags: print(f"   {t['file']}: {t['rights']} | {t.get('shows')}")


if __name__ == "__main__":
    main()
