import { redirect } from "next/navigation";

/** The two studio pages merged into one; this path is kept so old links resolve. */
export default async function StudioVideoRedirect({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/studio`);
}
