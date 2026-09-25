/**
 * AI_COST_MODE=free — strict zero-cost mode. Every model call goes to Zhipu's
 * free models (GLM-4.7-Flash, GLM-4.6V-Flash, CogView-3-Flash,
 * CogVideoX-Flash); anything that would spend money (OpenAI/Gemini/Anthropic
 * tokens, gpt-image, fal/Veo video, LibTV credits) is refused rather than
 * silently used as a fallback.
 */
export function isStrictFree(): boolean {
  return process.env.AI_COST_MODE === "free";
}

export class PaidFeatureDisabledError extends Error {
  readonly status = 402;
  constructor(what: string) {
    super(`${what} is turned off in free mode (AI_COST_MODE=free) — it would spend money.`);
    this.name = "PaidFeatureDisabledError";
  }
}
