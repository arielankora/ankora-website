import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import {
  MAX_COMMENT_LENGTH,
  addTaskComment,
  createTask,
  deleteTaskComment,
  getTaskDetail,
  updateTask,
} from "@/lib/app-domain/tasks";

// Tasks phase 3 ("שרשור"), Hadas's third request.
//
// The thread is the one part of this product that is assembled rather
// than stored: comments are their own rows, files are ClientDocument
// rows, and the changes have been in the audit log since phase 1. What
// belongs here is everything that only shows up once those three are put
// together against a real database:
//
//   - that the merge is by time and by nothing else,
//   - that writing a comment does not also produce a line saying a
//     comment was written,
//   - that a soft delete takes the words out of the thread and leaves
//     the trace in the log,
//   - and who may remove whose words.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

async function taskFor(actor: Awaited<ReturnType<typeof employeeOn>>, clientId: string, title = "לברר מול הספק") {
  return createTask(actor, { clientId, title });
}

describe("a comment is a line in the thread, and only one", () => {
  it("appears as itself", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await taskFor(actor, client.id);

    await addTaskComment(actor, task.id, "דיברתי עם מיכל, היא חוזרת מחר.");

    const detail = await getTaskDetail(actor, task.id);
    const comments = detail!.thread.filter((e) => e.kind === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("דיברתי עם מיכל, היא חוזרת מחר.");
    expect(detail!.commentCount).toBe(1);
  });

  it("does not also produce an event line saying a comment was written", async () => {
    // The audit row exists, and it should: the log is the record of who
    // did what. But the comment is already in the thread as itself, and
    // a second line beside it would be the same fact twice, on every
    // comment, forever.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await taskFor(actor, client.id);

    await addTaskComment(actor, task.id, "הערה");

    const detail = await getTaskDetail(actor, task.id);
    const labels = detail!.thread.filter((e) => e.kind === "event").map((e) => e.label);
    expect(labels).not.toContain("נוספה הערה");

    const audited = await prisma.auditEvent.count({
      where: { entityType: "Task", entityId: task.id, action: "task.comment" },
    });
    expect(audited).toBe(1);
  });

  it("refuses an empty one and an enormous one", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await taskFor(actor, client.id);

    await expect(addTaskComment(actor, task.id, "   ")).rejects.toThrow();
    await expect(addTaskComment(actor, task.id, "x".repeat(MAX_COMMENT_LENGTH + 1))).rejects.toThrow();
  });
});

describe("the merge", () => {
  it("puts changes, words and files in one list, newest first", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await taskFor(actor, client.id);

    await updateTask(actor, task.id, { priority: "URGENT" });
    await addTaskComment(actor, task.id, "אחרי שדיברנו, זה דחוף");
    // A file, written straight to the table rather than through the
    // upload path: this test is about the merge, and reaching Drive from
    // CI would make it a test of somebody else's uptime.
    await prisma.clientDocument.create({
      data: {
        clientId: client.id,
        taskId: task.id,
        title: "הצעת מחיר.pdf",
        driveFileId: "fake-drive-id",
        mimeType: "application/pdf",
        sizeBytes: 12345,
        clientVisible: false,
      },
    });

    const detail = await getTaskDetail(actor, task.id);
    const kinds = detail!.thread.map((e) => e.kind);

    expect(kinds).toContain("event");
    expect(kinds).toContain("comment");
    expect(kinds).toContain("file");

    // Newest first, and asserted as a property rather than as a fixed
    // sequence: an order written out by hand is one that breaks when
    // somebody adds a step, without anything actually being wrong.
    const times = detail!.thread.map((e) => e.at.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("carries what a file line needs to say for itself", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await taskFor(actor, client.id);
    await prisma.clientDocument.create({
      data: {
        clientId: client.id,
        taskId: task.id,
        title: "חוזה חתום.pdf",
        driveFileId: "fake",
        mimeType: "application/pdf",
        sizeBytes: 900,
        clientVisible: true,
      },
    });

    const detail = await getTaskDetail(actor, task.id);
    const file = detail!.thread.find((e) => e.kind === "file");
    expect(file).toMatchObject({ title: "חוזה חתום.pdf", clientVisible: true, sizeBytes: 900 });
  });
});

describe("taking words back", () => {
  it("removes them from the thread and leaves the trace in the log", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await taskFor(actor, client.id);
    const comment = await addTaskComment(actor, task.id, "טעות");

    await deleteTaskComment(actor, comment.id);

    const detail = await getTaskDetail(actor, task.id);
    expect(detail!.thread.filter((e) => e.kind === "comment")).toHaveLength(0);
    expect(detail!.commentCount).toBe(0);

    // Soft, so the row is still there and still says who wrote it.
    const row = await prisma.taskComment.findUnique({ where: { id: comment.id } });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.body).toBe("טעות");
  });

  it("lets a colleague remove their own and not somebody else's", async () => {
    const client = await createTestClient();
    const author = await employeeOn(client.id);
    const other = await employeeOn(client.id);
    const task = await taskFor(author, client.id);
    const comment = await addTaskComment(author, task.id, "שלי");

    await expect(deleteTaskComment(other, comment.id)).rejects.toThrow();
    await expect(deleteTaskComment(author, comment.id)).resolves.toBeTruthy();
  });

  it("lets an admin remove anyone's", async () => {
    // The same reasoning as approving somebody else's work: a person who
    // already edits other people's time can take down a comment that
    // should not be on a client's task, and doing it in the product
    // leaves a record where doing it in the database would not.
    const client = await createTestClient();
    const author = await employeeOn(client.id);
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    const task = await taskFor(author, client.id);
    const comment = await addTaskComment(author, task.id, "משהו");

    await expect(deleteTaskComment(admin, comment.id)).resolves.toBeTruthy();
  });

  it("says on each line whether THIS person may remove it", async () => {
    const client = await createTestClient();
    const author = await employeeOn(client.id);
    const other = await employeeOn(client.id);
    const task = await taskFor(author, client.id);
    await addTaskComment(author, task.id, "שלי");

    const mine = await getTaskDetail(author, task.id);
    const theirs = await getTaskDetail(other, task.id);
    expect(mine!.thread.find((e) => e.kind === "comment")).toMatchObject({ canDelete: true });
    expect(theirs!.thread.find((e) => e.kind === "comment")).toMatchObject({ canDelete: false });
  });
});

describe("access", () => {
  it("refuses a comment from somebody with no access to the client", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const task = await taskFor(actor, client.id);

    await expect(addTaskComment(stranger, task.id, "לא שלי")).rejects.toThrow();
  });
});
