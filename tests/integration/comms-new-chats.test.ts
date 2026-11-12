import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestUser } from "./factories";

// "שיחות חדשות לבדיקה" (5.11.2026). The "לא לשמור" list was chosen once,
// before storing started; a chat that began later was stored with nobody
// asked. Now those chats wait on the setup screen for "לשמור" or "לא לשמור",
// decided by the number's owner or a manager.

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
vi.mock("@/lib/google-drive", () => ({
  uploadLargeFileToDriveFolder: async () => ({ ok: true, fileId: "drive-1" }),
  downloadFileFromDrive: async () => ({ ok: true, body: new ArrayBuffer(8) }),
  removeDriveFile: async () => ({ ok: true, how: "deleted" }),
}));

import { keepAllNewChatsAction, reviewNewChatAction } from "@/app/(product)/app/(authenticated)/whatsapp-poc/setup/actions";
import { countChatsToReview, listChatsToReview } from "@/lib/comms/new-chats";

const STARTED = new Date("2026-11-01T00:00:00Z");

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  return fd;
}

async function chat(channelId: string, id: string, phone: string | null, at: string[], isGroup = false) {
  return prisma.commsConversation.create({
    data: {
      channelId,
      externalChatId: id,
      isGroup,
      otherPhone: phone,
      name: id,
      lastMessageAt: new Date(at[at.length - 1]),
      messages: { create: at.map((t, i) => ({ externalId: `${id}-${i}`, at: new Date(t), text: "שלום" })) },
    },
  });
}

async function setup() {
  const { user: owner } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  process.env.COMMS_FULL_VIEWERS = "";
  const channel = await prisma.commsChannel.create({
    data: { accountId: "acc_new", ownerUserId: owner.id, storeEnabled: true, storeStartedAt: STARTED },
  });
  const old = await chat(channel.id, "old@lid", "+972541111111", ["2026-10-20T08:00:00Z", "2026-11-02T08:00:00Z"]);
  const fresh = await chat(channel.id, "fresh@lid", "+972542222222", ["2026-11-03T08:00:00Z", "2026-11-04T08:00:00Z"]);
  const group = await chat(channel.id, "g@g.us", null, ["2026-11-04T09:00:00Z"], true);
  return { owner, manager, other, channel, old, fresh, group };
}

beforeEach(() => {
  session.user = null;
  process.env.UNIPILE_API_KEY = "k";
  process.env.WHATSAPP_POC_VIEWERS = "";
  process.env.COMMS_CALL_VIEWERS = "";
  process.env.ALOHA_LINE_OWNERS = "";
});

describe("שיחות חדשות לבדיקה", () => {
  it("lists only chats that began after storing started, newest first", async () => {
    const { channel } = await setup();
    const { chats, total } = await listChatsToReview(channel);
    expect(chats.map((c) => c.name)).toEqual(["g@g.us", "fresh@lid"]);
    expect(total).toBe(2);
    expect(chats.find((c) => c.name === "fresh@lid")).toMatchObject({ messages: 2, isGroup: false, phone: "+972542222222" });
  });

  it("לשמור takes a chat off the list, and ביטול puts it back", async () => {
    const { owner, channel, fresh } = await setup();
    session.user = owner;
    expect(await reviewNewChatAction(undefined, form({ conversationId: fresh.id, decision: "keep" }))).toEqual({ ok: "נשמרת.", kept: true });
    expect(await countChatsToReview(channel)).toBe(1);
    await reviewNewChatAction(undefined, form({ conversationId: fresh.id, decision: "undo" }));
    expect(await countChatsToReview(channel)).toBe(2);
  });

  it("לא לשמור by the owner holds the chat for a manager; by a manager deletes what was kept", async () => {
    const { owner, manager, channel, fresh, group } = await setup();
    session.user = owner;
    const asked = await reviewNewChatAction(undefined, form({ conversationId: fresh.id, decision: "block" }));
    expect(asked.ok).toContain("נשלחה בקשה למנהל");
    expect(await prisma.commsMessage.count({ where: { conversationId: fresh.id, held: true } })).toBe(2);
    expect(await prisma.commsBlock.findFirstOrThrow({ where: { channelId: channel.id, kind: "PHONE" } })).toMatchObject({ status: "PENDING", value: "+972542222222" });

    session.user = manager;
    const done = await reviewNewChatAction(undefined, form({ conversationId: group.id, decision: "block" }));
    expect(done.ok).toContain("נמחק");
    expect(await prisma.commsBlock.findFirstOrThrow({ where: { channelId: channel.id, kind: "CHAT" } })).toMatchObject({ status: "APPROVED", value: "g@g.us" });
    expect(await countChatsToReview(channel)).toBe(0);
  });

  it("refuses anyone but the owner or a manager", async () => {
    const { other, fresh } = await setup();
    session.user = other;
    const result = await reviewNewChatAction(undefined, form({ conversationId: fresh.id, decision: "keep" }));
    expect(result.error).toBeTruthy();
    expect((await prisma.commsConversation.findUniqueOrThrow({ where: { id: fresh.id } })).reviewedAt).toBeNull();
  });

  it("לשמור את כל השאר marks the listed chats of that number only", async () => {
    const { owner, channel, fresh, group } = await setup();
    session.user = owner;
    const result = await keepAllNewChatsAction(undefined, form({ channelId: channel.id, conversationId: [fresh.id, group.id] }));
    expect(result.ok).toContain("2 שיחות");
    expect(await countChatsToReview(channel)).toBe(0);
  });
});
