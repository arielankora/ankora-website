import { describe, expect, it } from "vitest";
import { defaultRemindAt, isReply, parseRemindAt, recipientsOf, suggestCandidate, toLocalInput, waitState } from "@/lib/mail-scan/wait-rules";

// Stage 2 of "התיבות שלי" (27.11.2026): the pure rules of following a reply
// to an email on a task.

describe("mail waits: the default reminder", () => {
  it("is two working days later in Israel, at the same time of day", () => {
    // Thursday 26.11.2026 10:12 Israel (08:12 UTC) -> Monday 30.11 10:12.
    expect(toLocalInput(defaultRemindAt(new Date("2026-11-26T08:12:00Z")))).toBe("2026-11-30T10:12");
    // Sunday 29.11 09:00 -> Tuesday 1.12 09:00.
    expect(toLocalInput(defaultRemindAt(new Date("2026-11-29T07:00:00Z")))).toBe("2026-12-01T09:00");
  });
});

describe("mail waits: state", () => {
  const now = new Date("2026-12-01T10:00:00Z");
  it("open: waiting until the reminder, overdue after", () => {
    expect(waitState({ endedAt: null, endedHow: null, remindAt: new Date("2026-12-02T08:00:00Z") }, now)).toBe("waiting");
    expect(waitState({ endedAt: null, endedHow: null, remindAt: null }, now)).toBe("waiting");
    expect(waitState({ endedAt: null, endedHow: null, remindAt: new Date("2026-12-01T09:00:00Z") }, now)).toBe("overdue");
  });
  it("ended: replied, or stopped however it stopped", () => {
    expect(waitState({ endedAt: now, endedHow: "REPLY", remindAt: null }, now)).toBe("replied");
    expect(waitState({ endedAt: now, endedHow: "STOPPED", remindAt: null }, now)).toBe("stopped");
    expect(waitState({ endedAt: now, endedHow: "REPLACED", remindAt: null }, now)).toBe("stopped");
  });
});

describe("mail waits: what counts as the reply", () => {
  it("anyone but the mailbox that sent the email, a colleague included", () => {
    expect(isReply("yossi@acme-print.co.il", "Anna@Ankora.co.il")).toBe(true);
    expect(isReply("maor@ankora.co.il", "anna@ankora.co.il")).toBe(true);
    expect(isReply("anna@ankora.co.il", "anna@ankora.co.il")).toBe(false);
    expect(isReply(null, "anna@ankora.co.il")).toBe(false);
  });
  it("the recipients are everyone in the email but the mailbox", () => {
    expect(recipientsOf(["anna@ankora.co.il", "yossi@acme-print.co.il", "dana@acme-print.co.il"], "anna@ankora.co.il")).toEqual(["yossi@acme-print.co.il", "dana@acme-print.co.il"]);
  });
});

describe("mail waits: the suggested email", () => {
  const rows = [
    { threadId: "old-client", sentTo: ["nadav@grantor.co.il"], sentAt: new Date("2026-11-20T08:00:00Z"), clientIds: ["c1"] },
    { threadId: "newest", sentTo: ["yossi@acme-print.co.il"], sentAt: new Date("2026-11-27T08:00:00Z"), clientIds: [] },
    { threadId: "client", sentTo: ["office@grantor.co.il"], sentAt: new Date("2026-11-25T08:00:00Z"), clientIds: ["c1"] },
  ];
  it("is the newest one with the task's client, else the newest of all", () => {
    expect(suggestCandidate(rows, "c1")).toBe("client");
    expect(suggestCandidate(rows, "c2")).toBe("newest");
    expect(suggestCandidate(rows, null)).toBe("newest");
    expect(suggestCandidate([], "c1")).toBeNull();
  });
});

describe("mail waits: reading a reminder time", () => {
  const now = new Date("2026-11-27T10:00:00Z");
  it("takes a datetime-local value or a day in Israel time, or an ISO time", () => {
    expect(parseRemindAt("2026-12-01T10:12", now)?.toISOString()).toBe("2026-12-01T08:12:00.000Z");
    expect(parseRemindAt("2026-12-01", now)?.toISOString()).toBe("2026-12-01T07:00:00.000Z");
    expect(parseRemindAt("2026-12-01T08:00:00Z", now)?.toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });
  it("refuses the past, nonsense and nothing", () => {
    expect(parseRemindAt("2026-11-26T10:00", now)).toBeNull();
    expect(parseRemindAt("tomorrow", now)).toBeNull();
    expect(parseRemindAt("", now)).toBeNull();
    expect(parseRemindAt(null, now)).toBeNull();
  });
});
