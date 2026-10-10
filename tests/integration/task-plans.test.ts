import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createTask, getTaskDetail, updateTask } from "@/lib/app-domain/tasks";
import {
  PLAN_NOT_APPROVED_MESSAGE,
  PLAN_ON_CLOSED_MESSAGE,
  PLAN_ON_STEP_MESSAGE,
  PlanVersionConflictError,
  applyPlanSteps,
  approveTaskPlan,
  getTaskPlans,
  saveTaskPlan,
} from "@/lib/app-domain/task-plans";

// "קדם עם קלוד" (10.10.2026): the work plan of a task, against a real
// database. What only shows up here:
//
//   - versions are added, never overwritten, and the current plan is the
//     highest one,
//   - a save written against an old version is refused and changes nothing,
//   - the plan is reachable only through client access, like the task,
//   - turning a plan into steps keeps what is done and what has hours on it.

async function employeeOn(clientId: string) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return user;
}

const PLAN = "**מטרה**\nלסגור את ההתאמה.\n\n**שלבים**\n1. לבקש דוח\n2. להתאים";

describe("saving a plan", () => {
  it("adds version 1, approved in the saver's name, and leaves a line in the thread", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "התאמה" });

    const saved = await saveTaskPlan(actor, task.id, {
      body: PLAN,
      steps: ["1. לבקש דוח", "להתאים"],
      approved: true,
      baseVersion: 0,
      origin: "MCP",
    });
    expect(saved.version).toBe(1);
    expect(saved.status).toBe("APPROVED");
    expect(saved.approvedBy?.id).toBe(actor.id);
    expect(saved.steps).toEqual(["לבקש דוח", "להתאים"]);

    const detail = await getTaskDetail(actor, task.id);
    expect(detail!.thread.some((e) => e.kind === "event" && e.label === "תוכנית העבודה עודכנה")).toBe(true);
  });

  it("adds a version on every save and never edits an old one", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "התאמה" });

    await saveTaskPlan(actor, task.id, { body: "גרסה ראשונה", approved: true, baseVersion: 0, origin: "MCP" });
    await saveTaskPlan(actor, task.id, { body: "גרסה שנייה", approved: true, baseVersion: 1, origin: "APP" });

    const plans = await getTaskPlans(actor, task.id);
    expect(plans!.current!.version).toBe(2);
    expect(plans!.current!.body).toBe("גרסה שנייה");
    expect(plans!.versions.map((v) => v.body)).toEqual(["גרסה שנייה", "גרסה ראשונה"]);
  });

  it("refuses a save written against an older version, and stores nothing", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "התאמה" });
    await saveTaskPlan(actor, task.id, { body: "1", approved: true, baseVersion: 0, origin: "MCP" });
    await saveTaskPlan(actor, task.id, { body: "2", approved: true, baseVersion: 1, origin: "APP" });

    await expect(
      saveTaskPlan(actor, task.id, { body: "ישנה", approved: true, baseVersion: 1, origin: "MCP" })
    ).rejects.toBeInstanceOf(PlanVersionConflictError);
    expect(await prisma.taskPlan.count({ where: { taskId: task.id } })).toBe(2);
  });

  it("saves a draft when not approved, and approving it records who agreed", async () => {
    const client = await createTestClient();
    const author = await employeeOn(client.id);
    const approver = await employeeOn(client.id);
    const task = await createTask(author, { clientId: client.id, title: "התאמה" });

    const draft = await saveTaskPlan(author, task.id, { body: "טיוטה", approved: false, baseVersion: 0, origin: "MCP" });
    expect(draft.status).toBe("DRAFT");
    expect(draft.approvedBy).toBeNull();

    const approved = await approveTaskPlan(approver, task.id, 1);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy?.id).toBe(approver.id);
    expect(approved.createdBy?.id).toBe(author.id);
  });

  it("is out of reach for someone with no access to the client", async () => {
    const client = await createTestClient();
    const other = await createTestClient();
    const actor = await employeeOn(client.id);
    const outsider = await employeeOn(other.id);
    const task = await createTask(actor, { clientId: client.id, title: "התאמה" });
    await saveTaskPlan(actor, task.id, { body: "x", approved: true, baseVersion: 0, origin: "MCP" });

    expect(await getTaskPlans(outsider, task.id)).toBeNull();
    await expect(
      saveTaskPlan(outsider, task.id, { body: "y", approved: true, baseVersion: 1, origin: "MCP" })
    ).rejects.toThrow();
  });

  it("is refused on a step and on a closed task", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "התאמה" });
    const step = await createTask(actor, { clientId: client.id, title: "שלב", parentId: task.id });

    await expect(
      saveTaskPlan(actor, step.id, { body: "x", approved: true, baseVersion: 0, origin: "MCP" })
    ).rejects.toThrow(PLAN_ON_STEP_MESSAGE);

    await updateTask(actor, task.id, { status: "ARCHIVED" });
    await expect(
      saveTaskPlan(actor, task.id, { body: "x", approved: true, baseVersion: 0, origin: "MCP" })
    ).rejects.toThrow(PLAN_ON_CLOSED_MESSAGE);
  });
});

describe("turning a plan into steps", () => {
  it("replaces open steps, keeps a done one, and does not add it twice", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "התאמה" });
    const done = await createTask(actor, { clientId: client.id, title: "לבקש דוח", parentId: task.id });
    await updateTask(actor, done.id, { status: "DONE" });
    await createTask(actor, { clientId: client.id, title: "שלב ישן", parentId: task.id });

    await saveTaskPlan(actor, task.id, {
      body: PLAN,
      steps: ["לבקש דוח", "להתאים", "לסגור"],
      approved: true,
      baseVersion: 0,
      origin: "MCP",
    });
    const result = await applyPlanSteps(actor, task.id);

    expect(result.removed.map((s) => s.title)).toEqual(["שלב ישן"]);
    expect(result.kept.map((s) => s.title)).toEqual(["לבקש דוח"]);
    expect(result.added).toEqual(["להתאים", "לסגור"]);

    const detail = await getTaskDetail(actor, task.id);
    expect(detail!.subtasks.map((s) => s.title)).toEqual(["לבקש דוח", "להתאים", "לסגור"]);
    const plans = await getTaskPlans(actor, task.id);
    expect(plans!.current!.stepsAppliedAt).not.toBeNull();
  });

  it("refuses a draft", async () => {
    const client = await createTestClient();
    const actor = await employeeOn(client.id);
    const task = await createTask(actor, { clientId: client.id, title: "התאמה" });
    await saveTaskPlan(actor, task.id, { body: "x", steps: ["א"], approved: false, baseVersion: 0, origin: "MCP" });
    await expect(applyPlanSteps(actor, task.id)).rejects.toThrow(PLAN_NOT_APPROVED_MESSAGE);
  });
});
