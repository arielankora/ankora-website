import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createTask } from "@/lib/app-domain/tasks";
import { createImportantDate } from "@/lib/app-domain/important-dates";
import { loadCalendar, OVERDUE_LIMIT, UNDATED_LIMIT } from "@/lib/app-domain/calendar";
import { dayStartInZone } from "@/lib/timezone";

// The calendar screen's data (/app/calendar), against a real database.
//
// Written 25.10.2026, because the weekly coverage check reported
// lib/app-domain/calendar.ts as 0 of 6 functions ever executed by a test.
// The screen went in across five pull requests in October, one of which
// added dragging a task to change its due date, which is a write. Nothing
// in this repo had ever run the code that loads it.
//
// What is worth holding, in the order the file's own comments raise it:
//
// - **A due date is stored two ways** and both must land on the same day.
//   The task screen writes UTC midnight of the local day; the MCP server
//   writes 23:59 local. On an Israel day those are different instants and
//   the same date, and the calendar only ever hands out day keys.
// - **"Overdue" starts before today**, in Israel. A task due today is not
//   late, and the boundary is computed as one millisecond before the
//   start of the local day, which is exactly where an off-by-one lives.
// - **Overdue reaches outside the range on screen.** That list exists
//   because a task that slipped last week was on no screen at all.
// - **Nothing crosses a client the actor cannot reach**, including when
//   the caller names one in `clientId`.

const JERUSALEM_DAY = "2026-03-11";

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

/// Midnight of a local day, the way the task screen stores a due date.
const atLocalMidnight = (key: string) => dayStartInZone(key)!;

/// 23:59 local on the same day, the way the MCP server stores one.
const atLocalEndOfDay = (key: string) => new Date(dayStartInZone(key)!.getTime() + 23 * 3600_000 + 59 * 60_000);

const view = (over: Partial<Parameters<typeof loadCalendar>[1]> = {}) =>
  ({ view: "month", date: JERUSALEM_DAY, show: "all", mine: "all", today: JERUSALEM_DAY, ...over }) as Parameters<
    typeof loadCalendar
  >[1];

