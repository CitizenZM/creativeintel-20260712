import { describe, expect, it } from "vitest";
import { clerkProfile, needsTouch, SEEN_THROTTLE_MS } from "./profile";

describe("clerkProfile", () => {
  const base = {
    primaryEmailAddressId: "e2",
    emailAddresses: [
      { id: "e1", emailAddress: "old@example.com", verification: null },
      { id: "e2", emailAddress: "BarronZuo@Gmail.com", verification: { status: "verified" } },
    ],
    firstName: "Barron",
    lastName: "Zuo",
    username: null,
  };

  it("uses the primary email, lower-cased, and the full name", () => {
    expect(clerkProfile(base)).toEqual({
      email: "barronzuo@gmail.com",
      name: "Barron Zuo",
      ownerEligibleEmail: "barronzuo@gmail.com",
    });
  });

  it("falls back to the first email and the username", () => {
    expect(
      clerkProfile({ ...base, primaryEmailAddressId: null, firstName: null, lastName: null, username: "bz" }),
    ).toEqual({ email: "old@example.com", name: "bz", ownerEligibleEmail: null });
  });

  it("has no email or name when Clerk has none", () => {
    expect(
      clerkProfile({ primaryEmailAddressId: null, emailAddresses: [], firstName: " ", lastName: null, username: null }),
    ).toEqual({ email: null, name: null, ownerEligibleEmail: null });
  });

  it("an unverified email is never owner-eligible", () => {
    const unverified = {
      ...base,
      emailAddresses: [{ id: "e2", emailAddress: "barronzuo@gmail.com", verification: { status: "unverified" } }],
    };
    expect(clerkProfile(unverified).ownerEligibleEmail).toBeNull();
  });
});

describe("needsTouch", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  it("writes lastSeenAt at most once per throttle window", () => {
    expect(needsTouch(new Date(now.getTime() - 1000), now)).toBe(false);
    expect(needsTouch(new Date(now.getTime() - SEEN_THROTTLE_MS - 1), now)).toBe(true);
  });
});
