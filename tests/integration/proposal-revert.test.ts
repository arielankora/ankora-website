import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientFact, listClientFacts, removeClientFact } from "@/lib/app-domain/client-facts";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientContact, addClientOrganization, updateClientContact } from "@/lib/app-domain/client-contacts";
import { addSystemAccess } from "@/lib/app-domain/system-map";
import { addRequestType } from "@/lib/app-domain/request-types";
import { addClientEntity } from "@/lib/app-domain/client-entities";
import { approveProposal, listOpenBatches, proposeKnowledge, revertProposal, type ProposalItemInput } from "@/lib/app-domain/knowledge-proposals";

// "ביטול" of an approved change (19.11.2026): a SUPERSEDE or a CONTRADICT
// puts the item back as it was before it, from the approval's audit row,
// and is refused when the item changed after, when that row is missing,
// and for a process or a rule. Also through the connector.

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
  const validated = await tool.schema["~standard"]!.validate(args);
  if (validated.issues) throw new Error(`schema refused ${name}: ${validated.issues.map((i) => i.message).join("; ")}`);
  const result = await tool.handler(validated.value, { http: { authInfo: { extra: { user } } } });
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0].text);
}

let n = 0;

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "CLIENT_DOCUMENT", title: "טופס פתיחה" }); // S1
  return { client, user };
}

/// One change proposed from a new meeting (S2...), and approved by `user`
/// (or entered on its own with `auto`).
async function approveChange(user: User, clientId: string, item: ProposalItemInput, auto = false) {
  n++;
  const r = await proposeKnowledge(user, { clientId, source: { kind: "TRANSCRIPT", title: `פגישה ${n}`, occurredAt: new Date("2026-11-10T00:00:00Z"), externalIds: [`ff-revert-${n}`] }, items: [item] });
  expect(r.dropped).toEqual([]);
  const p = (await listOpenBatches(user)).find((b) => b.id === r.batchId)!.proposals[0];
  await approveProposal(user, p.id, {}, auto ? { auto: true } : {});
  return p.id;
}

const S1 = [{ code: "S1" }];

