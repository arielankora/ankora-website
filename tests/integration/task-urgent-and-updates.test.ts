import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addTaskComment, createTask, updateTask } from "@/lib/app-domain/tasks";
import { buildDigest } from "@/lib/app-domain/task-digest";
import { TASK_URGENT_COMMENT_NOTIFICATION_TYPE } from "@/lib/app-domain/urgent-tasks";

// Ariel and Hadas, 7.10.2026. The pure rules are checked next door
// (tests/unit/task-updates-and-urgent.test.ts). What needs a database is
// whether a real save produces the email, the bell row and the digest
// lines, and whether it produces them for the right person only.
//
// The mail provider is replaced with a stub that records what it was
// asked to send. Nothing leaves the test.

async function staffOn(clientId: string, name: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return { ...user, name };
}

const sent: { to: string[]; subject: string; text: string }[] = [];
const savedKey = process.env.RESEND_API_KEY;

beforeEach(() => {
  sent.length = 0;
  process.env.RESEND_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      sent.push({ to: body.to, subject: body.subject, text: body.text });
      return new Response(JSON.stringify({ id: "msg_test" }), { status: 200 });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedKey;
});

describe("urgent work reaches its owner now, by email", () => {
  it("emails the assignee when urgent work is opened on them, with the brief and a link", async () => {
    const client = await createTestClient({ name: "RIMED" });
    const hadas = await staffOn(client.id, "הדס");
    const ariel = await staffOn(client.id, "אריאל");

    const task = await createTask(hadas, {
      clientId: client.id,
      title: "דווח שעות שנוצלו",
      description: "יוסי לא קיבל דוח על השעות שניצל וכמה נשאר",
      assignedToId: ariel.id,
      priority: "URGENT",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([ariel.email]);
    expect(sent[0].subject).toBe("משימה דחופה אצלך: דווח שעות שנוצלו · RIMED");
    expect(sent[0].text).toContain(`/app/tasks/${task.id}`);
    expect(sent[0].text).toContain("יוסי לא קיבל דוח");

    // Logged, so a failure is visible and the retry can resend it.
    const log = await prisma.emailDelivery.findMany({ where: { template: "task_urgent" } });
    expect(log).toHaveLength(1);
    expect(log[0].status).toBe("SENT");

    // The bell says urgent too, once.
    const bell = await prisma.notification.findMany({ where: { userId: ariel.id } });
    expect(bell).toHaveLength(1);
    expect(bell[0].title).toBe("משימה דחופה אצלך");
  });

  it("sends nothing for normal work, and nothing to the person who did it", async () => {
    const client = await createTestClient();
    const hadas = await staffOn(client.id, "הדס");
    const ariel = await staffOn(client.id, "אריאל");

    await createTask(hadas, { clientId: client.id, title: "רגילה", assignedToId: ariel.id });
    await createTask(ariel, { clientId: client.id, title: "שלי", assignedToId: ariel.id, priority: "URGENT" });

    expect(sent).toHaveLength(0);
  });

  it("emails when somebody raises a task to urgent, and not again on the next edit", async () => {
    const client = await createTestClient();
    const hadas = await staffOn(client.id, "הדס");
    const ariel = await staffOn(client.id, "אריאל");

    const task = await createTask(ariel, { clientId: client.id, title: "חידוש פוליסה", assignedToId: ariel.id });
    await updateTask(hadas, task.id, { priority: "URGENT" });
    await updateTask(hadas, task.id, { title: "חידוש פוליסה לרכב" });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([ariel.email]);
  });

  it("emails on a comment on urgent work at most once an hour", async () => {
    const client = await createTestClient();
    const hadas = await staffOn(client.id, "הדס");
    const ariel = await staffOn(client.id, "אריאל");

    const task = await createTask(ariel, {
      clientId: client.id,
      title: "חידוש פוליסה",
      assignedToId: ariel.id,
      priority: "URGENT",
    });
    await addTaskComment(hadas, task.id, "הסוכן ביקש מספר רכב");
    await addTaskComment(hadas, task.id, "וגם צילום רישיון");

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("עדכון במשימה דחופה");
    expect(sent[0].text).toContain("הסוכן ביקש מספר רכב");
    expect(
      await prisma.notification.count({ where: { userId: ariel.id, type: TASK_URGENT_COMMENT_NOTIFICATION_TYPE } })
    ).toBe(1);
  });
});

describe("the morning digest says what others changed", () => {
  it("lists a task somebody else changed, with what they changed", async () => {
    const client = await createTestClient({ name: "RIMED" });
    const hadas = await staffOn(client.id, "הדס");
    const ariel = await staffOn(client.id, "אריאל");

    // Ariel's own task, from before the last digest.
    const task = await createTask(ariel, { clientId: client.id, title: "דוח שעות", assignedToId: ariel.id });
    const lastDigest = new Date();
    await prisma.user.update({ where: { id: ariel.id }, data: { dailyDigestAt: lastDigest } });

    await addTaskComment(hadas, task.id, "יוסי ביקש לדעת כמה שעות נשארו");
    await updateTask(hadas, task.id, { dueDate: new Date("2026-10-09T09:00:00Z") });
    // His own change is not news to him.
    await addTaskComment(ariel, task.id, "אני על זה");

    const digest = await buildDigest({ id: ariel.id, dailyDigestAt: lastDigest });
    expect(digest.updated.map((t) => t.id)).toEqual([task.id]);
    const lines = digest.updated[0].changes!.map((c) => `${c.actorName}: ${c.text}`);
    expect(lines).toContain("הדס: תגובה: «יוסי ביקש לדעת כמה שעות נשארו»");
    expect(lines.some((l) => l.startsWith("הדס: תאריך יעד:"))).toBe(true);
    expect(lines.some((l) => l.includes("אני על זה"))).toBe(false);
  });

  it("shows what was written on new work, once", async () => {
    const client = await createTestClient({ name: "RIMED" });
    const hadas = await staffOn(client.id, "הדס");
    const ariel = await staffOn(client.id, "אריאל");
    const since = new Date(Date.now() - 60_000);

    const task = await createTask(hadas, { clientId: client.id, title: "דווח שעות שנוצלו", assignedToId: ariel.id });
    await addTaskComment(hadas, task.id, "בשיחה עם יוסי אמר שלא קיבל דוח");

    const digest = await buildDigest({ id: ariel.id, dailyDigestAt: since });
    expect(digest.fresh.map((t) => t.id)).toEqual([task.id]);
    expect(digest.fresh[0].excerpt).toBe("בשיחה עם יוסי אמר שלא קיבל דוח");
    // The same comment is not listed again as a change, nor the task
    // again under "עודכן אצלך".
    expect(digest.fresh[0].changes ?? []).toHaveLength(0);
    expect(digest.updated).toHaveLength(0);
  });
});
