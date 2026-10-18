// Platform-native creative intelligence for script + angle generation.
// Dense, expert playbooks per CAMPAIGN_PLATFORMS id (see src/lib/campaign-platform.ts).
// Keep entries terse but information-dense — these are injected directly into system prompts.

export interface HookFormula {
  name: string;
  pattern: string;
  whenToUse: string;
}

const PLAYBOOKS: Record<string, string> = {
  tiktok: `PLATFORM PLAYBOOK — TikTok / Reels (9:16 short-form social):
- VISUAL HOOK IN FIRST 0.5s: the first frame must communicate the hook without sound — a jarring visual, a bold on-screen claim, or mid-action movement. No slow fade-ins, no logo-first opens.
- NATIVE TEXT OVERLAY IN FRAME 1: burn in a short, punchy caption (5-8 words max) styled like native creator captions (bold sans, white/yellow with black stroke), not brand-template lower-thirds.
- SOUND-ON DESIGN + SOUND-OFF FALLBACK: write VO/dialogue for sound-on viewers, but every beat must also read from on-screen text and visual action alone (60-85% of viewers start muted).
- LOOP-ABILITY (esp. Reels): design the last frame/beat to visually rhyme with or flow into the first frame, so an accidental replay feels intentional rather than jarring.
- 9:16 SAFE ZONES: keep all critical text/faces inside the center-safe 80% — avoid top 100px (UI overlays) and bottom 220px (caption/CTA/username bar).
- UGC AUTHENTICITY VS POLISH: default to handheld, imperfect, one-take-feeling camera work and casual VO delivery; only go polished/studio for premium or beauty verticals where "prosumer" signals quality.
- TREND-SOUND NOTE: leave a beat in the structure (typically the first 1-2s) open for a trending audio drop or sound effect — do not over-script VO across a moment meant for a trend sound.`,

  instagram: `PLATFORM PLAYBOOK — Instagram Feed/Reels (9:16, algorithm-fed):
- VISUAL HOOK IN FIRST 0.5s: same discipline as TikTok — arresting first frame, no brand-intro throat-clearing.
- NATIVE TEXT OVERLAY IN FRAME 1: caption-forward, aesthetic-conscious styling (Instagram audiences reward higher visual polish than TikTok, but still native-feeling, not ad-template).
- SOUND-ON DESIGN + SOUND-OFF FALLBACK: identical requirement — dual-channel comprehension (visual + VO).
- LOOP-ABILITY: Reels autoloop aggressively — engineer a seamless loop point between last and first frame.
- 9:16 SAFE ZONES: keep key content out of top/bottom UI chrome; Instagram's like/comment/share rail sits lower-right — avoid blocking with text there.
- UGC AUTHENTICITY VS POLISH: Instagram skews slightly more aspirational/polished than TikTok — lifestyle gloss is acceptable, but avoid overtly "ad" framing (static product shots, stock-photo lighting).
- TREND-SOUND NOTE: reserve a moment for trending audio/meme formats where relevant to the niche.`,

  youtube: `PLATFORM PLAYBOOK — YouTube Pre-roll (16:9 or 9:16 Shorts, skippable ads):
- 5s SKIP LOGIC: viewers can skip after 5 seconds on TrueView. Brand identity AND the core hook/promise must both land before the 5s mark — do not save the brand reveal for later.
- FRONT-LOAD VALUE: state the single strongest benefit or most surprising claim in the pre-skip window; treat seconds 0-5 as a self-contained micro-ad in case the viewer skips immediately after.
- MID-ROLL RETENTION BEATS: after the skip point, insert a re-hook every 5-8 seconds (new visual, new claim, pattern shift) to fight attention decay through the remainder of the ad.
- PACING: slightly slower and more explanatory than TikTok/Reels — YouTube viewers who don't skip are in a more receptive, longer-attention-span mode.
- END CARD: leave the final 2-3s clean for a clear CTA card / end screen (works with YouTube's native end-card overlay).`,

  tvc: `PLATFORM PLAYBOOK — TVC (Television Commercial, broadcast-safe):
- BROADCAST PACING: slower, cinematic pacing versus social-native cuts — average shot length 3-5s, deliberate composition, no jump-cut social editing style.
- STORY-FIRST STRUCTURE: classic setup → tension → resolution arc; broadcast audiences are a captive, non-skippable audience so the hook can build over 3-5s rather than needing an instant 0.5s jolt.
- END-CARD BRANDING: final 3-5 seconds MUST be a clean, static (or near-static) end card — logo, tagline, and single clear CTA, held long enough to read comfortably (legal/compliance convention).
- AUDIO-FORWARD: TVC assumes sound-on viewing — VO, music, and SFX carry equal weight to visuals (no sound-off caption fallback needed).
- BROADCAST SAFE AREAS: keep essential graphics within title-safe area (~90% of frame) for cross-device/cross-broadcast display.`,

  amazon: `PLATFORM PLAYBOOK — Amazon PDP Video (product detail page, autoplay-muted):
- SILENT-AUTOPLAY FIRST FRAME: PDP video autoplays muted and often without user interaction — the first frame must communicate the core value prop as a static-readable image (product + benefit text), since many viewers will never unmute.
- FEATURE-DEMONSTRATION DENSITY: prioritize dense, rapid feature/benefit demonstration over story or emotion — shoppers are already in high-intent, comparison-shopping mode, not scroll-stopping mode.
- NO EXTERNAL CTAs: never direct to a URL, social handle, discount code, or off-Amazon destination — Amazon policy prohibits this; all CTAs must stay implicit ("see below," "add to cart") or be omitted entirely.
- ON-SCREEN TEXT CARRIES THE MESSAGE: burn in feature callouts, spec labels, and comparison points as on-screen text/graphics since sound is unreliable.
- TRUST SIGNALS: include real-use demonstration (hands using the product, scale references, before/after) — Amazon shoppers weed out overly staged or vague content fast.`,
};

