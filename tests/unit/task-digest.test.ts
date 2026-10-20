import { describe, expect, it } from "vitest";
import {
  RANKED_LINES,
  type Digest,
  daysBetween,
  digestLead,
  digestSubject,
  rankDigest,
  safeText,
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

const EMPTY: Digest = { overdue: [], today: [], fresh: [], updated: [], awaitingMySignature: [], staleWaits: 0 };

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

// 08:00 in Israel on Tuesday 20.10.2026, the morning the email was
// rebuilt around one ranked list.
const NOW = new Date("2026-10-20T05:00:00Z");
const day = (key: string) => new Date(`${key}T09:00:00Z`);

describe("the subject line, which is often the whole message", () => {
  it("names the first thing to handle, with its reason, and counts the rest", () => {
    // 20.10.2026: "משימה אחת עליך, אחת באיחור" said how much, not what.
    const d = { ...EMPTY, overdue: [task("a", "לבדוק אם לרכוש את הדומיין", day("2026-10-03"))], today: [task("b")] };
    expect(digestSubject(d, NOW)).toBe("באיחור 17 ימים: לבדוק אם לרכוש את הדומיין, ועוד אחת");
    expect(digestSubject({ ...EMPTY, today: [task("a", "לתאם טכנאי")] }, NOW)).toBe("להיום: לתאם טכנאי");
  });

  it("puts somebody else's stopped work first", () => {
    const d = { ...EMPTY, overdue: [task("a", "x", day("2026-10-10"))], awaitingMySignature: [task("b", "הצעת מחיר")] };
    expect(digestSubject(d, NOW)).toBe("מחכה לאישור שלך: הצעת מחיר, ועוד אחת");
  });

  it("cuts a long title, never the reason", () => {
    const subject = digestSubject({ ...EMPTY, today: [task("a", "א".repeat(120))] }, NOW);
    expect(subject.startsWith("להיום: ")).toBe(true);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("still says something when the only news is a long wait", () => {
    expect(digestSubject({ ...EMPTY, staleWaits: 3 }, NOW)).toBe("3 משימות ממתינות יותר משבוע");
  });
});

describe("one list, in order of importance", () => {
  it("counts late days by the Israel calendar", () => {
    // Due yesterday at 23:59 Israel is one day late at 08:00, not zero.
    expect(daysBetween(new Date("2026-10-19T20:59:00Z"), NOW)).toBe(1);
    expect(daysBetween(day("2026-10-03"), NOW)).toBe(17);
  });

  it("ranks: signature, urgent, late (latest first), today, new, long waits, updated", () => {
    const d: Digest = {
      overdue: [task("late2", "x", day("2026-10-18")), task("late17", "x", day("2026-10-03"))],
      today: [task("today")],
      fresh: [task("fresh")],
      updated: [task("updated")],
      awaitingMySignature: [task("sign")],
      staleWaits: 1,
      waiting: [{ ...task("wait"), blockedOn: "CLIENT", since: day("2026-10-11") }],
    };
    d.today.push({ ...task("urgentToday"), priority: "URGENT" });
    expect(rankDigest(d, NOW).map((i) => i.task.id)).toEqual([
      "sign",
      "urgentToday",
      "late17",
      "late2",
      "today",
      "fresh",
      "wait",
      "updated",
    ]);
  });

  it("says how late, and asks for a decision after a week", () => {
    const [item] = rankDigest({ ...EMPTY, overdue: [task("a", "x", day("2026-10-03"))] }, NOW);
    expect(item.reason).toBe("באיחור 17 ימים");
    expect(item.hint).toBe("לבצע, לדחות את התאריך, או לסגור?");
    const [fresh] = rankDigest({ ...EMPTY, overdue: [task("b", "x", day("2026-10-19"))] }, NOW);
    expect(fresh.reason).toBe("באיחור יום אחד");
    expect(fresh.hint).toBeUndefined();
  });

  it("names who is stopped on the signature, and for how long", () => {
    const [item] = rankDigest(
      { ...EMPTY, awaitingMySignature: [{ ...task("a"), assigneeName: "הדס", since: day("2026-10-18") }] },
      NOW
    );
    expect(item.reason).toBe("מחכה לאישור שלך יומיים · עוצר את הדס");
    expect(item.action).toBe("לאשר");
  });

  it("names a long wait and offers the reminder", () => {
    const [item] = rankDigest(
      { ...EMPTY, staleWaits: 1, waiting: [{ ...task("a"), blockedOn: "CLIENT", since: day("2026-10-11") }] },
      NOW
    );
    expect(item.reason).toBe("ממתינה ללקוח 9 ימים");
    expect(item.action).toBe("להזכיר");
  });

  it("lists a task once, at its highest rank", () => {
    const t = task("a", "x", day("2026-10-10"));
    expect(rankDigest({ ...EMPTY, overdue: [t], updated: [t] }, NOW)).toHaveLength(1);
  });

  it("says how much, and whether somebody is stopped", () => {
    const d = { ...EMPTY, today: [task("a"), task("b")], awaitingMySignature: [task("c")] };
    expect(digestLead(d, rankDigest(d, NOW))).toBe("3 דברים דורשים אותך היום. אחד מהם עוצר מישהו אחר.");
    const u = { ...EMPTY, updated: [task("a")] };
    expect(digestLead(u, rankDigest(u, NOW))).toBe("משימה אחת שלך עודכנה.");
  });

  it("does not send a list of twenty", () => {
    const many = Array.from({ length: 12 }, (_, i) => task(`t${i}`, `משימה ${i}`));
    const { text } = renderDigestEmail({ ...EMPTY, today: many }, "הדס", NOW);
    expect(text).toContain(`${RANKED_LINES}. להיום`);
    expect(text).not.toContain(`${RANKED_LINES + 1}. להיום`);
    expect(text).toContain("ועוד 5 משימות ברשימה.");
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

  it("counts the waits it did not name", () => {
    const { text } = renderDigestEmail({ ...EMPTY, staleWaits: 4 }, "אנה", NOW);
    expect(text).toContain("4 משימות ממתינות למישהו יותר משבוע");
  });

  it("opens the day, and gives every line one action", () => {
    const { html, text } = renderDigestEmail({ ...EMPTY, today: [task("abc", "לתאם טכנאי")] }, "הדס", NOW);
    expect(html).toContain("/app/calendar?view=day");
    expect(html).toContain("פתח את היום שלי");
    expect(text).toContain("לפתוח: ");
  });

  it("keeps a domain in a title from becoming its own link", () => {
    // 20.10.2026: Gmail turned "ankora360.com" inside the task's link
    // into a link to the website.
    expect(safeText("לרכוש את ankora360.com")).toBe("לרכוש את ankora360.&#8203;com");
    expect(safeText("יעד 3.10")).toBe("יעד 3.10");
    const { html, text } = renderDigestEmail({ ...EMPTY, today: [task("x", "לרכוש את ankora360.com")] }, "אריאל", NOW);
    expect(html).not.toContain("ankora360.com</a>");
    expect(text).toContain("לרכוש את ankora360.com");
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
