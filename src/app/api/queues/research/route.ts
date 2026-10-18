import { handleCallback } from "@vercel/queue";
import { processResearch } from "@/services/research/dispatch";
export const maxDuration = 300;
export const POST = handleCallback<{ jobId: string }>(processResearch, {
  retry: (_error, metadata) => ({ afterSeconds: Math.min(300, 10 * 2 ** Math.min(metadata.deliveryCount, 5)) }),
});
