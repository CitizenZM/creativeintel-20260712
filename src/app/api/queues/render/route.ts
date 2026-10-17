import { handleCallback } from "@vercel/queue";
import { processRender, type RenderMessage } from "@/services/video-gen/render-dispatch";
export const maxDuration = 300;
export const POST = handleCallback<RenderMessage>(processRender, {
  retry: (_error, metadata) => ({ afterSeconds: Math.min(300, 10 * 2 ** Math.min(metadata.deliveryCount, 5)) }),
});
