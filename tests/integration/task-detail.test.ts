import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestCategory, createTestClient, createTestUser } from "./factories";
import { createTask, getTaskDetail, listTasks, updateTask } from "@/lib/app-domain/tasks";
import { startTimer, stopTimer } from "@/lib/app-domain/time-entries";

// Tasks phase 1 ("מסך המשימה").
//
// The screen itself is the browser suite's job. What belongs here is the
// part of this phase that is a rule rather than a layout:
//
//   - `startedAt`, which the server owns and which is the one half of
//     cycle time the team-adoption phase did not add. Its whole value is
//     that it does NOT move, so most of these tests are about it staying
//     put through transitions that look like they should reset it.
//   - `getTaskDetail`'s access answer, which is a `null` and not a throw,
//     because the screen must not distinguish "no such task" from "not
//     your client".
//   - The hours roll-up, which is the number the tasks-system spec argues
//     only a tracker built inside a time product can show.
//   - The audit action name, which the new history panel reads and which
//     a server-owned column could quietly have broken.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

describe("startedAt: the moment work began, and it does not move", () => {
  it("is empty on a task nobody has started", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "לבדוק מול הסוכן" });
    expect(task.startedAt).toBeNull();
  });

  it("is written the first time the task leaves OPEN", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "לתאם שליח" });

    const started = await updateTask(actor, task.id, { status: "IN_PROGRESS" });
    expect(started.startedAt).not.toBeNull();
  });

  it("is written even when a task jumps straight to DONE", async () => {
    // Plenty of work is finished in the same gesture it is recorded in,
    // and a task with a completion and no start would make cycle time
    // unanswerable for exactly the quickest jobs.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "שיחה אחת" });

    const done = await updateTask(actor, task.id, { status: "DONE" });
    expect(done.startedAt).not.toBeNull();
    expect(done.completedAt).not.toBeNull();
  });

  it("keeps the ORIGINAL start when a finished task is reopened", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "החזרה לספק" });

    const started = await updateTask(actor, task.id, { status: "IN_PROGRESS" });
    await updateTask(actor, task.id, { status: "DONE" });
    const reopened = await updateTask(actor, task.id, { status: "IN_PROGRESS" });

    // A second start date would silently shorten every cycle-time number
    // that reads this column.
    expect(reopened.startedAt?.getTime()).toBe(started.startedAt?.getTime());
    expect(reopened.completedAt).toBeNull();
  });

  it("is cleared only by going all the way back to OPEN", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "הוקפא" });

    await updateTask(actor, task.id, { status: "IN_PROGRESS" });
    const back = await updateTask(actor, task.id, { status: "OPEN" });
    expect(back.startedAt).toBeNull();
  });

  it("does not move when something unrelated is edited", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "כותרת ראשונה" });
    const started = await updateTask(actor, task.id, { status: "IN_PROGRESS" });

    const renamed = await updateTask(actor, task.id, { title: "כותרת אחרת" });
    expect(renamed.startedAt?.getTime()).toBe(started.startedAt?.getTime());
  });

  it("leaves an archived task's completion date alone", async () => {
    // Archiving finished work does not unfinish it.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "לארכיון" });
    const done = await updateTask(actor, task.id, { status: "DONE" });

    const archived = await updateTask(actor, task.id, { status: "ARCHIVED" });
    expect(archived.completedAt?.getTime()).toBe(done.completedAt?.getTime());
  });
});

describe("description and priority", () => {
  it("round-trip through create and update, and a blank clears the description", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);

    const task = await createTask(actor, {
      clientId: client.id,
      title: "חידוש ביטוח",
      description: "פוליסה 442-19, לדבר עם רונית",
      priority: "HIGH",
    });
    expect(task.description).toBe("פוליסה 442-19, לדבר עם רונית");
    expect(task.priority).toBe("HIGH");

    const cleared = await updateTask(actor, task.id, { description: "   " });
    expect(cleared.description).toBeNull();
  });

  it("defaults to NORMAL rather than to nothing", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "רגילה" });
    expect(task.priority).toBe("NORMAL");
  });

  it("sorts urgent work above an earlier deadline within the same status", async () => {
    // Priority above dueDate is the deliberate order: a date says when
    // somebody wrote a date down, a priority says what a person decided.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);

    await createTask(actor, {
      clientId: client.id,
      title: "רגילה עם תאריך קרוב",
      dueDate: new Date("2026-09-25T20:59:00Z"),
    });
    await createTask(actor, {
      clientId: client.id,
      title: "דחופה בלי תאריך",
      priority: "URGENT",
    });

    const list = await listTasks(actor, {});
    expect(list[0].title).toBe("דחופה בלי תאריך");
  });

  it("filters to a priority floor rather than an exact value", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "נמוכה", priority: "LOW" });
    await createTask(actor, { clientId: client.id, title: "גבוהה", priority: "HIGH" });
    await createTask(actor, { clientId: client.id, title: "דחופה", priority: "URGENT" });

    const list = await listTasks(actor, { minPriority: "HIGH" });
    expect(list.map((t) => t.title).sort()).toEqual(["גבוהה", "דחופה"]);
  });
});

