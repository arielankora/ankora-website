import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildInbox,
  buildTimeline,
  countSince,
  filterInbox,
  formatDuration,
  parseFilter,
  parseKey,
  proposeTask,
  type InboxCall,
  type InboxChat,
  type PhoneOwner,
} from "@/lib/whatsapp-poc/inbox";
import { RECORDINGS_FRESH_MS, RECORDINGS_MAX_AGE_MS, listRecordingsCached, resetRecordingsCache, type Recording } from "@/lib/whatsapp-poc/recordings";

const A = "+972541111111";
const B = "+972542222222";

function chat(over: Partial<InboxChat>): InboxChat {
  return { id: "x@lid", name: "ללא שם", type: "1to1", phone: null, unreadCount: 0, lastMessageAt: null, lastMessagePreview: null, ...over };
}

function call(over: Partial<InboxCall>): InboxCall {
  return { emailId: "e1", callAt: "2026-11-01T08:00:00Z", direction: "in", other: A, ...over };
}

describe("buildInbox", () => {
  const owners = new Map<string, PhoneOwner>([[A, { personName: "דנה", clients: [{ id: "c1", name: "לוי" }] }]]);

  it("puts a chat and the calls with the same number in one row, with the latest activity", () => {
    const rows = buildInbox(
      [chat({ id: "a@lid", phone: A, lastMessageAt: "2026-11-01T07:00:00Z", lastMessagePreview: "היי" })],
      [call({ callAt: "2026-11-01T08:00:00Z" })],
      owners,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: `p:${A}`, chatId: "a@lid", channel: "call", hasWhatsapp: true, hasCalls: true, preview: "שיחה נכנסת" });
    expect(rows[0].name).toBe("דנה");
    expect(rows[0].clients).toEqual([{ id: "c1", name: "לוי" }]);
  });

  it("keeps the message as the preview when it is newer than the call", () => {
    const rows = buildInbox(
      [chat({ id: "a@lid", name: "Dana", phone: A, lastMessageAt: "2026-11-01T09:00:00Z", lastMessagePreview: "היי" })],
      [call({ callAt: "2026-11-01T08:00:00Z" })],
      owners,
    );
    expect(rows[0]).toMatchObject({ channel: "wa", preview: "היי", name: "Dana" });
  });

  it("gives a call-only number its own row, and a group a chat key, newest first", () => {
    const rows = buildInbox(
      [chat({ id: "g@g.us", type: "group", name: "קבוצה", lastMessageAt: "2026-11-01T06:00:00Z" })],
      [call({ other: B, direction: "out", callAt: "2026-11-01T10:00:00Z" })],
      owners,
    );
    expect(rows.map((r) => r.key)).toEqual([`p:${B}`, "c:g@g.us"]);
    expect(rows[0]).toMatchObject({ name: B, preview: "שיחה יוצאת", chatId: null, clients: [] });
  });
});

describe("filterInbox", () => {
  const owners = new Map<string, PhoneOwner>([[A, { personName: "דנה", clients: [{ id: "c1", name: "משרד לוי" }] }]]);
  const rows = buildInbox(
    [chat({ id: "a@lid", phone: A, lastMessageAt: "2026-11-01T07:00:00Z" }), chat({ id: "g@g.us", type: "group", name: "קבוצה" })],
    [call({ other: B })],
    owners,
  );

  it("filters by channel and by having a client", () => {
    expect(filterInbox(rows, "wa", "").map((r) => r.key)).toEqual([`p:${A}`, "c:g@g.us"]);
    expect(filterInbox(rows, "call", "").map((r) => r.key)).toEqual([`p:${B}`]);
    expect(filterInbox(rows, "none", "").map((r) => r.key)).toEqual([`p:${B}`]);
  });

  it("searches names, client names and local numbers", () => {
    expect(filterInbox(rows, "all", "דנה").map((r) => r.key)).toEqual([`p:${A}`]);
    expect(filterInbox(rows, "all", "לוי").map((r) => r.key)).toEqual([`p:${A}`]);
    expect(filterInbox(rows, "all", "054-2222").map((r) => r.key)).toEqual([`p:${B}`]);
  });
});

