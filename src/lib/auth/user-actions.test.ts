import { describe, expect, it } from "vitest";
import { planUserAction, type UserActionTarget } from "./user-actions";

const OWNERS = "boss@xark.io";
const actor = { id: "owner1" };
const member = (over: Partial<UserActionTarget> = {}): UserActionTarget => ({
  id: "m1",
  email: "someone@example.com",
  role: "member",
  status: "active",
  ...over,
});

const plan = (action: string, target: UserActionTarget, owners = OWNERS) =>
  planUserAction({ actor, target, action, ownerEmails: owners });

describe("planUserAction", () => {
  it("block → blocked and demoted", () => {
    expect(plan("block", member())).toEqual({ ok: true, data: { status: "blocked", role: "member" } });
    expect(plan("block", member({ role: "owner" }))).toEqual({ ok: true, data: { status: "blocked", role: "member" } });
  });

  it("unblock → active", () => {
    expect(plan("unblock", member({ status: "blocked" }))).toEqual({ ok: true, data: { status: "active" } });
  });

  it("make-owner → owner and active; make-member → member", () => {
    expect(plan("make-owner", member())).toEqual({ ok: true, data: { role: "owner", status: "active" } });
    expect(plan("make-member", member({ role: "owner" }))).toEqual({ ok: true, data: { role: "member" } });
  });

  it("refuses to block or demote yourself", () => {
    for (const action of ["block", "make-member"]) {
      expect(plan(action, member({ id: "owner1", role: "owner" }))).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("refuses to block or demote an OWNER_EMAILS owner (case-insensitive)", () => {
    for (const action of ["block", "make-member"]) {
      expect(plan(action, member({ email: "Boss@Xark.io", role: "owner" }))).toMatchObject({ ok: false, status: 409 });
    }
  });

  it("rejects unknown actions", () => {
    expect(plan("approve", member())).toMatchObject({ ok: false, status: 400 });
  });
});
