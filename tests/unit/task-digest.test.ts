import { describe, expect, it } from "vitest";
import {
  LINES_PER_GROUP,
  type Digest,
  digestGroups,
  digestSubject,
  freshSince,
  isDigestEmpty,
  isWorkingDay,
  renderDigestEmail,
  startOfLocalDay,
} from "@/lib/app-domain/task-digest";
import { whoToNotify } from "@/lib/app-domain/notifications";

// The morning digest, and the bell beside it.
//
// Hadas did not notice that a task had been opened on her. Everything
// here is one of the three ways the answer to that usually goes wrong:
// telling the wrong person, sending an email nobody needed, or getting
// the day boundary wrong in a country that is three hours off UTC.

function task(id: string, title = "משימה", dueDate: Date | null = null) {
  return { id, title, clientName: "אורביט", dueDate };
}

const EMPTY: Digest = { overdue: [], today: [], fresh: [], awaitingMySignature: [], staleWaits: 0 };

describe("who gets told, and who does not", () => {
  const hadas = "u-hadas";
  const anna = "u-anna";

  it("tells the person work was handed to", () => {
    const out = whoToNotify(
      hadas,
      { assignedToId: hadas, supervisorId: null },
      { assignedToId: anna, supervisorId: null }
    );
    expect(out).toEqual([{ userId: anna, type: "task_assigned" }]);
  });

  it("does not tell you about your own decision", () => {
    // Hadas assigning herself a task knows she did it. A bell for it is
    // the first line of noise, and noise is how a bell stops being read.
    const out = whoToNotify(
      hadas,
      { assignedToId: null, supervisorId: null },
      { assignedToId: hadas, supervisorId: hadas }
    );
    expect(out).toEqual([]);
  });

  it("does not re-announce work that landed last week", () => {
    // The trap: any edit to a task writes the whole row, so a title fix
    // would tell the assignee again every time somebody touched it.
    const out = whoToNotify(
      "u-someone",
      { assignedToId: anna, supervisorId: hadas },
      { assignedToId: anna, supervisorId: hadas }
    );
    expect(out).toEqual([]);
  });

  it("says nothing to the person it was taken from", () => {
    // "It is no longer yours" is a message with nothing to do attached.
    const out = whoToNotify(
      "u-someone",
      { assignedToId: hadas, supervisorId: null },
      { assignedToId: anna, supervisorId: null }
    );
    expect(out.map((o) => o.userId)).toEqual([anna]);
  });

  it("tells a new supervisor, because that is work too", () => {
    const out = whoToNotify(
      anna,
      { assignedToId: anna, supervisorId: null },
      { assignedToId: anna, supervisorId: hadas }
    );
    expect(out).toEqual([{ userId: hadas, type: "task_supervising" }]);
  });
});

describe("an email that is never sent empty", () => {
  it("knows when there is nothing to say", () => {
    expect(isDigestEmpty(EMPTY)).toBe(true);
    expect(isDigestEmpty({ ...EMPTY, staleWaits: 2 })).toBe(false);
    expect(isDigestEmpty({ ...EMPTY, fresh: [task("t1")] })).toBe(false);
  });
});

describe("the subject line, which is often the whole message", () => {
  it("leads with the count, and says when something is late", () => {
    expect(digestSubject({ ...EMPTY, today: [task("a"), task("b")] })).toBe("2 משימות עליך");
    expect(digestSubject({ ...EMPTY, overdue: [task("a")], today: [task("b"), task("c")] })).toBe(
      "3 משימות עליך, אחת באיחור"
    );
  });

  it("falls back to whatever the person is actually needed for", () => {
    // Nothing assigned, but somebody else's work is stopped on their
    // signature. A subject that said "0 משימות" would be read as
    // nothing to do.
    expect(digestSubject({ ...EMPTY, awaitingMySignature: [task("a")] })).toBe("משימה אחת מחכה לחתימה שלך");
    expect(digestSubject({ ...EMPTY, staleWaits: 3 })).toBe("יש מה להזכיר ללקוחות");
  });
});

