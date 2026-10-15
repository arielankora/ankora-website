import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, saveProcessVersion, setProcessStatus, updateProcess } from "@/lib/app-domain/processes";
import { CHECK_DUE, listMyRoutines, notifyDueProcessChecks, recordProcessCheck } from "@/lib/app-domain/process-checks";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";
import { addDaysToKey, localDateKey, TIMEZONE } from "@/lib/timezone";

// Org brain, phase 1: the routine (claude/org-brain-spec-2026-10-12.md,
// 3.8).
//
// What is worth holding here: an ongoing process shows in its owner's
// and its backup's routine and nobody else's; its check is due on the
// right day and reminds the owner once per due day; "all fine" is a
// record and nothing more; an issue needs a sentence and opens a task;
// and a paused process is not checked.

const S1 = [{ code: "S1" }];
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: backup } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  for (const u of [hadas, backup]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const process = await addProcess(hadas, {
    clientId: client.id,
    title: "איסוף חשבוניות SaaS",
    triggerKinds: ["CONTINUOUS"],
    ownerId: hadas.id,
    backupOwnerId: backup.id,
    checkEveryDays: 7,
    checkText: "שאין חשבוניות תקועות",
    sources: S1,
  });
  return { client, hadas, backup, ariel, process };
}

describe("an ongoing process", () => {
  it("takes a check only when it is ongoing, every 1 to 365 days", async () => {
    const { client, hadas, process } = await setup();
    await expect(
      addProcess(hadas, { clientId: client.id, title: "תשלומים", triggerKinds: ["SCHEDULED"], checkEveryDays: 7, sources: S1 })
    ).rejects.toThrow("שוטף");
    await expect(updateProcess(hadas, process.id, { checkEveryDays: 0 })).rejects.toThrow("365");
    await expect(updateProcess(hadas, process.id, { triggerKinds: ["SCHEDULED"] })).rejects.toThrow("שוטף");
    await expect(updateProcess(hadas, process.id, { checkText: "password: hunter2" })).rejects.toThrow("בכספת");
  });

  it("is in its owner's and its backup's routine, due today until first checked", async () => {
    const { hadas, backup, process } = await setup();
    const [mine] = await listMyRoutines(hadas);
    expect(mine).toMatchObject({ id: process.id, code: "P1", checkEvery: "פעם בשבוע", state: "DUE", asBackup: false });
    expect((await listMyRoutines(backup))[0]).toMatchObject({ id: process.id, asBackup: true });
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    expect(await listMyRoutines(stranger)).toEqual([]);
  });
});

describe("the check", () => {
  it("reminds the owner once per due day, and again when the next one is due", async () => {
    const { hadas, backup } = await setup();
    const now = new Date();
    expect((await notifyDueProcessChecks(now)).notified).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { userId: hadas.id, type: CHECK_DUE } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: backup.id, type: CHECK_DUE } })).toBe(0);
    await notifyDueProcessChecks(now);
    expect(await prisma.notification.count({ where: { userId: hadas.id, type: CHECK_DUE } })).toBe(1);
  });

  it("all fine is a record; the next one is due a week later, and nothing reminds before then", async () => {
    const { hadas, process } = await setup();
    const { check, task } = await recordProcessCheck(hadas, process.id, { outcome: "OK" });
    expect(check.outcome).toBe("OK");
    expect(task).toBeNull();
    const [r] = await listMyRoutines(hadas);
    expect(r.state).toBe("LATER");
    expect(r.dueKey).toBe(addDaysToKey(localDateKey(new Date(), TIMEZONE), 7));
    await notifyDueProcessChecks();
    expect(await prisma.notification.count({ where: { userId: hadas.id, type: CHECK_DUE } })).toBe(0);
    await notifyDueProcessChecks(new Date(Date.now() + 8 * DAY));
    expect(await prisma.notification.count({ where: { userId: hadas.id, type: CHECK_DUE } })).toBe(1);
  });

  it("an issue says what, and opens a task for whoever found it", async () => {
    const { client, backup, process } = await setup();
    await expect(recordProcessCheck(backup, process.id, { outcome: "ISSUE" })).rejects.toThrow("מה נמצא");
    const { check, task } = await recordProcessCheck(backup, process.id, { outcome: "ISSUE", note: "שתי חשבוניות של Notion לא הגיעו" });
    expect(task).not.toBeNull();
    expect(check.taskId).toBe(task!.id);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task!.id } });
    expect(row).toMatchObject({ clientId: client.id, assignedToId: backup.id, processId: process.id, status: "OPEN", clientVisible: false });
    expect(row.title).toBe("P1 איסוף חשבוניות SaaS: שתי חשבוניות של Notion לא הגיעו");
    expect(await prisma.auditEvent.count({ where: { action: "process.check", entityId: process.id } })).toBe(1);
  });

  it("is not taken by a paused process, nor by a stranger", async () => {
    const { hadas, ariel, process } = await setup();
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(recordProcessCheck(stranger, process.id, { outcome: "OK" })).rejects.toThrow();
    await saveProcessVersion(hadas, process.id, { steps: [{ title: "לבדוק שאין חשבוניות תקועות" }], baseVersion: 0 });
    await approveProcessVersion(ariel, process.id, 1);
    expect((await listMyRoutines(hadas))[0].steps).toEqual(["לבדוק שאין חשבוניות תקועות"]);
    await setProcessStatus(ariel, process.id, "PAUSED");
    await expect(recordProcessCheck(hadas, process.id, { outcome: "OK" })).rejects.toThrow("שוטף");
    expect(await listMyRoutines(hadas)).toEqual([]);
  });

  it("reads in section 7.4 of the file", async () => {
    const { client, hadas, process } = await setup();
    await recordProcessCheck(hadas, process.id, { outcome: "OK" });
    const md = toMarkdown(await buildClientFile(hadas, client.id, { audience: "ai" }));
    expect(md).toContain("בדיקה פעם בשבוע: שאין חשבוניות תקועות, נבדק לאחרונה");
  });
});
