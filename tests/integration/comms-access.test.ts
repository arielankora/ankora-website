import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { canSeeCall, commsAccess } from "@/lib/comms/access";
import { accountForChatFile } from "@/lib/comms/route-access";

// Several numbers (1.11.2026): who gets into the communications screen, and
// whose chat files they may open.

beforeEach(() => {
  process.env.UNIPILE_API_KEY = "k";
  process.env.WHATSAPP_POC_VIEWERS = "";
  process.env.COMMS_CALL_VIEWERS = "";
});

describe("commsAccess", () => {
  it("lets in the full viewers and a number's owner, never a client", async () => {
    const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: client } = await createTestUser({ role: "CLIENT_USER" });
    process.env.COMMS_FULL_VIEWERS = `${ariel.email},${client.email}`;
    await prisma.commsChannel.create({ data: { accountId: "acc_anna", ownerUserId: anna.id } });

    expect((await commsAccess(ariel)).full).toBe(true);
    expect((await commsAccess(anna)).allowed).toBe(true);
    expect((await commsAccess(anna)).full).toBe(false);
    expect((await commsAccess(other)).allowed).toBe(false);
    expect((await commsAccess(client)).allowed).toBe(false);
  });

  it("shows a call to the line's people, and otherwise to the client's account manager", async () => {
    const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    process.env.COMMS_CALL_VIEWERS = anna.email;
    process.env.COMMS_FULL_VIEWERS = "";
    expect(canSeeCall(await commsAccess(anna), anna.id, [])).toBe(true);
    const limited = { allowed: true, full: false, manager: false, allCalls: false, ownedChannelIds: [] };
    expect(canSeeCall(limited, "m1", [{ accountManagerId: "m1" }])).toBe(true);
    expect(canSeeCall(limited, "m1", [{ accountManagerId: "m2" }])).toBe(false);
  });
});

describe("accountForChatFile", () => {
  it("keeps an excluded person out of a number, and lets its owner in", async () => {
    const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: hadas } = await createTestUser({ role: "ANKORA_ADMIN" });
    process.env.COMMS_FULL_VIEWERS = `${ariel.email},${hadas.email}`;
    const channel = await prisma.commsChannel.create({
      data: { accountId: "acc_ariel", ownerUserId: ariel.id, excludedViewerIds: [hadas.id] },
    });
    expect(await accountForChatFile(ariel, channel.id, "x@lid")).toEqual({ apiKey: "k", accountId: "acc_ariel" });
    expect(await accountForChatFile(hadas, channel.id, "x@lid")).toBeNull();
  });

  it("gives an account manager only their client's stored conversation", async () => {
    const { user: owner } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: manager } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    process.env.COMMS_FULL_VIEWERS = "";
    process.env.COMMS_CALL_VIEWERS = manager.email;
    const client = await createTestClient({ name: "לוי" });
    await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: manager.id } });
    const person = await prisma.person.create({ data: { name: "דנה", phones: ["+972542222222"] } });
    await prisma.clientContact.create({ data: { clientId: client.id, personId: person.id, role: "כספים" } });
    const channel = await prisma.commsChannel.create({ data: { accountId: "acc_o", ownerUserId: owner.id, storeEnabled: true } });
    await prisma.commsConversation.create({ data: { channelId: channel.id, externalChatId: "dana@lid", otherPhone: "+972542222222", name: "דנה" } });
    await prisma.commsConversation.create({ data: { channelId: channel.id, externalChatId: "other@lid", otherPhone: "+972543333333", name: "אחר" } });

    expect(await accountForChatFile(manager, channel.id, "dana@lid")).not.toBeNull();
    expect(await accountForChatFile(manager, channel.id, "other@lid")).toBeNull();
  });
});
