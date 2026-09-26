/**
 * Strict zero-cost mode. Every model call goes to Zhipu's free models
 * (GLM-4.7-Flash, GLM-4.6V-Flash, CogView-3-Flash, CogVideoX-Flash); anything
 * that would spend money (OpenAI/Gemini/Anthropic tokens, gpt-image, fal/Veo
 * video, LibTV credits, bring-your-own paid APIs) is refused rather than
 * silently used as a fallback.
 *
 * Precedence: the toggle saved on /settings/ai (AppSetting "ai.engines"),
 * else env AI_COST_MODE=free, else off. The saved value lives in the
 * database, so this sync accessor reads a cache that
 * `loadAiSettings()` (src/services/settings/ai-settings.ts) warms — routes and
 * AI calls await that loader before they ask.
 */
let _dbOverride: boolean | null = null;

/** Set by the settings loader; null = no saved value, follow env. */
export function setStrictFreeOverride(value: boolean | null): void {
  _dbOverride = value;
}

export function isStrictFree(): boolean {
  if (typeof _dbOverride === "boolean") return _dbOverride;
  return process.env.AI_COST_MODE === "free";
}

export class PaidFeatureDisabledError extends Error {
  readonly status = 402;
  constructor(what: string) {
    super(`${what} is turned off in strict free mode (Settings → AI engines, or AI_COST_MODE=free) — it would spend money.`);
    this.name = "PaidFeatureDisabledError";
  }
}
