import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// The communications screen is given from the person's page (12.11.2026).
// It used to take an edit to Vercel's environment and a redeploy for every
// new person. The environment lists still count alongside the app.

const session = vi.hoisted(() => ({ user: null as User | null }));

vi.mock("@/lib/app-auth/session", () => {
  class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }
  const current = async () => {
    if (!session.user) throw new UnauthorizedError();
    return session.user;
  };
  return { UnauthorizedError, requireUser: current, requireUserOrThrow: current, getCurrentUser: async () => session.user };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { setCommsAccessAction } from "@/app/(product)/app/(authenticated)/users/actions";
import { commsAccess } from "@/lib/comms/access";
import { fullViewerEmails, lineOwnerEmails } from "@/lib/comms/grants";
import { CURRENT_AGREEMENTS } from "@/lib/agreements";
import { confidentialitySignedBothChannels, setCommsAccess } from "@/lib/app-domain/comms-access";
import { ACTION_LABEL } from "@/app/(product)/app/(authenticated)/audit-log/labels";

const LINE_A = "+972553000001";
const LINE_B = "+972553000002";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  return fd;
}

async function signConfidentiality(userId: string, channels: Array<"APP" | "EMAIL_PDF">) {
  for (const channel of channels) {
    await prisma.employeeAgreement.create({
      data: {
        userId,
        kind: "CONFIDENTIALITY",
        version: CURRENT_AGREEMENTS.CONFIDENTIALITY,
        channel,
        signedAt: new Date(),
        signedName: "Test",
        contentHash: "0".repeat(64),
      },
    });
  }
}

async function freshUser(id: string) {
  return prisma.user.findUniqueOrThrow({ where: { id } });
}

beforeEach(() => {
  process.env.WHATSAPP_POC_VIEWERS = "";
  process.env.COMMS_FULL_VIEWERS = "";
  process.env.COMMS_CALL_VIEWERS = "";
  process.env.ALOHA_LINE_OWNERS = "";
  process.env.ALOHA_LINE_NUMBER = `${LINE_A},${LINE_B}`;
});

