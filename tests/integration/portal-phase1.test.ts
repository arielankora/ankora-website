import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser, createTestUser, createTestCategory } from "./factories";
import { getPortalHome, getPortalTimeline } from "@/lib/app-domain/client-portal";
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
  } = {}
) {
  return prisma.task.create({
    data: {
      clientId,
      title: overrides.title ?? "Internal shorthand",
      clientTitle: overrides.clientTitle ?? null,
      clientVisible: overrides.clientVisible ?? true,
      status: overrides.status ?? "OPEN",
      waitingOnClientSince: overrides.waitingOnClientSince ?? null,
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
    expect(created.waitingOnClientSince).toBeNull();

    const waiting = await updateTask(admin, created.id, { waitingOnClientSince: new Date() });
    expect(waiting.waitingOnClientSince).not.toBeNull();

    // An absent key must not blank a field - the patch contract the whole
    // task module rests on.
    const untouched = await updateTask(admin, created.id, { title: "Internal, renamed" });
    expect(untouched.clientVisible).toBe(true);
    expect(untouched.clientTitle).toBe("מה שהלקוח רואה");
    expect(untouched.waitingOnClientSince).not.toBeNull();

    const cleared = await updateTask(admin, created.id, { clientTitle: null, waitingOnClientSince: null });
    expect(cleared.clientTitle).toBeNull();
    expect(cleared.waitingOnClientSince).toBeNull();
  });

  it("defaults a new task to invisible", async () => {
    const client = await createTestClient({ name: "Client Default" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });

    const created = await createTask(admin, { clientId: client.id, title: "Just internal" });

    expect(created.clientVisible).toBe(false);
  });
});
