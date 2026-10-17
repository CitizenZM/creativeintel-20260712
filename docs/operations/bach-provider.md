# Bach.art media provider

Bach.art is now available as a server-side image and video engine. Select **Bach.art GPT Image2 Economy** for image work and **Bach Chrome (720p)** for video in Settings → AI engines / the Studio model selector. With the Bach credentials present, the app's automatic image/video defaults prefer Bach unless Strict Free mode is enabled. Existing engines remain selectable.

The server signs short-lived HS256 JWTs from `BACH_ACCESS_KEY` and `BACH_SECRET_KEY`; neither key nor generated bearer tokens are sent to the browser. The credentials are stored as encrypted Vercel secrets for Production and Preview. Redeploy after changing Vercel environment variables.

## API behavior

- Images use `POST /images/text2image`, then poll `GET /images/text2image/{task_id}`. The adapter requests one 2K PNG and fetches the temporary result into configured app storage when available.
- Video uses `POST /video/chrome`, then poll `GET /video/chrome/{task_id}`. Text requests use `t2v`; start/end keyframes use `i2v`. All provider calls have bounded timeouts.
- Image editing supports up to eight public reference image URLs at the provider API layer. The current Studio image adapter does not yet forward existing project references to Bach.

The supplied guide and official API reference do not publish account pricing. Until the account rate is confirmed, the Studio budget display uses provisional estimates of **$0.50/image** and **$0.50/second of video**. These are safety placeholders, not Bach quotes. The video success response did not include a monetary charge, so check the Bach console before using automatic project budgets.

## Live sample comparison (2026-10-12)

Both clips used the same perfume-bottle prompt and 16:9, 720p output. Bach returned a 5.04-second, 1280×720 H.264 MP4. The existing OpenRouter Veo 3.1 Lite comparison returned a 6-second, 1280×720 H.264 MP4 with reported usage of $0.1782. In the sampled frames, both have the amber bottle on a black plinth; Bach uses a darker, harder side light, while Veo produces a brighter background and clearer bottle detail. The durations differ because the providers accept different allowed lengths.

The Bach image endpoint also completed a 1K low-quality single-image test and returned a downloadable JPEG. An earlier 2K image request timed out before the API returned its task ID; its final provider status and any charge cannot be verified.

## Re-run checks

`pnpm vitest run src/services/video-gen/bach.test.ts src/services/video-gen/libtv-pricing.test.ts src/services/ai/image-engine.test.ts`

Then inspect the app logs for the Bach adapter's safe provider/status codes. Never log AK, SK, JWTs, or signed result URLs.
