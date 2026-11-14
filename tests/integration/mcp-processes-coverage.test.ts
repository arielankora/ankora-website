import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, saveProcessVersion } from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { addClientContact } from "@/lib/app-domain/client-contacts";

// Ankora's connector and the processes redesign (14.11.2026). What is worth
// holding: a refusal of the domain reaches Claude in its own words; a run's
// step approved at the client is closed from the connector only with when
// and how; a task is linked to a process; get_process carries the kind, the
// rhythm, the audit and who left; and Claude's new tools write what the
// screen writes.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);

async function call(user: User, name: string, args: unknown) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text, isError: !!result.isError };
  } catch {
    return { json: null, text, isError: !!result.isError };
  }
}

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  await prisma.client.update({ where: { id: client.id }, data: { auditRequirements: true } });
  const { user: h } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const hadas = await prisma.user.update({ where: { id: h.id }, data: { name: "Hadas Vinogura" } });
  const { user: created } = await createTestUser({ role: "ANKORA_ADMIN" });
  const ariel = await prisma.user.update({ where: { id: created.id }, data: { canApproveExceptions: true, name: "Ariel" } });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const dana = await addClientContact(hadas, { clientId: client.id, name: "דנה כהן", role: "סמנכ\"לית כספים", sources: S1 });
  const p = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים", ownerId: hadas.id, triggerKinds: ["ON_DEMAND"], sources: S1 });
  await saveProcessVersion(hadas, p.id, {
    steps: [{ title: "איסוף חשבוניות" }, { title: "אישור רשימת התשלומים", approverContactId: dana.id }],
    baseVersion: 0,
  });
  await approveProcessVersion(ariel, p.id, 1);
  return { client, hadas, ariel, dana, p };
}

describe("runs from the connector", () => {
  it("shows a run's approvers, closes a client-approved step only with when and how, and keeps an evidence link", async () => {
    const { hadas, p } = await setup();
    const run = await startProcessRun(hadas, p.id, new Date("2026-11-16T00:00:00Z"));

    const task = await call(hadas, "get_task", { taskId: run.id });
    expect(task.json.runOf).toEqual({ code: p.code, title: "תשלומי ספקים" });
    expect(task.json.evidenceLinks).toBe(true);
    expect(task.json.steps[1]).toMatchObject({ approverAtClient: "דנה כהן", clientApproval: null, evidenceLink: null });

    const plain = await call(hadas, "set_task_step", { taskId: run.id, step: "אישור רשימת", done: true });
    expect(plain.isError).toBe(true);
    expect(plain.text).toContain("מתעדים מתי ואיך הלקוח אישר");
    expect(plain.text).not.toMatch(/unexpected server error/i);

    const approved = await call(hadas, "set_task_step", { taskId: run.id, step: "אישור רשימת", done: true, clientApproval: { at: "2026-11-12", how: "EMAIL" }, evidenceLink: "https://mail.example/1" });
    expect(approved.json).toMatchObject({ status: "DONE", evidenceLink: "https://mail.example/1" });
    const after = await call(hadas, "get_task", { taskId: run.id });
    expect(after.json.steps[1]).toMatchObject({ clientApproval: { at: "2026-11-12", how: "EMAIL" }, evidenceLink: "https://mail.example/1" });
  });

  it("links a task to a process and clears it", async () => {
    const { client, hadas, p } = await setup();
    const task = await prisma.task.create({ data: { clientId: client.id, title: "תשלומים 25.11", assignedToId: hadas.id } });
    const linked = await call(hadas, "set_task_process", { taskId: task.id, process: p.code });
    expect(linked.json.runOf).toEqual({ code: p.code, title: "תשלומי ספקים" });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).processId).toBe(p.id);
    const list = await call(hadas, "list_tasks", { client: "NUX" });
    expect(list.json.tasks.find((t: { id: string }) => t.id === task.id).runOfProcess).toBe(true);
    await call(hadas, "set_task_process", { taskId: task.id, process: null });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).processId).toBeNull();
  });
});