const DEFAULT_PLAYBOOK = `PLATFORM PLAYBOOK — General short-form video:
- Lead with a clear visual or verbal hook in the first 1-2 seconds.
- Support VO with on-screen text for sound-off viewers.
- Keep pacing tight; re-hook attention every 5-8 seconds.
- Close with an unambiguous, single CTA.`;

/** Campaign selection IDs are more specific than the script playbook families. */
function playbookFamily(platformId: string | null | undefined): string | null {
  if (!platformId) return null;
  const id = platformId.toLowerCase();
  if (id === "instagram_reels" || id === "instagram_stories") return "instagram";
  if (id.startsWith("youtube_")) return "youtube";
  return id;
}

/** Returns a dense platform-specific creative playbook block for prompt injection. */
export function getPlatformPlaybook(platformId: string | null | undefined): string {
  const family = playbookFamily(platformId);
  return (family && PLAYBOOKS[family]) || DEFAULT_PLAYBOOK;
}

const HOOK_FORMULAS: Record<string, HookFormula[]> = {
  tiktok: [
    { name: "problem-agitate", pattern: "Show the relatable problem in motion, then twist the knife with a stat or exaggerated consequence before cutting to product.", whenToUse: "Use when the pain point is instantly recognizable (mess, waste, frustration) and needs no explanation." },
    { name: "pattern-interrupt", pattern: "Open on an unexpected visual or action that breaks scroll-pattern expectation (object flying, sudden reveal, wrong-looking setup).", whenToUse: "Use for saturated categories where viewers have seen every standard ad opener." },
    { name: "social-proof-count", pattern: "Open with a bold number/stat overlay ('10,000 sold this week') read in the first beat, then show why.", whenToUse: "Use when you have a genuinely strong number (sales, reviews, before/after count) to lead with." },
    { name: "before/after", pattern: "Cold open on the 'after' result first (curiosity gap), then cut back to reveal the 'before' and the product that bridged it.", whenToUse: "Use for visibly transformative products (cleaning, beauty, organization, fitness)." },
    { name: "pov", pattern: "First-person POV shot placing the viewer directly in the moment of realization or use ('POV: you just found out...').", whenToUse: "Use for UGC-style, relatable, first-person discovery narratives." },
    { name: "negative-hook", pattern: "Open with a contrarian or myth-busting statement that challenges what the audience believes ('Stop doing X').", whenToUse: "Use when there's a common misconception in the category worth correcting." },
    { name: "question-hook", pattern: "Open with a direct question to camera or on-screen text that the viewer can't help but mentally answer.", whenToUse: "Use when the target audience has an obvious shared question or doubt." },
  ],
  instagram: [
    { name: "problem-agitate", pattern: "Aesthetic cold-open on the problem, styled like a lifestyle vignette, then escalate before the reveal.", whenToUse: "Use when the brand needs to stay visually polished while still using pain-point framing." },
    { name: "pattern-interrupt", pattern: "Unexpected visual beat or color/motion break within the first frame to stop the algorithmic scroll.", whenToUse: "Use in saturated feed categories (beauty, home, fashion) needing pattern disruption." },
    { name: "social-proof-count", pattern: "Lead with a stat or count overlay styled as a clean graphic card, not a loud native caption.", whenToUse: "Use when the brand has strong quantifiable proof and wants to keep visual polish." },
    { name: "before/after", pattern: "Split-screen or quick-cut before/after as the opening frame.", whenToUse: "Use for visibly transformative categories; Instagram audiences respond well to aspirational after-states." },
    { name: "pov", pattern: "First-person aesthetic POV (getting-ready, unboxing, morning routine) as the cold open.", whenToUse: "Use for lifestyle/beauty/home categories where routine-style content performs." },
    { name: "negative-hook", pattern: "Contrarian statement delivered over a stylized visual, challenging a common habit or product category norm.", whenToUse: "Use when positioning against an incumbent or common (often incorrect) practice." },
    { name: "question-hook", pattern: "Direct-to-camera or text-overlay question that mirrors a caption/comment-bait style.", whenToUse: "Use when optimizing for comments/engagement in addition to conversion." },
  ],
  youtube: [
    { name: "problem-agitate", pattern: "State the problem and its cost/consequence clearly within the pre-skip 5s window, reinforced with VO.", whenToUse: "Use when the audience needs the stakes explained, not just shown." },
    { name: "pattern-interrupt", pattern: "Open with a surprising claim or visual before the brand reveal, timed to land right at the skip button's appearance.", whenToUse: "Use to reduce skip-rate in the critical 5s window." },
    { name: "social-proof-count", pattern: "Lead with a credibility stat (reviews, users, awards) narrated clearly in VO plus on-screen graphic.", whenToUse: "Use when trust-building matters more than novelty (considered purchases)." },
    { name: "before/after", pattern: "Show the 'after' result with narration bridging back to the starting problem within the first 5 seconds.", whenToUse: "Use for demonstrable, visually clear transformations." },
    { name: "pov", pattern: "Open from the customer's first-person perspective narrating their own doubt or need.", whenToUse: "Use for testimonial-style or relatable-narrative pre-roll ads." },
    { name: "negative-hook", pattern: "Open by directly contradicting a common assumption the viewer holds about the category.", whenToUse: "Use for considered-purchase categories where re-education drives conversion." },
    { name: "question-hook", pattern: "Open with a direct, VO-delivered question addressing the viewer's likely search/viewing intent.", whenToUse: "Use when running against contextually relevant content (e.g. how-to videos)." },
  ],
  tvc: [
    { name: "problem-agitate", pattern: "Build the problem cinematically over 3-5s with music and visual tension before the product resolves it.", whenToUse: "Use as the default TVC opener for problem-solution narratives." },
    { name: "social-proof-count", pattern: "Open on a voiced-over stat or awards mention layered over brand-appropriate visuals.", whenToUse: "Use for trust/authority-building brand campaigns." },
    { name: "before/after", pattern: "Cinematic before/after sequence with a clear visual transition (wipe, dissolve, match-cut).", whenToUse: "Use for visibly transformative product categories." },
    { name: "story-arc-cold-open", pattern: "Open mid-scene on a relatable character moment before revealing the brand's role in resolving it.", whenToUse: "Use for brand/emotional TVC campaigns rather than direct-response." },
    { name: "question-hook", pattern: "Open with a voiced rhetorical question that the ensuing narrative answers.", whenToUse: "Use for brand campaigns aiming for message recall over immediate action." },
  ],
  amazon: [
    { name: "feature-lead", pattern: "Open on the single most differentiating feature in action as a static-readable frame with on-screen label.", whenToUse: "Use as the default PDP video opener — no story needed, comparison-shoppers want proof fast." },
    { name: "social-proof-count", pattern: "Open with a review count/rating overlay burned into the first frame.", whenToUse: "Use when star rating or review volume is a genuine differentiator vs. competitors on the same page." },
    { name: "before/after", pattern: "Static-readable before/after split frame with labels, no narration required.", whenToUse: "Use for visibly demonstrable improvement categories (cleaning, organization, appearance)." },
    { name: "spec-comparison", pattern: "Open with a comparison graphic (this product vs. generic/competitor) with on-screen spec callouts.", whenToUse: "Use in categories where shoppers are actively comparing multiple listings." },
    { name: "use-in-context", pattern: "Open on real-hands-on-product demonstration in a realistic use setting.", whenToUse: "Use to build trust and show scale/fit when product dimensions or usability are a common question." },
  ],
};

const DEFAULT_HOOKS: HookFormula[] = [
  { name: "problem-agitate", pattern: "Show the problem, escalate briefly, then introduce the product as resolution.", whenToUse: "Default opener when no platform-specific guidance applies." },
  { name: "pattern-interrupt", pattern: "Open with an unexpected visual or claim to break passive viewing.", whenToUse: "Use in saturated categories." },
  { name: "social-proof-count", pattern: "Lead with a credible number or stat.", whenToUse: "Use when strong quantifiable proof exists." },
  { name: "before/after", pattern: "Show transformation result first, then bridge back to the starting point.", whenToUse: "Use for visibly transformative products." },
  { name: "question-hook", pattern: "Open with a direct question mirroring viewer intent.", whenToUse: "Use when the audience has an obvious shared question." },
];

/** Returns named hook formulas (5-8) with when-to-use guidance for the given platform. */
export function getHookFormulas(platformId: string | null | undefined): HookFormula[] {
  const family = playbookFamily(platformId);
  return (family && HOOK_FORMULAS[family]) || DEFAULT_HOOKS;
}
