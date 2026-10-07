import { PlanningWorkspace } from "@/components/planning/planning-workspace";

export default async function PlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  // Dev-only: ?fixture=1 renders the NXTPAPER fixtures without any API call.
  const fixture = process.env.NODE_ENV !== "production" && sp.fixture === "1";
  return <PlanningWorkspace projectId={projectId} fixture={fixture} />;
}