describe("five lines to a group, then a number", () => {
  it("does not send a list of twenty", () => {
    const many = Array.from({ length: 9 }, (_, i) => task(`t${i}`, `משימה ${i}`));
    const [group] = digestGroups({ ...EMPTY, overdue: many });
    expect(group.tasks).toHaveLength(LINES_PER_GROUP);
    expect(group.more).toBe(4);
  });

  it("leaves out a group with nothing in it", () => {
    const groups = digestGroups({ ...EMPTY, fresh: [task("t1")] });
    expect(groups.map((g) => g.heading)).toEqual(["חדש אצלך"]);
  });

  it("asks the questions in the order somebody asks them at eight", () => {
    const groups = digestGroups({
      overdue: [task("a")],
      today: [task("b")],
      fresh: [task("c")],
      awaitingMySignature: [task("d")],
      staleWaits: 0,
    });
    expect(groups.map((g) => g.heading)).toEqual(["באיחור", "להיום", "חדש אצלך", "מחכה לחתימה שלך"]);
  });
});

describe("the email itself", () => {
  it("carries a link per line, and the person's name", () => {
    const { html, text } = renderDigestEmail({ ...EMPTY, overdue: [task("abc123", "לתאם טכנאי")] }, "הדס");
    expect(html).toContain("בוקר טוב הדס");
    expect(html).toContain("/app/tasks/abc123");
    expect(text).toContain("/app/tasks/abc123");
    expect(text).toContain("לתאם טכנאי");
  });

  it("says the waiting line as a sentence, not as a list", () => {
    const { text } = renderDigestEmail({ ...EMPTY, staleWaits: 4 }, "אנה");
    expect(text).toContain("4 משימות שלך ממתינות למישהו יותר משבוע");
  });

  it("escapes a task title that contains markup", () => {
    // Titles are free text typed by people, and this one goes into an
    // HTML email.
    const { html } = renderDigestEmail({ ...EMPTY, today: [task("x", '<script>alert("x")</script>')] }, "הדס");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the day boundary, where this kind of email actually breaks", () => {
  it("starts the day in Israel and not in UTC", () => {
    // 01:00 UTC on the 25th is 04:00 in Israel, the same day. A naive
    // implementation would call it the 24th and report yesterday's work
    // as due today.
    const start = startOfLocalDay(new Date("2026-09-25T01:00:00Z"));
    expect(start.toISOString()).toBe("2026-09-24T21:00:00.000Z");
  });

  it("does not send on Friday or Saturday", () => {
    // The week here runs Sunday to Thursday, and an email that arrives
    // on Saturday morning is stale before anybody opens it.
    expect(isWorkingDay(new Date("2026-09-25T08:00:00Z"))).toBe(false); // Friday
    expect(isWorkingDay(new Date("2026-09-26T08:00:00Z"))).toBe(false); // Saturday
    expect(isWorkingDay(new Date("2026-09-27T08:00:00Z"))).toBe(true); // Sunday
    expect(isWorkingDay(new Date("2026-09-24T08:00:00Z"))).toBe(true); // Thursday
  });

  it("reaches back to the last email, not a fixed day", () => {
    // Sunday's email has to cover everything since Thursday afternoon.
    // A 24-hour window drops two days of work in silence, every week.
    const thursday = new Date("2026-09-24T05:00:00Z");
    const sunday = new Date("2026-09-27T05:00:00Z");
    expect(freshSince({ dailyDigestAt: thursday }, sunday)).toEqual(thursday);
  });

  it("does not call every task ever assigned 'new' on the first email", () => {
    const now = new Date("2026-09-27T05:00:00Z");
    const since = freshSince({ dailyDigestAt: null }, now);
    // Yesterday morning, not the beginning of time.
    expect(now.getTime() - since.getTime()).toBeLessThan(3 * 24 * 3600_000);
    expect(since.getTime()).toBeLessThan(now.getTime());
  });
});
