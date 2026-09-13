import * as cheerio from "cheerio";
import { cached } from "@/services/cache";

export interface CrawlResult {
  url: string;
  title: string;
  metaDescription: string;
  headings: string[];
  ctaTexts: string[];
  productFeatures: string[];
  testimonials: string[];
  pricingMentions: string[];
  socialProof: string[];
  images: { alt: string; src: string }[];
  bodyText: string;
  links: string[];
}

export async function crawlWebsite(url: string): Promise<CrawlResult> {
  if (process.env.MOCK_CRAWL === "true") {
    return getMockCrawlResult(url);
  }
  return cached(
    { kind: "crawl:website", params: { url }, schemaVersion: 1 },
    () => crawlWebsiteUncached(url)
  );
}

async function crawlWebsiteUncached(url: string): Promise<CrawlResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; CreativeIntelBot/1.0; +https://creativeintel.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    return parseHtml(url, html);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseHtml(url: string, html: string): CrawlResult {
  const $ = cheerio.load(html);

  // Remove scripts and styles
  $("script, style, noscript").remove();

  const title = $("title").text().trim();
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || "";

  const headings: string[] = [];
  $("h1, h2, h3").each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 200) headings.push(text);
  });

  // Find CTAs (buttons, links with action words)
  const ctaPatterns =
    /shop|buy|get|try|start|order|subscribe|sign up|learn more|discover|explore|add to cart|join/i;
  const ctaTexts: string[] = [];
  $("a, button").each((_, el) => {
    const text = $(el).text().trim();
    if (text && ctaPatterns.test(text) && text.length < 100) {
      ctaTexts.push(text);
    }
  });

  // Find product features (list items, feature descriptions)
  const productFeatures: string[] = [];
  $("li, .feature, [class*='feature'], [class*='benefit']").each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 10 && text.length < 300) {
      productFeatures.push(text);
    }
  });

  // Find testimonials
  const testimonials: string[] = [];
  $(
    "blockquote, [class*='testimonial'], [class*='review'], [class*='quote']"
  ).each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 20 && text.length < 500) {
      testimonials.push(text);
    }
  });

  // Find pricing mentions
  const pricingMentions: string[] = [];
  const priceRegex = /\$[\d,.]+|free|starting at|per month|\/mo|pricing/i;
  $("*").each((_, el) => {
    const text = $(el)
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .trim();
    if (text && priceRegex.test(text) && text.length < 200) {
      pricingMentions.push(text);
    }
  });

  // Social proof elements
  const socialProof: string[] = [];
  $("[class*='social-proof'], [class*='trust'], [class*='customer']").each(
    (_, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 300) socialProof.push(text);
    }
  );

  // Images with alt text
  const images: { alt: string; src: string }[] = [];
  $("img[alt]").each((_, el) => {
    const alt = $(el).attr("alt")?.trim();
    const src = $(el).attr("src") || "";
    if (alt) images.push({ alt, src });
  });

  // Body text (truncated)
  const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 5000);

  // Important links
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
      try {
        const absolute = new URL(href, url).toString();
        links.push(absolute);
      } catch {
        // invalid URL
      }
    }
  });

  return {
    url,
    title,
    metaDescription,
    headings: headings.slice(0, 30),
    ctaTexts: [...new Set(ctaTexts)].slice(0, 20),
    productFeatures: productFeatures.slice(0, 30),
    testimonials: testimonials.slice(0, 10),
    pricingMentions: [...new Set(pricingMentions)].slice(0, 10),
    socialProof: socialProof.slice(0, 10),
    images: images.slice(0, 20),
    bodyText,
    links: [...new Set(links)].slice(0, 50),
  };
}

function getMockCrawlResult(url: string): CrawlResult {
  return {
    url,
    title: "Sample Brand - Premium Products",
    metaDescription: "Discover our premium collection of products designed for modern living.",
    headings: [
      "Welcome to Our Brand",
      "Our Best Sellers",
      "Why Choose Us",
      "Customer Stories",
    ],
    ctaTexts: ["Shop Now", "Learn More", "Get Started", "Try Free"],
    productFeatures: [
      "Premium materials",
      "Sustainable manufacturing",
      "30-day money-back guarantee",
      "Free shipping on orders over $50",
    ],
    testimonials: [
      "This product changed my daily routine. Highly recommend!",
      "Best quality I've found in this price range.",
    ],
    pricingMentions: ["Starting at $29.99", "Free shipping"],
    socialProof: ["Over 10,000 happy customers", "4.8/5 star rating"],
    images: [{ alt: "Product hero image", src: "/hero.jpg" }],
    bodyText: "Sample brand body text for analysis...",
    links: [`${url}/products`, `${url}/about`],
  };
}
