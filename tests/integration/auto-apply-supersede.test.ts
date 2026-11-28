import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientContact } from "@/lib/app-domain/client-contacts";
import { autoApplySetting, listAutoReview, setAutoApply } from "@/lib/app-domain/auto-apply";
import { proposalStatsForAi } from "@/lib/app-domain/proposal-stats";

// 28.11.2026 (Ariel, via Ankora Ops): a simple update (SUPERSEDE) at a
// high review level enters the file on arrival, through propose_knowledge.
// What is held here: it changes the item, it is listed under "נכנס
// אוטומטית" with what it changed, "ביטול" puts the item back, its reverts
// count in a pause bucket of its own (CONTACT:SUPERSEDE), apart from new
// contacts, and an update at a medium level still waits for a person.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
type Validated = { value?: unknown; issues?: readonly { message: string }[] };
type Schema = { "~standard"?: { validate: (v: unknown) => Validated | Promise<Validated> } };
const tools = new Map<string, { schema: Schema; handler: Handler }>();
registerAnkoraTools({ registerTool: (name: string, c: { inputSchema: Schema }, h: Handler) => tools.set(name, { schema: c.inputSchema, handler: h }) } as never);

async function call(user: User, name: string, args: unknown) {
  const tool = tools.get(name)!;
  const validated = tool.schema["~standard"] ? await tool.schema["~standard"].validate(args) : { value: args };
  if (validated.issues) throw new Error(`schema refused ${name}: ${validated.issues.map((i) => i.message).join("; ")}`);
  const result = await tool.handler(validated.value, { http: { authInfo: { extra: { user } } } });
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0].text);
}

const S1 = [{ code: "S1" }];

async function clientWith(user: User, name: string) {
  const client = await createTestClient({ name });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  const source = await addClientSource(user, { clientId: client.id, kind: "PERSON", title: `שיחה עם ${name}` });
  const contact = await addClientContact(user, { clientId: client.id, name: "דנה כהן", role: "CFO", context: "מטפלת בשכר", sources: S1 });
  return { client, source, contact };
}

async function setup() {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  return { user, ...(await clientWith(user, "NUX")) };
}

function roleUpdate(contactId: string, role: string, confidence = "HIGH") {
  return { target: "CONTACT", action: "SUPERSEDE", targetId: contactId, payload: { knowledgeStatus: "CONFIRMED", name: "דנה כהן", role }, reason: "אמרה בשיחה שהיא מנכ״לית עכשיו", confidence };
}

