import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";

// Extraction from stored communications (14.11.2026): a stretch of a
// WhatsApp conversation, or a recorded call, proposed as a source through
// propose_knowledge, found again when sent twice, refused when the user may
// not read it, and reported by get_extraction_brief so the next run starts
// the day after.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));
import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[] }>;
type Validated = { value?: unknown; issues?: readonly { message: string }[] };
type Standard = { "~standard": { validate: (v: unknown) => Validated | Promise<Validated> } };
const tools = new Map<string, { schema?: Standard; handler: Handler }>();
registerAnkoraTools({ registerTool: (name: string, c: { inputSchema?: Standard }, h: Handler) => tools.set(name, { schema: c.inputSchema, handler: h }) } as never);

async function call(user: User, name: string, args: unknown) {
  const tool = tools.get(name)!;
  let parsed = args;
  if (tool.schema && "~standard" in tool.schema) {
    const v = await tool.schema["~standard"].validate(args);
    if (v.issues) throw new Error(v.issues.map((i) => i.message).join("; "));
    parsed = v.value;
  }
  const text = (await tool.handler(parsed, { http: { authInfo: { extra: { user } } } })).content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

const DANA = "+972542222222";
const LINE = "+972553302266";
const FACT = { target: "FACT", payload: { kind: "PREFERENCE", body: "מעדיפים לקבל חשבוניות ביום ראשון" }, reason: "דנה כתבה בוואטסאפ", confidence: "MEDIUM" };

beforeEach(() => {
  process.env.COMMS_CALL_VIEWERS = "";
  process.env.WHATSAPP_POC_VIEWERS = "";
  process.env.ALOHA_LINE_NUMBER = LINE;
  process.env.ALOHA_LINE_OWNERS = "";
});

async function world() {
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: other } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  process.env.COMMS_FULL_VIEWERS = hadas.email;
  const client = await createTestClient({ name: "לוי" });
  for (const u of [hadas, other]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  const dana = await prisma.person.create({ data: { name: "דנה", phones: [DANA] } });
  await prisma.clientContact.create({ data: { clientId: client.id, personId: dana.id, role: "כספים" } });
  const wa = await prisma.commsChannel.create({ data: { accountId: "acc_h", ownerUserId: hadas.id, storeEnabled: true } });
  const chat = await prisma.commsConversation.create({ data: { channelId: wa.id, externalChatId: "dana", otherPhone: DANA, name: "דנה" } });
  await prisma.commsMessage.create({ data: { conversationId: chat.id, externalId: "m1", at: new Date("2026-11-10T08:00:00Z"), text: "חשבוניות רק ביום ראשון" } });
  const rec = await prisma.callRecording.create({
    data: {
      emailId: "e1",
      mailAccountId: "acc_m",
      fromPhone: DANA,
      toPhone: LINE,
      otherPhone: DANA,
      direction: "IN",
      callAt: new Date("2026-11-12T09:00:00Z"),
      transcript: { create: { status: "DONE", text: "שיחה" } },
    },
  });
  return { hadas, other, client, chat, rec };
}

describe("extraction from communications", () => {
  it("registers a WhatsApp stretch and a call as sources, once each, and the brief says what was read", async () => {
    const { hadas, client, chat, rec } = await world();
    const whatsapp = { conversationId: chat.id, from: "2026-11-01", to: "2026-11-10" };

    const first = await call(hadas, "propose_knowledge", { client: "לוי", newSource: { kind: "PERSON", title: "וואטסאפ עם דנה", whatsapp }, items: [FACT] });
    expect(first.json).toMatchObject({ proposed: 1 });
    const again = await call(hadas, "propose_knowledge", { client: "לוי", newSource: { kind: "PERSON", title: "וואטסאפ עם דנה", whatsapp }, items: [FACT] });
    expect(again.json.sourceCode).toBe(first.json.sourceCode);

    const byCall = await call(hadas, "propose_knowledge", { client: "לוי", newSource: { kind: "TRANSCRIPT", title: "שיחה עם דנה", callId: rec.id }, items: [FACT] });
    expect(byCall.json).toMatchObject({ proposed: 1 });

    const sources = await prisma.clientSource.findMany({ where: { clientId: client.id }, orderBy: { seq: "asc" } });
    expect(sources.map((s) => s.externalRefs)).toEqual([
      [{ system: "WHATSAPP", id: `${chat.id}:2026-11-01:2026-11-10` }],
      [{ system: "CALL", id: rec.id }],
    ]);

    const brief = await call(hadas, "get_extraction_brief", {});
    expect(brief.json.communications.alreadyRead).toEqual([
      { client: "לוי", whatsapp: [{ conversationId: chat.id, readThrough: "2026-11-10" }], calls: [rec.id] },
    ]);
  });

  it("refuses a conversation the user may not read, and the wrong kind", async () => {
    const { other, hadas, chat, rec } = await world();
    const whatsapp = { conversationId: chat.id, from: "2026-11-01", to: "2026-11-10" };
    expect((await call(other, "propose_knowledge", { client: "לוי", newSource: { kind: "PERSON", title: "x", whatsapp }, items: [FACT] })).text).toContain(
      "no access to the communications screen",
    );
    expect((await call(hadas, "propose_knowledge", { client: "לוי", newSource: { kind: "TRANSCRIPT", title: "x", whatsapp }, items: [FACT] })).text).toContain("kind PERSON");
    expect((await call(hadas, "propose_knowledge", { client: "לוי", newSource: { kind: "TRANSCRIPT", title: "x", callId: "nope" }, items: [FACT] })).text).toContain("No such conversation");
    expect(await prisma.clientSource.count()).toBe(0);
    void rec;
  });
});
