import { redirect } from "next/navigation";

/**
 * Research used to be its own progress page next to the results page. Both
 * now live on /content (progress panel on top), so old links land there.
 */
export default async function ResearchRedirect({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/content`);
}