describe("loadCalendar()", () => {
  it("puts both ways of storing a due date on the same day", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "מהמסך", dueDate: atLocalMidnight(JERUSALEM_DAY) });
    await createTask(actor, { clientId: client.id, title: "מ-MCP", dueDate: atLocalEndOfDay(JERUSALEM_DAY) });

    const data = await loadCalendar(actor, view());

    const keys = data.tasks.map((t) => t.dueKey);
    expect(keys, "the two instants did not land on the same Israel day").toEqual([JERUSALEM_DAY, JERUSALEM_DAY]);
    expect(data.tasks.map((t) => t.title).sort()).toEqual(["מ-MCP", "מהמסך"].sort());
  });

  it("does not call a task due today late, and does call yesterday's", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "היום", dueDate: atLocalMidnight(JERUSALEM_DAY) });
    // Late in the evening of the previous day, the side of the boundary
    // that a day computed in UTC would put on the wrong side.
    await createTask(actor, { clientId: client.id, title: "אתמול", dueDate: atLocalEndOfDay("2026-03-10") });

    const data = await loadCalendar(actor, view());

    expect(data.overdue.map((t) => t.title)).toEqual(["אתמול"]);
    expect(data.overdueTotal).toBe(1);
  });

  it("lists a task that slipped before the range on screen", async () => {
    // The reason the drawer exists: a task due last month is on no day
    // this month's grid draws, so without this list it is on no screen.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "מחודש שעבר", dueDate: atLocalMidnight("2026-01-05") });

    const data = await loadCalendar(actor, view());

    expect(data.tasks, "a task outside the range should not be on the grid").toHaveLength(0);
    expect(data.overdue.map((t) => t.title)).toEqual(["מחודש שעבר"]);
  });

  it("puts the longest wait first", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "שבוע", dueDate: atLocalMidnight("2026-03-04") });
    await createTask(actor, { clientId: client.id, title: "חודשיים", dueDate: atLocalMidnight("2026-01-05") });
    await createTask(actor, { clientId: client.id, title: "אתמול", dueDate: atLocalMidnight("2026-03-10") });

    const data = await loadCalendar(actor, view());

    expect(data.overdue.map((t) => t.title)).toEqual(["חודשיים", "שבוע", "אתמול"]);
  });

  it("keeps a task with no due date out of the grid and in its own list", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "בלי תאריך" });

    const data = await loadCalendar(actor, view());

    expect(data.tasks).toHaveLength(0);
    expect(data.undated.map((t) => t.title)).toEqual(["בלי תאריך"]);
    expect(data.undated[0].dueKey).toBeNull();
    expect(data.undatedTotal).toBe(1);
  });

  it("says how many there really are when the list stops at its limit", async () => {
    // A total that was the length of the truncated list would tell the
    // toolbar there is nothing more to see.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    for (let i = 0; i < UNDATED_LIMIT + 3; i += 1) {
      await createTask(actor, { clientId: client.id, title: `משימה ${i}` });
    }

    const data = await loadCalendar(actor, view());

    expect(data.undated).toHaveLength(UNDATED_LIMIT);
    expect(data.undatedTotal).toBe(UNDATED_LIMIT + 3);
    expect(OVERDUE_LIMIT).toBeGreaterThan(0);
  });

  it("shows only what the toolbar asked for", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "משימה", dueDate: atLocalMidnight(JERUSALEM_DAY) });
    await createImportantDate(actor, {
      clientId: client.id,
      title: "מועד",
      type: "פג תוקף רישיון",
      category: "DOCUMENTS_AUTHORITIES",
      month: 3,
      day: 11,
      responsibleUserId: actor.id,
    });

    const both = await loadCalendar(actor, view());
    expect(both.tasks.length, "the task is missing from the default view").toBe(1);
    expect(both.dates.length, "the date is missing from the default view").toBeGreaterThan(0);

    const tasksOnly = await loadCalendar(actor, view({ show: "tasks" }));
    expect(tasksOnly.tasks).toHaveLength(1);
    expect(tasksOnly.dates).toEqual([]);

    const datesOnly = await loadCalendar(actor, view({ show: "dates" }));
    expect(datesOnly.tasks).toEqual([]);
    expect(datesOnly.dates.length).toBeGreaterThan(0);
    // The drawer follows the tasks switch, so it empties with them.
    expect(datesOnly.undated).toEqual([]);
    expect(datesOnly.overdue).toEqual([]);
  });

  it("shows no dates under supervision, because a date has no supervisor", async () => {
    // Ariel, 20.10.2026. A date has a responsible person and
    // participants; "בפיקוח" is a question it cannot answer, so it
    // answers with nothing rather than with everything.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createImportantDate(actor, {
      clientId: client.id,
      title: "מועד",
      type: "פג תוקף רישיון",
      category: "DOCUMENTS_AUTHORITIES",
      month: 3,
      day: 11,
      responsibleUserId: actor.id,
    });

    expect((await loadCalendar(actor, view())).dates.length).toBeGreaterThan(0);
    expect((await loadCalendar(actor, view({ mine: "supervising" }))).dates).toEqual([]);
  });

  it("leaves an archived or paused date off the calendar", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const date = await createImportantDate(actor, {
      clientId: client.id,
      title: "בארכיון",
      type: "פג תוקף רישיון",
      category: "DOCUMENTS_AUTHORITIES",
      month: 3,
      day: 11,
      responsibleUserId: actor.id,
    });

    expect((await loadCalendar(actor, view())).dates.length).toBeGreaterThan(0);
    await prisma.importantDate.update({ where: { id: date.id }, data: { status: "ARCHIVED" } });
    expect((await loadCalendar(actor, view())).dates).toEqual([]);
  });

  it("carries nothing from a client the actor cannot reach", async () => {
    const mine = await createTestClient();
    const theirs = await createTestClient();
    const actor = await employeeOn(mine.id);
    const other = await employeeOn(theirs.id);
    await createTask(actor, { clientId: mine.id, title: "שלי", dueDate: atLocalMidnight(JERUSALEM_DAY) });
    await createTask(other, { clientId: theirs.id, title: "לא שלי", dueDate: atLocalMidnight(JERUSALEM_DAY) });
    await createImportantDate(other, {
      clientId: theirs.id,
      title: "מועד של אחר",
      type: "פג תוקף רישיון",
      category: "DOCUMENTS_AUTHORITIES",
      month: 3,
      day: 11,
      responsibleUserId: other.id,
    });

    const data = await loadCalendar(actor, view());

    expect(data.tasks.map((t) => t.title)).toEqual(["שלי"]);
    expect(data.dates.map((d) => d.title)).toEqual([]);

    // And naming the other client in the filter does not reach it either.
    // `clientId` comes off the address bar, so it is a value the caller
    // chose rather than one the product offered them.
    const named = await loadCalendar(actor, view({ clientId: theirs.id }));
    expect(named.tasks.map((t) => t.title), "a client id from the URL reached another client's tasks").toEqual(["שלי"]);
    expect(named.dates.map((d) => d.title)).toEqual([]);
  });

  it("names the client and the assignee on a row, so the grid needs no second lookup", async () => {
    const client = await createTestClient({ name: "NUX" });
    const actor = await employeeOn(client.id);
    await createTask(actor, {
      clientId: client.id,
      title: "משימה",
      dueDate: atLocalMidnight(JERUSALEM_DAY),
      assignedToId: actor.id,
      priority: "HIGH",
    });

    const [row] = (await loadCalendar(actor, view())).tasks;
    expect(row.clientName).toBe("NUX");
    expect(row.assigneeName).toBe(actor.name);
    expect(row.priority).toBe("HIGH");
    expect(row.clientVisible).toBe(false);
  });

  it("draws the days the view asks for, and a day view draws one", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);

    const month = await loadCalendar(actor, view());
    // Whole weeks, so a month grid is a multiple of seven and covers the
    // whole month.
    expect(month.days.length % 7).toBe(0);
    expect(month.days).toContain(JERUSALEM_DAY);
    expect(month.days).toContain("2026-03-01");
    expect(month.days).toContain("2026-03-31");

    expect((await loadCalendar(actor, view({ view: "day" }))).days).toEqual([JERUSALEM_DAY]);
    expect((await loadCalendar(actor, view({ view: "week" }))).days).toHaveLength(7);
  });
});