describe("keys and small helpers", () => {
  it("reads keys back and refuses junk", () => {
    expect(parseKey(`p:${A}`)).toEqual({ phone: A });
    expect(parseKey("p:abc")).toBeNull();
    expect(parseKey("c:a@lid")).toEqual({ chatId: "a@lid" });
    expect(parseKey("zzz")).toBeNull();
    expect(parseFilter("call")).toBe("call");
    expect(parseFilter("nope")).toBe("all");
    expect(formatDuration(378)).toBe("6:18");
  });

  it("orders messages and calls in one timeline, oldest first", () => {
    const t = buildTimeline(
      [
        { id: "m2", timestamp: "2026-11-01T09:00:00Z" },
        { id: "m1", timestamp: "2026-11-01T07:00:00Z" },
      ],
      [call({ emailId: "e1", callAt: "2026-11-01T08:00:00Z" })],
    );
    expect(t.map((i) => i.id)).toEqual(["m1", "e1", "m2"]);
    expect(countSince(t, (i) => i.at, new Date("2026-11-01T07:30:00Z"))).toBe(2);
  });

  it("proposes a task from the conversation", () => {
    const p = proposeTask({
      name: "דנה",
      phone: A,
      lastMessages: [
        { text: "שלחתי את הדוחות", isSender: false },
        { text: "", isSender: false },
        { text: "קיבלתי", isSender: true },
      ],
      lastCall: { at: "2026-11-01T08:03:00Z", direction: "in" },
    });
    expect(p.title).toBe("מעקב: שיחה עם דנה");
    expect(p.description).toContain(`מספר: ${A}`);
    expect(p.description).toContain("שיחה נכנסת אחרונה");
    expect(p.description).toContain("דנה: שלחתי את הדוחות");
    expect(p.description).toContain("אנחנו: קיבלתי");
    expect(p.description).not.toContain("תמלול השיחה האחרונה");
  });

  it("adds the latest call's transcript to the proposed task", () => {
    const p = proposeTask({ name: "דנה", phone: A, lastMessages: [], lastCall: null, transcript: "  ביקשה דוח רבעוני  " });
    expect(p.description).toContain("תמלול השיחה האחרונה:\nביקשה דוח רבעוני");
  });
});

describe("listRecordingsCached", () => {
  const cfg = { apiKey: "k", mailAccountId: "acc_1" };
  const rec = { emailId: "e1" } as Recording;

  it("reuses a fresh list, and falls back to an older one when a read fails", async () => {
    resetRecordingsCache();
    let t = 0;
    const read = vi.fn().mockResolvedValueOnce([rec]);
    expect((await listRecordingsCached(cfg, read, () => t)).recordings).toEqual([rec]);
    t = 60_000;
    await listRecordingsCached(cfg, read, () => t);
    expect(read).toHaveBeenCalledTimes(1);

    t = RECORDINGS_FRESH_MS + 1;
    read.mockRejectedValueOnce(new Error("429"));
    expect(await listRecordingsCached(cfg, read, () => t)).toEqual({ recordings: [rec], stale: true });

    t = RECORDINGS_MAX_AGE_MS + 1;
    read.mockRejectedValueOnce(new Error("429"));
    await expect(listRecordingsCached(cfg, read, () => t)).rejects.toThrow("429");
  });
});

import { displayPhone, isPlausiblePhone } from "@/lib/whatsapp-poc/inbox";

describe("isPlausiblePhone", () => {
  it("tells real numbers from WhatsApp's internal ids (1.11.2026)", () => {
    expect(isPlausiblePhone("+972528549835")).toBe(true);
    expect(isPlausiblePhone("+14155356690")).toBe(true);
    expect(isPlausiblePhone("+995599601303")).toBe(true);
    expect(isPlausiblePhone("+141167152890103")).toBe(false);
    expect(isPlausiblePhone("+10394273849525")).toBe(false);
    expect(isPlausiblePhone("+238349444976674")).toBe(false);
    expect(displayPhone("+216256670072844")).toBe("מזהה WhatsApp (לא מספר טלפון)");
    expect(displayPhone("+972528549835")).toBe("+972528549835");
  });
});