describe("ביטול of an approved change", () => {
  it("a fact's replacement: the new version leaves and the old one is current again, with its status", async () => {
    const { client, user } = await setup();
    const old = await addClientFact(user, { clientId: client.id, kind: "PREFERENCE", body: "דוחות ביום ראשון", sources: S1 });
    expect(old.knowledgeStatus).toBe("CONFIRMED");
    const id = await approveChange(user, client.id, { target: "FACT", reason: "נאמר", at: "01:00", action: "SUPERSEDE", targetId: old.id, payload: { knowledgeStatus: "CONFIRMED", kind: "PREFERENCE", body: "דוחות ביום שני" } });
    const newId = (await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id } })).resultId!;
    expect((await listClientFacts(user, client.id)).current.map((f) => f.body)).toEqual(["דוחות ביום שני"]);

    const reverted = await revertProposal(user, id);
    expect(reverted.revertedAt).toBeInstanceOf(Date);
    expect((await listClientFacts(user, client.id)).current.map((f) => f.body)).toEqual(["דוחות ביום ראשון"]);
    expect(await prisma.clientFact.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ knowledgeStatus: "CONFIRMED", supersededById: null, supersededAt: null, deletedAt: null });
    expect((await prisma.clientFact.findUniqueOrThrow({ where: { id: newId } })).deletedAt).not.toBeNull();
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: id, action: "knowledge_proposal.revert" } });
    expect(audit.afterJson).toMatchObject({ action: "SUPERSEDE", target: "FACT", autoApplied: false });
    expect(await prisma.auditEvent.count({ where: { entityId: old.id, action: "client_fact.restore" } })).toBe(1);
    await expect(revertProposal(user, id)).rejects.toThrow("כבר בוטלה");
  });

  it("an answered question is open again, and a version of another kind leaves the file", async () => {
    const { client, user } = await setup();
    const question = await addClientFact(user, { clientId: client.id, kind: "QUESTION", body: "מה מדיניות החופש?", sources: S1 });
    const pref = await addClientFact(user, { clientId: client.id, kind: "PREFERENCE", body: "WhatsApp קודם", sources: S1 });
    const answer = await approveChange(user, client.id, { target: "FACT", reason: "נאמר", at: "01:30", action: "SUPERSEDE", targetId: question.id, payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "Unlimited Vacation" } });
    const note = await approveChange(user, client.id, { target: "FACT", reason: "נאמר", at: "01:40", action: "SUPERSEDE", targetId: pref.id, payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "Slack לדחוף" } });
    await revertProposal(user, answer);
    expect(await prisma.clientFact.findUniqueOrThrow({ where: { id: question.id } })).toMatchObject({ answer: null, answeredAt: null, knowledgeStatus: "MISSING", sources: S1 });
    await revertProposal(user, note);
    expect((await listClientFacts(user, client.id)).current.map((f) => f.body).sort()).toEqual(["WhatsApp קודם", "מה מדיניות החופש?"]);
  });

  it("a contact's update: exactly the fields it changed come back, with the sources it had", async () => {
    const { client, user } = await setup();
    const c = await addClientContact(user, { clientId: client.id, name: "דנה כהן", role: "CFO", emails: ["dana@nux.example"], context: "מטפלת בשכר", sources: S1 });
    const id = await approveChange(user, client.id, { target: "CONTACT", reason: "נאמר", at: "02:00", action: "SUPERSEDE", targetId: c.id, payload: { knowledgeStatus: "CONFIRMED", name: "דנה כהן", role: "CEO", emails: ["dana@new.example"] } });
    const changed = await prisma.clientContact.findUniqueOrThrow({ where: { id: c.id }, include: { person: true } });
    expect(changed.role).toBe("CEO");
    expect(changed.person.emails).toEqual(["dana@new.example"]);

    await revertProposal(user, id);
    const back = await prisma.clientContact.findUniqueOrThrow({ where: { id: c.id }, include: { person: true } });
    expect(back).toMatchObject({ role: "CFO", context: "מטפלת בשכר", knowledgeStatus: "CONFIRMED", deletedAt: null });
    expect(back.person.emails).toEqual(["dana@nux.example"]);
    expect(back.person.name).toBe("דנה כהן");
    expect(back.sources).toEqual(S1);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: id, action: "knowledge_proposal.revert" } });
    expect((audit.afterJson as { restored: string[] }).restored).toEqual(expect.arrayContaining(["role", "emails", "sources"]));
    // The write-back is the contact's own update, with its own audit row.
    expect(await prisma.auditEvent.count({ where: { entityId: c.id, action: "client_contact.update" } })).toBe(2);
  });

  it("a provider, an entity, a system and a request type come back the same way", async () => {
    const { client, user } = await setup();
    const org = await addClientOrganization(user, { clientId: client.id, name: "רואי חשבון בע\"מ", role: "הנהלת חשבונות", sources: S1 });
    const entity = await addClientEntity(user, { clientId: client.id, name: "NUX Inc", legalName: "NUX Incorporated", sources: S1 });
    const system = await addSystemAccess(user, { clientId: client.id, systemName: "Mercury", accessStatus: "PENDING", sources: S1 });
    const rt = await addRequestType(user, { clientId: client.id, title: "בקשת החזר", handling: "מעבירים לדנה", sources: S1 });
    const ids = [
      await approveChange(user, client.id, { target: "ORGANIZATION", reason: "נאמר", at: "03:00", action: "SUPERSEDE", targetId: org.id, payload: { knowledgeStatus: "CONFIRMED", name: "רואי חשבון בע\"מ", role: "ביקורת" } }),
      await approveChange(user, client.id, { target: "ENTITY", reason: "נאמר", at: "04:00", action: "SUPERSEDE", targetId: entity.id, payload: { knowledgeStatus: "CONFIRMED", name: "NUX Inc", legalName: "NUX Holdings Inc" } }),
      await approveChange(user, client.id, { target: "SYSTEM", reason: "נאמר", at: "05:00", action: "SUPERSEDE", targetId: system.id, payload: { knowledgeStatus: "CONFIRMED", systemName: "Mercury", accessStatus: "HAS_ACCESS" } }),
      await approveChange(user, client.id, { target: "REQUEST_TYPE", reason: "נאמר", at: "06:00", action: "SUPERSEDE", targetId: rt.id, payload: { knowledgeStatus: "CONFIRMED", title: "בקשת החזר", handling: "מעבירים ליוסי" } }),
    ];
    expect((await prisma.systemAccess.findUniqueOrThrow({ where: { id: system.id } })).accessStatus).toBe("HAS_ACCESS");
    for (const id of ids) await revertProposal(user, id);
    expect(await prisma.clientOrganization.findUniqueOrThrow({ where: { id: org.id } })).toMatchObject({ role: "הנהלת חשבונות", sources: S1 });
    expect(await prisma.clientEntity.findUniqueOrThrow({ where: { id: entity.id } })).toMatchObject({ legalName: "NUX Incorporated", sources: S1 });
    expect(await prisma.systemAccess.findUniqueOrThrow({ where: { id: system.id } })).toMatchObject({ accessStatus: "PENDING", sources: S1 });
    expect(await prisma.requestType.findUniqueOrThrow({ where: { id: rt.id } })).toMatchObject({ handling: "מעבירים לדנה", sources: S1 });
  });

  it("a contradiction: the alternative and the uncertain mark come off, of a fact and of a contact", async () => {
    const { client, user } = await setup();
    const bank = await addClientFact(user, { clientId: client.id, kind: "FINANCE", body: "הבנק בישראל: לאומי", sources: S1 });
    const c = await addClientContact(user, { clientId: client.id, name: "יוסי לוי", role: "CEO", sources: S1 });
    const onFact = await approveChange(user, client.id, { target: "FACT", reason: "נאמר", at: "07:00", action: "CONTRADICT", targetId: bank.id, payload: { knowledgeStatus: "CONFIRMED", kind: "FINANCE", body: "הבנק בישראל: הפועלים" } });
    const onContact = await approveChange(user, client.id, { target: "CONTACT", reason: "נאמר", at: "08:00", action: "CONTRADICT", targetId: c.id, payload: { knowledgeStatus: "CONFIRMED", name: "יוסי לוי", role: "CTO" } });
    expect((await prisma.clientFact.findUniqueOrThrow({ where: { id: bank.id } })).knowledgeStatus).toBe("UNCERTAIN");
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: c.id } })).knowledgeStatus).toBe("UNCERTAIN");

    await revertProposal(user, onFact);
    expect(await prisma.clientFact.findUniqueOrThrow({ where: { id: bank.id } })).toMatchObject({ knowledgeStatus: "CONFIRMED", toResolve: null, alternatives: [], body: "הבנק בישראל: לאומי", sources: S1 });
    await revertProposal(user, onContact);
    expect(await prisma.clientContact.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ knowledgeStatus: "CONFIRMED", toResolve: null, role: "CEO", sources: S1 });
  });

  it("refused, in its own words, when the item changed after the approval; the proposal stays as it was", async () => {
    const { client, user } = await setup();
    const c = await addClientContact(user, { clientId: client.id, name: "מיכל", role: "CFO", sources: S1 });
    const id = await approveChange(user, client.id, { target: "CONTACT", reason: "נאמר", at: "09:00", action: "SUPERSEDE", targetId: c.id, payload: { knowledgeStatus: "CONFIRMED", name: "מיכל", role: "COO" } });
    await updateClientContact(user, c.id, { context: "נוסף ביד" });
    await expect(revertProposal(user, id)).rejects.toMatchObject({ code: "knowledgeProposals.changedSince", message: expect.stringContaining("השתנה אחרי האישור") });
    expect((await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id } })).revertedAt).toBeNull();
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: c.id } })).role).toBe("COO");

    // A fact's new version taken out by hand after: the same.
    const old = await addClientFact(user, { clientId: client.id, kind: "NOTE", body: "ישן", sources: S1 });
    const factId = await approveChange(user, client.id, { target: "FACT", reason: "נאמר", at: "10:00", action: "SUPERSEDE", targetId: old.id, payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "חדש" } });
    await removeClientFact(user, (await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: factId } })).resultId!);
    await expect(revertProposal(user, factId)).rejects.toThrow("השתנה אחרי האישור");
    expect((await prisma.clientFact.findUniqueOrThrow({ where: { id: old.id } })).knowledgeStatus).toBe("SUPERSEDED");
  });

  it("refused when the approval's audit row is missing", async () => {
    const { client, user } = await setup();
    const c = await addClientContact(user, { clientId: client.id, name: "רון", role: "CFO", sources: S1 });
    const id = await approveChange(user, client.id, { target: "CONTACT", reason: "נאמר", at: "11:00", action: "SUPERSEDE", targetId: c.id, payload: { knowledgeStatus: "CONFIRMED", name: "רון", role: "CEO" } });
    // Audit rows are append-only: an approval with no row on its item is
    // one whose item the log never saw change (here, another contact).
    const other = await addClientContact(user, { clientId: client.id, name: "רונית", role: "CFO", sources: S1 });
    await prisma.knowledgeProposal.update({ where: { id }, data: { targetId: other.id, resultId: other.id } });
    await expect(revertProposal(user, id)).rejects.toMatchObject({ code: "knowledgeProposals.noSnapshot", message: expect.stringContaining("לא נשמר בתיעוד") });
    expect((await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id } })).revertedAt).toBeNull();
  });

  it("a change of a process or a rule is not undone from here, and says why", async () => {
    const { client, user } = await setup();
    const c = await addClientContact(user, { clientId: client.id, name: "גל", role: "CFO", sources: S1 });
    const id = await approveChange(user, client.id, { target: "CONTACT", reason: "נאמר", at: "12:00", action: "SUPERSEDE", targetId: c.id, payload: { knowledgeStatus: "CONFIRMED", name: "גל", role: "CEO" } });
    // The same approved change, as if it were of a process, then of a rule.
    await prisma.knowledgeProposal.update({ where: { id }, data: { target: "PROCESS" } });
    await expect(revertProposal(user, id)).rejects.toMatchObject({ code: "knowledgeProposals.cannotRevert", values: { reason: "manualUndo", target: "PROCESS" }, message: expect.stringContaining("טיוטת נוהל") });
    await prisma.knowledgeProposal.update({ where: { id }, data: { target: "POLICY", action: "CONTRADICT" } });
    await expect(revertProposal(user, id)).rejects.toThrow("מוצע");
    expect((await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id } })).revertedAt).toBeNull();
  });
});