describe("get_process and the new process tools", () => {
  it("reads the kind, the rhythm, the audit and a contact who left; sets the rhythm and the contact", async () => {
    const { hadas, p } = await setup();
    const left = await call(hadas, "set_contact_ended", { client: "NUX", contact: "דנה כהן", endedAt: "2026-11-15" });
    expect(left.json).toMatchObject({ saved: true });
    const rhythm = await call(hadas, "set_process_rhythm", {
      client: "NUX",
      process: p.code,
      starts: [{ kind: "SCHEDULE", schedule: { frequency: "MONTHLY", monthDays: [10, 25], roll: "PREVIOUS_BUSINESS_DAY" } }],
    });
    expect(rhythm.json.rhythm).toContain("10");

    const detail = await call(hadas, "get_process", { client: "NUX", process: p.code });
    expect(detail.json.kind).toBe("PROCESS");
    expect(detail.json.rhythmDetail.starts[0]).toMatchObject({ kind: "SCHEDULE", schedule: { frequency: "MONTHLY", monthDays: [10, 25] } });
    expect(detail.json.rhythmDetail.nextDates).toHaveLength(3);
    expect(detail.json.procedure.steps[1].approver).toEqual({ atClient: "דנה כהן", leftOn: "2026-11-15" });
    expect(detail.json.approverLeft).toEqual([{ step: 2, name: "דנה כהן" }]);
    expect(detail.json.staleReasons.join(" ")).toContain("דנה כהן");
    expect(detail.json.audit).toMatchObject({ scope: null, controlRefs: [], ready: false });
    expect(detail.json.audit.missing.map((m: { item: string }) => m.item)).toContain("controls");
  });

  it("drafts a new version of a procedure with an approver and systems, only from the version read", async () => {
    const { client, hadas, p } = await setup();
    await prisma.systemAccess.create({ data: { clientId: client.id, systemName: "Mercury" } });
    const steps = [{ title: "איסוף חשבוניות", systems: ["Mercury"] }, { title: "אישור", approver: "Hadas Vinogura" }];
    const stale = await call(hadas, "save_procedure_draft", { client: "NUX", process: p.code, steps, baseVersion: 0 });
    expect(stale.text).toContain("נשמרה גרסה 1");
    const saved = await call(hadas, "save_procedure_draft", { client: "NUX", process: p.code, steps, baseVersion: 1, changeNote: "מאשרת באנקורה" });
    expect(saved.json).toMatchObject({ saved: true, version: 2 });
    const v2 = await prisma.processVersion.findFirstOrThrow({ where: { processId: p.id, version: 2 } });
    expect(v2.steps).toMatchObject([{ title: "איסוף חשבוניות" }, { title: "אישור", approverUserId: hadas.id, requiresApproval: true }]);
    expect((v2.steps as { systemIds?: string[] }[])[0].systemIds).toHaveLength(1);
  });

  it("creates a work guide, edits a process, and decides a lesson", async () => {
    const { client, hadas, ariel, p } = await setup();
    const guide = await call(hadas, "create_process", { client: "NUX", title: "איך מעלים קובץ לבנק", kind: "GUIDE", sources: ["S1"] });
    expect(guide.json).toMatchObject({ created: true, kind: "GUIDE" });
    expect((await prisma.process.findFirstOrThrow({ where: { clientId: client.id, code: guide.json.code } })).kind).toBe("GUIDE");

    const edit = await call(hadas, "update_process", { client: "NUX", process: p.code, purpose: "לשלם לספקים בזמן", executor: "Nextage" });
    expect(edit.json.changed).toEqual(expect.arrayContaining(["purpose", "executorText"]));
    const row = await prisma.process.findUniqueOrThrow({ where: { id: p.id } });
    expect([row.purpose, row.executorText]).toEqual(["לשלם לספקים בזמן", "Nextage"]);

    const run = await prisma.task.create({ data: { clientId: client.id, title: "ריצה", assignedToId: hadas.id, processId: p.id, status: "DONE" } });
    const lesson = await prisma.processLesson.create({ data: { processId: p.id, clientId: client.id, taskId: run.id, status: "OPEN", body: "חסר שלב בדיקת כפילויות", version: 1, authorId: hadas.id } });
    const decided = await call(ariel, "resolve_process_lesson", { client: "NUX", lessonId: lesson.id, decision: "DISMISSED", resolution: "נבדק כבר בשלב 1" });
    expect(decided.json).toMatchObject({ saved: true });
    expect((await prisma.processLesson.findUniqueOrThrow({ where: { id: lesson.id } })).status).toBe("DISMISSED");
  });
});
