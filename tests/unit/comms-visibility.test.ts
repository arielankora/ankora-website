import { describe, it, expect } from "vitest";
import { blockStateFor, canSeeConversation, nextExcludedViewers, parseViewerEmails } from "@/lib/comms/visibility";

// Who sees which stored WhatsApp conversation (spec decisions, 1.11.2026).
const ariel = { id: "ariel", email: "ariel@ankora.co.il" };
const hadas = { id: "hadas", email: "hadas@ankora.co.il" };
const anna = { id: "anna", email: "annam@ankora.co.il" };
const fullViewers = parseViewerEmails("ariel@ankora.co.il, Hadas@Ankora.co.il");

describe("canSeeConversation", () => {
  const arielsNumber = { ownerUserId: "ariel", excludedViewerIds: ["hadas"] };
  const hadasNumber = { ownerUserId: "hadas", excludedViewerIds: [] };

  it("never shows Ariel's number to Hadas, not even her own client's conversation", () => {
    const clients = [{ id: "c1", accountManagerId: "hadas" }];
    expect(canSeeConversation({ viewer: hadas, channel: arielsNumber, clients, fullViewers })).toBe(false);
    expect(canSeeConversation({ viewer: ariel, channel: arielsNumber, clients, fullViewers })).toBe(true);
  });

  it("shows a conversation with no client to the owner and the full viewers only", () => {
    expect(canSeeConversation({ viewer: ariel, channel: hadasNumber, clients: [], fullViewers })).toBe(true);
    expect(canSeeConversation({ viewer: hadas, channel: hadasNumber, clients: [], fullViewers })).toBe(true);
    expect(canSeeConversation({ viewer: anna, channel: hadasNumber, clients: [], fullViewers })).toBe(false);
  });

  it("shows a client's conversation to its account manager", () => {
    const clients = [{ id: "c1", accountManagerId: "anna" }];
    expect(canSeeConversation({ viewer: anna, channel: hadasNumber, clients, fullViewers })).toBe(true);
    expect(canSeeConversation({ viewer: anna, channel: hadasNumber, clients: [{ id: "c2", accountManagerId: "x" }], fullViewers })).toBe(false);
  });
});

describe("blockStateFor", () => {
  it("reads the block list for a number and for a group", () => {
    const blocks = [
      { kind: "PHONE" as const, value: "+972541111111", status: "APPROVED" as const },
      { kind: "PHONE" as const, value: "+972542222222", status: "PENDING" as const },
      { kind: "CHAT" as const, value: "g@g.us", status: "APPROVED" as const },
      { kind: "PHONE" as const, value: "+972543333333", status: "REVOKED" as const },
    ];
    expect(blockStateFor(blocks, { phone: "+972541111111", chatId: "a" })).toBe("blocked");
    expect(blockStateFor(blocks, { phone: "+972542222222", chatId: "b" })).toBe("pending");
    expect(blockStateFor(blocks, { phone: null, chatId: "g@g.us" })).toBe("blocked");
    expect(blockStateFor(blocks, { phone: "+972543333333", chatId: "c" })).toBe("none");
  });
});

describe("nextExcludedViewers (5.11.2026)", () => {
  const arielsNumber = { ownerUserId: "ariel", excludedViewerIds: ["hadas"] };

  it("lets the owner change the list freely, and never puts the owner on it", () => {
    expect(nextExcludedViewers({ channel: arielsNumber, editorId: "ariel", picked: ["anna", "ariel"] })).toEqual(["anna"]);
    expect(nextExcludedViewers({ channel: arielsNumber, editorId: "ariel", picked: [] })).toEqual([]);
  });

  it("does not let someone on the list take themselves off a number that is not theirs", () => {
    expect(nextExcludedViewers({ channel: arielsNumber, editorId: "hadas", picked: [] })).toEqual(["hadas"]);
    expect(nextExcludedViewers({ channel: arielsNumber, editorId: "hadas", picked: ["anna"] }).sort()).toEqual(["anna", "hadas"]);
  });

  it("lets a manager who is not on the list take others off", () => {
    expect(nextExcludedViewers({ channel: arielsNumber, editorId: "anna", picked: [] })).toEqual([]);
  });
});
