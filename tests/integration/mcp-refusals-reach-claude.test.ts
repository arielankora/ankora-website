import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addProcess, approveProcessVersion, saveProcessVersion } from "@/lib/app-domain/processes";

// QA level 3, 15.11.2026: a refusal of the domain has to reach Claude in
// its own words (CLAUDE.md, "סירוב חדש של הדומיין"). toMcpToolError
// (lib/mcp/errors.ts) passes a DomainError through and turns anything else
// into "an unexpected server error ... Do not retry", which is right for a
// Prisma crash and wrong for a rule saying no.
//
// These four refusals are thrown as a plain `Error`, not a DomainError, so
// each one reaches Claude as "unexpected server error", although each
// sentence was written to tell Claude (or the person) what to do instead:
//
//   1. get_proposal_stats by someone who is not a manager
//      (lib/app-domain/proposal-stats.ts, "רק למנהלים.")
//   2. get_procedure_for_translation on a sensitive process
//      (lib/app-domain/procedure-documents.ts, "Translate it by hand.")
//   3. record_stranger_test with a step the procedure does not have
//      (lib/app-domain/stranger-tests.ts, via lib/stranger-test.ts)
//   4. propose_knowledge `uncertain` for a meeting already registered
//      under one of the candidates (lib/app-domain/batch-assignment.ts,
//      "...שולחים אליו עם sourceCode.")
//
// Each is `it.fails` so CI stays green and the suite asks for `.fails` to
// be removed the moment the refusal reaches Claude in its own words.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
type Issue = { message: string; path?: readonly (PropertyKey | { key: PropertyKey })[] };
type Validated = { value?: unknown; issues?: readonly Issue[] };
type Schema = { "~standard"?: { validate: (v: unknown) => Validated | Promise<Validated> }; parse?: (v: unknown) => unknown };
const tools = new Map<string, { schema: Schema; handler: Handler }>();
registerAnkoraTools({ registerTool: (name: string, c: { inputSchema: Schema }, h: Handler) => tools.set(name, { schema: c.inputSchema, handler: h }) } as never);

/// Calls the tool as the MCP server does: the published schema first, then the handler.
async function call(user: User, name: string, args: unknown) {
  const tool = tools.get(name)!;
  const validated = await tool.schema["~standard"]!.validate(args);
  if (validated.issues) throw new Error(`schema refused ${name}: ${validated.issues.map((i) => i.message).join("; ")}`);
  const result = await tool.handler(validated.value, { http: { authInfo: { extra: { user } } } });
  return result.content.map((c) => c.text).join("");
}

const UNEXPECTED = "unexpected server error";
const S1 = [{ code: "S1" }];

async function setup() {
  const nux = await createTestClient({ name: "NUX" });
  const rimed = await createTestClient({ name: "RIMED" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: created } = await createTestUser({ role: "ANKORA_ADMIN" });
  const ariel = await prisma.user.update({ where: { id: created.id }, data: { canApproveExceptions: true } });
  for (const clientId of [nux.id, rimed.id]) await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId } });
  await addClientSource(hadas, { clientId: nux.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  return { nux, rimed, hadas, ariel };
}

describe("a refusal of the domain reaches Claude in its own words, not as an unexpected error", () => {
  it.fails("1. get_proposal_stats, asked by an employee who is not a manager", async () => {
    const { hadas } = await setup();
    const text = await call(hadas, "get_proposal_stats", {});
    expect(text).not.toContain(UNEXPECTED);
    expect(text).toContain("רק למנהלים");
  });

  it.fails("2. get_procedure_for_translation on a sensitive process", async () => {
    const { nux, hadas, ariel } = await setup();
    const p = await addProcess(hadas, { clientId: nux.id, title: "פרט רפואי", sensitivity: "SENSITIVE", triggerKinds: ["ON_DEMAND"], sources: S1 });
    await saveProcessVersion(hadas, p.id, { steps: [{ title: "שולחים את הטופס", actionTags: ["OTHER"] }], baseVersion: 0 });
    await approveProcessVersion(ariel, p.id, 1);
    const text = await call(hadas, "get_procedure_for_translation", { client: "NUX", process: p.code });
    expect(text).not.toContain(UNEXPECTED);
    expect(text).toContain("Translate it by hand");
  });

  it.fails("3. record_stranger_test with a step the procedure does not have", async () => {
    const { nux, hadas } = await setup();
    const p = await addProcess(hadas, { clientId: nux.id, title: "תשלומי ספקים", purpose: "לשלם בזמן", ownerId: hadas.id, triggerKinds: ["ON_DEMAND"], sources: S1 });
    await saveProcessVersion(hadas, p.id, { steps: [{ title: "מעלים חשבוניות", actionTags: ["INVOICE"] }, { title: "מאשרים תשלום", actionTags: ["PAYMENT"] }], baseVersion: 0 });
    const text = await call(hadas, "record_stranger_test", {
      client: "NUX",
      process: p.code,
      questions: [{ step: 9, severity: "BLOCKER", askWho: "ANKORA", question: "מאיפה מורידים את החשבוניות?" }],
    });
    expect(text).not.toContain(UNEXPECTED);
    expect(text).toContain("אין בנוהל שלב 9");
  });

  it.fails("4. propose_knowledge `uncertain` for a meeting already registered under a candidate", async () => {
    const { rimed, hadas } = await setup();
    await addClientSource(hadas, { clientId: rimed.id, kind: "TRANSCRIPT", title: "Weekly sync", externalIds: ["ff-123"] });
    const text = await call(hadas, "propose_knowledge", {
      client: "NUX",
      newSource: { kind: "TRANSCRIPT", title: "Weekly sync", firefliesId: "ff-123" },
      uncertain: { candidates: ["NUX", "RIMED"], reason: "הכותרת לא אומרת, והמשתתפים משני הלקוחות." },
      items: [{ target: "FACT", payload: { kind: "PREFERENCE", body: "מעדיפים עדכון במייל" }, reason: "נאמר בשיחה", confidence: "HIGH" }],
    });
    expect(text).not.toContain(UNEXPECTED);
    expect(text).toContain("sourceCode");
  });
});
