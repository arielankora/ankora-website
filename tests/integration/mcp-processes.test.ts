import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientPolicy } from "@/lib/app-domain/client-policies";
import { addProcess, approveProcessVersion, saveProcessVersion } from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { mcpListProcesses } from "@/lib/app-domain/mcp-processes";
import { CONTINUOUS_NO_CHECK_BLOCKER } from "@/lib/process-readiness";

// list_processes, get_process and list_policies (claude/org-brain-spec-
// 2026-10-12.md, 8) against a real database. What is worth holding: the
// approved procedure reaches Claude step by step, a rule it fails is said,
// the interim rule is the one in force, and nothing reaches Claude that
// the client file's version for Claude would leave out: a sensitive item,
// or a restricted one the person asking is not named on, even a manager
// who may see it on the screen.

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
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

const S1 = [{ code: "S1" }];

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: created } = await createTestUser({ role: "ANKORA_ADMIN" });
  const ariel = await prisma.user.update({ where: { id: created.id }, data: { canApproveExceptions: true } });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const p1 = await addProcess(hadas, { clientId: client.id, title: "תשלומי ספקים", purpose: "לשלם בזמן", ownerId: hadas.id, triggerKinds: ["ON_DEMAND"], sources: S1 });
  await saveProcessVersion(hadas, p1.id, { steps: [{ title: "מעלים חשבוניות", actionTags: ["INVOICE"] }, { title: "מאשרים תשלום", actionTags: ["PAYMENT"], requiresApproval: true }], baseVersion: 0 });
  await approveProcessVersion(ariel, p1.id, 1);
  await addProcess(hadas, { clientId: client.id, title: "פרט רפואי", sensitivity: "SENSITIVE", triggerKinds: ["ON_DEMAND"], sources: S1 });
  return { client, hadas, ariel, p1 };
}

describe("list_processes and get_process", () => {
  it("lists what Claude may read, and gives the approved procedure step by step with its last runs", async () => {
    const { client, hadas, p1 } = await setup();
    const list = await call(hadas, "list_processes", { client: "NUX" });
    // The tool says exactly what the domain says, nothing added.
    expect(list.json.processes).toEqual(await mcpListProcesses(hadas, client.id));
    expect(list.json.processes.map((p: { code: string }) => p.code)).toEqual([p1.code]);
    expect(list.json.processes[0]).toMatchObject({ title: "תשלומי ספקים", owner: hadas.name, approvedVersion: 1 });
    expect(list.text).not.toContain("פרט רפואי");

    await startProcessRun(hadas, p1.id, new Date("2026-11-10T00:00:00Z"));
    const detail = await call(hadas, "get_process", { client: "NUX", process: p1.code });
    expect(detail.json.procedure.steps.map((s: { title: string; needsApproval: boolean }) => [s.title, s.needsApproval])).toEqual([
      ["מעלים חשבוניות", false],
      ["מאשרים תשלום", true],
    ]);
    expect(detail.json.recentRuns).toHaveLength(1);

    expect((await call(hadas, "get_process", { client: "NUX", process: "פרט רפואי" })).text).toContain("No process");
  });

  it("says which of the client's rules the procedure fails today", async () => {
    const { client, hadas, p1 } = await setup();
    await addClientPolicy(hadas, { clientId: client.id, kind: "FORBIDDEN", title: "בלי תשלומים", statement: "לא משלמים עד סוף השנה", params: { appliesToTags: ["PAYMENT"] }, sources: S1 });
    const detail = await call(hadas, "get_process", { client: "NUX", process: p1.code });
    expect(detail.json.procedure.failsRules.join()).toContain("בלי תשלומים");
  });

  // 3.11.2026: a process with only a draft gave `procedure: null` and
  // nothing else, so Claude could not see why it was blocked.
  it("gives a draft-only process its draft steps and what holds them back, with procedure still null", async () => {
    const { client, hadas } = await setup();
    const p2 = await addProcess(hadas, { clientId: client.id, title: "דוח חודשי", triggerKinds: ["ON_DEMAND"], sources: S1 });
    await saveProcessVersion(hadas, p2.id, { steps: [{ title: "שליפה", mode: "AUTOMATED" }, { title: "בדיקה" }, { title: "שמירה", mode: "AUTOMATED" }], baseVersion: 0 });
    const detail = await call(hadas, "get_process", { client: "NUX", process: p2.code });
    expect(detail.json.procedure).toBeNull();
    expect(detail.json.draftVersion).toBe(1);
    expect(detail.json.draft.version).toBe(1);
    expect(detail.json.draft.steps.map((s: { n: number; title: string; verification: string | null }) => [s.n, s.title, s.verification])).toEqual([
      [1, "שליפה", null],
      [2, "בדיקה", null],
      [3, "שמירה", null],
    ]);
    expect(detail.json.draft.failsRules).toEqual(["שלבים 1 ו-3 אוטומטיים: צריך לכתוב בכל אחד איך אדם מוודא שהשלב קרה."]);
  });

  it("an approved procedure with no draft has draft null", async () => {
    const { hadas, p1 } = await setup();
    const detail = await call(hadas, "get_process", { client: "NUX", process: p1.code });
    expect(detail.json.procedure.version).toBe(1);
    expect(detail.json.draft).toBeNull();
  });
});

