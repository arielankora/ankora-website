import { describe, expect, it, afterEach } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { openOnboardingTask, resolveInternalClient } from "@/lib/app-domain/employee-lifecycle";

// Which client is Ankora's own, and what breaks when the answer is wrong.
//
// `Client.isInternal` was added on 9.10.2026 with its own migration and a
// checkbox on the client screen. resolveInternalClient did not look at
// it: it asked the environment, and then matched the exact Hebrew name.
// So the question had two answers that could disagree, and the two
// callers that most depend on being right were on the wrong one.
//
// The failure is silent, which is what makes it worth a test rather than
// a comment. openOnboardingTask catches its own error and returns null,
// so renaming the internal client in the UI would stop producing a
// checklist for every new employee, and the only trace would be a line
// in a log nobody reads. It has in fact been in every CI run for weeks,
// for the neighbouring reason that no seed created the client at all.

const NAME = "Ankora פנימי";
const ENV = "INTERNAL_CLIENT_ID";

afterEach(() => {
  delete process.env[ENV];
});

async function internal(over: { name?: string; isInternal?: boolean; status?: "ACTIVE" | "ARCHIVED" } = {}) {
  return prisma.client.create({
    data: {
      name: over.name ?? NAME,
      status: over.status ?? "ACTIVE",
      isInternal: over.isInternal ?? true,
    },
  });
}

describe("resolveInternalClient()", () => {
  it("finds it by the flag, whatever it is called", async () => {
    // The case the product actually offers: somebody ticked the box on
    // the client screen, and then renamed the client.
    const row = await internal({ name: "Ankora Internal (HQ)" });
    expect((await resolveInternalClient())?.id).toBe(row.id);
  });

  it("still finds it by name when nobody ever set the flag", async () => {
    // Every database that predates the migration, and the fallback the
    // employee lifecycle has always used.
    const row = await internal({ isInternal: false });
    expect((await resolveInternalClient())?.id).toBe(row.id);
  });

  it("lets the environment override both", async () => {
    await internal({ name: "Ankora Internal (HQ)" });
    const named = await createTestClient({ name: "אחר" });
    process.env[ENV] = named.id;
    expect((await resolveInternalClient())?.id).toBe(named.id);
  });

  it("falls through when the environment names something that is not there", async () => {
    // A stale id in the environment must not take the lifecycle down
    // with it; the flag is still a true answer.
    const row = await internal({ name: "Ankora Internal (HQ)" });
    process.env[ENV] = "clxxxxxxxxxxxxxxxxxxxxxxxx";
    expect((await resolveInternalClient())?.id).toBe(row.id);
  });

  it("refuses an archived or deleted one rather than returning it", async () => {
    // A task on an archived client is invisible to everyone it is meant
    // for, so "not found" is the honest answer and the caller reports it.
    const archived = await internal({ status: "ARCHIVED" });
    expect(await resolveInternalClient()).toBeNull();

    await prisma.client.update({ where: { id: archived.id }, data: { status: "ACTIVE", deletedAt: new Date() } });
    expect(await resolveInternalClient()).toBeNull();
  });

  it("gives the same answer every time when two rows carry the flag", async () => {
    // Two internal clients is a misconfiguration. An answer that moves
    // between calls is worse than one that is arguably the wrong half of
    // a pair, because nothing downstream can be reasoned about.
    const first = await internal({ name: "Ankora פנימי" });
    await new Promise((r) => setTimeout(r, 5));
    await internal({ name: "Ankora Internal (second)" });

    const answers = [await resolveInternalClient(), await resolveInternalClient(), await resolveInternalClient()];
    expect(answers.map((a) => a?.id)).toEqual([first.id, first.id, first.id]);
  });

  it("returns nothing when there is no internal client, instead of any client", async () => {
    await createTestClient({ name: "לקוח רגיל" });
    expect(await resolveInternalClient()).toBeNull();
  });
});

describe("the onboarding checklist", () => {
  it("opens on the internal client found by the flag", async () => {
    // The half that matters: not that the lookup returns a row, but that
    // the checklist a new employee depends on actually gets written.
    const client = await internal({ name: "Ankora Internal (HQ)" });
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    await prisma.userClientAccess.create({ data: { userId: admin.id, clientId: client.id } });
    const { user: joiner } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    const taskId = await openOnboardingTask(admin, joiner);

    expect(taskId, "no onboarding task was opened").toBeTruthy();
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId! } });
    expect(task.clientId).toBe(client.id);
    expect(task.title).toContain(joiner.name);
    // The checklist is the point, not the parent row.
    const steps = await prisma.task.findMany({ where: { parentId: task.id } });
    expect(steps.length).toBeGreaterThan(1);
  });

  it("writes nothing and says so when there is no internal client", async () => {
    // Today's behaviour, asserted rather than assumed: it swallows the
    // failure and records it. That is why renaming the client is silent,
    // and why the test above exists.
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const { user: joiner } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    expect(await openOnboardingTask(admin, joiner)).toBeNull();

    const failures = await prisma.auditEvent.findMany({
      where: { action: "employee_lifecycle.trigger_failed", entityId: joiner.id },
    });
    expect(failures, "the failure left no trace at all").toHaveLength(1);
  });
});
