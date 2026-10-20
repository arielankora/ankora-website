import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { addClientSource, removeClientSource } from "@/lib/app-domain/client-sources";
import {
  addClientPolicy,
  approveClientPolicy,
  listClientPolicies,
  removeClientPolicy,
  retireClientPolicy,
  updateClientPolicy,
} from "@/lib/app-domain/client-policies";
import { approveProposal, listOpenBatches, proposeKnowledge } from "@/lib/app-domain/knowledge-proposals";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";

// Org brain, phase 3 (claude/org-brain-spec-2026-10-12.md, 3.11).
//
// What is worth holding here: a rule binds only once a manager approves
// it, a proposed permission is read through its careful interim rule, an
// approved rule cannot be softened without going back to a manager, and
// the rules reach the places that act on them today: the file Claude
// reads, the extraction brief, and the review screen.

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
  await prisma.userClientAccess.create({ data: { userId: employee.id, clientId: client.id } });
  await addClientSource(employee, { clientId: client.id, kind: "TRANSCRIPT", title: "פגישת חפיפה" });
  return { client, employee, manager };
}

const S1 = [{ code: "S1", at: "12:00" }];

describe("client policies", () => {
  it("anyone on the client writes a rule; it is proposed until a manager approves it", async () => {
    const { client, employee, manager } = await setup();
    const p = await addClientPolicy(employee, { clientId: client.id, kind: "DATA_HANDLING", title: "פגישות הנהלה", statement: "נושאים בלבד", sources: S1 });
    expect(p.status).toBe("PROPOSED");
    await expect(approveClientPolicy(employee, p.id)).rejects.toThrow("רק מנהל");
    const approved = await approveClientPolicy(manager, p.id);
    expect(approved).toMatchObject({ status: "ACTIVE", approvedById: manager.id });
    await expect(approveClientPolicy(manager, p.id)).rejects.toThrow("רק כלל מוצע");
  });

  it("a proposed permission needs an interim rule, and an uncertain rule is not approved", async () => {
    const { client, employee, manager } = await setup();
    await expect(
      addClientPolicy(employee, { clientId: client.id, kind: "THRESHOLD", title: "תוכנה", statement: "עד 3,000$ בשנה מאושר", sources: S1 })
    ).rejects.toThrow("כלל ביניים");
    const p = await addClientPolicy(employee, {
      clientId: client.id,
      kind: "THRESHOLD",
      title: "תוכנה",
      statement: "עד 3,000$ בשנה מאושר",
      interimStatement: "כל הוצאה עוברת לאורן",
      knowledgeStatus: "UNCERTAIN",
      toResolve: "אישור בכתב של אורן",
      sources: S1,
    });
    await expect(approveClientPolicy(manager, p.id)).rejects.toThrow("עוד לא ודאי");
  });

  // 20.10.2026: not every client puts things in writing. On Ankora's own
  // document alone "מאושר" was saved as uncertain without a word, and the
  // rule could never be approved.
  it("confirmed by hand on an Ankora document, a rule stays confirmed, survives later edits, and can be approved", async () => {
    const { client, employee, manager } = await setup();
    await addClientSource(employee, { clientId: client.id, kind: "ANKORA_DOCUMENT", title: "סיכום של הדס", weight: "SECONDARY" });
    const S2 = [{ code: "S2" }];
    const p = await addClientPolicy(employee, { clientId: client.id, kind: "INFO", title: "חריגים: אישור אורן", statement: "חריג מגיע לשכר רק אחרי אישור כתוב של אורן", sources: S2 });
    expect(p).toMatchObject({ knowledgeStatus: "UNCERTAIN" });
    await expect(approveClientPolicy(manager, p.id)).rejects.toThrow("עוד לא ודאי");

    // The same save without the box changes nothing; with it, it is confirmed.
    expect(await updateClientPolicy(employee, p.id, { knowledgeStatus: "CONFIRMED", sources: S2 })).toMatchObject({ knowledgeStatus: "UNCERTAIN" });
    const confirmed = await updateClientPolicy(employee, p.id, { knowledgeStatus: "CONFIRMED", sources: S2, manualConfirm: true });
    expect(confirmed).toMatchObject({ knowledgeStatus: "CONFIRMED", toResolve: null });

    // Another edit on the same sources does not lower it again.
    expect(await updateClientPolicy(employee, p.id, { knowledgeStatus: "CONFIRMED", rationale: "לפי גיא", sources: S2 })).toMatchObject({ knowledgeStatus: "CONFIRMED" });
    expect(await approveClientPolicy(manager, p.id)).toMatchObject({ status: "ACTIVE" });
  });

  it("changing what an approved rule says is a new version, back with a manager; a source note is not", async () => {
    const { client, employee, manager } = await setup();
    const p = await addClientPolicy(employee, { clientId: client.id, kind: "SEPARATION", title: "Inc ו-LTD", statement: "לא שולחים לאיילה שום דבר של Inc", sources: S1 });
    await approveClientPolicy(manager, p.id);

    const resourced = await updateClientPolicy(employee, p.id, { sources: [{ code: "S1", at: "13:10" }] });
    expect(resourced).toMatchObject({ status: "ACTIVE", version: 1 });

    const softened = await updateClientPolicy(employee, p.id, { statement: "אפשר לשלוח לאיילה חשבוניות Inc דחופות" });
    expect(softened).toMatchObject({ status: "PROPOSED", version: 2, approvedById: null });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: p.id, action: "client_policy.reopen" } });
    expect(audit).not.toBeNull();
  });

  it("what the server checks is part of the rule: raising a threshold reopens it, and entities must be the client's", async () => {
    const { client, employee, manager } = await setup();
    const p = await addClientPolicy(employee, {
      clientId: client.id,
      kind: "THRESHOLD",
      title: "תוכנה",
      statement: "תוכנה עד 3,000$ בשנה מאושרת",
      interimStatement: "כל הוצאה עוברת לאורן",
      params: { amountMinor: 300000, currency: "USD", channels: ["EMAIL"] },
      sources: S1,
    });
    // Keys the kind does not take are dropped.
    expect(p.params).toEqual({ amountMinor: 300000, currency: "USD" });
    await approveClientPolicy(manager, p.id);
    const same = await updateClientPolicy(employee, p.id, { params: { currency: "USD", amountMinor: 300000 } });
    expect(same).toMatchObject({ status: "ACTIVE", version: 1 });
    const raised = await updateClientPolicy(employee, p.id, { params: { amountMinor: 900000, currency: "USD" } });
    expect(raised).toMatchObject({ status: "PROPOSED", version: 2 });

    await expect(
      addClientPolicy(employee, { clientId: client.id, kind: "THRESHOLD", title: "x", statement: "x", interimStatement: "x", params: { amountMinor: 100 }, sources: S1 })
    ).rejects.toThrow("מטבע");
    const other = await createTestClient({ name: "Other" });
    const foreign = await prisma.clientEntity.create({ data: { clientId: other.id, name: "Inc" } });
    await expect(
      addClientPolicy(employee, { clientId: client.id, kind: "FORBIDDEN", title: "x", statement: "x", params: { appliesToTags: ["PAYMENT"], entityId: foreign.id }, sources: S1 })
    ).rejects.toThrow("ישות");
  });

  it("an approved rule is retired, never deleted; a proposed one written by mistake can be removed", async () => {
    const { client, employee, manager } = await setup();
    const a = await addClientPolicy(employee, { clientId: client.id, kind: "INFO", title: "א", statement: "x", sources: S1 });
    const b = await addClientPolicy(employee, { clientId: client.id, kind: "INFO", title: "ב", statement: "y", sources: S1 });
    await approveClientPolicy(manager, a.id);
    await expect(removeClientPolicy(employee, a.id)).rejects.toThrow("מבטלים אותו");
    await expect(retireClientPolicy(employee, a.id, "בוטל")).rejects.toThrow("רק מנהל");
    await expect(retireClientPolicy(manager, a.id, " ")).rejects.toThrow("למה");
    await retireClientPolicy(manager, a.id, "אורן ביטל");
    await expect(updateClientPolicy(employee, a.id, { statement: "z" })).rejects.toThrow("שבוטל");
    await removeClientPolicy(employee, b.id);

    const list = await listClientPolicies(employee, client.id);
    expect(list.map((p) => [p.title, p.status])).toEqual([["א", "RETIRED"]]);
  });

  it("cites the register, keeps its source from being removed, and is closed to strangers", async () => {
    const { client, employee } = await setup();
    await expect(addClientPolicy(employee, { clientId: client.id, kind: "INFO", title: "x", statement: "y" })).rejects.toThrow("צריך מקור");
    await addClientPolicy(employee, { clientId: client.id, kind: "INFO", title: "x", statement: "y", sources: S1 });
    const s1 = await prisma.clientSource.findFirstOrThrow({ where: { clientId: client.id, code: "S1" } });
    await expect(removeClientSource(employee, s1.id)).rejects.toThrow("1 פריטים");
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await expect(listClientPolicies(stranger, client.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("where the rules act", () => {
  it("the file Claude reads has the rules, with the interim rule in force while proposed", async () => {
    const { client, employee, manager } = await setup();
    await addClientPolicy(employee, {
      clientId: client.id,
      kind: "THRESHOLD",
      title: "תוכנה",
      statement: "עד 3,000$ בשנה מאושר",
      interimStatement: "כל הוצאה עוברת לאורן",
      sources: S1,
    });
    const dh = await addClientPolicy(employee, { clientId: client.id, kind: "DATA_HANDLING", title: "פגישות הנהלה", statement: "נושאים בלבד", sources: S1 });
    await approveClientPolicy(manager, dh.id);

    const md = toMarkdown(await buildClientFile(employee, client.id, { audience: "ai" }));
    expect(md).toContain("## 6. כללים והגבלות");
    expect(md).toContain("- תוכנה: כל הוצאה עוברת לאורן (מוצע, זה כלל הביניים. הכלל המוצע: עד 3,000$ בשנה מאושר)");
    expect(md).toContain("## 14. כללי עבודה ספציפיים");
    expect(md).toContain("- פגישות הנהלה: נושאים בלבד");
    // A proposed rule waits in section 15, an approved one does not.
    const s15 = md.slice(md.indexOf("## 15."), md.indexOf("## 16."));
    expect(s15).toContain("תוכנה");
    expect(s15).not.toContain("פגישות הנהלה");
  });

  it("the extraction brief carries each client's data-handling rules, and only those", async () => {
    const { extractionBrief } = await import("@/lib/app-domain/extraction-brief");
    const { client, employee, manager } = await setup();
    const dh = await addClientPolicy(employee, { clientId: client.id, kind: "DATA_HANDLING", title: "פגישות הנהלה", statement: "נושאים בלבד", sources: S1 });
    await addClientPolicy(employee, { clientId: client.id, kind: "DATA_HANDLING", title: "רפואי", statement: "לא נרשם בלי אישור אריאל", sources: S1 });
    await addClientPolicy(employee, { clientId: client.id, kind: "INFO", title: "אחר", statement: "לא לחילוץ", sources: S1 });
    await approveClientPolicy(manager, dh.id);
    const retired = await addClientPolicy(employee, { clientId: client.id, kind: "DATA_HANDLING", title: "ישן", statement: "בוטל", sources: S1 });
    await retireClientPolicy(manager, retired.id, "ישן");

    const b = await extractionBrief(employee);
    expect(b.clients.find((c) => c.name === "NUX")!.dataHandlingRules).toEqual([
      "פגישות הנהלה: נושאים בלבד",
      "רפואי: לא נרשם בלי אישור אריאל (מוצע, עוד לא אושר)",
    ]);
  });

  it("a rule proposed from a meeting enters the file as proposed, and a manager makes it binding", async () => {
    const { client, employee, manager } = await setup();
    const r = await proposeKnowledge(employee, {
      clientId: client.id,
      source: { kind: "TRANSCRIPT", title: "פגישת הנהלה", externalIds: ["ff-9"] },
      items: [{ target: "POLICY", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "DISCLOSURE", title: "עזיבת גיא", statement: "לא מספרים לעובדים עד הודעה של אורן" }, at: "03:10" }],
    });
    const p = (await listOpenBatches(employee)).find((x) => x.id === r.batchId)!.proposals[0];
    expect((p.flags as { code: string }[]).map((f) => f.code)).toContain("POLICY");
    const approved = await approveProposal(employee, p.id);
    const rule = await prisma.clientPolicy.findUniqueOrThrow({ where: { id: approved.resultId! } });
    expect(rule).toMatchObject({ status: "PROPOSED", kind: "DISCLOSURE", sources: [{ code: "S2", at: "03:10" }] });
    await approveClientPolicy(manager, rule.id);

    // The same rule again is flagged before anyone approves it twice.
    const again = await proposeKnowledge(employee, {
      clientId: client.id,
      source: { code: "S2" },
      items: [{ target: "POLICY", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "DISCLOSURE", title: "עזיבת גיא", statement: "לא מספרים" } }],
    });
    const dup = (await listOpenBatches(employee)).find((x) => x.id === again.batchId)!.proposals[0];
    expect((dup.flags as { code: string }[]).map((f) => f.code)).toContain("DUPLICATE");
  });

  it("spec 3.11: a start date and a review date; moving the start of an approved rule sends it back", async () => {
    const { client, employee, manager } = await setup();
    const from = new Date(Date.now() + 60 * 86_400_000);
    const p = await addClientPolicy(employee, { clientId: client.id, kind: "DATA_HANDLING", title: "פגישות הנהלה", statement: "נושאים בלבד", sources: S1, effectiveFrom: from, reviewBy: new Date(Date.now() - 86_400_000) });
    expect(p).toMatchObject({ effectiveFrom: from });
    await approveClientPolicy(manager, p.id);
    // The review date is not what the rule says: still in force.
    const reviewed = await updateClientPolicy(employee, p.id, { reviewBy: new Date(Date.now() + 365 * 86_400_000) });
    expect(reviewed.status).toBe("ACTIVE");
    // When it starts is.
    const moved = await updateClientPolicy(employee, p.id, { effectiveFrom: new Date(from.getTime() + 30 * 86_400_000) });
    expect(moved).toMatchObject({ status: "PROPOSED", version: 2 });
  });
});
