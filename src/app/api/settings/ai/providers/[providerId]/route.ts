/** DELETE — remove a bring-your-own provider (engine choices using it reset to automatic). */
import { NextResponse } from "next/server";
import { deleteProvider } from "@/services/settings/ai-settings";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(providerId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const deleted = await deleteProvider(providerId);
  if (!deleted) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
