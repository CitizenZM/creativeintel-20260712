import { handleCallback } from "@vercel/queue";
import { processCreativeBatch } from "@/services/creative/batch-dispatch";

export const maxDuration = 300;
export const POST = handleCallback<{ jobId: string }>(processCreativeBatch, {
  retry: (_error, metadata) => ({ afterSeconds: Math.min(300, 10 * 2 ** Math.min(metadata.deliveryCount, 5)) }),
});
