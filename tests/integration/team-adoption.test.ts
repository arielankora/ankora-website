import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import {
  NO_OUTCOME_MESSAGE,
  listMyOpenTasks,
  listOpenPromises,
  stalledPromisesByClient,
  updateTask,
} from "@/lib/app-domain/tasks";
import { getPortalTimeline } from "@/lib/app-domain/client-portal";
import { buildSummaryDraft, monthRange } from "@/lib/app-domain/portal-summary";

// Team adoption ("אימוץ בצוות").
//
// The mechanisms are mostly screens, and screens are the browser suite's
// job. What belongs here is the one rule that refuses a write, and the
// three queries the screens are only as correct as.
//
// The rule is the interesting half. Every other portal field in this
// product is optional by design - a task can be invisible, untitled for
// the client, with no supplier recorded - and this is the single place
// where the domain says no. So the tests below spend most of their time
// on the ways a promise could reach the client's screen marked done with
// nothing to show for it, because each of those is a way the portal goes
// back to being a list of titles.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

async function seedTask(
  clientId: string,
  overrides: {
    title?: string;
    clientVisible?: boolean;
    status?: "OPEN" | "IN_PROGRESS" | "DONE";
    clientOutcome?: string | null;
    clientTitle?: string | null;
    assignedToId?: string | null;
    dueDate?: Date | null;
    updatedAt?: Date;
    completedAt?: Date | null;
  } = {}
) {
  const task = await prisma.task.create({
    data: {
      clientId,
      title: overrides.title ?? "משימה",
      status: overrides.status ?? "OPEN",
      clientVisible: overrides.clientVisible ?? false,
      clientTitle: overrides.clientTitle ?? null,
      clientOutcome: overrides.clientOutcome ?? null,
      assignedToId: overrides.assignedToId ?? null,
      dueDate: overrides.dueDate ?? null,
      completedAt: overrides.completedAt ?? null,
    },
  });
  // `updatedAt` is @updatedAt, so it cannot be set through create. The
  // staleness tests need a row that has genuinely not moved, and the
  // only honest way to get one in a test is to write the column.
  if (overrides.updatedAt) {
    await prisma.$executeRaw`UPDATE "tasks" SET "updatedAt" = ${overrides.updatedAt} WHERE "id" = ${task.id}`;
  }
  return task;
}

