import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import OpenAI from "openai";

export const maxDuration = 30;

export async function GET() {
  const results: Record<string, unknown> = {
    env: {
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      aiModel: process.env.AI_MODEL || "gpt-4o",
      mockAI: process.env.MOCK_AI,
      databaseUrl: process.env.DATABASE_URL?.slice(0, 30) + "...",
    },
  };

  // Test DB
  try {
    const count = await prisma.project.count();
    results.db = { success: true, projectCount: count };
  } catch (err) {
    results.db = { success: false, error: String(err).slice(0, 500) };
  }

  // Test OpenAI
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });
    const response = await client.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o",
      max_tokens: 50,
      messages: [{ role: "user", content: 'Say {"ok":true}' }],
      response_format: { type: "json_object" },
    });
    results.openai = { success: true, model: response.model };
  } catch (err) {
    results.openai = { success: false, error: String(err).slice(0, 300) };
  }

  // Temporary egress diagnostic — is Vercel's outbound IP blocked by the
  // third-party sites the research adapters scrape? Remove once diagnosed.
  try {
    const res = await fetch(
      "https://html.duckduckgo.com/html/?q=test",
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }
    );
    const text = await res.text();
    results.duckduckgoEgress = {
      status: res.status,
      bytes: text.length,
      resultCount: (text.match(/class="result /g) || []).length,
      snippet: text.slice(0, 300),
    };
  } catch (err) {
    results.duckduckgoEgress = { error: String(err).slice(0, 300) };
  }

  try {
    const res = await fetch(
      "https://ads.tiktok.com/creative_radar_api/v1/top_ads/v2/list?period=30&page=1&limit=5&country_code=US&order_by=for_you",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
          Accept: "application/json, text/plain, */*",
          Referer: "https://ads.tiktok.com/business/creativecenter/inspiration/popular/pc/en",
        },
      }
    );
    const text = await res.text();
    results.tiktokCreativeCenterEgress = { status: res.status, body: text.slice(0, 400) };
  } catch (err) {
    results.tiktokCreativeCenterEgress = { error: String(err).slice(0, 300) };
  }

  return NextResponse.json(results);
}
