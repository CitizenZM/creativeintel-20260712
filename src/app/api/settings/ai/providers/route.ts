/** POST — connect a bring-your-own model API (key encrypted at rest). */
import { NextResponse } from "next/server";
import { providerInputSchema } from "@/services/settings/ai-settings-core";
import { createProvider, ProviderInputError } from "@/services/settings/ai-settings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = providerInputSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid provider", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const provider = await createProvider(parsed.data);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (err) {
    if (err instanceof ProviderInputError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[settings/ai] create provider failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not save the provider" }, { status: 500 });
  }
}
