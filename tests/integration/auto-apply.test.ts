import { describe, expect, it } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { listClientFacts, removeClientFact } from "@/lib/app-domain/client-facts";
import { approveProposal, proposeKnowledge, revertProposal, type ProposalItemInput } from "@/lib/app-domain/knowledge-proposals";
import { AUTO_APPLY_PAUSED, autoApplySetting, liftAutoApplyPause, listAutoReview, markAutoReviewed, setAutoApply } from "@/lib/app-domain/auto-apply";
import { inAutoSample } from "@/lib/auto-apply";

// Auto-apply at intake (3.11.2026, approval tiers part 2). What is worth
// holding here: only the AUTO tier enters on arrival, and only when Claude
// sent it; a person looks at it after ("תקין" or "ביטול"); reverts and
// changes count as errors and send a client or a kind back to a person,
// with the managers told; a manager lifts it; the switch turns it all off.

const DAY = 86_400_000;
let n = 0;

async function setup(name = "NUX") {
  const client = await createTestClient({ name });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  const { user: manager } = await createTestUser({ role: "SUPER_ADMIN" });
  return { client, user, manager };
}

async function anotherClient(user: User, name: string) {
  const client = await createTestClient({ name });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  return client;
}

/// A new simple item, HIGH, at a minute in the recording: the AUTO tier.
function pref(body: string, extra: Partial<ProposalItemInput> = {}): ProposalItemInput {
  return { target: "FACT", reason: "נאמר בפגישה", at: "01:00", confidence: "HIGH", payload: { knowledgeStatus: "CONFIRMED", kind: "PREFERENCE", body }, ...extra };
}

function propose(user: User, clientId: string, items: ProposalItemInput[], autoApply = true) {
  n++;
  return proposeKnowledge(
    user,
    { clientId, source: { kind: "TRANSCRIPT", title: `פגישה ${n}`, occurredAt: new Date("2026-11-01T00:00:00Z"), externalIds: [`ff-auto-${n}`] }, items },
    { autoApply }
  );
}

