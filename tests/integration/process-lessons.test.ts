import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, saveProcessVersion } from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { LESSON_ARRIVED, listLessons, recordRunLesson, resolveLesson } from "@/lib/app-domain/process-lessons";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";

// Learning from runs (claude/org-brain-spec-2026-10-12.md, 5.4).
//
// What is worth holding: the question is asked of a run, once, only after
// it is done; a remark reaches the process's owner and waits on the
// process until its owner or a manager decides, with a line; "it held" is
// recorded and asked no more; a secret never enters; and Claude can give
// the answer, and read the open remarks before drafting a version.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));
import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[] }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);
async function call(user: User, name: string, args: unknown) {
  const text = (await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } })).content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ana } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ariel } = await createTestUser({ role: "ANKORA_ADMIN" });
  for (const u of [hadas, ana]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const process = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים", ownerId: hadas.id, backupOwnerId: ana.id, triggerKinds: ["ON_DEMAND"], sources: S1 });
  await saveProcessVersion(hadas, process.id, { steps: [{ title: "מעלים חשבוניות", actionTags: ["INVOICE"] }], baseVersion: 0 });
  await approveProcessVersion(ariel, process.id, 1);
  return { client, hadas, ana, ariel, process };
}

async function closedRun(user: User, processId: string, day: string) {
  const run = await startProcessRun(user, processId, new Date(`${day}T00:00:00Z`));
  await prisma.task.update({ where: { id: run.id }, data: { status: "DONE", completedAt: new Date() } });
  return run;
}

describe("learning from runs", () => {
  it("asks a done run once; a remark reaches the owner and waits on the process", async () => {
    const { client, hadas, ana, process } = await setup();
    const open = await startProcessRun(ana, process.id, new Date("2026-11-10T00:00:00Z"));
    await expect(recordRunLesson(ana, open.id, "משהו")).rejects.toThrow("אחרי שהריצה הסתיימה");

    const run = await closedRun(ana, process.id, "2026-11-25");
    const lesson = await recordRunLesson(ana, run.id, "שלב 1 צריך להתחיל יום קודם, איילה לא עונה בשישי");
    expect(lesson).toMatchObject({ status: "OPEN", version: 1, processId: process.id });
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: hadas.id, type: LESSON_ARRIVED } });
    expect(note.body).toContain("איילה לא עונה בשישי");
    await expect(recordRunLesson(hadas, run.id, null)).rejects.toThrow("כבר ענו");

    // "It held" is an answer, kept apart from the remarks.
    const quiet = await closedRun(hadas, process.id, "2026-12-10");
    expect((await recordRunLesson(hadas, quiet.id, null)).status).toBe("NOTHING");
    expect((await listLessons([process.id])).map((l) => l.status)).toEqual(["OPEN"]);

    expect(toMarkdown(await buildClientFile(hadas, client.id, { audience: "staff" }))).toContain("הערה אחת מריצות ממתינה לגרסה הבאה");
  });

  it("a remark the owner writes goes to the backup; a secret never enters", async () => {
    const { hadas, ana, process } = await setup();
    const run = await closedRun(hadas, process.id, "2026-11-25");
    await expect(recordRunLesson(hadas, run.id, "הסיסמה לבנק היא Pa55w0rd!xyz")).rejects.toThrow("סודות נשמרים בכספת");
    await recordRunLesson(hadas, run.id, "חסר שלב של בדיקת כפילויות");
    expect(await prisma.notification.count({ where: { userId: ana.id, type: LESSON_ARRIVED } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: hadas.id, type: LESSON_ARRIVED } })).toBe(0);
  });

  it("the owner or a manager decides, with a line; nobody else", async () => {
    const { hadas, ana, ariel, process } = await setup();
    const run = await closedRun(ana, process.id, "2026-11-25");
    const lesson = await recordRunLesson(ana, run.id, "שלב 1 צריך להתחיל יום קודם");
    await expect(resolveLesson(ana, lesson.id, "APPLIED", "גרסה 2")).rejects.toThrow("רק הבעלים");
    await expect(resolveLesson(hadas, lesson.id, "APPLIED", " ")).rejects.toThrow("איפה זה נכנס");
    const done = await resolveLesson(hadas, lesson.id, "APPLIED", "גרסה 2, שלב 1");
    expect(done).toMatchObject({ status: "APPLIED", resolution: "גרסה 2, שלב 1", resolvedById: hadas.id });
    await expect(resolveLesson(ariel, lesson.id, "DISMISSED", "לא")).rejects.toThrow("כבר הוחלט");
  });

  it("Claude records the answer once the user confirms, and reads the open remarks", async () => {
    const { hadas, ana, process } = await setup();
    const run = await closedRun(ana, process.id, "2026-11-25");
    expect((await call(ana, "record_run_lesson", { taskId: run.id })).text).toContain("nothing: true");
    expect((await call(ana, "record_run_lesson", { taskId: run.id, lesson: "חסר מי מאשר בהיעדר אורן" })).json).toMatchObject({ recorded: "lesson" });
    const detail = await call(hadas, "get_process", { client: "NUX", process: process.code });
    expect(detail.json.openLessons).toEqual([expect.objectContaining({ lesson: "חסר מי מאשר בהיעדר אורן", fromVersion: 1 })]);
  });
});
