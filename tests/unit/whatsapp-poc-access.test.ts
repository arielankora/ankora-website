import { describe, it, expect } from "vitest";
import {
  canSendTo,
  canViewWhatsappPoc,
  checkMessageText,
  maskPhone,
  parseEmailList,
  parsePhoneList,
  MAX_MESSAGE_LENGTH,
} from "@/lib/whatsapp-poc/access";
import { UnipileError, loadMergedChats, resetChatListCache, CHAT_LIST_FRESH_MS, mergeChats, parseOffset, isHiddenChat, toPocChat, toPocMessage, whatsappAddress } from "@/lib/whatsapp-poc/unipile";

describe("WhatsApp POC: who may see the screen", () => {
  const viewers = parseEmailList("Ariel@Ankora.co.il, hadas@ankora.co.il");

  it("lets a listed admin in", () => {
    expect(canViewWhatsappPoc({ role: "SUPER_ADMIN", email: "ariel@ankora.co.il" }, viewers)).toBe(true);
    expect(canViewWhatsappPoc({ role: "ANKORA_ADMIN", email: "HADAS@ankora.co.il" }, viewers)).toBe(true);
  });

  it("keeps out an admin who is not on the list", () => {
    expect(canViewWhatsappPoc({ role: "SUPER_ADMIN", email: "ops@ankora.co.il" }, viewers)).toBe(false);
  });

  it("keeps out a listed address whose role is not admin", () => {
    expect(canViewWhatsappPoc({ role: "ANKORA_EMPLOYEE", email: "ariel@ankora.co.il" }, viewers)).toBe(false);
    expect(canViewWhatsappPoc({ role: "CLIENT_USER", email: "ariel@ankora.co.il" }, viewers)).toBe(false);
  });

  it("treats a missing or empty list as nobody", () => {
    expect(canViewWhatsappPoc({ role: "SUPER_ADMIN", email: "ariel@ankora.co.il" }, parseEmailList(undefined))).toBe(false);
    expect(canViewWhatsappPoc({ role: "SUPER_ADMIN", email: "ariel@ankora.co.il" }, parseEmailList(" , "))).toBe(false);
  });

  it("drops entries that are not addresses", () => {
    expect(parseEmailList("ariel@ankora.co.il, *, @ankora.co.il")).toEqual(["ariel@ankora.co.il"]);
  });
});

describe("WhatsApp POC: who may be written to", () => {
  const sendTo = parsePhoneList("054-123-4567\n+972 52 765 4321");

  it("normalizes the list to E.164", () => {
    expect(sendTo).toEqual(["+972541234567", "+972527654321"]);
  });

  it("allows a listed number in any spelling Unipile may return", () => {
    expect(canSendTo("+972541234567", sendTo)).toBe(true);
    expect(canSendTo("+972 54-123-4567", sendTo)).toBe(true);
  });

  it("refuses an unlisted number, a missing number and a bare local number", () => {
    expect(canSendTo("+972501111111", sendTo)).toBe(false);
    expect(canSendTo(null, sendTo)).toBe(false);
    expect(canSendTo("", sendTo)).toBe(false);
    expect(canSendTo("541234567", sendTo)).toBe(false);
  });

  it("refuses everything when the list is empty", () => {
    expect(canSendTo("+972541234567", parsePhoneList(""))).toBe(false);
  });
});

describe("WhatsApp POC: message text", () => {
  it("trims and accepts ordinary text", () => {
    expect(checkMessageText("  שלום  ")).toEqual({ ok: true, text: "שלום" });
  });

  it("refuses empty, non-string and over-long text", () => {
    expect(checkMessageText("   ").ok).toBe(false);
    expect(checkMessageText(null).ok).toBe(false);
    expect(checkMessageText("x".repeat(MAX_MESSAGE_LENGTH + 1)).ok).toBe(false);
  });

  it("masks a number for the audit log", () => {
    expect(maskPhone("+972524645088")).toBe("+972 ••• 5088");
    expect(maskPhone(null)).toBe("");
  });
});

describe("WhatsApp POC: reading Unipile's shapes", () => {
  it("takes the number only from a 1:1 chat", () => {
    const oneToOne = toPocChat({ id: "1@lid", name: "A", type: "1to1", user: { public_identifier: "+972541234567" } });
    expect(oneToOne?.phone).toBe("+972541234567");
    const group = toPocChat({ id: "2@g.us", name: "G", type: "group", user: { public_identifier: "+972541234567" } });
    expect(group?.phone).toBeNull();
  });

  it("drops a chat without an id and fills a missing name", () => {
    expect(toPocChat({ name: "x" })).toBeNull();
    expect(toPocChat({ id: "3@lid" })?.name).toBe("ללא שם");
  });

  it("drops system events and keeps attachments as labels", () => {
    expect(toPocMessage({ id: "e", timestamp: "2026-10-31T10:00:00Z", is_event: true })).toBeNull();
    const m = toPocMessage({
      id: "m",
      timestamp: "2026-10-31T10:00:00Z",
      text: "hi",
      is_sender: true,
      attachments: [{ type: "audio", voice_note: true }],
    });
    expect(m).toMatchObject({ id: "m", isSender: true, attachments: [{ type: "audio", voiceNote: true }] });
  });
});

