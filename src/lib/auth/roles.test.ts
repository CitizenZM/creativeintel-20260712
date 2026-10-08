import { describe, expect, it } from "vitest";
import { parseOwnerEmails, resolveRole } from "./roles";

describe("parseOwnerEmails", () => {
  it("splits on commas, semicolons and whitespace, lower-cased and de-duplicated", () => {
    expect(parseOwnerEmails(" Barronzuo@Gmail.com, ops@xark.io;ops@xark.io\nx@y.z ")).toEqual([
      "barronzuo@gmail.com",
      "ops@xark.io",
      "x@y.z",
    ]);
  });

  it("is empty when unset", () => {
    expect(parseOwnerEmails(undefined)).toEqual([]);
    expect(parseOwnerEmails("  ")).toEqual([]);
  });
});

describe("resolveRole", () => {
  const owners = "barronzuo@gmail.com";

  it("makes a listed email the owner, ignoring case and spaces", () => {
    expect(resolveRole(" BarronZuo@gmail.com ", owners)).toBe("owner");
  });

  it("makes everyone else a member", () => {
    expect(resolveRole("someone@example.com", owners)).toBe("member");
    expect(resolveRole(null, owners)).toBe("member");
    expect(resolveRole("barronzuo@gmail.com", undefined)).toBe("member");
  });

  it("never demotes an existing owner", () => {
    expect(resolveRole("someone@example.com", owners, "owner")).toBe("owner");
  });

  it("promotes an existing member once their email is listed", () => {
    expect(resolveRole("barronzuo@gmail.com", owners, "member")).toBe("owner");
  });

  it("does not match on a substring", () => {
    expect(resolveRole("xbarronzuo@gmail.com", owners)).toBe("member");
  });
});