describe("the definition of done", () => {
  it("refuses to close a promise the client can see without saying what came of it", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await seedTask(client.id, { clientVisible: true, status: "IN_PROGRESS" });

    await expect(updateTask(actor, task.id, { status: "DONE" })).rejects.toThrow(NO_OUTCOME_MESSAGE);

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status, "the refusal must not half-apply").toBe("IN_PROGRESS");
    expect(after.completedAt).toBeNull();
  });

  it("closes when the sentence comes with it, and records when it closed", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await seedTask(client.id, { clientVisible: true, status: "IN_PROGRESS" });

    const before = Date.now();
    const updated = await updateTask(actor, task.id, {
      status: "DONE",
      clientOutcome: "קבענו את הביקור ליום שלישי, והטכנאי אישר.",
    });

    expect(updated.status).toBe("DONE");
    expect(updated.clientOutcome).toBe("קבענו את הביקור ליום שלישי, והטכנאי אישר.");
    expect(updated.completedAt).not.toBeNull();
    expect(updated.completedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("refuses whitespace, which is the obvious way around a required field", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await seedTask(client.id, { clientVisible: true, status: "IN_PROGRESS" });

    await expect(updateTask(actor, task.id, { status: "DONE", clientOutcome: "   " })).rejects.toThrow(
      NO_OUTCOME_MESSAGE
    );
  });

  it("refuses the same state reached from the other direction: showing a closed task to the client", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    // Closed while internal, so no outcome was ever required.
    const task = await seedTask(client.id, { clientVisible: false, status: "DONE" });

    await expect(updateTask(actor, task.id, { clientVisible: true })).rejects.toThrow(NO_OUTCOME_MESSAGE);

    // And with a sentence, the same patch is fine.
    const updated = await updateTask(actor, task.id, {
      clientVisible: true,
      clientOutcome: "הוזמן וסופק.",
    });
    expect(updated.clientVisible).toBe(true);
  });

  it("does not stand in the way of an internal task", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await seedTask(client.id, { clientVisible: false, status: "OPEN" });

    const updated = await updateTask(actor, task.id, { status: "DONE" });
    expect(updated.status).toBe("DONE");
    // The column still moves: it is the moment work finished, not a
    // portal field, and an internal task that is later shown to a client
    // should not claim it closed the day it was shown.
    expect(updated.completedAt).not.toBeNull();
  });

  it("clears the completion date when work is reopened", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await seedTask(client.id, { clientVisible: true, status: "IN_PROGRESS" });
    await updateTask(actor, task.id, { status: "DONE", clientOutcome: "נסגר." });

    const reopened = await updateTask(actor, task.id, { status: "IN_PROGRESS" });
    expect(reopened.completedAt, "a reopened promise has no completion date").toBeNull();
    // The sentence survives: it was true when it was written, and making
    // someone retype it to reopen a task is how a person learns to leave
    // things closed.
    expect(reopened.clientOutcome).toBe("נסגר.");
  });

  it("keeps the completion date when finished work is archived", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await seedTask(client.id, { clientVisible: true, status: "IN_PROGRESS" });
    const done = await updateTask(actor, task.id, { status: "DONE", clientOutcome: "נסגר." });

    const archived = await updateTask(actor, task.id, { status: "ARCHIVED" });
    expect(archived.completedAt?.getTime()).toBe(done.completedAt?.getTime());
  });
});

describe("what the client reads", () => {
  it("shows the outcome on the promise, and dates it by when it closed", async () => {
    const client = await createTestClient();
    const { user: portalUser } = await createTestUser({ role: "CLIENT_USER" });
    await prisma.clientUser.create({ data: { userId: portalUser.id, clientId: client.id, role: "ADMIN" } });

    const actor = await employeeOn(client.id);
    const task = await seedTask(client.id, {
      clientVisible: true,
      status: "IN_PROGRESS",
      clientTitle: "הזמנת הטכנאי",
    });
    await updateTask(actor, task.id, { status: "DONE", clientOutcome: "הטכנאי הגיע ביום שלישי וסיים." });

    // A later edit that has nothing to do with finishing the work. This
    // is exactly what used to re-date a finished promise to today.
    await updateTask(actor, task.id, { clientTitle: "הזמנת הטכנאי (תוקן)" });

    const timeline = await getPortalTimeline(portalUser);
    const shown = timeline.promises.find((p) => p.id === task.id);
    expect(shown?.outcome).toBe("הטכנאי הגיע ביום שלישי וסיים.");

    const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(shown?.movedAt.getTime(), "dated by the close, not by the last edit").toBe(stored.completedAt?.getTime());
    expect(shown?.movedAt.getTime()).not.toBe(stored.updatedAt.getTime());
  });

  it("builds the monthly summary out of outcomes rather than titles", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await seedTask(client.id, {
      clientVisible: true,
      status: "IN_PROGRESS",
      clientTitle: "טיפול במזגן",
    });
    await updateTask(actor, task.id, {
      status: "DONE",
      clientOutcome: "המזגן תוקן והוחלף בו הפילטר.",
    });

    const { periodStart, periodEnd } = monthRange(new Date());
    const draft = await buildSummaryDraft(client.id, periodStart, periodEnd);

    expect(draft.text).toContain("המזגן תוקן והוחלף בו הפילטר.");
    expect(draft.text, "the title is what it was called, not what happened").not.toContain("טיפול במזגן");
    expect(draft.sourceTaskIds).toContain(task.id);
  });
});

