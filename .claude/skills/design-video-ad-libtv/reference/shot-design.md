# Shot design for 10–15s vertical ads

## Beat grid first
1. Pick a track whose licence allows paid social ads (Mixkit's free music licence lists "Online
   marketing ads"; it **forbids remixing**, so you cannot splice sections — pick one continuous
   window that already contains a build and a drop).
2. `aubio tempo/beat/onset` → beat timestamps; choose the 15.0s / 10.0s window that starts on a
   downbeat with energy from the first beat.
3. Every cut, word pop, logo landing and speed change goes on a beat from that list. Nothing is
   placed by feel.
4. Prove it afterwards: `ffmpeg -vf "select='gt(scene,0.25)',showinfo"` on the render, compare each
   detected cut to the nearest beat. Target ≤1 frame (33ms at 30fps). Duplicate detections a few
   frames after a flash/whip are the transition tail, not an extra cut.

## Cut density
Benchmarks (measured on official brand ads): 13–19 cuts per 15s, average 0.8–1.5s, the first 3s
densest. A 15s ad therefore needs ~14 visible cuts but only **8–12 generated clips** — cut two or
three shots out of each clip.

## The keyframe rule
Image-to-video inherits the pose in the first frame. A standing keyframe produces a standing clip
(this is why early cuts "looked like a slideshow"). So:
- Generate the keyframe **mid-movement**: weight on one leg, knee lifted/crossed, torso twisted
  20–30°, one arm extended at an angle, hair mid-swing, chin down with eyes up.
- Write the video prompt as a **two-beat phrase**: start pose → mid → end pose
  (e.g. "lands the lifted knee, sharp body roll, sweeps the arm down, finishes pointing at camera").
- Safe for AI: upper-body isolations, hip pops, arm extensions, hair flips, a single turn ending in
  a pose, spray/press actions. Risky: fast footwork, multi-turn spins, hands crossing the face,
  anything where a small prop passes behind the body (the prop disappears).

## 15s structure that worked (bright K-pop version)
| Beat window | Shot |
|---|---|
| 0.00–0.97 | product pushed at the lens, already bright — the hook |
| 0.97–1.95 | pull back into a dance move (hip pops) |
| 1.95–2.91 | breakdown section: hero close-up at 80% speed, slogan lands |
| 2.91–3.87 | build: full-body choreography |
| 3.87 (drop) | group formation, strobe/prism transition on the drop |
| 4.7–7.6 | turn → product insert (real photo) → group |
| 7.6–10.3 | spray → body roll / hair flip |
| 10.3–11.7 | dance + bottle to cheek → product insert with ingredient caption |
| 11.7–13.7 | "buy it now" one word per beat |
| 13.7–15.0 | logo lands in the last second, pulse on the final hit |

## Transition + speed-ramp templates
1. Beat slow-down: 100%→40% over 6 frames, hold 3–5, back to 100%.
2. Speed-up whip-out: last 8 frames 100%→250% + horizontal blur; next shot enters with 4 reverse-pan frames.
3. Flash cut: 2 white frames + 1 over-exposed frame — use when a product insert enters.
4. Light-change cut: no transition, a full-stage colour change marks the section.
5. Strobe cut: 1 black / 2 picture frames ×3.
6. Match-on-action: cut at the top of an arm raise, continue the fall in the next shot.
7. Freeze-out: last 10 frames ramp to 0% speed, then the logo.

## Visual-effect menu (all done locally in post, zero credits)
strobe flash cuts · LED colour wash (screen/multiply a gradient, pulsing per beat) · motion-trail
echo (offset copies at 40/25/15% opacity) · prism/kaleido split with chromatic offset · long-exposure
light streaks (max-blend 8–12 frames) · bloom (threshold + blur + screen) · mirror clone · film-burn
flash. Assign a different one per ad so A/B tests are clean.

## Typography and safe zones
- Match the brand wordmark. For a chunky rounded logo (MIXIK) the closest free faces are
  **Titan One** (first choice) and **Bowlby One**; Fredoka/Baloo need heavy variable weights.
- Body captions: the brand's own UI font (MIXIK uses Manrope).
- Keep text inside: top 14%, bottom 20%, right 12% clear of platform UI. Compose the主体 inside the
  centre 4:5 so the Meta feed crop still works.
- Two short lines beat one long line on 9:16 (a 22-character slogan clips at 96px).

## Deliverables per ad
9:16 1080×1920 master · 4:5 crop for Meta feed · 720p ≤3MB preview (phone delivery / chat upload
limits) · optional 10s cutdown using the same beat grid.
