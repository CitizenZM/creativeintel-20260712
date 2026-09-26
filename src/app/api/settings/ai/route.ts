/**
 * GET — the AI engine settings page's data (choices, options, providers
 *       without keys, this month's usage, free allowance).
 * PUT — save engine choices / the strict-free toggle (partial update).
 */
import { NextResponse } from "next/server";
import { settingsPatchSchema } from "@/services/settings/ai-settings-core";
import { saveAiSettings } from "@/services/settings/ai-settings";
import { getAiSettingsView } from "@/services/settings/ai-settings-view";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getAiSettingsView());
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = settingsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    await saveAiSettings(parsed.data);
  } catch (err) {
    console.error("[settings/ai] save failed:", err);
    return NextResponse.json(
      { error: `Could not save settings: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
  return NextResponse.json(await getAiSettingsView());
}
