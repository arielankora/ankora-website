import { describe, expect, it } from "vitest";
import { isMaskedPhone, maskedPhoneMatches, quoteSender } from "@/lib/comms/quote-sender";

// 15.11.2026: a reply showed "תגובה להודעה של +1••••••••90". WhatsApp hides
// the quoted sender's number, and Unipile passes it on as the name. What is
// worth holding: a row of dots never reaches the screen or the connector.

const oneToOne = { isGroup: false, chatName: "אורן רובין", chatPhone: "+14155356690" };
const group = { isGroup: true, chatName: "צוות NUX", chatPhone: null };

describe("isMaskedPhone", () => {
  it("knows a hidden number from a name", () => {
    expect(isMaskedPhone("+1••••••••90")).toBe(true);
    expect(isMaskedPhone("+972 ••• 5088")).toBe(true);
    expect(isMaskedPhone("Oren Rubin")).toBe(false);
    expect(isMaskedPhone("+14155356690")).toBe(false);
    expect(isMaskedPhone(null)).toBe(false);
  });
});

describe("maskedPhoneMatches", () => {
  it("matches the digits it shows, and the length when every digit has a dot", () => {
    expect(maskedPhoneMatches("+1••••••••90", "+14155356690")).toBe(true);
    expect(maskedPhoneMatches("+1••••••••91", "+14155356690")).toBe(false);
    expect(maskedPhoneMatches("+1•••••••90", "+14155356690")).toBe(false);
    expect(maskedPhoneMatches("+972 ••• 5088", "+972524645088")).toBe(true);
    expect(maskedPhoneMatches("••••", "+972524645088")).toBe(false);
  });
});

describe("quoteSender", () => {
  it("in a one to one conversation, the contact's name instead of their hidden number", () => {
    expect(quoteSender({ ...oneToOne, quotedName: "+1••••••••90", original: null })).toEqual({ kind: "name", name: "אורן רובין" });
    expect(quoteSender({ ...oneToOne, quotedName: "+1••••••••90", original: { isSender: false, senderName: null } })).toEqual({
      kind: "name",
      name: "אורן רובין",
    });
  });

  it("says us when the original is ours", () => {
    expect(quoteSender({ ...oneToOne, quotedName: "+972••••••••88", original: { isSender: true, senderName: "הדס" } })).toEqual({ kind: "us" });
  });

  it("does not guess: a hidden number that is not the contact's has no name", () => {
    expect(quoteSender({ ...oneToOne, quotedName: "+972••••••••88", original: null })).toEqual({ kind: "unknown" });
    expect(quoteSender({ ...oneToOne, chatPhone: null, quotedName: "+1••••••••90", original: null })).toEqual({ kind: "unknown" });
  });

  it("in a group, the sender's own name, never the group's name or a hidden number", () => {
    expect(quoteSender({ ...group, quotedName: "+1••••••••90", original: { isSender: false, senderName: "גיא" } })).toEqual({ kind: "name", name: "גיא" });
    expect(quoteSender({ ...group, quotedName: "+1••••••••90", original: null })).toEqual({ kind: "unknown" });
    expect(quoteSender({ ...group, quotedName: null, original: null })).toEqual({ kind: "unknown" });
    expect(quoteSender({ ...group, quotedName: "גיא", original: null })).toEqual({ kind: "name", name: "גיא" });
  });

  it("keeps a real name that came with the quote", () => {
    expect(quoteSender({ ...oneToOne, quotedName: "Oren", original: null })).toEqual({ kind: "name", name: "Oren" });
    expect(quoteSender({ ...oneToOne, quotedName: null, original: null })).toEqual({ kind: "name", name: "אורן רובין" });
  });
});
