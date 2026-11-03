import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser, createTestUser, createTestCategory } from "./factories";
import { getPortalHome, getPortalTimeline, getWeeklyActivity, GENERAL_ACTIVITY_LABEL } from "@/lib/app-domain/client-portal";
import { createTask, updateTask } from "@/lib/app-domain/tasks";

// Portal phase 1. What a client may see is now decided per task, so the
// tests that matter are the ones about what does NOT appear: a task
// nobody opted in, another client's task, an archived one. The isolation
// itself is resolvePortalClient's and covered in portal-phase0; here it
// is the visibility filter that is new and easy to get wrong.

async function seedTask(
  clientId: string,
  overrides: {
    title?: string;
    clientTitle?: string | null;
    clientVisible?: boolean;
    status?: "OPEN" | "IN_PROGRESS" | "DONE" | "ARCHIVED";
    waitingOnClientSince?: Date | null;
    completedAt?: Date | null;
    parentId?: string;
  } = {}
) {
  return prisma.task.create({
    data: {
      clientId,
      title: overrides.title ?? "Internal shorthand",
      clientTitle: overrides.clientTitle ?? null,
      clientVisible: overrides.clientVisible ?? true,
      status: overrides.status ?? "OPEN",
      blockedOn: overrides.waitingOnClientSince ? "CLIENT" : null,
      blockedSince: overrides.waitingOnClientSince ?? null,
      completedAt: overrides.completedAt ?? null,
      parentId: overrides.parentId ?? null,
    },
  });
}

describe("getPortalHome()", () => {
  it("shows only tasks opted in for this client", async () => {
    const client = await createTestClient({ name: "Client Visible" });
    const other = await createTestClient({ name: "Client Other" });
    const { user } = await createTestClientUser({ clientId: client.id });

    await seedTask(client.id, { title: "Shown", clientVisible: true });
    await seedTask(client.id, { title: "Internal only", clientVisible: false });
    await seedTask(other.id, { title: "Someone else's", clientVisible: true });

    const home = await getPortalHome(user);

    expect(home.inProgress.map((p) => p.title)).toEqual(["Shown"]);
    expect(home.waitingOnClient).toHaveLength(0);
  });

  it("prefers the client-facing title and falls back to the internal one", async () => {
    const client = await createTestClient({ name: "Client Titles" });
    const { user } = await createTestClientUser({ clientId: client.id });

    await seedTask(client.id, { title: "לבדוק מול הסוכן שוב", clientTitle: "חידוש ביטוח הרכב" });
    await seedTask(client.id, { title: "תיאום מול ספק תחזוקה", clientTitle: "   " });

    const { promises } = await getPortalTimeline(user);
    const titles = promises.map((p) => p.title).sort();

    expect(titles).toEqual(["חידוש ביטוח הרכב", "תיאום מול ספק תחזוקה"].sort());
  });

  // The stage is derived rather than stored, so these four cases are the
  // contract: three come from status, and only "waiting on the client"
  // has a column of its own - and it wins, because a task can be in
  // progress internally and still be blocked on an answer.
  it("derives the four client stages, with waiting winning over the internal status", async () => {
    const client = await createTestClient({ name: "Client Stages" });
    const { user } = await createTestClientUser({ clientId: client.id });

    await seedTask(client.id, { title: "Received", status: "OPEN" });
    await seedTask(client.id, { title: "Working", status: "IN_PROGRESS" });
    await seedTask(client.id, { title: "Finished", status: "DONE" });
    await seedTask(client.id, {
      title: "Blocked",
      status: "IN_PROGRESS",
      waitingOnClientSince: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });

    const { promises } = await getPortalTimeline(user);
    const byTitle = Object.fromEntries(promises.map((p) => [p.title, p.stage]));

    expect(byTitle).toEqual({
      Received: "RECEIVED",
      Working: "IN_PROGRESS",
      Finished: "DONE",
      Blocked: "WAITING_ON_CLIENT",
    });

    const home = await getPortalHome(user);
    expect(home.waitingOnClient.map((p) => p.title)).toEqual(["Blocked"]);
    expect(home.recentlyDone.map((p) => p.title)).toEqual(["Finished"]);
    expect(home.inProgress.map((p) => p.title).sort()).toEqual(["Received", "Working"]);
  });

  // ARCHIVED is Ankora's "this stopped being relevant". A client reading
  // it about their own request would hear "we dropped it".
  it("never shows an archived task, even when it is opted in", async () => {
    const client = await createTestClient({ name: "Client Archived" });
    const { user } = await createTestClientUser({ clientId: client.id });

    await seedTask(client.id, { title: "Dropped", status: "ARCHIVED", clientVisible: true });

    const home = await getPortalHome(user);
    const { promises } = await getPortalTimeline(user);

    expect(home.inProgress).toHaveLength(0);
    expect(promises).toHaveLength(0);
  });

  it("reports the current cycle as a single line, or nothing when none exists", async () => {
    const client = await createTestClient({ name: "Client No Cycle" });
    const { user } = await createTestClientUser({ clientId: client.id });

    const home = await getPortalHome(user);
    expect(home.cycle).toBeNull();
  });
});

