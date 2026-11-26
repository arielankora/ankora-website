import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// list_client_communications and get_client_communication (14.11.2026): a
// client's stored WhatsApp conversations and recorded calls, through the
// connector, with the communications screen's rules. What is worth holding:
// the right conversations and calls come back and can be read; a number the
// person is kept out of, a held message and a number of a client marked
// "בלי AI" do not; someone with no access to the screen gets nothing.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);

async function call(user: User, name: string, args: unknown) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

const DANA = "+972542222222";
const SHARED = "+972543333333";
const LINE = "+972553302266";

beforeEach(() => {
  process.env.COMMS_FULL_VIEWERS = "";
  process.env.COMMS_CALL_VIEWERS = "";
  process.env.WHATSAPP_POC_VIEWERS = "";
  process.env.ALOHA_LINE_NUMBER = LINE;
  process.env.ALOHA_LINE_OWNERS = "";
});

async function world() {
  const { user: hadas } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: ariel } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: stranger } = await createTestUser({ role: "ANKORA_ADMIN" });
  process.env.COMMS_FULL_VIEWERS = `${hadas.email},${ariel.email}`;
  process.env.COMMS_CALL_VIEWERS = hadas.email;

  const client = await createTestClient({ name: "לוי" });
  const marked = await createTestClient({ name: "חסוי" });
  await prisma.client.update({ where: { id: marked.id }, data: { aiExcluded: true } });
  for (const c of [client, marked]) {
    for (const u of [hadas, ariel, stranger]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: c.id } });
  }
  const dana = await prisma.person.create({ data: { name: "דנה", phones: [DANA] } });
  const shared = await prisma.person.create({ data: { name: "משותף", phones: [SHARED] } });
  await prisma.clientContact.create({ data: { clientId: client.id, personId: dana.id, role: "כספים" } });
  await prisma.clientContact.create({ data: { clientId: client.id, personId: shared.id, role: "x" } });
  await prisma.clientContact.create({ data: { clientId: marked.id, personId: shared.id, role: "x" } });

  const hadasWa = await prisma.commsChannel.create({ data: { accountId: "acc_h", ownerUserId: hadas.id, storeEnabled: true } });
  const arielWa = await prisma.commsChannel.create({
    data: { accountId: "acc_a", ownerUserId: ariel.id, storeEnabled: true, excludedViewerIds: [hadas.id] },
  });
  const chat = await prisma.commsConversation.create({ data: { channelId: hadasWa.id, externalChatId: "dana", otherPhone: DANA, name: "דנה" } });
  await prisma.commsMessage.createMany({
    data: [
      { conversationId: chat.id, externalId: "m1", at: new Date("2026-11-10T08:00:00Z"), text: "החשבונית מגיעה ביום ראשון" },
      { conversationId: chat.id, externalId: "m2", at: new Date("2026-11-10T08:05:00Z"), text: "תודה", isSender: true, senderName: "הדס" },
      { conversationId: chat.id, externalId: "m3", at: new Date("2026-11-10T08:06:00Z"), text: "ממתין לחסימה", held: true },
    ],
  });
  const arielChat = await prisma.commsConversation.create({ data: { channelId: arielWa.id, externalChatId: "dana2", otherPhone: DANA, name: "דנה" } });
  await prisma.commsMessage.create({ data: { conversationId: arielChat.id, externalId: "x1", at: new Date("2026-11-11T08:00:00Z"), text: "אצל אריאל" } });
  const sharedChat = await prisma.commsConversation.create({ data: { channelId: hadasWa.id, externalChatId: "shared", otherPhone: SHARED, name: "משותף" } });
  await prisma.commsMessage.create({ data: { conversationId: sharedChat.id, externalId: "s1", at: new Date("2026-11-11T08:00:00Z"), text: "סוד" } });

  const rec = await prisma.callRecording.create({
    data: {
      emailId: "e1",
      mailAccountId: "acc_m",
      fromPhone: DANA,
      toPhone: LINE,
      otherPhone: DANA,
      direction: "IN",
      callAt: new Date("2026-11-12T09:00:00Z"),
      durationSec: 90,
      transcript: { create: { status: "DONE", text: "שיחה על החשבונית" } },
    },
  });
  return { hadas, ariel, stranger, chat, arielChat, sharedChat, rec };
}

