import { describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestClient } from "./factories";

vi.mock("@/lib/google-drive", () => ({
  uploadLargeFileToDriveFolder: async () => ({ ok: true, fileId: "drive-x" }),
  downloadFileFromDrive: async () => ({ ok: true, body: new ArrayBuffer(8) }),
  removeDriveFile: async () => ({ ok: true, how: "deleted" }),
}));

import { sweepEndedEngagements } from "@/lib/comms/maintenance";

// 30 days after a client's engagement ends (archived), what was kept of its
// people goes, unless the number also belongs to a current client.

const OLD = "+972541111111";
const SHARED = "+972542222222";

async function recording(phone: string, emailId: string) {
  return prisma.callRecording.create({
    data: {
      emailId,
      mailAccountId: "acc_m",
      fromPhone: phone,
      toPhone: "+972553302266",
      otherPhone: phone,
      direction: "IN",
      callAt: new Date("2026-09-01T08:00:00Z"),
    },
  });
}

describe("sweepEndedEngagements", () => {
  it("removes an ended client's calls and chats, keeps a number shared with a current client", async () => {
    const ended = await createTestClient({ name: "הסתיים" });
    const current = await createTestClient({ name: "פעיל" });
    await prisma.client.update({ where: { id: ended.id }, data: { status: "ARCHIVED", deletedAt: new Date("2026-09-15T00:00:00Z") } });
    const a = await prisma.person.create({ data: { name: "א", phones: [OLD] } });
    const b = await prisma.person.create({ data: { name: "ב", phones: [SHARED] } });
    await prisma.clientContact.create({ data: { clientId: ended.id, personId: a.id, role: "x" } });
    await prisma.clientContact.create({ data: { clientId: ended.id, personId: b.id, role: "x" } });
    await prisma.clientContact.create({ data: { clientId: current.id, personId: b.id, role: "x" } });
    await recording(OLD, "e-old");
    await recording(SHARED, "e-shared");
    const { createTestUser } = await import("./factories");
    const { user } = await createTestUser({ role: "ANKORA_ADMIN" });
    const channel = await prisma.commsChannel.create({ data: { accountId: "acc_w", ownerUserId: user.id, storeEnabled: true } });
    await prisma.commsConversation.create({ data: { channelId: channel.id, externalChatId: "g@g.us", isGroup: true, name: "קבוצה", groupClientId: ended.id } });

    // Within 30 days: nothing goes.
    expect(await sweepEndedEngagements(new Date("2026-10-01T00:00:00Z"))).toEqual({ clients: 0, recordings: 0, conversations: 0 });

    const report = await sweepEndedEngagements(new Date("2026-11-01T00:00:00Z"));
    expect(report).toEqual({ clients: 1, recordings: 1, conversations: 1 });
    expect((await prisma.callRecording.findMany()).map((r) => r.emailId)).toEqual(["e-shared"]);
    expect(await prisma.commsConversation.count()).toBe(0);
  });
});
