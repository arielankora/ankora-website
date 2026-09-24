import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestCategory, createTestClient, createTestUser } from "./factories";
import { addTaskComment, createTask, listTasks, updateTask } from "@/lib/app-domain/tasks";

// Tasks phase 4: finding work.
//
// A search box is the one feature where being slightly wrong is worse
// than not having it: a person who searches and finds nothing concludes
// the task does not exist, and opens a second one. So what is checked
// here is not that it matches, but WHERE it looks and where it refuses
// to look:
//
//   - every field a person might have typed the word into, including
//     the thread, which is the whole reason phase 3 came first,
//   - and never outside the clients this person can reach, because a
//     search that leaks a title is worse than one that misses it.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

async function found(actor: Awaited<ReturnType<typeof employeeOn>>, q: string) {
  const rows = await listTasks(actor, { q });
  return rows.map((t) => t.title);
}

describe("the box looks everywhere a task keeps words", () => {
  it("finds it by its title", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "להזמין אינסטלטור לדירה" });

    expect(await found(actor, "אינסטלטור")).toContain("להזמין אינסטלטור לדירה");
  });

  it("finds it by its details", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, {
      clientId: client.id,
      title: "משימה",
      description: "הטלפון של הספק הוא 03-5551234",
    });

    expect(await found(actor, "5551234")).toContain("משימה");
  });

  it("finds it by a word only its thread contains", async () => {
    // The reason phase 3 came before this one. Most of what a person
    // remembers about a task a week later was said in the thread, not
    // written in the title.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "כותרת סתמית" });
    await addTaskComment(actor, task.id, "דיברתי עם רפי מחברת המעליות");

    expect(await found(actor, "מעליות")).toContain("כותרת סתמית");
  });

  it("stops finding it once that comment is taken back", async () => {
    // Words somebody removed should not keep surfacing the task they
    // removed them from.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "כותרת" });
    const comment = await addTaskComment(actor, task.id, "מילה-נדירה-מאוד");
    expect(await found(actor, "מילה-נדירה-מאוד")).toHaveLength(1);

    await prisma.taskComment.update({ where: { id: comment.id }, data: { deletedAt: new Date() } });
    expect(await found(actor, "מילה-נדירה-מאוד")).toHaveLength(0);
  });

  it("finds it by the client's name", async () => {
    // "מרידיאן" is a thing people type into a search box. Sending them
    // to a separate dropdown for it is the small refusal that teaches
    // people the box does not work.
    const client = await createTestClient({ name: "קבוצת אלטיטיוד" });
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "בלי שום רמז בכותרת" });

    expect(await found(actor, "אלטיטיוד")).toContain("בלי שום רמז בכותרת");
  });

  it("finds it by the outcome sentence, after it closed", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "ישן" });
    await updateTask(actor, task.id, { status: "DONE", clientOutcome: "הוחלף הדוד בקומה השלישית" });

    expect(await found(actor, "הדוד")).toContain("ישן");
  });

  it("ignores case", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "Renew the INSURANCE policy" });

    expect(await found(actor, "insurance")).toHaveLength(1);
  });
});

describe("what it refuses to do", () => {
  it("never crosses into a client this person cannot reach", async () => {
    // The highest-stakes property in this product, and a search box is
    // the easiest place to lose it: the predicate runs inside the
    // client scope, not beside it.
    const mine = await createTestClient();
    const theirs = await createTestClient();
    const actor = await employeeOn(mine.id);
    const other = await employeeOn(theirs.id);
    await createTask(other, { clientId: theirs.id, title: "סוד-של-לקוח-אחר" });

    expect(await found(actor, "סוד-של-לקוח-אחר")).toHaveLength(0);
  });

  it("is ignored under two characters", async () => {
    // One character matches nearly everything, which is not a result,
    // it is the whole list with a slower query behind it.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    await createTask(actor, { clientId: client.id, title: "אלף" });
    await createTask(actor, { clientId: client.id, title: "בית" });

    expect(await found(actor, "א")).toHaveLength(2);
    expect(await found(actor, "  ")).toHaveLength(2);
  });

  it("narrows the other filters rather than widening them", async () => {
    // The failure this guards against is a search that quietly ignores
    // the status pill somebody had set, which looks like the pill is
    // broken.
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const open = await createTask(actor, { clientId: client.id, title: "משהו פתוח" });
    const done = await createTask(actor, { clientId: client.id, title: "משהו סגור" });
    await updateTask(actor, done.id, { status: "DONE" });

    const rows = await listTasks(actor, { q: "משהו", status: "OPEN" });
    expect(rows.map((t) => t.id)).toEqual([open.id]);
  });

  it("combines with a category filter the same way", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const category = await createTestCategory();
    const inCategory = await createTask(actor, {
      clientId: client.id,
      title: "חיפוש עם קטגוריה",
      categoryId: category.id,
    });
    await createTask(actor, { clientId: client.id, title: "חיפוש בלי קטגוריה" });

    const rows = await listTasks(actor, { q: "חיפוש", categoryId: category.id });
    expect(rows.map((t) => t.id)).toEqual([inCategory.id]);
  });
});
