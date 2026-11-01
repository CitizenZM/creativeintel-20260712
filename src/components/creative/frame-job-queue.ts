/**
 * One browser tab sends at most this many frame-image requests at a time. A storyboard
 * can have dozens of frames and each request holds a serverless instance for up to 30 s.
 */
export const MAX_FRAME_JOBS = 2;

let active = 0;
const waiting: Array<() => void> = [];

export async function runFrameJob<T>(job: () => Promise<T>): Promise<T> {
  if (active >= MAX_FRAME_JOBS) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    return await job();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
