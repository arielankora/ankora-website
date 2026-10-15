import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientPolicy } from "@/lib/app-domain/client-policies";
import { addProcess, approveProcessVersion, linkProcessDates, saveProcessVersion, setProcessStatus } from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { createDueAutoTasks } from "@/lib/app-domain/important-dates-job";
import { localDateKey, TIMEZONE } from "@/lib/timezone";
import { shiftBusinessDays } from "@/lib/business-calendar";

// Org brain, phase 1 (claude/org-brain-spec-2026-10-12.md, 3.12, 5.3).
//
// What is worth holding here: a date linked to a process opens a run with
// the approved procedure's steps, each on its business day, once per
// occurrence; a paused process opens nothing; a process with no approved
// procedure falls back to what the date did before; a run keeps the
// version it came from; and a person can start a run for an event.

const S1 = [{ code: "S1" }];
const DAY = 24 * 60 * 60 * 1000;

const STEPS = [
  { title: "מעלים כל חשבונית ל-Doka", actionTags: ["INVOICE"] },
  { title: "מייל מרוכז לאיילה", mode: "ASSISTED", offsetBusinessDays: -2, actionTags: ["CLIENT_MESSAGE"] },
];

async function setup(options: { approve?: boolean; createAutoTask?: boolean } = {}) {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  await addClientPolicy(hadas, { clientId: client.id, kind: "SEPARATION", title: "Inc ו-LTD", statement: "לא שולחים לאיילה שום דבר של Inc", sources: S1 });
  // LTD: a separation rule wants a procedure with invoices to say whose (R8).
  const ltd = await prisma.clientEntity.create({ data: { clientId: client.id, name: "LTD", country: "IL" } });
  const process = await addProcess(hadas, {
    clientId: client.id,
    entityId: ltd.id,
    title: "תשלומי ספקים, LTD",
    triggerKinds: ["SCHEDULED", "EVENT"],
    triggerText: "10 ו-25 לחודש",
    ownerId: hadas.id,
    approverText: "מורשה חתימה",
    sources: S1,
  });
  await saveProcessVersion(hadas, process.id, { steps: STEPS, highlights: "רישום ותשלום הם שני ערוצים נפרדים", baseVersion: 0 });
  if (options.approve !== false) await approveProcessVersion(ariel, process.id, 1);
  // Two days from now: inside the three business days the run needs.
  const occurrence = new Date(Date.now() + 2 * DAY);
  const date = await prisma.importantDate.create({
    data: {
      clientId: client.id,
      title: "פעימת תשלומים",
      type: "custom",
      category: "BUSINESS_FINANCE",
      month: 1,
      day: 10,
      recurrence: "MONTHLY",
      responsibleUserId: ariel.id,
      nextOccurrenceAt: occurrence,
      createAutoTask: options.createAutoTask ?? false,
      // A plain task opens on its own lead; a run computes its own.
      autoTaskLeadDays: options.createAutoTask ? 5 : null,
    },
  });
  await linkProcessDates(hadas, process.id, [date.id]);
  return { client, hadas, ariel, process, date, occurrence };
}

describe("runs from a date", () => {
  it("open once with the approved steps, each on its business day, assigned to the owner", async () => {
    const { client, hadas, process, occurrence } = await setup();
    expect((await createDueAutoTasks()).created).toBe(1);
    expect((await createDueAutoTasks()).created).toBe(0);

    const run = await prisma.task.findFirstOrThrow({ where: { clientId: client.id, parentId: null, processId: process.id } });
    expect(run.title).toBe("P1 תשלומי ספקים, LTD");
    expect(run.assignedToId).toBe(hadas.id);
    expect(run.description).toContain("לפי נוהל גרסה 1");
    expect(run.description).toContain("Inc ו-LTD: לא שולחים לאיילה שום דבר של Inc");
    const runKey = localDateKey(occurrence, TIMEZONE);
    expect(run.dueDate?.toISOString().slice(0, 10)).toBe(runKey);

    const steps = await prisma.task.findMany({ where: { parentId: run.id }, orderBy: { createdAt: "asc" } });
    expect(steps.map((s) => s.title)).toEqual(["מעלים כל חשבונית ל-Doka", "מייל מרוכז לאיילה (Claude מכין, אדם בודק)"]);
    expect(steps.map((s) => s.stepMode)).toEqual(["MANUAL", "ASSISTED"]);
    expect(steps[1].dueDate?.toISOString().slice(0, 10)).toBe(shiftBusinessDays(runKey, -2, "IL"));
    expect(steps.every((s) => s.processVersionId === run.processVersionId)).toBe(true);

    expect(await prisma.notification.count({ where: { userId: hadas.id, type: "process.run_opened" } })).toBe(1);
    expect((await prisma.process.findUniqueOrThrow({ where: { id: process.id } })).lastRunAt).not.toBeNull();
  });

  it("a paused process opens nothing, not even the plain task", async () => {
    const { client, ariel, process } = await setup({ createAutoTask: true });
    await setProcessStatus(ariel, process.id, "PAUSED");
    expect((await createDueAutoTasks()).created).toBe(0);
    expect(await prisma.task.count({ where: { clientId: client.id } })).toBe(0);
  });

  it("without an approved procedure, the date does what it did before", async () => {
    const quiet = await setup({ approve: false });
    expect((await createDueAutoTasks()).created).toBe(0);
    expect(await prisma.task.count({ where: { clientId: quiet.client.id } })).toBe(0);

    const plain = await setup({ approve: false, createAutoTask: true });
    await createDueAutoTasks();
    const task = await prisma.task.findFirstOrThrow({ where: { clientId: plain.client.id } });
    expect(task.processId).toBeNull();
    expect(task.title).toBe("פעימת תשלומים");
  });
});

describe("runs started by a person", () => {
  it("open for the day given, keep their version when the procedure changes, and refuse an ongoing process", async () => {
    const { client, hadas, ariel, process } = await setup();
    const run = await startProcessRun(hadas, process.id, new Date("2026-11-10T00:00:00Z"));
    const v1 = run.processVersionId;
    await saveProcessVersion(hadas, process.id, { steps: [...STEPS, { title: "לוודא שהועלה" }], baseVersion: 1 });
    await approveProcessVersion(ariel, process.id, 2);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: run.id } })).processVersionId).toBe(v1);
    expect(await prisma.task.count({ where: { parentId: run.id } })).toBe(2);

    const ongoing = await addProcess(hadas, { clientId: client.id, title: "איסוף חשבוניות SaaS", triggerKinds: ["CONTINUOUS"], sources: S1 });
    await saveProcessVersion(hadas, ongoing.id, { steps: [{ title: "לבדוק שאין חשבוניות תקועות" }], baseVersion: 0 });
    await approveProcessVersion(ariel, ongoing.id, 1);
    await expect(startProcessRun(hadas, ongoing.id, new Date())).rejects.toThrow("שוטף");

    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(startProcessRun(stranger, process.id, new Date())).rejects.toThrow();
  });
});
