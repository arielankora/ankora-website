import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";

// 22.9.2026, the second hole the invite incident exposed.
//
// Anna's link happened to still be valid, so she got in. Had it expired,
// there was exactly one way forward in the whole product: delete her and
// create her again. inviteUser refuses an email that already exists, the
// self-service reset served only ACTIVE accounts, and nothing anywhere
// resent an invite. Deleting a person is not an answer to "the link timed
// out" - it also discards their client access on the way past.
//
// These are shape tests. The behaviour they describe lives behind Prisma,
// which the integration suite covers; what a unit test can hold is that
// the three doors out of the dead end still exist and still have their
// preconditions attached.

const USERS = "lib/app-domain/users.ts";
const RESET = "lib/app-auth/password-reset.ts";
const ACTIONS = "app/(product)/app/(authenticated)/users/actions.ts";
const PAGE = "app/(product)/app/(authenticated)/users/[userId]/page.tsx";
const FORM = "app/(product)/app/(authenticated)/users/[userId]/ResendInviteForm.tsx";

const read = (p: string) => readFile(p, "utf-8");

describe("an unused invite can be sent again", () => {
  it("the domain exposes resendInvite", async () => {
    expect(await read(USERS)).toContain("export async function resendInvite(");
  });

  it("it requires the permission to manage users", async () => {
    const src = await read(USERS);
    const fn = src.slice(src.indexOf("export async function resendInvite("));
    expect(fn).toContain('assertCan(actor.role, "user.manage")');
  });

  it("it refuses anyone who has already chosen a password", async () => {
    const src = await read(USERS);
    const fn = src.slice(src.indexOf("export async function resendInvite("));
    expect(fn).toMatch(/status !== "INVITED"/);
  });

  // Resending must REPLACE the outstanding link, not add a second one.
  // An invite that was forwarded or sat in a mailbox for two days should
  // stop working the moment a new one is issued.
  it("it burns every earlier unused link before issuing a new one", async () => {
    const src = await read(USERS);
    const fn = src.slice(src.indexOf("export async function resendInvite("));
    const burn = fn.indexOf("passwordResetToken.updateMany");
    const issue = fn.indexOf("issueInvite(user)");
    expect(burn, "resendInvite no longer revokes the outstanding links").toBeGreaterThan(-1);
    expect(fn.slice(burn, burn + 200)).toContain("usedAt: null");
    expect(burn, "the old links must be burned before the new one is minted").toBeLessThan(issue);
  });

  it("it leaves a trail of its own, distinct from the first invite", async () => {
    const src = await read(USERS);
    expect(src).toContain('action: "user.invite.resent"');
    expect(src).toContain('action: "user.invite"');
  });

  // The first invite and the resent one must be the same message. Two
  // slightly different emails from us is how a recipient ends up
  // comparing them and trusting neither.
  it("both paths send the identical email through one function", async () => {
    const src = await read(USERS);
    expect(src).toContain("async function issueInvite(");
    expect(src.match(/issueInvite\(user\)/g)?.length, "inviteUser and resendInvite should both call it").toBe(2);
    expect(src.match(/renderActionEmail\(/g)?.length, "the email body should be written once").toBe(1);
  });
});

describe("the dead end for someone who never used their invite", () => {
  // They have no password to forget, but "forgot password" is the door
  // they will try. It used to answer with the same reassuring message and
  // send nothing at all.
  it("self-service reset now serves INVITED as well as ACTIVE", async () => {
    const src = await read(RESET);
    expect(src).toContain('status: { in: ["ACTIVE", "INVITED"] }');
  });

  it("and consuming the token still promotes them to ACTIVE", async () => {
    const src = await read(RESET);
    expect(src).toContain('status: token.user.status === "INVITED" ? "ACTIVE" : token.user.status');
  });

  it("without widening it to deleted accounts", async () => {
    expect(await read(RESET)).toContain("deletedAt: null");
  });
});

describe("the admin can reach it from the screen", () => {
  it("there is a server action", async () => {
    expect(await read(ACTIONS)).toContain("export async function resendInviteAction(");
  });

  it("which hands back the link either way, so a failed send is not a dead end", async () => {
    const src = await read(ACTIONS);
    const fn = src.slice(src.indexOf("export async function resendInviteAction("));
    expect(fn).toContain("/app/reset-password?token=");
    expect(fn).toContain("emailSent");
  });

  // Shown only where it means something. A button that does nothing on
  // most of the accounts it appears on trains people to ignore it.
  it("the control appears only while the invite is unused", async () => {
    const src = await read(PAGE);
    expect(src).toContain('targetUser.status === "INVITED"');
    expect(src).toContain("<ResendInviteForm");
    const gate = src.indexOf('targetUser.status === "INVITED"');
    const control = src.indexOf("<ResendInviteForm");
    expect(gate, "the form must sit inside the status gate").toBeLessThan(control);
  });

  it("and it tells the admin the previous link was revoked", async () => {
    expect(await read(FORM)).toContain("הקישור הקודם בוטל");
  });
});

describe("the production probe watches the protection the incident relied on", () => {
  it("asserts a vercel.app host is not serving the product", async () => {
    const src = await read("qa/checks/production.mjs");
    expect(src).toContain("PROTECTED_ALIAS");
    expect(src).toContain("vercel.app");
    // The tell is our own headers: a wall put up in front of the
    // deployment never reaches us, so it cannot be wearing them.
    expect(src).toContain("wearingOurHeaders");
    expect(src).toContain("serves the product with no sign-in wall");
  });

  it("and reports an unreachable runner as a non-finding, not a false alarm", async () => {
    const src = await read("qa/checks/production.mjs");
    expect(src).toContain("deployment protection could not be checked from this runner");
  });
});