describe("access to the communications screen, given in the app", () => {
  it("a new person sees nothing until given a level, whatever their role", async () => {
    const { user } = await createTestUser({ role: "SUPER_ADMIN" });
    expect((await commsAccess(user)).allowed).toBe(false);
  });

  it("OWN is given at once, before any signature, and opens the screen without showing everything", async () => {
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: newcomer } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    session.user = admin;

    expect(await setCommsAccessAction(undefined, form({ userId: newcomer.id, level: "OWN" }))).toEqual({ ok: true });

    const access = await commsAccess(await freshUser(newcomer.id));
    expect(access.allowed).toBe(true);
    expect(access.full).toBe(false);
    expect(access.allCalls).toBe(false);
  });

  it("FULL and CALLS are refused until the undertaking is signed in both channels", async () => {
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: newcomer } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    session.user = admin;

    for (const level of ["FULL", "CALLS"]) {
      const res = await setCommsAccessAction(undefined, form({ userId: newcomer.id, level }));
      expect(res.error).toMatch(/סודיות/);
    }
    await signConfidentiality(newcomer.id, ["APP"]);
    expect((await setCommsAccessAction(undefined, form({ userId: newcomer.id, level: "FULL" }))).error).toMatch(/סודיות/);
    expect((await freshUser(newcomer.id)).commsAccessLevel).toBe("NONE");

    await signConfidentiality(newcomer.id, ["EMAIL_PDF"]);
    expect(await setCommsAccessAction(undefined, form({ userId: newcomer.id, level: "FULL" }))).toEqual({ ok: true });
    const access = await commsAccess(await freshUser(newcomer.id));
    expect(access.full).toBe(true);
    expect(await fullViewerEmails()).toContain(newcomer.email.toLowerCase());
  });

  it("the undertaking counts only when both channels are signed on the current version", async () => {
    const { user: person } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    expect(await confidentialitySignedBothChannels(person.id)).toBe(false);
    await signConfidentiality(person.id, ["EMAIL_PDF"]);
    expect(await confidentialitySignedBothChannels(person.id)).toBe(false);
    await signConfidentiality(person.id, ["APP"]);
    expect(await confidentialitySignedBothChannels(person.id)).toBe(true);
  });

  it("refuses a level that does not exist", async () => {
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: person } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(setCommsAccess(admin, person.id, { level: "EVERYTHING", lines: [] })).rejects.toThrow();
  });

  it("CALLS hears every call without seeing every conversation", async () => {
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: person } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await signConfidentiality(person.id, ["APP", "EMAIL_PDF"]);
    session.user = admin;
    expect(await setCommsAccessAction(undefined, form({ userId: person.id, level: "CALLS" }))).toEqual({ ok: true });
    const access = await commsAccess(await freshUser(person.id));
    expect(access.allCalls).toBe(true);
    expect(access.full).toBe(false);
  });

  it("only someone who manages users may give it, and never to a client", async () => {
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: client } = await createTestUser({ role: "CLIENT_USER" });

    session.user = employee;
    expect((await setCommsAccessAction(undefined, form({ userId: other.id, level: "OWN" }))).error).toBeTruthy();
    expect((await freshUser(other.id)).commsAccessLevel).toBe("NONE");

    session.user = admin;
    expect((await setCommsAccessAction(undefined, form({ userId: client.id, level: "OWN" }))).error).toBeTruthy();
    expect((await commsAccess(await freshUser(client.id))).allowed).toBe(false);
  });

  it("an Aloha line is given in the app, moved between people, and can override the environment", async () => {
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: hadas } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    process.env.ALOHA_LINE_OWNERS = `${LINE_A}=${hadas.email}`;
    session.user = admin;

    expect((await commsAccess(await freshUser(hadas.id))).ownedLines).toEqual([LINE_A]);

    // Anna takes line A: it leaves Hadas, though the environment still names her.
    expect(await setCommsAccessAction(undefined, form({ userId: anna.id, level: "NONE", line: LINE_A }))).toEqual({ ok: true });
    expect((await lineOwnerEmails()).get(LINE_A)).toBe(anna.email.toLowerCase());
    expect((await commsAccess(await freshUser(anna.id))).allowed).toBe(true);
    expect((await commsAccess(await freshUser(hadas.id))).ownedLines).toEqual([]);

    // Taken off Anna: nobody in particular, not back to the environment.
    expect(await setCommsAccessAction(undefined, form({ userId: anna.id, level: "NONE" }))).toEqual({ ok: true });
    expect((await lineOwnerEmails()).has(LINE_A)).toBe(false);
  });

  it("refuses a line that is not one of ours", async () => {
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: person } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    session.user = admin;
    const res = await setCommsAccessAction(undefined, form({ userId: person.id, level: "OWN", line: "+972500000000" }));
    expect(res.error).toBeTruthy();
    expect(await prisma.commsLineOwner.count()).toBe(0);
  });

  it("the environment lists still count, so nobody loses access on the day this ships", async () => {
    const { user: person } = await createTestUser({ role: "ANKORA_ADMIN" });
    process.env.COMMS_FULL_VIEWERS = person.email;
    expect((await commsAccess(person)).full).toBe(true);
  });

  it("a suspended person drops out of the full viewers given in the app", async () => {
    const { user: person } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.user.update({ where: { id: person.id }, data: { commsAccessLevel: "FULL", status: "SUSPENDED" } });
    expect(await fullViewerEmails()).not.toContain(person.email.toLowerCase());
  });

  it("every change leaves an audit row with a label", async () => {
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: person } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    session.user = admin;
    await setCommsAccessAction(undefined, form({ userId: person.id, level: "OWN", line: LINE_B }));
    const row = await prisma.auditEvent.findFirst({ where: { action: "user.comms_access", entityId: person.id } });
    expect(row?.actorId).toBe(admin.id);
    expect(row?.afterJson).toEqual({ commsAccessLevel: "OWN", lines: [LINE_B] });
    expect(ACTION_LABEL["user.comms_access"]).toBeTruthy();
  });
});
