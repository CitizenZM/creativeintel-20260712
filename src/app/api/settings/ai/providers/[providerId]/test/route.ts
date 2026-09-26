/** POST — test a saved provider's connection (list models, else a 1-token completion). */
import { NextResponse } from "next/server";
import { cachedProvider, loadAiSettings } from "@/services/settings/ai-settings";
import { testProviderConnection } from "@/services/settings/ai-settings-view";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(_request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(providerId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await loadAiSettings({ fresh: true });
  const provider = cachedProvider(providerId);
  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  return NextResponse.json(await testProviderConnection(provider));
}
