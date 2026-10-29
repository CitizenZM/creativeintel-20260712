import { describe, expect, it } from "vitest";
import {
  accountSignInUrl,
  accountSignUpUrl,
  accountUrl,
  appLandingUrl,
  canEnterCreative,
  isCreativeOwnerClaim,
  noAccessUrl,
  parseApps,
  safeReturnUrl,
} from "./account";

describe("accountUrl", () => {
  it("defaults to https://account.xark.io and honours ACCOUNT_URL (trailing slash dropped)", () => {
    expect(accountUrl({})).toBe("https://account.xark.io");
    expect(accountUrl({ ACCOUNT_URL: "http://localhost:3100/" })).toBe("http://localhost:3100");
  });
});

describe("account redirects", () => {
  it("sign-in carries the full return URL, encoded", () => {
    expect(accountSignInUrl("https://creative.account.xark.io/projects?a=1&b=2", {})).toBe(
      "https://account.xark.io/sign-in?redirect_url=https%3A%2F%2Fcreative.account.xark.io%2Fprojects%3Fa%3D1%26b%3D2",
    );
  });

  it("sign-up and no-access", () => {
    expect(accountSignUpUrl("https://creative.account.xark.io/", {})).toBe(
      "https://account.xark.io/sign-up?redirect_url=https%3A%2F%2Fcreative.account.xark.io%2F",
    );
    expect(noAccessUrl({})).toBe("https://account.xark.io/no-access?app=creative");
    expect(noAccessUrl({ ACCOUNT_URL: "https://acc.example.com" })).toBe("https://acc.example.com/no-access?app=creative");
  });

  it("the landing URL follows AUTH_CANONICAL_HOST, default creative.account.xark.io", () => {
    expect(appLandingUrl({})).toBe("https://creative.account.xark.io/");
    expect(appLandingUrl({ AUTH_CANONICAL_HOST: "app.example.com" })).toBe("https://app.example.com/");
  });

  it("only forwards return URLs on the canonical host", () => {
    expect(safeReturnUrl("https://creative.account.xark.io/projects?x=1", {})).toBe(
      "https://creative.account.xark.io/projects?x=1",
    );
    expect(safeReturnUrl("https://evil.example.com/", {})).toBe("https://creative.account.xark.io/");
    expect(safeReturnUrl("http://creative.account.xark.io/", {})).toBe("https://creative.account.xark.io/");
    expect(safeReturnUrl("not a url", {})).toBe("https://creative.account.xark.io/");
    expect(safeReturnUrl(undefined, {})).toBe("https://creative.account.xark.io/");
  });
});

describe("apps claim", () => {
  it("parses only string roles from an object", () => {
    expect(parseApps({ creative: "member", portal: 3, account: "super_admin" })).toEqual({
      creative: "member",
      account: "super_admin",
    });
    expect(parseApps(null)).toEqual({});
    expect(parseApps(["creative"])).toEqual({});
    expect(parseApps("creative")).toEqual({});
  });

  it("creative needs apps.creative, or apps.account === super_admin", () => {
    expect(canEnterCreative({ creative: "member" })).toBe(true);
    expect(canEnterCreative({ creative: "owner" })).toBe(true);
    expect(canEnterCreative({ account: "super_admin" })).toBe(true);
    expect(canEnterCreative({ portal: "client" })).toBe(false);
    expect(canEnterCreative({ account: "admin" })).toBe(false);
    expect(canEnterCreative({})).toBe(false);
  });

  it("apps.creative === owner is the owner claim", () => {
    expect(isCreativeOwnerClaim({ creative: "owner" })).toBe(true);
    expect(isCreativeOwnerClaim({ creative: "member" })).toBe(false);
    expect(isCreativeOwnerClaim({ account: "super_admin" })).toBe(false);
  });
});
