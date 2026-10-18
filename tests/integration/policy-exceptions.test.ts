import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientPolicy, retireClientPolicy } from "@/lib/app-domain/client-policies";
import { approveException, listOpenExceptions, rejectException, requestException, withdrawException } from "@/lib/app-domain/policy-exceptions";
import { canApproveForClient, ruleApproversFor, setClientRuleApprovers, setUserCanApproveExceptions } from "@/lib/app-domain/rule-approvals";
import { approveProposal, listOpenBatches, proposeKnowledge, rejectProposal } from "@/lib/app-domain/knowledge-proposals";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";
import type { User } from "@prisma/client";

// Org brain, phase 3 (claude/org-brain-spec-2026-10-12.md, 3.11, 7.2,
// decision 5).
//
// What is worth holding here: only an approver decides an exception or a
// sensitive item, a client that named its approvers overrides the
// permission, an exception always ends, the approvers hear about a
// request and the requester about the decision, and a sensitive proposal
// is never shown to someone who may not decide it.

const DAY = 24 * 60 * 60 * 1000;
function dayFromNow(n: number) {
  const d = new Date(Date.now() + n * DAY);
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
}

async function approver(role: "ANKORA_ADMIN" | "ANKORA_EMPLOYEE" = "ANKORA_EMPLOYEE"): Promise<User> {
  const { user } = await createTestUser({ role });
  return prisma.user.update({ where: { id: user.id }, data: { canApproveExceptions: true } });
}

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: anna } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const hadas = await approver();
  const { user: manager } = await createTestUser({ role: "ANKORA_ADMIN" });
  for (const u of [anna, hadas]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  await addClientSource(anna, { clientId: client.id, kind: "TRANSCRIPT", title: "חפיפה" });
  const rule = await addClientPolicy(anna, {
    clientId: client.id,
    kind: "SEPARATION",
    title: "Inc ו-LTD",
    statement: "לא שולחים לאיילה שום דבר של Inc",
    sources: [{ code: "S1" }],
  });
  return { client, anna, hadas, manager, rule };
}

const ASK = { what: "לשלוח לאיילה את חשבוניות Inc של אוקטובר", reason: "שני בחופשה" };

describe("who approves", () => {
  it("anyone with the permission, unless the client named its own", async () => {
    const { client, anna, hadas, manager } = await setup();
    expect(await canApproveForClient(hadas, client.id)).toBe(true);
    expect(await canApproveForClient(anna, client.id)).toBe(false);
    expect((await ruleApproversFor(client.id)).map((u) => u.id)).toContain(hadas.id);

    const ariel = await approver("ANKORA_ADMIN");
    await expect(setClientRuleApprovers(anna, client.id, [ariel.id])).rejects.toThrow("רק מנהל");
    await setClientRuleApprovers(manager, client.id, [ariel.id]);
    expect(await canApproveForClient(hadas, client.id)).toBe(false);
    expect(await canApproveForClient(ariel, client.id)).toBe(true);
    expect((await ruleApproversFor(client.id)).map((u) => u.id)).toEqual([ariel.id]);

    await setClientRuleApprovers(manager, client.id, []);
    expect(await canApproveForClient(hadas, client.id)).toBe(true);
  });

  it("the permission is given on the user page by whoever manages users, never to a client user", async () => {
    const { anna } = await setup();
    const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
    await expect(setUserCanApproveExceptions(anna, anna.id, true)).rejects.toThrow();
    await setUserCanApproveExceptions(superAdmin, anna.id, true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: anna.id } })).canApproveExceptions).toBe(true);
    const { user: portal } = await createTestUser({ role: "CLIENT_USER" });
    await expect(setUserCanApproveExceptions(superAdmin, portal.id, true)).rejects.toThrow("אנשי צוות");
  });
});

