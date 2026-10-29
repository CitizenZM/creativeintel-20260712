import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/auth/mode", () => ({ isClerkActive: () => true }));

import SignInPage from "./page";
import SignUpPage from "../../sign-up/[[...sign-up]]/page";

const target = async (page: Promise<unknown>) => {
  try {
    await page;
  } catch (err) {
    return (err as { url?: string }).url;
  }
  throw new Error("expected a redirect");
};

describe("local /sign-in and /sign-up hand off to Xark Accounts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("/sign-in → account sign-in, returning to the app (or the given same-host URL)", async () => {
    expect(await target(SignInPage({ searchParams: Promise.resolve({}) }))).toBe(
      "https://account.xark.io/sign-in?redirect_url=" + encodeURIComponent("https://creative.account.xark.io/"),
    );
    const back = "https://creative.account.xark.io/projects?a=1";
    expect(await target(SignInPage({ searchParams: Promise.resolve({ redirect_url: back }) }))).toBe(
      "https://account.xark.io/sign-in?redirect_url=" + encodeURIComponent(back),
    );
    expect(await target(SignInPage({ searchParams: Promise.resolve({ redirect_url: "https://evil.example.com/" }) }))).toBe(
      "https://account.xark.io/sign-in?redirect_url=" + encodeURIComponent("https://creative.account.xark.io/"),
    );
  });

  it("/sign-up → account sign-up; ACCOUNT_URL overrides the default", async () => {
    vi.stubEnv("ACCOUNT_URL", "https://acc.example.com");
    expect(await target(SignUpPage())).toBe(
      "https://acc.example.com/sign-up?redirect_url=" + encodeURIComponent("https://creative.account.xark.io/"),
    );
  });
});