describe("an update (SUPERSEDE) at a high level enters on its own", () => {
  it("through propose_knowledge: changes the contact, listed with what it changed, and ביטול puts it back", async () => {
    const { user, client, source, contact } = await setup();
    const r = await call(user, "propose_knowledge", { client: "NUX", sourceCode: source.code, items: [roleUpdate(contact.id, "CEO")] });
    expect(r.enteredFile).toHaveLength(1);
    const proposalId = r.enteredFile[0].proposalId;
    const p = await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(p).toMatchObject({ state: "APPROVED", autoApplied: true, action: "SUPERSEDE", resultId: contact.id });
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: contact.id } })).role).toBe("CEO");

    // "נכנס אוטומטית": the first 14 days of updates, with the change.
    expect((await autoApplySetting()).supersedeEnabledAt).toBeInstanceOf(Date);
    const [item] = await listAutoReview(user);
    expect(item).toMatchObject({ id: proposalId, action: "SUPERSEDE", revertible: true, why: "עדכונים, 14 הימים הראשונים: בודקים כל עדכון" });
    expect(item.changes).toEqual([{ field: "role", before: "CFO", beforeKnown: true, after: "CEO" }]);

    // The connector: the same row, with the change in words.
    const listed = await call(user, "list_approvals", { kind: "knowledge" });
    const row = listed.enteredAutomatically.find((x: { proposalId: string }) => x.proposalId === proposalId);
    expect(row).toMatchObject({ action: "SUPERSEDE", says: "דנה כהן, CEO", changes: [{ field: "תפקיד", before: "CFO", after: "CEO" }], decisions: ["reviewed_ok", "revert"] });
    expect(listed.fieldNotes.enteredAutomatically).toContain("`changes`");

    const out = await call(user, "decide_knowledge_proposals", { proposalIds: [proposalId], decision: "revert" });
    expect(out).toMatchObject({ done: 1 });
    expect(await prisma.clientContact.findUniqueOrThrow({ where: { id: contact.id } })).toMatchObject({ role: "CFO", context: "מטפלת בשכר", deletedAt: null });
    expect((await listAutoReview(user)).map((i) => i.id)).not.toContain(proposalId);
    // The stats call the revert an error of this proposal.
    const { user: manager } = await createTestUser({ role: "SUPER_ADMIN" });
    const stats = await proposalStatsForAi(manager, { rows: true });
    expect(stats.rows!.find((x) => x.id === proposalId)).toMatchObject({ autoError: { type: "REVERTED" } });
    void client;
  });

  it("an update at a medium level waits for a person", async () => {
    const { user, source, contact } = await setup();
    const r = await call(user, "propose_knowledge", { client: "NUX", sourceCode: source.code, items: [roleUpdate(contact.id, "CEO", "MEDIUM")] });
    expect(r.enteredFile ?? []).toHaveLength(0);
    expect(r.proposed).toBe(1);
    expect(await prisma.knowledgeProposal.findFirstOrThrow({ where: { batchId: r.batchId } })).toMatchObject({ state: "PENDING", autoApplied: false });
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: contact.id } })).role).toBe("CFO");
  });

  it("a pause of new contacts does not hold updates back", async () => {
    const { user, source, contact } = await setup();
    await prisma.autoApplyPause.create({ data: { scope: "KIND", key: "CONTACT", errors: 3, reason: "3 מתוך 30" } });
    const r = await call(user, "propose_knowledge", { client: "NUX", sourceCode: source.code, items: [roleUpdate(contact.id, "CEO")] });
    expect(r.enteredFile).toHaveLength(1);
  });

  it("reverts of updates pause only updates (CONTACT:SUPERSEDE): new contacts still enter, and the managers' notice names it", async () => {
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    const { user: manager } = await createTestUser({ role: "SUPER_ADMIN" });
    // One client each: two errors of one client would pause the client.
    for (const name of ["A1", "A2", "A3"]) {
      const { source, contact } = await clientWith(user, name);
      const r = await call(user, "propose_knowledge", { client: name, sourceCode: source.code, items: [roleUpdate(contact.id, "CEO")] });
      expect(r.enteredFile, name).toHaveLength(1);
      await call(user, "decide_knowledge_proposals", { proposalIds: [r.enteredFile[0].proposalId], decision: "revert" });
    }
    const pauses = await prisma.autoApplyPause.findMany({ where: { liftedAt: null } });
    expect(pauses).toEqual([expect.objectContaining({ scope: "KIND", key: "CONTACT:SUPERSEDE", errors: 3, reason: expect.stringContaining("עדכון של איש קשר") })]);
    const notice = await prisma.notification.findFirstOrThrow({ where: { userId: manager.id, type: "knowledge.auto_apply_paused" } });
    expect(notice.title).toContain("עדכון של איש קשר");

    const { source, contact } = await clientWith(user, "A4");
    const r = await call(user, "propose_knowledge", {
      client: "A4",
      sourceCode: source.code,
      items: [roleUpdate(contact.id, "CEO"), { target: "CONTACT", payload: { knowledgeStatus: "CONFIRMED", name: "יוסי לוי", role: "CTO" }, reason: "הצטרף לשיחה", confidence: "HIGH" }],
    });
    // The new contact enters; the update waits for a person.
    expect(r.enteredFile).toEqual([expect.objectContaining({ says: "יוסי לוי, CTO" })]);
    const update = await prisma.knowledgeProposal.findFirstOrThrow({ where: { batchId: r.batchId, action: "SUPERSEDE" } });
    expect(update).toMatchObject({ state: "PENDING", autoApplied: false });

    // The pause shows on list_approvals for a manager, by its own label.
    const listed = await call(manager, "list_approvals", { kind: "knowledge" });
    expect(listed.autoApplyPauses).toEqual([expect.objectContaining({ scope: "KIND", label: "עדכון של איש קשר" })]);
  });

  it("turning auto-apply off and on keeps when updates began", async () => {
    const { user: manager } = await createTestUser({ role: "SUPER_ADMIN" });
    const before = (await autoApplySetting()).supersedeEnabledAt!;
    await setAutoApply(manager, false);
    await setAutoApply(manager, true);
    expect((await autoApplySetting()).supersedeEnabledAt).toEqual(before);
  });
});
