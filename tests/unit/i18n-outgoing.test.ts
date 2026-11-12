import { describe, expect, it } from "vitest";
import { translatorFor } from "@/lib/i18n/outgoing";
import { renderActionEmail, renderDeletionDeclarationEmail } from "@/lib/email-templates";
import { type Digest, digestSubject, renderDigestEmail } from "@/lib/app-domain/task-digest";
import { urgentMessage } from "@/lib/app-domain/urgent-tasks";
import { describeChange } from "@/lib/app-domain/task-changes";
import { metricsReport } from "@/lib/brain-metrics";
import { metricsSubject, renderMetricsEmail } from "@/lib/brain-metrics-email";

// ADR 0006, outgoing channels: what the app sends to a person with an
// account is in that person's language. The Hebrew is checked where each
// builder was already tested (it must not change by a character); these
// check the English, and that the layout turns with it.

const he = translatorFor("he");
const en = translatorFor("en");
const HEBREW_LETTER = /\p{Script=Hebrew}/u;

describe("translatorFor", () => {
  it("falls back to Hebrew in Jerusalem for anything it does not know", () => {
    const out = translatorFor("fr", "Not/AZone");
    expect(out.locale).toBe("he");
    expect(out.timeZone).toBe("Asia/Jerusalem");
    expect(out.dir).toBe("rtl");
  });

  it("formats English dates day first (en-IL)", () => {
    expect(en.tag).toBe("en-IL");
    expect(en.format.dateTime(new Date("2026-03-04T10:00:00Z"), { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" })).toBe("04/03");
  });
});

describe("the action email layout", () => {
  const input = { title: "T", body: ["B"], buttonLabel: "Go", url: "https://www.ankora.co.il/app" };

  it("is right to left in Hebrew, unchanged", () => {
    const { html } = renderActionEmail(input, he);
    expect(html).toContain('<html dir="rtl" lang="he">');
    expect(html).toContain('dir="rtl" align="right"');
    expect(html).toContain("אם הכפתור אינו עובד, אפשר להעתיק את הכתובת הזו לדפדפן:");
    expect(renderActionEmail(input).html).toBe(html);
  });

  it("is left to right in English, with no Hebrew of its own", () => {
    const { html } = renderActionEmail(input, en);
    expect(html).toContain('<html dir="ltr" lang="en">');
    expect(html).toContain('dir="ltr" align="left"');
    expect(html).not.toMatch(HEBREW_LETTER);
  });

  it("words the deletion declaration email in the person's language", () => {
    const { text } = renderDeletionDeclarationEmail({ name: "Dana", url: "https://x.test/a" }, en);
    expect(text).toContain("Hi Dana,");
    expect(text).not.toMatch(HEBREW_LETTER);
    expect(renderDeletionDeclarationEmail({ name: "דנה", url: "https://x.test/a" }).text).toContain("הצהרת מחיקה בסיום העבודה עם Ankora");
  });
});

describe("the urgent message", () => {
  const input = { kind: "landed" as const, taskId: "t1", taskTitle: "Renew", clientName: "Orbit", actorName: "Hadas", detail: null, baseUrl: "https://x.test" };

  it("speaks English to an English reader", () => {
    const m = urgentMessage(input, en);
    expect(m.subject).toBe("Urgent task for you: Renew · Orbit");
    expect(m.lines).toEqual(["Renew · Orbit", "From Hadas"]);
    expect(m.buttonLabel).toBe("Open the task");
  });

  it("keeps the Hebrew", () => {
    expect(urgentMessage(input, he).subject).toBe("משימה דחופה אצלך: Renew · Orbit");
  });
});

describe("a change line", () => {
  it("in English, arrows pointing the way English reads", () => {
    expect(describeChange({ action: "task.update", before: { priority: "NORMAL" }, after: { priority: "URGENT" } }, en)).toBe("Priority: Normal → Urgent");
    expect(describeChange({ action: "task.update", before: { priority: "NORMAL" }, after: { priority: "URGENT" } }, he)).toBe("עדיפות: רגילה ← דחופה");
  });
});

describe("the morning digest", () => {
  const now = new Date("2026-10-14T05:00:00Z");
  const digest: Digest = {
    overdue: [{ id: "a", title: "Renew insurance", clientName: "Orbit", dueDate: new Date("2026-10-10T09:00:00Z"), priority: "URGENT" }],
    today: [],
    fresh: [],
    updated: [],
    awaitingMySignature: [],
    staleWaits: 0,
    approvals: 2,
  };

  it("is in English, left to right, for an English reader", () => {
    const { html, text } = renderDigestEmail(digest, "Dana", now, en);
    expect(text).toContain("Good morning Dana,");
    expect(text).toContain("Urgent · 4 days late");
    expect(text).toContain("2 things are waiting for your approval.");
    expect(html).toContain('<html dir="ltr" lang="en">');
    expect(html).not.toMatch(HEBREW_LETTER);
    expect(digestSubject(digest, now, en)).toBe("4 days late: Renew insurance");
  });

  it("is the Hebrew it was for a Hebrew reader", () => {
    const { html, text } = renderDigestEmail(digest, "דנה", now, he);
    expect(text).toContain("בוקר טוב דנה,");
    expect(text).toContain("דחופה · באיחור 4 ימים");
    expect(html).toContain('<html dir="rtl" lang="he">');
    expect(digestSubject(digest, now)).toBe("באיחור 4 ימים: Renew insurance");
  });
});

describe("the weekly metrics email", () => {
  const empty = { processes: [], uncertainSince: [], systems: [], autoTasks: [], runs: [], pendingProposalsSince: [], decidedBatches: [] };
  const r = metricsReport([{ clientId: "a", clientName: "NUX", ...empty, systems: [{ accessStatus: "NO_ACCESS" }] }], new Date("2026-10-25T06:00:00Z"));

  it("words each measure in English, from the screen's dictionary", () => {
    expect(metricsSubject(r, "25.10.2026", en)).toBe("File metrics, week of 25.10.2026: one measure not on target yet");
    const { html, text } = renderMetricsEmail(r, "Dana", "https://www.ankora.co.il", "25.10.2026", en);
    expect(text).toContain("- NUX: ");
    expect(html).toContain('dir="ltr"');
    expect(html).not.toMatch(HEBREW_LETTER);
  });
});
