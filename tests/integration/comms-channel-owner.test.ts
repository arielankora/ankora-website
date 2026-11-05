import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// The owner of a connected WhatsApp number (5.11.2026). Anna's number was
// connected to an archived "Anna Kozlov" who had never signed in, picked from
// a list that held every staff user. Now the setup screen lists only active
// people, the server refuses anyone else, and a manager can move a number to
// another owner from the screen, with a row in the audit log.

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

import { changeChannelOwnerAction, connectChannelAction, updateExcludedViewersAction } from "@/app/(product)/app/(authenticated)/whatsapp-poc/setup/actions";
import { listChannelPeople } from "@/lib/comms/channel-people";
import { commsAccess } from "@/lib/comms/access";
import { accountForChatFile } from "@/lib/comms/route-access";
import { canSeeConversation } from "@/lib/comms/visibility";
import { ACTION_LABEL } from "@/app/(product)/app/(authenticated)/audit-log/labels";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  return fd;
}

beforeEach(() => {
  session.user = null;
  process.env.UNIPILE_API_KEY = "k";
  process.env.WHATSAPP_POC_VIEWERS = "";
  process.env.COMMS_FULL_VIEWERS = "";
  process.env.COMMS_CALL_VIEWERS = "";
  process.env.ALOHA_LINE_OWNERS = "";
});

describe("who may own a number, or be on its list", () => {
  it("lists only active staff, each with an email", async () => {
    const { user: active } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: archived } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "ARCHIVED" });
    const { user: suspended } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "SUSPENDED" });
    const { user: invited } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "INVITED" });
    const { user: client } = await createTestUser({ role: "CLIENT_USER" });
    const { user: deleted } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    const ids = (await listChannelPeople()).map((p) => p.id);
    expect(ids).toContain(active.id);
    for (const out of [archived, suspended, invited, client, deleted]) expect(ids).not.toContain(out.id);
    expect((await listChannelPeople()).find((p) => p.id === active.id)?.email).toBe(active.email);
  });

  it("refuses an archived owner when connecting a number", async () => {
    const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: archived } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "ARCHIVED" });
    session.user = manager;
    const res = await connectChannelAction(undefined, form({ accountId: "acc_anna", ownerUserId: archived.id }));
    expect(res.error).toBe("אפשר לבחור כבעלים רק משתמש פעיל במערכת.");
    expect(await prisma.commsChannel.count()).toBe(0);
  });

  it("refuses an inactive person on the excluded list when connecting a number", async () => {
    const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: owner } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: suspended } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "SUSPENDED" });
    session.user = manager;
    const res = await connectChannelAction(undefined, form({ accountId: "acc_x", ownerUserId: owner.id, excluded: [suspended.id] }));
    expect(res.error).toMatch(/רק משתמשים פעילים/);
    expect(await prisma.commsChannel.count()).toBe(0);
  });

  it("connects a number to an active owner, with active people excluded", async () => {
    const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: owner } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    session.user = manager;
    const res = await connectChannelAction(undefined, form({ accountId: "acc_ok", ownerUserId: owner.id, excluded: [other.id] }));
    expect(res.ok).toBeTruthy();
    const channel = await prisma.commsChannel.findUniqueOrThrow({ where: { accountId: "acc_ok" } });
    expect(channel.ownerUserId).toBe(owner.id);
    expect(channel.excludedViewerIds).toEqual([other.id]);
  });
});

describe("editing the excluded list", () => {
  it("refuses adding someone who is not active, and keeps someone already on it who no longer is", async () => {
    const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: owner } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: active } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: gone } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: archived } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "ARCHIVED" });
    const channel = await prisma.commsChannel.create({ data: { accountId: "acc_e", ownerUserId: owner.id, excludedViewerIds: [gone.id] } });
    await prisma.user.update({ where: { id: gone.id }, data: { status: "ARCHIVED" } });
    session.user = manager;

    const refused = await updateExcludedViewersAction(undefined, form({ channelId: channel.id, excluded: [archived.id] }));
    expect(refused.error).toMatch(/רק משתמשים פעילים/);
    expect((await prisma.commsChannel.findUniqueOrThrow({ where: { id: channel.id } })).excludedViewerIds).toEqual([gone.id]);

    // The form lists active people only, so `gone` is not sent back, and stays.
    expect((await updateExcludedViewersAction(undefined, form({ channelId: channel.id, excluded: [active.id] }))).ok).toBeTruthy();
    expect((await prisma.commsChannel.findUniqueOrThrow({ where: { id: channel.id } })).excludedViewerIds.sort()).toEqual([active.id, gone.id].sort());
  });
});