describe("auto-apply at intake", () => {
  it("only the AUTO tier enters on arrival, as the person who sent it, and only from Claude", async () => {
    const { client, user } = await setup();
    const r = await propose(user, client.id, [
      pref("עדכונים במייל ולא בטלפון"),
      { target: "FACT", reason: "נאמר", at: "02:00", payload: { knowledgeStatus: "CONFIRMED", kind: "NOTE", body: "בלי ביטחון" } },
      { target: "TASK", reason: "הבטחנו", at: "03:00", confidence: "HIGH", payload: { title: "לשלוח לאורן את החוזה" } },
      pref("גלוי ללקוח", { at: "04:00", payload: { knowledgeStatus: "CONFIRMED", kind: "PREFERENCE", body: "גלוי ללקוח", clientVisible: true } }),
    ]);
    expect(r.proposed).toBe(4);
    expect(r.autoApplied).toHaveLength(1);
    const [auto] = r.autoApplied;
    expect(auto).toMatchObject({ target: "FACT", headline: expect.stringContaining("עדכונים במייל") });

    const row = await prisma.knowledgeProposal.findUniqueOrThrow({ where: { id: auto.proposalId } });
    expect(row).toMatchObject({ state: "APPROVED", autoApplied: true, decidedById: user.id, resultId: auto.resultId });
    expect(await prisma.auditEvent.count({ where: { entityId: auto.proposalId, action: "knowledge_proposal.auto_apply" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: auto.proposalId, action: "knowledge_proposal.approve" } })).toBe(0);
    expect((await listClientFacts(user, client.id)).current.map((f) => f.body)).toEqual(["עדכונים במייל ולא בטלפון"]);
    expect(await prisma.knowledgeProposal.count({ where: { batchId: r.batchId!, state: "PENDING" } })).toBe(3);

    // The same from a screen (no autoApply): it waits.
    const typed = await propose(user, client.id, [pref("דוחות ביום ראשון")], false);
    expect(typed.autoApplied).toEqual([]);
    expect(await prisma.knowledgeProposal.count({ where: { batchId: typed.batchId!, state: "PENDING" } })).toBe(1);
  });

  it("is on by default, and the first 14 days start when it is first read", async () => {
    const s = await autoApplySetting();
    expect(s.enabled).toBe(true);
    expect(Math.abs(s.firstEnabledAt!.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

describe("after the fact: נכנס אוטומטית", () => {
  it("lists every auto-applied item in the first 14 days; תקין takes it off the list", async () => {
    const { client, user } = await setup();
    const r = await propose(user, client.id, [pref("מעדיפים וואטסאפ"), { target: "CONTACT", reason: "נאמר", at: "02:00", confidence: "HIGH", payload: { knowledgeStatus: "CONFIRMED", name: "דנה כהן", role: "CFO" } }]);
    expect(r.autoApplied).toHaveLength(2);
    const list = await listAutoReview(user);
    expect(list.map((i) => i.id).sort()).toEqual(r.autoApplied.map((a) => a.proposalId).sort());
    expect(list[0]).toMatchObject({ clientId: client.id, clientName: "NUX", why: expect.stringContaining("14") });

    const [first] = r.autoApplied;
    await markAutoReviewed(user, first.proposalId);
    expect((await listAutoReview(user)).map((i) => i.id)).not.toContain(first.proposalId);
    expect(await prisma.auditEvent.count({ where: { entityId: first.proposalId, action: "knowledge_proposal.auto_review" } })).toBe(1);
    await expect(markAutoReviewed(user, first.proposalId)).rejects.toThrow("כבר סומן");

    // Someone not on the client sees none of it and cannot mark it.
    const { user: stranger } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    expect(await listAutoReview(stranger)).toEqual([]);
    await expect(markAutoReviewed(stranger, r.autoApplied[1].proposalId)).rejects.toBeInstanceOf(ForbiddenError);

    // A proposal a person approved is not "auto".
    const manual = await propose(user, client.id, [pref("בקשה ידנית")], false);
    const p = await prisma.knowledgeProposal.findFirstOrThrow({ where: { batchId: manual.batchId! } });
    await approveProposal(user, p.id);
    await expect(markAutoReviewed(user, p.id)).rejects.toThrow("לא נכנסה אוטומטית");
  });

  it("after the first 14 days only the sample, and every item again for 7 days after a guide approval", async () => {
    const { client, user, manager } = await setup();
    await autoApplySetting();
    await prisma.appSetting.update({ where: { key: "knowledge.auto_apply" }, data: { value: { enabled: true, firstEnabledAt: new Date(Date.now() - 60 * DAY).toISOString() } } });
    const items = Array.from({ length: 12 }, (_, i) => pref(`העדפה מספר ${i}`, { at: `0${Math.floor(i / 10)}:${String(i % 10).padStart(2, "0")}` }));
    const r = await propose(user, client.id, items);
    expect(r.autoApplied).toHaveLength(12);
    const ids = r.autoApplied.map((a) => a.proposalId);

    // A guide approved yesterday: every one of them.
    const guide = await prisma.extractionGuide.create({ data: { version: 1, body: "x", state: "APPROVED", decidedById: manager.id, decidedAt: new Date(Date.now() - DAY) } });
    expect((await listAutoReview(user)).map((i) => i.id).sort()).toEqual([...ids].sort());

    // A guide approved ten days ago: the sample only.
    await prisma.extractionGuide.update({ where: { id: guide.id }, data: { decidedAt: new Date(Date.now() - 10 * DAY) } });
    expect((await listAutoReview(user)).map((i) => i.id).sort()).toEqual(ids.filter(inAutoSample).sort());
  });
});

describe("errors send a client or a kind back to a person", () => {
  it("two reverts of one client pause the client, the managers are told, and a manager lifts it", async () => {
    const { client, user, manager } = await setup();
    const r = await propose(user, client.id, [pref("ראשון"), { target: "CONTACT", reason: "נאמר", at: "02:00", confidence: "HIGH", payload: { knowledgeStatus: "CONFIRMED", name: "יוסי לוי", role: "CEO" } }]);
    expect(r.autoApplied).toHaveLength(2);
    await revertProposal(user, r.autoApplied[0].proposalId);
    expect(await prisma.autoApplyPause.count()).toBe(0);
    await revertProposal(user, r.autoApplied[1].proposalId);

    const pause = await prisma.autoApplyPause.findFirstOrThrow({ where: { liftedAt: null } });
    expect(pause).toMatchObject({ scope: "CLIENT", key: client.id, errors: 2 });
    expect(pause.reason).not.toContain("NUX");
    const notice = await prisma.notification.findFirstOrThrow({ where: { type: AUTO_APPLY_PAUSED, userId: manager.id } });
    expect(notice.title).toContain("NUX");
    expect(await prisma.notification.count({ where: { type: AUTO_APPLY_PAUSED, userId: user.id } })).toBe(0);

    // Paused: the next AUTO item waits for a person.
    const waits = await propose(user, client.id, [pref("שלישי")]);
    expect(waits.autoApplied).toEqual([]);
    expect(await prisma.knowledgeProposal.count({ where: { batchId: waits.batchId!, state: "PENDING" } })).toBe(1);

    // Another client is not held.
    const other = await anotherClient(user, "RIMED");
    expect((await propose(user, other.id, [pref("של לקוח אחר")])).autoApplied).toHaveLength(1);

    await expect(liftAutoApplyPause(user, pause.id)).rejects.toBeInstanceOf(ForbiddenError);
    await liftAutoApplyPause(manager, pause.id);
    await expect(liftAutoApplyPause(manager, pause.id)).rejects.toThrow("כבר הוסרה");
    // Lifted, and the old errors do not pause it again.
    expect((await propose(user, client.id, [pref("רביעי")])).autoApplied).toHaveLength(1);
    expect(await prisma.autoApplyPause.count({ where: { liftedAt: null } })).toBe(0);
  });

  it("an item changed in the file by hand counts as an error too, read at the next arrival", async () => {
    const { client, user } = await setup();
    const r = await propose(user, client.id, [pref("יוסר ביד"), pref("יבוטל", { at: "02:00" })]);
    expect(r.autoApplied).toHaveLength(2);
    await removeClientFact(user, r.autoApplied[0].resultId!);
    await revertProposal(user, r.autoApplied[1].proposalId);
    // The revert saw both errors.
    expect(await prisma.autoApplyPause.findFirst({ where: { scope: "CLIENT", key: client.id, liftedAt: null } })).not.toBeNull();
  });

  it("three errors in the last 30 of a kind pause the kind, for every client, counted after the latest guide approval", async () => {
    const { user, manager } = await setup("A");
    const clients = [await anotherClient(user, "B"), await anotherClient(user, "C"), await anotherClient(user, "D"), await anotherClient(user, "E")];
    const applied = [];
    for (const c of clients.slice(0, 3)) applied.push((await propose(user, c.id, [pref(`העדפה של ${c.name}`)])).autoApplied[0]);
    await revertProposal(user, applied[0].proposalId);
    await revertProposal(user, applied[1].proposalId);
    // A new guide version: the kind's counters start again after it.
    await prisma.extractionGuide.create({ data: { version: 1, body: "x", state: "APPROVED", decidedById: manager.id, decidedAt: new Date() } });
    await revertProposal(user, applied[2].proposalId);
    expect(await prisma.autoApplyPause.count()).toBe(0);

    // Three more after the guide, each taken out: the kind pauses.
    const after = [];
    for (const c of clients.slice(0, 3)) after.push((await propose(user, c.id, [pref(`עוד העדפה של ${c.name}`, { at: "05:00" })])).autoApplied[0]);
    for (const a of after) await revertProposal(user, a.proposalId);
    const pauses = await prisma.autoApplyPause.findMany({ where: { liftedAt: null } });
    expect(pauses.find((p) => p.scope === "KIND")).toMatchObject({ key: "FACT.PREFERENCE", errors: 3 });

    // A preference waits now, for a client with no errors; a contact does not.
    const r = await propose(user, clients[3].id, [pref("העדפה חדשה"), { target: "CONTACT", reason: "נאמר", at: "02:00", confidence: "HIGH", payload: { knowledgeStatus: "CONFIRMED", name: "רון כהן", role: "CTO" } }]);
    expect(r.autoApplied.map((a) => a.target)).toEqual(["CONTACT"]);
    expect(await prisma.notification.count({ where: { type: AUTO_APPLY_PAUSED, userId: manager.id, title: { contains: "העדפה" } } })).toBe(1);
  });
});

describe("the switch", () => {
  it("off: nothing enters on arrival, for any client; only a manager flips it", async () => {
    const { client, user, manager } = await setup();
    const first = (await autoApplySetting()).firstEnabledAt;
    await expect(setAutoApply(user, false)).rejects.toBeInstanceOf(ForbiddenError);
    const off = await setAutoApply(manager, false);
    expect(off).toMatchObject({ enabled: false, firstEnabledAt: first });
    const r = await propose(user, client.id, [pref("כשהמתג כבוי")]);
    expect(r.autoApplied).toEqual([]);
    expect(await prisma.knowledgeProposal.count({ where: { batchId: r.batchId!, state: "PENDING" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "knowledge.auto_apply_switch" } })).toBe(1);

    // On again: the first 14 days still count from the first time.
    const on = await setAutoApply(manager, true);
    expect(on.firstEnabledAt).toEqual(first);
    expect((await propose(user, client.id, [pref("כשהמתג דולק")])).autoApplied).toHaveLength(1);
  });

  it("a client marked בלי AI never auto-applies", async () => {
    const { client, user } = await setup();
    await prisma.client.update({ where: { id: client.id }, data: { aiExcluded: true } });
    const r = await propose(user, client.id, [pref("לקוח בלי AI")]);
    expect(r.autoApplied).toEqual([]);
  });
});
