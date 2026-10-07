import { describe, expect, it } from "vitest";
import { describeChange, quoteComment } from "@/lib/app-domain/task-changes";
import {
  CHANGES_PER_TASK,
  type Digest,
  digestSubject,
  groupChanges,
  isDigestEmpty,
  renderDigestEmail,
  taskNotes,
} from "@/lib/app-domain/task-digest";
import {
  DETAIL_MAX_CHARS,
  quoteFor,
  shouldAlertOnComment,
  urgentLanding,
  urgentMessage,
} from "@/lib/app-domain/urgent-tasks";
import { DEFAULT_URGENT_POLICY, planDelivery, policyFromEnv } from "@/lib/notify/policy";
import { deliver, type DeliveryChannel } from "@/lib/notify/channels";

// Ariel and Hadas, 7.10.2026. Hadas opened a task on Ariel, wrote the
// whole brief in a comment, and expected him to know that day. Two
// answers: the morning digest says what OTHERS changed on your work and
// what was written on new work, and urgent work reaches you now.

const EMPTY: Digest = { overdue: [], today: [], fresh: [], updated: [], awaitingMySignature: [], staleWaits: 0 };
const t = (id: string, extra: Partial<Digest["fresh"][number]> = {}) => ({
  id,
  title: "דווח שעות שנוצלו",
  clientName: "RIMED",
  dueDate: null,
  ...extra,
});

describe("one change, one line a person can act on", () => {
  it("quotes a comment, without Markdown marks", () => {
    expect(describeChange({ action: "task.comment", before: null, after: {}, commentBody: "**יוסי** לא קיבל דוח" })).toBe(
      "תגובה: «יוסי לא קיבל דוח»"
    );
  });

  it("cuts a long comment rather than pasting it whole", () => {
    const long = "א".repeat(400);
    expect(quoteComment(long).length).toBe(160);
    expect(quoteComment(long).endsWith("…")).toBe(true);
  });

  it("says a status moved, from what to what", () => {
    expect(
      describeChange({ action: "task.status_change", before: { status: "OPEN" }, after: { status: "IN_PROGRESS" } })
    ).toBe("סטטוס: פתוחה ← בביצוע");
  });

  it("names the two status moves that mean work came back", () => {
    expect(
      describeChange({ action: "task.update", before: { status: "PENDING_APPROVAL" }, after: { status: "IN_PROGRESS" } })
    ).toBe("הוחזרה מאישור");
    expect(describeChange({ action: "task.update", before: { status: "DONE" }, after: { status: "OPEN" } })).toBe(
      "נפתחה מחדש"
    );
  });

  it("puts several real changes from one save on one line", () => {
    const line = describeChange({
      action: "task.update",
      before: { priority: "NORMAL", dueDate: null, status: "OPEN" },
      after: { priority: "URGENT", dueDate: "2026-10-09T09:00:00.000Z", status: "OPEN" },
    });
    expect(line).toBe("עדיפות: רגילה ← דחופה · תאריך יעד: ללא ← 9.10");
  });

  it("stays quiet about changes with nothing to do attached", () => {
    // Category, the client's title and a spelling fix in the title are
    // real changes. None of them is a reason to read an email.
    expect(
      describeChange({
        action: "task.update",
        before: { title: "דווח שעות", categoryId: "a", clientTitle: null, status: "OPEN" },
        after: { title: "דוח שעות", categoryId: "b", clientTitle: "דוח", status: "OPEN" },
      })
    ).toBeNull();
  });

  it("names a file and a wait", () => {
    expect(describeChange({ action: "client_document.add", before: null, after: {}, fileTitle: "פוליסה.pdf" })).toBe(
      "צירף/ה קובץ: פוליסה.pdf"
    );
    expect(describeChange({ action: "task.blocked", before: {}, after: { blockedOn: "CLIENT" } })).toBe("ממתין ללקוח");
    expect(describeChange({ action: "task.unblocked", before: {}, after: {} })).toBe("ההמתנה הסתיימה");
  });
});