describe("getTaskDetail", () => {
  it("returns null for a client this person cannot reach, not a throw", async () => {
    // The screen renders the same not-found for a missing task and for
    // someone else's client. Telling the two apart would confirm that a
    // task exists on a client this person has no access to.
    const clientA = await createTestClient();
    const clientB = await createTestClient();
    const owner = await employeeOn(clientA.id);
    const stranger = await employeeOn(clientB.id);

    const task = await createTask(owner, { clientId: clientA.id, title: "פרטי" });

    await expect(getTaskDetail(stranger, task.id)).resolves.toBeNull();
    await expect(getTaskDetail(stranger, "does-not-exist")).resolves.toBeNull();
  });

  it("rolls up reported hours by person, and says when a timer is still running", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const category = await createTestCategory();
    const task = await createTask(actor, { clientId: client.id, categoryId: category.id, title: "עם שעות" });

    const first = await startTimer(actor, { clientId: client.id, categoryId: category.id, taskId: task.id });
    await stopTimer(actor, first.id);
    // A second, left running: its seconds do not exist until the stop, so
    // it must be counted as an entry and contribute nothing to the total.
    await startTimer(actor, { clientId: client.id, categoryId: category.id, taskId: task.id });

    const detail = await getTaskDetail(actor, task.id);
    expect(detail).not.toBeNull();
    expect(detail!.time.entryCount).toBe(2);
    expect(detail!.time.runningCount).toBe(1);
    expect(detail!.time.byUser).toHaveLength(1);
    expect(detail!.time.byUser[0].userId).toBe(actor.id);
  });

  it("reads the history the audit log has been writing all along", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "לתעד" });
    await updateTask(actor, task.id, { priority: "URGENT" });

    const detail = await getTaskDetail(actor, task.id);
    // Newest first: the priority change, then the creation. Read off the
    // thread's event entries now that comments and files share the list.
    const events = detail!.thread.filter((e) => e.kind === "event");
    expect(events[0].changed).toContain("עדיפות");
    expect(events[events.length - 1].label).toBe("המשימה נפתחה");
  });

  it("names the field that changed and not the columns the server moved", async () => {
    // `startedAt` and `completedAt` move as a consequence of somebody
    // else's change. A history line that listed them would be telling a
    // person about bookkeeping instead of about a decision.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "מעבר" });
    await updateTask(actor, task.id, { status: "DONE" });

    const detail = await getTaskDetail(actor, task.id);
    const events = detail!.thread.filter((e) => e.kind === "event");
    expect(events[0].changed).toEqual(["סטטוס"]);
  });
});

describe("the audit action stays queryable", () => {
  it("still records a plain status change as task.status_change", async () => {
    // `updateTask` now writes `startedAt` alongside a status change, so
    // naming the action off the RESULTING data would have turned every
    // status change into a generic "task.update" - the exact query the
    // audit log was promised to keep answering, and the one the new
    // history panel reads.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "סטטוס בלבד" });
    await updateTask(actor, task.id, { status: "IN_PROGRESS" });

    const events = await prisma.auditEvent.findMany({
      where: { entityType: "Task", entityId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(events[0].action).toBe("task.status_change");
  });

  it("records a multi-field change as task.update", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "כמה שדות" });
    await updateTask(actor, task.id, { status: "IN_PROGRESS", priority: "HIGH" });

    const events = await prisma.auditEvent.findMany({
      where: { entityType: "Task", entityId: task.id },
      orderBy: { createdAt: "desc" },
    });
    expect(events[0].action).toBe("task.update");
  });
});