describe("through the connector: decide_knowledge_proposals revert on a change that entered automatically", () => {
  it("lists `revert` for it, puts the contact back, and a refusal reaches Claude in its own words", async () => {
    const { client, user } = await setup();
    const c = await addClientContact(user, { clientId: client.id, name: "שירה", role: "CFO", sources: S1 });
    const id = await approveChange(user, client.id, { target: "CONTACT", reason: "נאמר", at: "13:00", action: "SUPERSEDE", targetId: c.id, payload: { knowledgeStatus: "CONFIRMED", name: "שירה", role: "CEO" } }, true);
    const c2 = await addClientContact(user, { clientId: client.id, name: "עומר", role: "CFO", sources: S1 });
    const changedAfter = await approveChange(user, client.id, { target: "CONTACT", reason: "נאמר", at: "14:00", action: "SUPERSEDE", targetId: c2.id, payload: { knowledgeStatus: "CONFIRMED", name: "עומר", role: "CEO" } }, true);
    await updateClientContact(user, c2.id, { context: "נוסף ביד" });
    // Entered automatically while first enabled: waiting for a look.
    const listed = await call(user, "list_approvals", { kind: "knowledge" });
    const row = (listed.enteredAutomatically ?? []).find((r: { proposalId: string }) => r.proposalId === id);
    expect(row).toMatchObject({ action: "SUPERSEDE", decisions: ["reviewed_ok", "revert"] });

    const out = await call(user, "decide_knowledge_proposals", { proposalIds: [id, changedAfter], decision: "revert" });
    expect(out).toMatchObject({ done: 1, failed: 1 });
    expect(out.errors).toEqual([{ proposalId: changedAfter, error: expect.stringContaining("השתנה אחרי האישור") }]);
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: c.id } })).role).toBe("CFO");
    expect((await prisma.clientContact.findUniqueOrThrow({ where: { id: c2.id } })).role).toBe("CEO");
    expect((await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id } })).revertedById).toBe(user.id);
  });
});