describe("client communications through the connector", () => {
  it("lists and reads what the person may see on the screen, and nothing else", async () => {
    const { hadas, chat, arielChat, sharedChat, rec } = await world();

    const listed = await call(hadas, "list_client_communications", { client: "לוי" });
    expect(listed.json.conversations.map((c: { id: string }) => c.id)).toEqual([chat.id]);
    expect(listed.json.conversations[0]).toMatchObject({ messages: 2, onAnkoraNumberOf: hadas.name });
    expect(listed.json.calls).toEqual([expect.objectContaining({ id: rec.id, direction: "incoming", minutes: 1.5, transcript: "ready" })]);
    expect(listed.json.hidden).toMatchObject({ conversations: 1 });

    const read = await call(hadas, "get_client_communication", { client: "לוי", id: chat.id });
    expect(read.json.messages.map((m: { text: string }) => m.text)).toEqual(["החשבונית מגיעה ביום ראשון", "תודה"]);
    expect(read.json.messages[1]).toMatchObject({ fromAnkora: true, from: "Ankora (הדס)" });
    expect(read.json.messages[0].at).toBe("2026-11-10 10:00");

    const heard = await call(hadas, "get_client_communication", { client: "לוי", id: rec.id });
    expect(heard.json).toMatchObject({ kind: "call", transcript: "שיחה על החשבונית", transcriptStatus: "ready" });

    // Kept out of Ariel's number; a number shared with a "בלי AI" client.
    expect((await call(hadas, "get_client_communication", { client: "לוי", id: arielChat.id })).text).toContain("No such conversation");
    expect((await call(hadas, "get_client_communication", { client: "לוי", id: sharedChat.id })).text).toContain("No such conversation");
  });

  // 26.11.2026: a voice message or a call without a transcript tells Claude
  // why: still waiting, or failed and the reason the last try gave.
  it("says why a voice message or a call has no transcript", async () => {
    const { hadas, chat, rec } = await world();
    const voice = await prisma.commsMessage.create({
      data: {
        conversationId: chat.id,
        externalId: "v1",
        at: new Date("2026-11-10T09:00:00Z"),
        attachments: { create: { externalId: "v1", type: "audio", voiceNote: true, durationSec: 2152 } },
      },
      include: { attachments: true },
    });
    await prisma.transcript.create({
      data: { attachmentId: voice.attachments[0].id, status: "FAILED", attempts: 3, lastError: "קובץ השמע לא נמצא." },
    });
    await prisma.transcript.update({ where: { recordingId: rec.id }, data: { status: "PENDING", attempts: 1, text: null, lastError: "OpenAI החזיר שגיאה 400." } });

    const read = await call(hadas, "get_client_communication", { client: "לוי", id: chat.id });
    const v = read.json.messages.find((m: { attachments?: unknown[] }) => m.attachments?.length);
    expect(v.attachments[0]).toMatchObject({ kind: "voice", voiceTranscript: null, voiceTranscriptState: "failed", voiceTranscriptError: "קובץ השמע לא נמצא." });

    const heard = await call(hadas, "get_client_communication", { client: "לוי", id: rec.id });
    expect(heard.json.transcriptStatus).toBe("waiting for the nightly run; the last try failed: OpenAI החזיר שגיאה 400.");
  });

  it("says who wrote a quoted message, never WhatsApp's hidden number", async () => {
    const { hadas, chat } = await world();
    await prisma.commsMessage.createMany({
      data: [
        {
          conversationId: chat.id,
          externalId: "r1",
          at: new Date("2026-11-10T08:10:00Z"),
          text: "אני על זה",
          isSender: true,
          quotedExternalId: "m1",
          quotedText: "החשבונית מגיעה ביום ראשון",
          quotedSenderName: "+972••••••••99",
        },
        {
          conversationId: chat.id,
          externalId: "r2",
          at: new Date("2026-11-10T08:11:00Z"),
          text: "מעולה",
          quotedExternalId: "m2",
          quotedText: "תודה",
          quotedSenderName: "+972••••••••11",
        },
        {
          conversationId: chat.id,
          externalId: "r3",
          at: new Date("2026-11-10T08:12:00Z"),
          text: "?",
          quotedExternalId: "old",
          quotedText: "ישן",
          quotedSenderName: "+972••••••••11",
        },
      ],
    });
    const read = await call(hadas, "get_client_communication", { client: "לוי", id: chat.id });
    const byText = new Map(read.json.messages.map((m: { text: string; replyTo?: unknown }) => [m.text, m.replyTo]));
    expect(byText.get("אני על זה")).toEqual({ from: "דנה", text: "החשבונית מגיעה ביום ראשון" });
    expect(byText.get("מעולה")).toEqual({ from: "Ankora", text: "תודה" });
    expect(byText.get("?")).toEqual({ from: "unknown", text: "ישן" });
    expect(read.text).not.toContain("•");
    expect(byText.get("תודה")).toBeUndefined();
  });

  it("gives nothing to someone without access to the communications screen, and refuses a marked client", async () => {
    const { stranger, hadas } = await world();
    expect((await call(stranger, "list_client_communications", { client: "לוי" })).text).toContain("no access to the communications screen");
    expect((await call(hadas, "list_client_communications", { client: "חסוי" })).json).toBeNull();
  });

  it("counts only what happened since a day, and pages back", async () => {
    const { hadas, chat } = await world();
    const since = await call(hadas, "list_client_communications", { client: "לוי", since: "2026-11-11" });
    expect(since.json.conversations).toEqual([]);
    expect(since.json.calls).toHaveLength(1);

    const page = await call(hadas, "get_client_communication", { client: "לוי", id: chat.id, limit: 1 });
    expect(page.json.messages.map((m: { text: string }) => m.text)).toEqual(["תודה"]);
    expect(page.json.hasEarlier).toBe(true);
  });

  it("lets the extraction account read a number people are kept out of, unless a manager turned it off (14.11.2026)", async () => {
    const { hadas, chat } = await world();
    const { user: ops } = await createTestUser({ role: "SUPER_ADMIN", email: "ops@ankora.co.il" });
    process.env.COMMS_EXTRACTION_ACCOUNTS = "";
    process.env.COMMS_FULL_VIEWERS = `${hadas.email},${ops.email}`;
    const client = await prisma.client.findFirstOrThrow({ where: { name: "לוי" } });
    await prisma.userClientAccess.create({ data: { userId: ops.id, clientId: client.id } });
    const channel = await prisma.commsConversation.findUniqueOrThrow({ where: { id: chat.id }, select: { channelId: true } });
    await prisma.commsChannel.update({ where: { id: channel.channelId }, data: { excludeAllViewers: true } });

    const listed = await call(ops, "list_client_communications", { client: "לוי" });
    expect(listed.json.conversations.map((c: { id: string }) => c.id)).toContain(chat.id);
    expect((await call(ops, "get_client_communication", { client: "לוי", id: chat.id })).json.messages).toHaveLength(2);

    await prisma.commsChannel.update({ where: { id: channel.channelId }, data: { extractionAllowed: false } });
    expect((await call(ops, "get_client_communication", { client: "לוי", id: chat.id })).text).toContain("No such conversation");
  });
});