describe("changes grouped under their task", () => {
  it("keeps the newest few and counts the rest", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      taskId: "t1",
      at: new Date(Date.UTC(2026, 9, 6, 8 + i)),
      actorName: "הדס",
      text: `שינוי ${i}`,
    }));
    const grouped = groupChanges([...rows, { taskId: "t1", at: new Date(), actorName: "הדס", text: null }]);
    const g = grouped.get("t1")!;
    expect(g.changes).toHaveLength(CHANGES_PER_TASK);
    expect(g.changes[0].text).toBe("שינוי 4");
    expect(g.more).toBe(2);
  });

  it("writes what was on new work under it, and who changed what", () => {
    const notes = taskNotes(
      t("t1", {
        excerpt: "בשיחה עם יוסי אמר שלא קיבל דוח",
        changes: [{ at: new Date("2026-10-06T13:40:00Z"), actorName: "הדס", text: "תאריך יעד: ללא ← 9.10" }],
        moreChanges: 2,
      })
    );
    expect(notes).toEqual(["«בשיחה עם יוסי אמר שלא קיבל דוח»", "הדס, 16:40: תאריך יעד: ללא ← 9.10", "ועוד 2 עדכונים"]);
  });

  it("puts the RIMED brief in the email itself", () => {
    const { text, html } = renderDigestEmail(
      { ...EMPTY, fresh: [t("t1", { excerpt: "בשיחה עם יוסי אמר שלא קיבל דוח" })] },
      "אריאל"
    );
    expect(text).toContain("«בשיחה עם יוסי אמר שלא קיבל דוח»");
    expect(html).toContain("בשיחה עם יוסי");
  });

  it("marks urgent work in the email", () => {
    const { text } = renderDigestEmail({ ...EMPTY, updated: [t("t1", { priority: "URGENT" })] }, "אריאל");
    expect(text).toContain("דחופה · דווח שעות שנוצלו");
  });
});

describe("a digest with only updates is still a digest", () => {
  it("is not empty", () => {
    expect(isDigestEmpty({ ...EMPTY, updated: [t("t1")] })).toBe(false);
  });

  it("says so in the subject", () => {
    expect(digestSubject({ ...EMPTY, updated: [t("t1")] })).toBe("משימה אחת שלך עודכנה");
    expect(digestSubject({ ...EMPTY, updated: [t("t1"), t("t2")] })).toBe("2 משימות שלך עודכנו");
    expect(digestSubject({ ...EMPTY, today: [t("a")], updated: [t("b"), t("c")] })).toBe("משימה אחת עליך, 2 עודכנו");
  });
});

describe("urgent work: who is told, and when", () => {
  const hadas = "u-hadas";
  const ariel = "u-ariel";

  it("tells the assignee when urgent work is opened on them", () => {
    expect(urgentLanding(hadas, null, { assignedToId: ariel, priority: "URGENT" })).toBe(ariel);
  });

  it("does not message anybody about normal work", () => {
    // The RIMED task was opened at normal priority. It waits for the
    // morning, and the form says so to the person opening it.
    expect(urgentLanding(hadas, null, { assignedToId: ariel, priority: "NORMAL" })).toBeNull();
  });

  it("tells the assignee when their task is raised to urgent, or urgent work is handed to them", () => {
    expect(
      urgentLanding(hadas, { assignedToId: ariel, priority: "HIGH" }, { assignedToId: ariel, priority: "URGENT" })
    ).toBe(ariel);
    expect(
      urgentLanding(hadas, { assignedToId: hadas, priority: "URGENT" }, { assignedToId: ariel, priority: "URGENT" })
    ).toBe(ariel);
  });

  it("does not re-announce urgent work that is already theirs", () => {
    expect(
      urgentLanding(hadas, { assignedToId: ariel, priority: "URGENT" }, { assignedToId: ariel, priority: "URGENT" })
    ).toBeNull();
  });

  it("never messages the person who did it", () => {
    expect(urgentLanding(ariel, null, { assignedToId: ariel, priority: "URGENT" })).toBeNull();
  });

  it("alerts on a comment at most once an hour per task, and never on closed work", () => {
    const now = new Date("2026-10-07T10:00:00Z");
    const open = { priority: "URGENT" as const, assignedToId: ariel, status: "OPEN" };
    expect(shouldAlertOnComment(hadas, open, null, now)).toBe(true);
    expect(shouldAlertOnComment(hadas, open, new Date("2026-10-07T09:30:00Z"), now)).toBe(false);
    expect(shouldAlertOnComment(hadas, open, new Date("2026-10-07T08:59:00Z"), now)).toBe(true);
    expect(shouldAlertOnComment(ariel, open, null, now)).toBe(false);
    expect(shouldAlertOnComment(hadas, { ...open, status: "DONE" }, null, now)).toBe(false);
    expect(shouldAlertOnComment(hadas, { ...open, priority: "HIGH" }, null, now)).toBe(false);
  });
});

