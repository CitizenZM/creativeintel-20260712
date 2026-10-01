/**
 * GET  ?category= — the structure library (same category first).
 * POST { projectId, teardownId } — save a teardown's structure to the library.
 */
import { NextResponse } from "next/server";
import { listStructures, saveStructureFromTeardown } from "@/services/structures";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const category = new URL(req.url).searchParams.get("category");
  return NextResponse.json({ structures: await listStructures(category) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; teardownId?: unknown };
  if (typeof body.projectId !== "string" || typeof body.teardownId !== "string") {
    return NextResponse.json({ error: "projectId and teardownId are required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ structure: await saveStructureFromTeardown(body.projectId, body.teardownId) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
