import { safePublicError } from "@/lib/public-error";
/**
 * GET  ?category= — the structure library (same category first).
 * POST { projectId, teardownId } — save a teardown's structure to the library.
 * Both are per account (src/services/structures.ts → structureWhereForTenant).
 */
import { NextResponse } from "next/server";
import { listStructures, saveStructureFromTeardown } from "@/services/structures";
import { viewerCanUseProject, viewerTenant } from "@/services/workspace";
import { withAccess } from "@/lib/auth/route-guard";

export const dynamic = "force-dynamic";

async function unguardedGET(req: Request) {
  const category = new URL(req.url).searchParams.get("category");
  return NextResponse.json({ structures: await listStructures(category, await viewerTenant()) });
}

async function unguardedPOST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; teardownId?: unknown };
  if (typeof body.projectId !== "string" || typeof body.teardownId !== "string") {
    return NextResponse.json({ error: "projectId and teardownId are required" }, { status: 400 });
  }
  // projectId comes from the body, so the proxy never checked it.
  if (!(await viewerCanUseProject(body.projectId))) {
    return NextResponse.json({ error: "Teardown not found" }, { status: 400 });
  }
  try {
    return NextResponse.json({ structure: await saveStructureFromTeardown(body.projectId, body.teardownId) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: safePublicError(err) }, { status: 400 });
  }
}

export const GET = withAccess(unguardedGET);
export const POST = withAccess(unguardedPOST);
