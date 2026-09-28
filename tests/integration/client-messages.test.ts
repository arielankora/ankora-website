import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser, createTestUser } from "./factories";
import { messageComposerProps, recordClientMessage } from "@/lib/app-domain/client-messages";
import { createTask } from "@/lib/app-domain/tasks";
import { ForbiddenError } from "@/lib/app-auth/permissions";

/// An employee assigned to exactly one client. The scoping this file
/// now tests is meaningless against an admin, who is on all of them.
async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

// The one query behind the "הודעה ללקוח" button.
//
// What it gathers decides whether the person about to write sees the
// sentence the client wrote about being written to, and whether the
// buttons point at a real number and a real address. Every one of those
// is a database fact, so this is where it is checked.

const PORTAL = "https://www.ankora.co.il/app/portal";

describe("what the person about to write is shown", () => {
  it("carries the client's own words, unread and uninterpreted", async () => {
    const client = await createTestClient({ name: "אורביט" });
    await prisma.client.update({
      where: { id: client.id },
      data: {
        // The sentence that killed the parser. It stays a sentence.
        preferenceContact: "וואטסאפ בלבד, לא מיילים",
        preferenceNever: "לא להתקשר אחרי 18:00",
        whatsappNumber: "050-1234567",
      },
    });

    const props = await messageComposerProps({ clientId: client.id, fromName: "הדס", portalUrl: PORTAL });

    expect(props!.preference).toBe("וואטסאפ בלבד, לא מיילים");
    expect(props!.never).toBe("לא להתקשר אחרי 18:00");
    expect(props!.whatsappDigits).toBe("972501234567");
    expect(props!.clientName).toBe("אורביט");
  });

  it("offers the addresses of people who could actually read it", async () => {
    const client = await createTestClient();
    await createTestClientUser({ clientId: client.id, role: "ADMIN", email: "admin@orbit.test" });
    // A viewer cannot answer a decision and is not who we write to about
    // one; a deleted admin is a bounce with somebody's name on it.
    await createTestClientUser({ clientId: client.id, role: "VIEWER", email: "viewer@orbit.test" });
    const gone = await createTestClientUser({ clientId: client.id, role: "ADMIN", email: "gone@orbit.test" });
    await prisma.user.update({ where: { id: gone.user.id }, data: { deletedAt: new Date() } });

    const props = await messageComposerProps({ clientId: client.id, fromName: "הדס" });

    expect(props!.emails).toEqual(["admin@orbit.test"]);
  });

  it("gives no button at all for a client that is not there", async () => {
    // A screen rendering a composer against a missing row would offer to
    // write to nobody, with somebody else's draft in the box.
    expect(await messageComposerProps({ clientId: "does-not-exist", fromName: "הדס" })).toBeNull();
  });

  it("writes every draft in the name of the person who will send it", async () => {
    const client = await createTestClient({ name: "אורביט" });
    const props = await messageComposerProps({
      clientId: client.id,
      fromName: "הדס",
      subject: "החלפת ספק ניקיון",
      portalUrl: PORTAL,
    });

    expect(props!.drafts.length).toBeGreaterThan(1);
    for (const draft of props!.drafts) {
      expect(draft.body.trimEnd().endsWith("הדס"), draft.kind).toBe(true);
    }
    const decision = props!.drafts.find((d) => d.kind === "decision_waiting")!;
    expect(decision.body).toContain(`${PORTAL}/decisions`);
  });

  it("says nothing about a task when the screen is not about one", async () => {
    // The client screen has no task in mind. A draft that names one
    // would be naming whichever task happened to be nearby.
    const client = await createTestClient({ name: "אורביט" });
    const props = await messageComposerProps({ clientId: client.id, fromName: "הדס" });

    for (const draft of props!.drafts) {
      expect(draft.body, draft.kind).not.toContain("undefined");
      expect(draft.body, draft.kind).not.toContain("null");
    }
  });
});

// ── The write ─────────────────────────────────────────────────────────
//
// 26.9.2026, level-3 hunt. Everything above tests what the composer is
// shown. Nothing tested what it writes, and that is where the hole was.
//
// The action verifies the client against the actor's own list and then
// passed `taskId` through untouched, so a comment could be written onto
// any task in the system by pairing a task id with a client the actor
// happens to be assigned to. The other road to the same write,
// addTaskComment(), has resolved the task and checked its client since
// the day it was written.
//
// The test that matters is the second one. The first only establishes
// that the guard did not break the ordinary case.

describe("what the composer writes", () => {
  it("puts the message on the task when the task is the client's own", async () => {
    const client = await createTestClient({ name: "אורביט" });
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "לברר מול הספק" });

    await recordClientMessage(actor, {
      clientId: client.id,
      taskId: task.id,
      kind: "promise_update",
      channel: "whatsapp",
      body: "שלחתי להם תזכורת, אחזור אלייך מחר.",
    });

    const comments = await prisma.taskComment.findMany({ where: { taskId: task.id } });
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("שלחתי להם תזכורת");
    expect(comments[0].authorId).toBe(actor.id);
  });

  it("refuses a task belonging to a client the actor is not on", async () => {
    // The realistic shape of this is not an attack. It is someone who
    // was on a client, saw the task, and is not on it any more - the
    // task URL still sits in their history, and the composer is on
    // every screen.
    const mine = await createTestClient({ name: "אורביט" });
    const theirs = await createTestClient({ name: "מרידיאן" });

    const actor = await employeeOn(mine.id);
    const stranger = await employeeOn(theirs.id);
    const foreign = await createTask(stranger, { clientId: theirs.id, title: "משימה של לקוח אחר" });

    await expect(
      recordClientMessage(actor, {
        clientId: mine.id,
        taskId: foreign.id,
        kind: "promise_update",
        channel: "whatsapp",
        body: "זה לא אמור להגיע לשם.",
      })
    ).rejects.toThrow(ForbiddenError);

    // Two assertions, because the fix has two halves and only one of
    // them is visible from the thrown error.
    expect(await prisma.taskComment.count({ where: { taskId: foreign.id } })).toBe(0);
    expect(
      await prisma.auditEvent.count({ where: { actorId: actor.id, action: "client.message_sent" } })
    ).toBe(0);
  });

  it("still records a message that carries no task at all", async () => {
    // The guard runs only when there is a task. A message sent from a
    // client screen has none, and it is the common case.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);

    await recordClientMessage(actor, {
      clientId: client.id,
      taskId: null,
      kind: "promise_update",
      channel: "email",
      body: "עדכון קצר.",
    });

    expect(
      await prisma.auditEvent.count({ where: { actorId: actor.id, action: "client.message_sent" } })
    ).toBe(1);
  });
});