describe("the urgent message reads on its own", () => {
  const msg = urgentMessage({
    kind: "landed",
    taskId: "t1",
    taskTitle: "דווח שעות שנוצלו",
    clientName: "RIMED",
    actorName: "הדס",
    detail: "בשיחה עם יוסי אמר שלא קיבל דוח",
    baseUrl: "https://www.ankora.co.il",
  });

  it("carries the whole answer in the subject, and a link to the task", () => {
    expect(msg.subject).toBe("משימה דחופה אצלך: דווח שעות שנוצלו · RIMED");
    expect(msg.url).toBe("https://www.ankora.co.il/app/tasks/t1");
    expect(msg.lines).toContain("מאת הדס");
  });

  it("keeps the quote short", () => {
    const q = quoteFor("א".repeat(1000))!;
    expect(q.length).toBe(DETAIL_MAX_CHARS);
    expect(quoteFor("   ")).toBeNull();
  });
});

describe("the channel is a setting, not a code change", () => {
  it("defaults to email when nothing, or nonsense, is configured", () => {
    expect(policyFromEnv(undefined, undefined)).toEqual(DEFAULT_URGENT_POLICY);
    expect(policyFromEnv("wahtsapp", "")).toEqual(DEFAULT_URGENT_POLICY);
  });

  it("reads an order of preference and a mode", () => {
    expect(policyFromEnv("WhatsApp, email, email", "all")).toEqual({ channels: ["whatsapp", "email"], mode: "all" });
  });

  it("skips a channel that is not connected or cannot reach the person", () => {
    const plan = planDelivery({ channels: ["whatsapp", "email"], mode: "first" }, [
      { id: "whatsapp", configured: false, reaches: false },
      { id: "email", configured: true, reaches: true },
    ]);
    expect(plan).toEqual(["email"]);
  });
});

describe("delivery falls back, and stops when it has delivered", () => {
  const recipient = { userId: "u1", name: "אריאל", email: "a@example.com", phone: "972500000000" };
  const message = urgentMessage({
    kind: "comment",
    taskId: "t1",
    taskTitle: "x",
    clientName: "y",
    actorName: "הדס",
    detail: null,
    baseUrl: "https://example.com",
  });

  function fake(id: "email" | "whatsapp", ok: boolean, log: string[]): DeliveryChannel {
    return {
      id,
      configured: () => true,
      reaches: () => true,
      async send() {
        log.push(id);
        return ok ? { ok } : { ok, error: "down" };
      },
    };
  }

  it("moves to email when WhatsApp fails", async () => {
    const log: string[] = [];
    const out = await deliver(recipient, message, { channels: ["whatsapp", "email"], mode: "first" }, {
      whatsapp: fake("whatsapp", false, log),
      email: fake("email", true, log),
    });
    expect(log).toEqual(["whatsapp", "email"]);
    expect(out.map((r) => r.ok)).toEqual([false, true]);
  });

  it("sends once in 'first' mode, through every channel in 'all' mode", async () => {
    const first: string[] = [];
    await deliver(recipient, message, { channels: ["whatsapp", "email"], mode: "first" }, {
      whatsapp: fake("whatsapp", true, first),
      email: fake("email", true, first),
    });
    expect(first).toEqual(["whatsapp"]);

    const all: string[] = [];
    await deliver(recipient, message, { channels: ["whatsapp", "email"], mode: "all" }, {
      whatsapp: fake("whatsapp", true, all),
      email: fake("email", true, all),
    });
    expect(all).toEqual(["whatsapp", "email"]);
  });
});