describe("exceptions", () => {
  it("a request reaches the approvers; only they decide; the requester hears the decision", async () => {
    const { client, anna, hadas, rule } = await setup();
    const req = await requestException(anna, { policyId: rule.id, ...ASK, validUntil: dayFromNow(10) });
    expect(req.status).toBe("REQUESTED");
    const notice = await prisma.notification.findFirstOrThrow({ where: { userId: hadas.id, type: "policy_exception.requested" } });
    expect(notice).toMatchObject({ entityType: "ClientRules", entityId: client.id });
    expect(await prisma.notification.count({ where: { userId: anna.id, type: "policy_exception.requested" } })).toBe(0);

    await expect(approveException(anna, req.id)).rejects.toThrow("מאשרים חריגות");
    await approveException(hadas, req.id);
    expect(await prisma.notification.count({ where: { userId: anna.id, type: "policy_exception.decided" } })).toBe(1);
    await expect(approveException(hadas, req.id)).rejects.toThrow("כבר הוחלט");
  });

  it("an approver may approve their own request, and the log keeps both", async () => {
    const { hadas, rule } = await setup();
    const req = await requestException(hadas, { policyId: rule.id, ...ASK, validUntil: dayFromNow(1) });
    await approveException(hadas, req.id);
    const actions = (await prisma.auditEvent.findMany({ where: { entityId: req.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["policy_exception.request", "policy_exception.approve"]));
  });

  it("always ends, never from a retired rule, never with a secret; refused with a reason; withdrawn by its requester", async () => {
    const { anna, hadas, manager, rule, client } = await setup();
    await expect(requestException(anna, { policyId: rule.id, ...ASK, validUntil: dayFromNow(200) })).rejects.toThrow("משנים את הכלל");
    await expect(requestException(anna, { policyId: rule.id, ...ASK, reason: "password: hunter2", validUntil: dayFromNow(3) })).rejects.toThrow("בכספת");

    const a = await requestException(anna, { policyId: rule.id, ...ASK, validUntil: dayFromNow(3) });
    await expect(rejectException(hadas, a.id, " ")).rejects.toThrow("למה");
    await rejectException(hadas, a.id, "אפשר לחכות לשני");

    const b = await requestException(anna, { policyId: rule.id, ...ASK, validUntil: dayFromNow(3) });
    await expect(withdrawException(hadas, b.id)).rejects.toThrow("רק מי שביקש");
    await withdrawException(anna, b.id);
    expect(await listOpenExceptions(anna, client.id)).toEqual([]);

    const other = await addClientPolicy(anna, { clientId: client.id, kind: "INFO", title: "x", statement: "y", sources: [{ code: "S1" }] });
    await retireClientPolicy(manager, other.id, "ישן");
    await expect(requestException(anna, { policyId: other.id, ...ASK, validUntil: dayFromNow(3) })).rejects.toThrow("בוטל");
  });

  it("an approved exception travels with its rule into the file, and leaves it when it ends", async () => {
    const { client, anna, hadas, rule } = await setup();
    const req = await requestException(anna, { policyId: rule.id, ...ASK, validUntil: dayFromNow(5) });
    await approveException(hadas, req.id);
    const md = toMarkdown(await buildClientFile(anna, client.id, { audience: "ai" }));
    expect(md).toContain("חריגה מאושרת עד");
    expect(md).toContain(ASK.what);

    await prisma.policyException.update({ where: { id: req.id }, data: { validUntil: dayFromNow(-2) } });
    expect(await listOpenExceptions(anna, client.id)).toEqual([]);
    expect(toMarkdown(await buildClientFile(anna, client.id, { audience: "ai" }))).not.toContain(ASK.what);
  });
});

describe("sensitive proposals (R6)", () => {
  it("are shown and decided by the client's approvers only, who are told one is waiting", async () => {
    const { client, anna, hadas } = await setup();
    const r = await proposeKnowledge(anna, {
      clientId: client.id,
      source: { kind: "TRANSCRIPT", title: "שיחה עם אורן", externalIds: ["ff-77"] },
      items: [
        { target: "FACT", payload: { knowledgeStatus: "CONFIRMED", kind: "TEMPORARY", body: "אורן בטיפול רפואי עד סוף החודש", validUntilEvent: "סוף החודש", sensitivity: "SENSITIVE" }, reason: "אורן סיפר" },
        { target: "FACT", reason: "נאמר בפגישה", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "שגרה" } },
      ],
    });
    expect(await prisma.notification.count({ where: { userId: hadas.id, type: "knowledge.sensitive_proposed" } })).toBe(1);

    const seenByAnna = (await listOpenBatches(anna)).find((b) => b.id === r.batchId)!.proposals;
    const [secret, plain] = seenByAnna;
    expect(secret.hiddenFor).toBeTruthy();
    expect(JSON.stringify(secret.payload)).not.toContain("רפואי");
    expect(secret.reason).toBeNull();
    expect(plain.hiddenFor).toBeNull();
    await expect(approveProposal(anna, secret.id)).rejects.toThrow("מאשרים");
    await expect(rejectProposal(anna, secret.id, "לא")).rejects.toThrow("מאשרים");

    const seenByHadas = (await listOpenBatches(hadas)).find((b) => b.id === r.batchId)!.proposals[0];
    expect(seenByHadas.hiddenFor).toBeNull();
    expect((seenByHadas.flags as { code: string }[]).map((f) => f.code)).toContain("R6");
    const approved = await approveProposal(hadas, seenByHadas.id);
    const fact = await prisma.clientFact.findUniqueOrThrow({ where: { id: approved.resultId! } });
    expect(fact.sensitivity).toBe("SENSITIVE");
    // In the file, and never in what Claude reads.
    expect(toMarkdown(await buildClientFile(hadas, client.id, { audience: "ai" }))).not.toContain("רפואי");
  });
});
