import { describe, it, expect } from "vitest";
import {
  canReplyTo,
  canSendTo,
  canViewWhatsappPoc,
  checkMessageText,
  maskPhone,
  parseEmailList,
  parsePhoneList,
  parseSendMode,
  MAX_MESSAGE_LENGTH,
} from "@/lib/whatsapp-poc/access";
import { UnipileError, parseVcard, loadMergedChats, resetChatListCache, CHAT_LIST_FRESH_MS, CHAT_LIST_MAX_AGE_MS, mergeChats, type PocChat, parseOffset, isHiddenChat, toPocChat, toPocMessage, whatsappAddress } from "@/lib/whatsapp-poc/unipile";

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

describe("Replies (5.11.2026): open by default, the test list as a kill switch", () => {
  const list = parsePhoneList("+972541234567");
  const one = { type: "1to1", phone: "+972501111111" };
  const group = { type: "group", phone: null };

  it("reads the mode: only \"test\" closes it", () => {
    expect(parseSendMode(undefined)).toBe("open");
    expect(parseSendMode("")).toBe("open");
    expect(parseSendMode(" TEST ")).toBe("test");
    expect(parseSendMode("tset")).toBe("open");
  });

  it("answers any one to one chat and any group when open", () => {
    expect(canReplyTo(one, "open", list)).toBe(true);
    expect(canReplyTo(group, "open", list)).toBe(true);
    expect(canReplyTo({ type: "channel", phone: null }, "open", list)).toBe(false);
  });

  it("goes back to the test list, one to one only, in test mode", () => {
    expect(canReplyTo(one, "test", list)).toBe(false);
    expect(canReplyTo({ type: "1to1", phone: "+972541234567" }, "test", list)).toBe(true);
    expect(canReplyTo(group, "test", list)).toBe(false);
  });

  it("never writes to a chat WhatsApp holds read-only", () => {
    expect(canReplyTo({ ...group, readOnly: true }, "open", list)).toBe(false);
  });

  it("reads Unipile's read-only flag", () => {
    expect(toPocChat({ id: "g@g.us", type: "group", is_readonly: true } as never)?.readOnly).toBe(true);
    expect(toPocChat({ id: "a@lid", type: "1to1" } as never)?.readOnly).toBeUndefined();
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

describe("WhatsApp POC: replies, forwards and contact cards (13.11.2026)", () => {
  it("keeps the quoted message and the forwarded mark", () => {
    const m = toPocMessage({
      id: "r",
      timestamp: "2026-11-13T10:45:00Z",
      text: "ממיה",
      quoted: { text: "המליצו לי עליו", sender: { display_name: "ANKORA" }, attachments: [] },
    });
    expect(m?.quoted).toEqual({ text: "המליצו לי עליו", senderName: "ANKORA", attachmentTypes: [] });
    expect(m?.forwarded).toBeUndefined();
    const f = toPocMessage({ id: "f", timestamp: "2026-11-13T10:45:00Z", text: "x", forwarded: { attachments: [] } });
    expect(f?.forwarded).toBe(true);
  });

  it("takes a wrapped forward's text when the message has none", () => {
    const f = toPocMessage({ id: "f", timestamp: "2026-11-13T10:45:00Z", text: "", forwarded: { text: "בפנים", attachments: [] } });
    expect(f?.text).toBe("בפנים");
  });

  it("reads a contact card from its fields", () => {
    const m = toPocMessage({
      id: "c",
      timestamp: "2026-11-13T10:45:00Z",
      attachments: [{ id: "a", type: "contact_card", display_name: "שלום", phones: [{ number: "+972 52-000-0000" }] }],
    });
    expect(m?.attachments[0].contact).toEqual({ name: "שלום", phones: ["+972 52-000-0000"] });
  });

  it("parses a WhatsApp vCard", () => {
    const card = ["BEGIN:VCARD", "VERSION:3.0", "N:;שלום❤;;;", "FN:שלום❤", "item1.TEL;waid=972520000000:+972 52-000-0000", "item1.X-ABLabel:נייד", "END:VCARD"].join("\r\n");
    expect(parseVcard(card)).toEqual({ name: "שלום❤", phones: ["+972 52-000-0000"] });
    expect(parseVcard("hello")).toBeNull();
    const inline = toPocMessage({
      id: "v",
      timestamp: "2026-11-13T10:45:00Z",
      attachments: [{ id: "a", type: "file", mimetype: "text/vcard", content: Buffer.from(card).toString("base64") }],
    });
    expect(inline?.attachments[0].contact?.name).toBe("שלום❤");
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

describe("WhatsApp POC: remembering the chat list", () => {
  const config = { apiKey: "k", accountId: "acc_test" };
  const chat = (id: string) => toPocChat({ id, name: id, type: "1to1", last_message_timestamp: "2026-10-31T10:00:00Z" })!;
  const first = [chat("a@lid")];
  const second = [chat("b@lid")];
  // Runs scheduled work at once and waits for it, as afterResponse does
  // outside a request.
  const inline = async (work: () => Promise<void>) => {
    await work().catch(() => undefined);
  };

  it("reads Unipile once within a minute", async () => {
    resetChatListCache();
    let calls = 0;
    const fetchAll = async () => {
      calls += 1;
      return first;
    };
    let t = 1_000_000;
    await loadMergedChats(config, fetchAll, () => t, inline);
    t += CHAT_LIST_FRESH_MS - 1;
    await loadMergedChats(config, fetchAll, () => t, inline);
    expect(calls).toBe(1);
  });

  it("keeps each number's list: reading a second number does not drop the first (5.11.2026)", async () => {
    resetChatListCache();
    const other = { apiKey: "k", accountId: "acc_other" };
    let calls = 0;
    const counting = (list: PocChat[]) => async () => {
      calls += 1;
      return list;
    };
    const t = 5_000_000;
    await loadMergedChats(config, counting(first), () => t, inline);
    await loadMergedChats(other, counting(second), () => t, inline);
    const again = await loadMergedChats(config, counting(second), () => t, inline);
    const otherAgain = await loadMergedChats(other, counting(first), () => t, inline);
    expect(calls).toBe(2);
    expect(again.chats).toEqual(first);
    expect(otherAgain.chats).toEqual(second);
  });

  it("after a minute shows the old list at once and refreshes it for the next load", async () => {
    resetChatListCache();
    let t = 2_000_000;
    await loadMergedChats(config, async () => first, () => t, inline);
    t += CHAT_LIST_FRESH_MS + 1;
    const scheduled: Array<() => Promise<void>> = [];
    const later = (work: () => Promise<void>) => {
      scheduled.push(work);
    };
    const shown = await loadMergedChats(config, async () => second, () => t, later);
    expect(shown).toEqual({ chats: first, refreshing: true });
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    const next = await loadMergedChats(config, async () => second, () => t, later);
    expect(next.chats).toEqual(second);
  });

  it("keeps the old list when the background read fails, a 429 included", async () => {
    resetChatListCache();
    let t = 3_000_000;
    await loadMergedChats(config, async () => first, () => t, inline);
    t += CHAT_LIST_FRESH_MS + 1;
    const failing = async (): Promise<PocChat[]> => {
      throw new UnipileError("rate", 429);
    };
    const shown = await loadMergedChats(config, failing, () => t, inline);
    expect(shown.chats).toEqual(first);
    const again = await loadMergedChats(config, failing, () => t, inline);
    expect(again.chats).toEqual(first);
  });

  it("waits for a read when there is no list or it is over ten minutes old", async () => {
    resetChatListCache();
    await expect(
      loadMergedChats(config, async () => {
        throw new UnipileError("rate", 429);
      }),
    ).rejects.toThrow("rate");
    let t = 4_000_000;
    await loadMergedChats(config, async () => first, () => t, inline);
    t += CHAT_LIST_MAX_AGE_MS + 1;
    const shown = await loadMergedChats(config, async () => second, () => t, inline);
    expect(shown).toEqual({ chats: second, refreshing: false });
  });
});

describe("WhatsApp POC: Unipile's 429", () => {
  it("passes on the wait Unipile states for a quota", async () => {
    const { rateLimitMessage } = await import("@/lib/whatsapp-poc/unipile");
    expect(rateLimitMessage("We only allow 100 requests. Retry in 15 hours.")).toContain("15 שעות");
    expect(rateLimitMessage("Retry in 2 minutes")).toContain("2 דקות");
  });

  it("falls back to a short wait when Unipile names none", async () => {
    const { rateLimitMessage } = await import("@/lib/whatsapp-poc/unipile");
    expect(rateLimitMessage(undefined)).toBe("Unipile מגביל כרגע את קצב הבקשות. נסו שוב בעוד דקה.");
    expect(rateLimitMessage("Too many requests")).toBe("Unipile מגביל כרגע את קצב הבקשות. נסו שוב בעוד דקה.");
  });
});
