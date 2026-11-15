import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/whatsapp-poc/voice/[chatId]/[messageId] (security review
// 2026-11): a chat id is unique per connected number, not across numbers.
// The stored Drive copy must therefore be looked up only under the number
// (Unipile account) that the access gate approved, or the owner of one
// number could play a stored voice message of another number by its ids.

const session = vi.hoisted(() => {
  class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }
  return { UnauthorizedError, requireUserOrThrow: vi.fn() };
});
const access = vi.hoisted(() => ({ accountForChatFile: vi.fn() }));
const db = vi.hoisted(() => ({ commsAttachment: { findFirst: vi.fn() } }));
const drive = vi.hoisted(() => ({ downloadFileFromDrive: vi.fn() }));
const voice = vi.hoisted(() => ({ fetchVoiceNote: vi.fn() }));

vi.mock("@/lib/app-auth/session", () => session);
vi.mock("@/lib/comms/route-access", () => access);
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/google-drive", () => drive);
vi.mock("@/lib/whatsapp-poc/voice-notes", () => voice);
vi.mock("@/lib/whatsapp-poc/unipile", () => ({ UnipileError: class UnipileError extends Error {} }));

const { GET } = await import("@/app/api/whatsapp-poc/voice/[chatId]/[messageId]/route");
const call = (chatId: string, messageId: string) =>
  GET(new Request(`http://x/api/whatsapp-poc/voice/${chatId}/${messageId}?n=ch-a`), {
    params: Promise.resolve({ chatId, messageId }),
  });

beforeEach(() => vi.clearAllMocks());

describe("WhatsApp voice route: stored copy is scoped to the approved number", () => {
  it("refuses before any lookup when the gate refuses", async () => {
    session.requireUserOrThrow.mockResolvedValue({ id: "u", role: "ANKORA_EMPLOYEE" });
    access.accountForChatFile.mockResolvedValue(null);
    expect((await call("chat1", "msg1")).status).toBe(403);
    expect(db.commsAttachment.findFirst).not.toHaveBeenCalled();
  });

  it("matches the stored conversation on the approved account, not on the chat id alone", async () => {
    session.requireUserOrThrow.mockResolvedValue({ id: "u", role: "ANKORA_EMPLOYEE" });
    access.accountForChatFile.mockResolvedValue({ apiKey: "k", accountId: "acc-A" });
    db.commsAttachment.findFirst.mockResolvedValue(null);
    voice.fetchVoiceNote.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: "audio/ogg" });

    const res = await call("chat1", "msg1");
    expect(res.status).toBe(200);
    const where = db.commsAttachment.findFirst.mock.calls[0][0].where;
    expect(where.message.conversation).toEqual({ externalChatId: "chat1", channel: { accountId: "acc-A" } });
    expect(where.message.held).toBe(false);
    expect(voice.fetchVoiceNote).toHaveBeenCalledWith({ apiKey: "k", accountId: "acc-A" }, "chat1", "msg1");
  });
});