describe("start_process and the check of an ongoing process (3.11.2026)", () => {
  it("opens one run a day; asked again for that day, answers with the run that is open", async () => {
    const { hadas, p1 } = await setup();
    const first = await call(hadas, "start_process", { client: "NUX", process: p1.code, date: "2026-11-04" });
    expect(first.json.alreadyOpen).toBeUndefined();
    const again = await call(hadas, "start_process", { client: "NUX", process: p1.code, date: "2026-11-04" });
    expect(again.json).toMatchObject({ alreadyOpen: true, taskId: first.json.taskId, link: first.json.link });
    expect(again.json.message).toContain("כבר יש ריצה פתוחה");
    const nextDay = await call(hadas, "start_process", { client: "NUX", process: p1.code, date: "2026-11-05" });
    expect(nextDay.json.taskId).not.toBe(first.json.taskId);
    expect(await prisma.task.count({ where: { processId: p1.id, parentId: null } })).toBe(2);
  });

  it("says how often an ongoing process is checked, and that it will not run without a check", async () => {
    const { client, hadas, ariel } = await setup();
    const withCheck = await addProcess(hadas, { clientId: client.id, title: "מעקב תיבה", ownerId: hadas.id, triggerKinds: ["CONTINUOUS"], triggerText: "כל הזמן", checkEveryDays: 7, checkText: "שאין מיילים בלי מענה", sources: S1 });
    const noCheck = await addProcess(hadas, { clientId: client.id, title: "תזכורת בוקר", ownerId: hadas.id, triggerKinds: ["CONTINUOUS"], triggerText: "כל יום עבודה ב-9:00", sources: S1 });
    for (const p of [withCheck, noCheck]) {
      await saveProcessVersion(hadas, p.id, { steps: [{ title: "שלב" }], baseVersion: 0 });
      await approveProcessVersion(ariel, p.id, 1);
    }
    const list = await call(hadas, "list_processes", { client: "NUX" });
    const byCode = new Map<string, { runs: string }>(list.json.processes.map((p: { code: string; runs: string }) => [p.code, p]));
    expect(byCode.get(withCheck.code)).toMatchObject({ check: "פעם בשבוע: שאין מיילים בלי מענה", runs: "רץ", notRunningBecause: [] });
    expect(byCode.get(noCheck.code)).toMatchObject({ check: null, notRunningBecause: [CONTINUOUS_NO_CHECK_BLOCKER] });
    expect(byCode.get(noCheck.code)?.runs).not.toBe("רץ");
    const detail = await call(hadas, "get_process", { client: "NUX", process: withCheck.code });
    expect(detail.json.check).toBe("פעם בשבוע: שאין מיילים בלי מענה");
  });
});

describe("list_policies", () => {
  it("gives Ankora's rules, the interim rule as the one in force, and never a restricted rule to a manager not named on it", async () => {
    const { client, hadas, ariel } = await setup();
    await addClientPolicy(hadas, { clientId: client.id, kind: "THRESHOLD", title: "תוכנה", statement: "עד 3,000$ בשנה מאושר", interimStatement: "כל הוצאה עוברת לאורן", sources: S1 });
    await addClientPolicy(hadas, { clientId: client.id, kind: "DISCLOSURE", title: "עזיבה", statement: "לא מספרים על עזיבת גיא", audience: "RESTRICTED", audienceUserIds: [hadas.id], sources: S1 });

    const forHadas = await call(hadas, "list_policies", { client: "NUX" });
    expect(forHadas.json.ankora.join()).toContain("תשלום");
    const software = forHadas.json.clientRules.find((r: { title: string }) => r.title === "תוכנה");
    expect(software).toMatchObject({ rule: "כל הוצאה עוברת לאורן", proposedRule: "עד 3,000$ בשנה מאושר" });
    expect(forHadas.text).toContain("עזיבה");

    const forAriel = await call(ariel, "list_policies", { client: "NUX" });
    expect(forAriel.text).not.toContain("עזיבה");
  });
});