describe("the three queries the screens rest on", () => {
  it("offers the timer only open promises, on clients the person can reach", async () => {
    const mine = await createTestClient();
    const someoneElses = await createTestClient();
    const actor = await employeeOn(mine.id);

    const open = await seedTask(mine.id, { clientVisible: true, status: "IN_PROGRESS", title: "פתוחה" });
    await seedTask(mine.id, { clientVisible: false, status: "OPEN", title: "פנימית" });
    await seedTask(mine.id, { clientVisible: true, status: "DONE", clientOutcome: "נגמר", title: "סגורה" });
    await seedTask(someoneElses.id, { clientVisible: true, status: "OPEN", title: "לקוח אחר" });

    const promises = await listOpenPromises(actor);
    expect(promises.map((p) => p.id)).toEqual([open.id]);
  });

  it("marks a promise stale only once it has been still for a day, and never an internal task", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const twoDaysAgo = new Date(Date.now() - 48 * 3600_000);

    const stale = await seedTask(client.id, {
      clientVisible: true,
      assignedToId: actor.id,
      title: "ישנה",
      updatedAt: twoDaysAgo,
    });
    const fresh = await seedTask(client.id, { clientVisible: true, assignedToId: actor.id, title: "טרייה" });
    const internal = await seedTask(client.id, {
      clientVisible: false,
      assignedToId: actor.id,
      title: "פנימית ישנה",
      updatedAt: twoDaysAgo,
    });
    // Somebody else's row, on a client this person can see.
    const other = await employeeOn(client.id);
    await seedTask(client.id, { clientVisible: true, assignedToId: other.id, title: "של מישהו אחר" });

    const rows = await listMyOpenTasks(actor);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(rows).toHaveLength(3);
    expect(byId.get(stale.id)?.stale).toBe(true);
    expect(byId.get(fresh.id)?.stale).toBe(false);
    expect(byId.get(internal.id)?.stale, "an internal task has no client waiting on it").toBe(false);
  });

  it("counts stalled promises per client, and leaves out what moved", async () => {
    const quiet = await createTestClient({ name: "שקט" });
    const busy = await createTestClient({ name: "עסוק" });
    const actor = await employeeOn(quiet.id);
    await prisma.userClientAccess.create({ data: { userId: actor.id, clientId: busy.id } });

    const yesterday = new Date(Date.now() - 30 * 3600_000);
    const since = new Date(Date.now() - 12 * 3600_000);

    await seedTask(quiet.id, { clientVisible: true, updatedAt: yesterday });
    await seedTask(busy.id, { clientVisible: true, updatedAt: yesterday });
    await seedTask(busy.id, { clientVisible: true, updatedAt: yesterday });
    // Moved since the cutoff, so it is not stalled.
    await seedTask(busy.id, { clientVisible: true });
    // Internal, and closed - neither is a promise anyone is waiting on.
    await seedTask(busy.id, { clientVisible: false, updatedAt: yesterday });
    await seedTask(busy.id, { clientVisible: true, status: "DONE", clientOutcome: "נגמר", updatedAt: yesterday });

    const rows = await stalledPromisesByClient(actor, since);
    expect(rows.map((r) => [r.clientName, r.count])).toEqual([
      ["עסוק", 2],
      ["שקט", 1],
    ]);
  });

  it("shows a person nothing from a client they were never given", async () => {
    const theirs = await createTestClient();
    const actor = await employeeOn(theirs.id);
    const elsewhere = await createTestClient();
    await seedTask(elsewhere.id, { clientVisible: true, assignedToId: actor.id, title: "לא שלהם" });

    // Assigned to them, on a client they cannot reach: the assignment is
    // a dead letter, and neither query should surface it.
    expect(await stalledPromisesByClient(actor, new Date())).toEqual([]);
    expect(await listOpenPromises(actor)).toEqual([]);
    expect(await listMyOpenTasks(actor), "an assignment survives losing access to the client").toEqual([]);
  });
});
