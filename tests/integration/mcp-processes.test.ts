import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientPolicy } from "@/lib/app-domain/client-policies";
import { addProcess, approveProcessVersion, saveProcessVersion } from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { mcpListProcesses } from "@/lib/app-domain/mcp-processes";

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
