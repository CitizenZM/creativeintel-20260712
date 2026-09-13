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

  return NextResponse.json(results);
}