describe("task portal fields", () => {
  it("round-trips through createTask and updateTask", async () => {
    const client = await createTestClient({ name: "Client Fields" });
    const category = await createTestCategory({ clientId: client.id, name: "Category Fields" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });

    const created = await createTask(admin, {
      clientId: client.id,
      categoryId: category.id,
      title: "Internal",
      clientVisible: true,
      clientTitle: "מה שהלקוח רואה",
    });

    expect(created.clientVisible).toBe(true);
    expect(created.clientTitle).toBe("מה שהלקוח רואה");
    expect(created.blockedOn).toBeNull();

    const waiting = await updateTask(admin, created.id, { block: { on: "CLIENT" } });
    expect(waiting.blockedOn).toBe("CLIENT");
    expect(waiting.blockedSince).not.toBeNull();

    // An absent key must not blank a field - the patch contract the whole
    // task module rests on.
    const untouched = await updateTask(admin, created.id, { title: "Internal, renamed" });
    expect(untouched.clientVisible).toBe(true);
    expect(untouched.clientTitle).toBe("מה שהלקוח רואה");
    expect(untouched.blockedOn).toBe("CLIENT");

    const cleared = await updateTask(admin, created.id, { clientTitle: null, block: null });
    expect(cleared.clientTitle).toBeNull();
    expect(cleared.blockedOn).toBeNull();
    expect(cleared.blockedSince).toBeNull();
  });

  it("defaults a new task to invisible", async () => {
    const client = await createTestClient({ name: "Client Default" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });

    const created = await createTask(admin, { clientId: client.id, title: "Just internal" });

    expect(created.clientVisible).toBe(false);
  });
});

// 3.11.2026, Hadas's review of the client screen.
describe("getPortalHome() - the month's summary", () => {
  it("lists this month's finished promises and leaves out last month's and hidden ones", async () => {
    const client = await createTestClient({ name: "Client Month" });
    const { user } = await createTestClientUser({ clientId: client.id });
    const lastMonth = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

    await seedTask(client.id, { title: "Closed now", status: "DONE", completedAt: new Date() });
    await seedTask(client.id, { title: "Closed long ago", status: "DONE", completedAt: lastMonth });
    await seedTask(client.id, { title: "Closed, internal", status: "DONE", completedAt: new Date(), clientVisible: false });

    const home = await getPortalHome(user);

    expect(home.month.done.map((p) => p.title)).toEqual(["Closed now"]);
    // A client is never told about tasks they cannot see.
    expect(home.month.hiddenDone).toBe(0);
    expect(JSON.stringify(home)).not.toContain("Closed, internal");
  });

  it("rolls a subtask's hours into its top-level promise", async () => {
    const client = await createTestClient({ name: "Client Hours" });
    const category = await createTestCategory({ clientId: client.id, name: "שכר" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user } = await createTestClientUser({ clientId: client.id });

    const parent = await seedTask(client.id, { title: "Payroll", status: "IN_PROGRESS" });
    const step = await seedTask(client.id, { title: "step", parentId: parent.id, clientVisible: false });
    const start = new Date();
    for (const [taskId, seconds] of [[parent.id, 1800], [step.id, 900]] as const) {
      await prisma.timeEntry.create({
        data: {
          userId: employee.id,
          clientId: client.id,
          categoryId: category.id,
          taskId,
          startAt: start,
          endAt: new Date(start.getTime() + seconds * 1000),
          actualSeconds: seconds,
          billableSeconds: seconds,
        },
      });
    }

    const home = await getPortalHome(user);
    expect(home.month.minutesByTask[parent.id]).toBe(45);
  });
});

describe("hours rows - the name a client reads (3.11.2026)", () => {
  it("never names a row by a task the client cannot see", async () => {
    const client = await createTestClient({ name: "Client Names" });
    const category = await createTestCategory({ clientId: client.id, name: "ניהול" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user } = await createTestClientUser({ clientId: client.id });

    const internal = await seedTask(client.id, { title: "ורטו - חוב", clientVisible: false });
    const visible = await seedTask(client.id, { title: "תיאום ספק", clientTitle: "חידוש חוזה הניקיון" });
    const step = await seedTask(client.id, { title: "להציע לנדב רעיון אחד", parentId: visible.id, clientVisible: false });
    const now = new Date();
    for (const taskId of [internal.id, visible.id, step.id]) {
      await prisma.timeEntry.create({
        data: {
          userId: employee.id,
          clientId: client.id,
          categoryId: category.id,
          taskId,
          startAt: now,
          endAt: new Date(now.getTime() + 600_000),
          actualSeconds: 600,
          billableSeconds: 600,
        },
      });
    }

    const week = await getWeeklyActivity(user, now);
    const names = week.rows.map((r) => r.activity).sort();

    expect(names).toEqual([GENERAL_ACTIVITY_LABEL, "חידוש חוזה הניקיון", "חידוש חוזה הניקיון"].sort());
    expect(JSON.stringify(week)).not.toContain("ורטו");
    expect(JSON.stringify(week)).not.toContain("לנדב");
    // Grouped with its category, so the same label in two categories is
    // two lines, never one mixed line.
    expect(week.topActivities.every((a) => a.category === "ניהול")).toBe(true);
  });
});