describe("changeChannelOwnerAction", () => {
  async function setup() {
    const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: wrongAnna } = await createTestUser({ role: "ANKORA_EMPLOYEE", status: "ARCHIVED" });
    const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const channel = await prisma.commsChannel.create({
      data: { accountId: "acc_anna", ownerUserId: wrongAnna.id, storeEnabled: true, excludedViewerIds: [anna.id, other.id] },
    });
    return { manager, wrongAnna, anna, other, channel };
  }

  it("lets only a manager change the owner", async () => {
    const { anna, channel, wrongAnna } = await setup();
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    session.user = employee;
    const res = await changeChannelOwnerAction(undefined, form({ channelId: channel.id, ownerUserId: anna.id }));
    expect(res.error).toBe("רק מנהל יכול לשנות בעלים של מספר.");
    expect((await prisma.commsChannel.findUniqueOrThrow({ where: { id: channel.id } })).ownerUserId).toBe(wrongAnna.id);
    expect(await prisma.auditEvent.count({ where: { action: "comms_channel.owner_changed" } })).toBe(0);
  });

  it("refuses an archived, suspended or invited new owner, and a client", async () => {
    const { manager, channel, wrongAnna } = await setup();
    session.user = manager;
    for (const status of ["ARCHIVED", "SUSPENDED", "INVITED"] as const) {
      const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE", status });
      const res = await changeChannelOwnerAction(undefined, form({ channelId: channel.id, ownerUserId: user.id }));
      expect(res.error).toBe("אפשר לבחור כבעלים רק משתמש פעיל במערכת.");
    }
    const { user: client } = await createTestUser({ role: "CLIENT_USER" });
    expect((await changeChannelOwnerAction(undefined, form({ channelId: channel.id, ownerUserId: client.id }))).error).toBeTruthy();
    expect((await prisma.commsChannel.findUniqueOrThrow({ where: { id: channel.id } })).ownerUserId).toBe(wrongAnna.id);
  });

  it("moves the number, takes the new owner off the excluded list, and writes the audit row", async () => {
    const { manager, wrongAnna, anna, other, channel } = await setup();
    await prisma.commsBlock.create({
      data: { channelId: channel.id, kind: "PHONE", value: "+972541111111", status: "APPROVED", requestedById: manager.id },
    });
    await prisma.commsConversation.create({ data: { channelId: channel.id, externalChatId: "x@lid", otherPhone: "+972549999999", name: "x" } });
    session.user = manager;

    const res = await changeChannelOwnerAction(undefined, form({ channelId: channel.id, ownerUserId: anna.id }));
    expect(res.error).toBeUndefined();
    expect(res.ok).toContain(anna.email);
    expect(res.ok).toContain("השיחות שכבר נשמרו ורשימת החסימה לא השתנו");

    const after = await prisma.commsChannel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(after.ownerUserId).toBe(anna.id);
    expect(after.excludedViewerIds).toEqual([other.id]);
    // Nothing else is touched.
    expect(await prisma.commsBlock.count({ where: { channelId: channel.id } })).toBe(1);
    expect(await prisma.commsConversation.count({ where: { channelId: channel.id } })).toBe(1);

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "comms_channel.owner_changed" } });
    expect(audit.actorId).toBe(manager.id);
    expect(audit.entityType).toBe("CommsChannel");
    expect(audit.entityId).toBe(channel.id);
    expect(audit.beforeJson).toMatchObject({ ownerUserId: wrongAnna.id, excludedViewerIds: [anna.id, other.id] });
    expect(audit.afterJson).toMatchObject({ ownerUserId: anna.id, excludedViewerIds: [other.id] });
    expect(ACTION_LABEL["comms_channel.owner_changed"]).toBeTruthy();
  });

  it("refuses the current owner as the new one", async () => {
    const { manager, anna } = await setup();
    const channel = await prisma.commsChannel.create({ data: { accountId: "acc_b", ownerUserId: anna.id } });
    session.user = manager;
    expect((await changeChannelOwnerAction(undefined, form({ channelId: channel.id, ownerUserId: anna.id }))).error).toBe("זה כבר הבעלים של המספר.");
  });

  it("takes effect on the next request: the new owner sees an unassigned conversation, the old one no longer", async () => {
    const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: before } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: next } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const channel = await prisma.commsChannel.create({ data: { accountId: "acc_line", ownerUserId: before.id, storeEnabled: true } });
    // A conversation with no client: only the owner (and the full viewers) see it.
    await prisma.commsConversation.create({ data: { channelId: channel.id, externalChatId: "stranger@lid", otherPhone: "+972547777777", name: "זר" } });

    expect((await commsAccess(before)).ownedChannelIds).toEqual([channel.id]);
    expect(await accountForChatFile(before, channel.id, "stranger@lid")).not.toBeNull();
    expect(await accountForChatFile(next, channel.id, "stranger@lid")).toBeNull();

    session.user = manager;
    expect((await changeChannelOwnerAction(undefined, form({ channelId: channel.id, ownerUserId: next.id }))).ok).toBeTruthy();

    // No cache to clear: commsAccess reads the owned numbers on every call.
    const nextAccess = await commsAccess(next);
    const beforeAccess = await commsAccess(before);
    expect(nextAccess.allowed).toBe(true);
    expect(nextAccess.ownedChannelIds).toEqual([channel.id]);
    expect(beforeAccess.ownedChannelIds).toEqual([]);
    expect(beforeAccess.allowed).toBe(false);

    const stored = await prisma.commsChannel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(canSeeConversation({ viewer: next, channel: stored, clients: [], fullViewers: [] })).toBe(true);
    expect(canSeeConversation({ viewer: before, channel: stored, clients: [], fullViewers: [] })).toBe(false);
    expect(await accountForChatFile(next, channel.id, "stranger@lid")).not.toBeNull();
    expect(await accountForChatFile(before, channel.id, "stranger@lid")).toBeNull();
  });
});