describe("WhatsApp POC: the chat list", () => {
  it("hides WhatsApp's status feed", () => {
    const status = toPocChat({ id: "status@broadcast", name: "status", type: "1to1" });
    expect(status && isHiddenChat(status)).toBe(true);
    const person = toPocChat({ id: "1@lid", name: "A", type: "1to1" });
    expect(person && isHiddenChat(person)).toBe(false);
  });

  it("accepts a page offset and turns anything odd into the first page", () => {
    expect(parseOffset("30")).toBe(30);
    expect(parseOffset("90")).toBe(90);
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset("31")).toBe(0);
    expect(parseOffset("-30")).toBe(0);
    expect(parseOffset("1e3")).toBe(0);
    expect(parseOffset("99990")).toBe(0);
    expect(parseOffset("180")).toBe(0);
  });
});

describe("WhatsApp POC: opening a chat by number", () => {
  it("turns an E.164 number into its WhatsApp address", () => {
    expect(whatsappAddress("+972553302266")).toBe("972553302266@s.whatsapp.net");
  });

  it("refuses anything that is not E.164", () => {
    expect(whatsappAddress(null)).toBeNull();
    expect(whatsappAddress("0553302266")).toBeNull();
    expect(whatsappAddress("+97255/../x")).toBeNull();
  });
});

describe("WhatsApp POC: merging Unipile's chat list", () => {
  const chat = (id: string, at: string | null) => toPocChat({ id, name: id, type: "1to1", last_message_timestamp: at ?? undefined })!;

  it("keeps one entry per chat, the copy with the latest activity", () => {
    const merged = mergeChats([
      chat("a@lid", "2026-10-30T10:00:00Z"),
      chat("b@lid", "2026-10-31T09:00:00Z"),
      chat("a@lid", "2026-10-31T12:00:00Z"),
      chat("a@lid", "2026-10-29T08:00:00Z"),
    ]);
    expect(merged.map((c) => c.id)).toEqual(["a@lid", "b@lid"]);
    expect(merged[0].lastMessageAt).toBe("2026-10-31T12:00:00Z");
  });

  it("orders newest first, puts chats without a date last, and drops the status feed", () => {
    const merged = mergeChats([
      chat("old@lid", "2026-10-01T00:00:00Z"),
      chat("none@lid", null),
      chat("status@broadcast", "2026-10-31T23:00:00Z"),
      chat("new@lid", "2026-10-31T00:00:00Z"),
    ]);
    expect(merged.map((c) => c.id)).toEqual(["new@lid", "old@lid", "none@lid"]);
  });
});

describe("WhatsApp POC: remembering the chat list for a minute", () => {
  const config = { apiKey: "k", accountId: "acc_test" };
  const list = [toPocChat({ id: "a@lid", name: "A", type: "1to1", last_message_timestamp: "2026-10-31T10:00:00Z" })!];

  it("reads Unipile once within a minute, then again after it", async () => {
    resetChatListCache();
    let calls = 0;
    const fetchAll = async () => {
      calls += 1;
      return list;
    };
    let t = 1_000_000;
    await loadMergedChats(config, fetchAll, () => t);
    t += CHAT_LIST_FRESH_MS - 1;
    await loadMergedChats(config, fetchAll, () => t);
    expect(calls).toBe(1);
    t += 2;
    await loadMergedChats(config, fetchAll, () => t);
    expect(calls).toBe(2);
  });

  it("shows the last list, marked stale, when Unipile answers 429", async () => {
    resetChatListCache();
    let t = 2_000_000;
    await loadMergedChats(config, async () => list, () => t);
    t += CHAT_LIST_FRESH_MS + 1;
    const result = await loadMergedChats(
      config,
      async () => {
        throw new UnipileError("rate", 429);
      },
      () => t,
    );
    expect(result).toEqual({ chats: list, stale: true });
  });

  it("does not hide other errors, and has nothing to show with no earlier list", async () => {
    resetChatListCache();
    await expect(
      loadMergedChats(config, async () => {
        throw new UnipileError("rate", 429);
      }),
    ).rejects.toThrow("rate");
    await loadMergedChats(config, async () => list, () => 0);
    await expect(
      loadMergedChats(
        config,
        async () => {
          throw new UnipileError("down", 500);
        },
        () => CHAT_LIST_FRESH_MS + 1,
      ),
    ).rejects.toThrow("down");
  });
});
