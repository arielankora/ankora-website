import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientPolicy, approveClientPolicy, retireClientPolicy } from "@/lib/app-domain/client-policies";
import { approveException, requestException } from "@/lib/app-domain/policy-exceptions";
import { addProcess, approveProcessVersion, saveProcessVersion, updateProcess } from "@/lib/app-domain/processes";
import { startProcessRun } from "@/lib/app-domain/process-runs";
import { markProcessReviewed, reviewProcessesDaily, RULES_CHANGED, REVIEW_DUE } from "@/lib/app-domain/process-review";

// Org brain (claude/org-brain-spec-2026-10-12.md, 7.3 and 5.4).
//
// What is worth holding here: a rule that changes is checked against every
// approved procedure at once; a procedure that no longer passes is marked,
// its owner told and its open runs commented; it is unmarked when the rule
// goes or is excepted; a restricted rule is never named; and a periodic
// review falls due, and is marked reviewed only when the procedure passes.

const S1 = [{ code: "S1" }];
const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: created } = await createTestUser({ role: "ANKORA_ADMIN" });
  const ariel = await prisma.user.update({ where: { id: created.id }, data: { canApproveExceptions: true } });
  await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
  await addClientSource(hadas, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const process = await addProcess(hadas, { clientId: client.id, title: "רכישת תוכנה", ownerId: hadas.id, triggerKinds: ["ON_DEMAND"], sources: S1 });
  await saveProcessVersion(hadas, process.id, { steps: [{ title: "רוכשים", actionTags: ["PURCHASE", "SUPPLIER_NEW"] }], baseVersion: 0 });
  await approveProcessVersion(ariel, process.id, 1);
  return { client, hadas, ariel, process };
}

const fresh = (id: string) => prisma.process.findUniqueOrThrow({ where: { id } });

describe("rescan when a rule changes", () => {
  it("marks a procedure that no longer passes, tells the owner, comments the open run, and unmarks when the rule goes", async () => {
    const { client, hadas, ariel, process } = await setup();
    const run = await startProcessRun(hadas, process.id, new Date("2026-11-10T00:00:00Z"));

    const rule = await addClientPolicy(hadas, {
      clientId: client.id,
      kind: "FORBIDDEN",
      title: "בלי ספקים חדשים",
      statement: "לא פותחים ספק חדש עד סוף השנה",
      params: { appliesToTags: ["SUPPLIER_NEW"] },
      sources: S1,
    });
    let p = await fresh(process.id);
    expect(p).toMatchObject({ needsReview: true, reviewReason: "RULES" });
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: hadas.id, type: RULES_CHANGED } });
    expect(note.body).toContain("בלי ספקים חדשים");
    const comments = await prisma.taskComment.findMany({ where: { taskId: run.id } });
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toContain("ספק חדש");

    // A run opened now says the procedure needs review.
    const later = await startProcessRun(hadas, process.id, new Date("2026-11-20T00:00:00Z"));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: later.id } })).description).toContain("דורש סקירה");

    // Approving the same rule changes nothing more: one comment, one notice.
    await approveClientPolicy(ariel, rule.id);
    expect(await prisma.taskComment.count({ where: { taskId: run.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: hadas.id, type: RULES_CHANGED } })).toBe(1);

    await retireClientPolicy(ariel, rule.id, "אורן ביטל");
    p = await fresh(process.id);
    expect(p).toMatchObject({ needsReview: false, reviewReason: null });
  });

  it("an approved exception unmarks it; a restricted rule is never named", async () => {
    const { client, hadas, ariel, process } = await setup();
    const rule = await addClientPolicy(hadas, {
      clientId: client.id,
      kind: "FORBIDDEN",
      title: "עסקה סודית",
      statement: "לא פותחים ספק חדש עד ההודעה",
      params: { appliesToTags: ["SUPPLIER_NEW"] },
      audience: "RESTRICTED",
      audienceUserIds: [hadas.id],
      sources: S1,
    });
    expect(await fresh(process.id)).toMatchObject({ reviewReason: "RULES" });
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: hadas.id, type: RULES_CHANGED } });
    expect(note.body).not.toContain("עסקה סודית");

    const ex = await requestException(hadas, { policyId: rule.id, what: "ספק אחד", reason: "דחוף", validUntil: new Date(Date.now() + 10 * DAY) });
    await approveException(ariel, ex.id);
    expect(await fresh(process.id)).toMatchObject({ needsReview: false, reviewReason: null });
  });

  it("the daily job notices an exception that ended", async () => {
    const { client, hadas, ariel, process } = await setup();
    const rule = await addClientPolicy(hadas, { clientId: client.id, kind: "FORBIDDEN", title: "בלי ספקים חדשים", statement: "x", params: { appliesToTags: ["SUPPLIER_NEW"] }, sources: S1 });
    const ex = await requestException(hadas, { policyId: rule.id, what: "ספק אחד", reason: "דחוף", validUntil: new Date(Date.now() + 2 * DAY) });
    await approveException(ariel, ex.id);
    expect(await fresh(process.id)).toMatchObject({ needsReview: false });

    const r = await reviewProcessesDaily(new Date(Date.now() + 5 * DAY));
    expect(r.flagged).toBe(1);
    expect(await fresh(process.id)).toMatchObject({ needsReview: true, reviewReason: "RULES" });
  });
});

describe("periodic review", () => {
  it("falls due after the period, and a manager marks it reviewed only while it passes", async () => {
    const { hadas, ariel, process } = await setup();
    await updateProcess(hadas, process.id, { reviewEveryDays: 30 });
    expect((await reviewProcessesDaily(new Date(Date.now() + 10 * DAY))).due).toBe(0);
    const r = await reviewProcessesDaily(new Date(Date.now() + 31 * DAY));
    expect(r.due).toBe(1);
    expect(await fresh(process.id)).toMatchObject({ needsReview: true, reviewReason: "PERIODIC" });
    expect(await prisma.notification.count({ where: { userId: hadas.id, type: REVIEW_DUE } })).toBe(1);
    // Already marked: not marked or told again.
    expect((await reviewProcessesDaily(new Date(Date.now() + 32 * DAY))).due).toBe(0);

    await expect(markProcessReviewed(hadas, process.id)).rejects.toThrow("רק מנהל");
    await markProcessReviewed(ariel, process.id);
    expect(await fresh(process.id)).toMatchObject({ needsReview: false, reviewReason: null });
  });

  it("a procedure that fails the rules is not marked reviewed: it takes a new version or an exception", async () => {
    const { client, hadas, ariel, process } = await setup();
    await addClientPolicy(hadas, { clientId: client.id, kind: "FORBIDDEN", title: "בלי ספקים חדשים", statement: "x", params: { appliesToTags: ["SUPPLIER_NEW"] }, sources: S1 });
    await expect(markProcessReviewed(ariel, process.id)).rejects.toThrow("גרסה חדשה");
  });
});
