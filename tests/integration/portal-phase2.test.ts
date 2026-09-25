import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestClientUser, createTestUser } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import {
  createDecision,
  cancelDecision,
  getPortalDecisions,
  respondToDecision,
  listDecisionsForClient,
} from "@/lib/app-domain/decisions";

// Portal phase 2. The approval is the one record in this product that has
// to hold up months later, so most of what is tested here is about what
// cannot happen: a viewer approving, a client answering another client's
// decision, an answer changing after the fact, or a snapshot drifting
// when the underlying text is edited.

async function openDecision(
  actorId: string,
  clientId: string,
  overrides: { question?: string; amountMinor?: number | null; taskId?: string | null } = {}
) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
  return createDecision(actor, {
    clientId,
    taskId: overrides.taskId ?? null,
    question: overrides.question ?? "באיזה מועד לקבוע את הביקור?",
    amountMinor: overrides.amountMinor ?? null,
    options: [
      { label: "יום שלישי בבוקר", amountMinor: 45000, recommended: true },
      { label: "יום חמישי אחר הצהריים", amountMinor: 52000 },
    ],
  });
}

describe("createDecision()", () => {
  it("refuses fewer than two options, more than three, and two recommendations", async () => {
    const client = await createTestClient({ name: "Client Options" });
    const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
    await prisma.userClientAccess.create({ data: { userId: admin.id, clientId: client.id } });

    const base = { clientId: client.id, question: "?" };

    await expect(createDecision(admin, { ...base, options: [{ label: "רק אחת" }] })).rejects.toThrow();
    await expect(
      createDecision(admin, {
        ...base,
        options: [{ label: "א" }, { label: "ב" }, { label: "ג" }, { label: "ד" }],
      })
    ).rejects.toThrow();
    await expect(
      createDecision(admin, {
        ...base,
        options: [
          { label: "א", recommended: true },
          { label: "ב", recommended: true },
        ],
      })
    ).rejects.toThrow();
  });

  it("copies the client's ceiling onto the decision, so a later change cannot rewrite it", async () => {
    const client = await createTestClient({ name: "Client Ceiling" });
    await prisma.client.update({ where: { id: client.id }, data: { approvalCeilingMinor: 50000 } });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });

    const decision = await openDecision(admin.id, client.id, { amountMinor: 90000 });
    expect(decision.ceilingMinorAtCreation).toBe(50000);

    await prisma.client.update({ where: { id: client.id }, data: { approvalCeilingMinor: 200000 } });

    const after = await prisma.decision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(after.ceilingMinorAtCreation).toBe(50000);
  });

  it("refuses a client the actor is not assigned to", async () => {
    const client = await createTestClient({ name: "Client Unassigned" });
    const { user: employee } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    await expect(openDecision(employee.id, client.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("respondToDecision()", () => {
  it("records the answer with a snapshot that survives later edits", async () => {
    const client = await createTestClient({ name: "Client Answer" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: clientAdmin } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });

    const decision = await openDecision(admin.id, client.id, { amountMinor: 45000 });
    const options = await prisma.decisionOption.findMany({ where: { decisionId: decision.id }, orderBy: { position: "asc" } });

    await respondToDecision(clientAdmin, decision.id, options[0].id);

    // The option text changes afterwards. The proof must not.
    await prisma.decisionOption.update({ where: { id: options[0].id }, data: { label: "נוסח אחר לגמרי" } });

    const stored = await prisma.decisionResponse.findUniqueOrThrow({ where: { decisionId: decision.id } });
    expect(stored.optionLabelSnapshot).toBe("יום שלישי בבוקר");
    expect(stored.amountMinorSnapshot).toBe(45000);
    expect(stored.questionSnapshot).toBe("באיזה מועד לקבוע את הביקור?");

    const closed = await prisma.decision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(closed.status).toBe("ANSWERED");
  });

  it("refuses a second answer", async () => {
    const client = await createTestClient({ name: "Client Twice" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: clientAdmin } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });

    const decision = await openDecision(admin.id, client.id);
    const options = await prisma.decisionOption.findMany({ where: { decisionId: decision.id } });

    await respondToDecision(clientAdmin, decision.id, options[0].id);
    await expect(respondToDecision(clientAdmin, decision.id, options[1].id)).rejects.toThrow();
  });

  it("refuses a client viewer", async () => {
    const client = await createTestClient({ name: "Client Viewer" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: viewer } = await createTestClientUser({ clientId: client.id, role: "VIEWER" });

    const decision = await openDecision(admin.id, client.id);
    const options = await prisma.decisionOption.findMany({ where: { decisionId: decision.id } });

    await expect(respondToDecision(viewer, decision.id, options[0].id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // Spec 21.2, restated for the one screen where a client writes: another
  // client's decision id must not resolve, even for a Client Admin.
  it("refuses another client's decision", async () => {
    const mine = await createTestClient({ name: "Client Mine" });
    const theirs = await createTestClient({ name: "Client Theirs" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: clientAdmin } = await createTestClientUser({ clientId: mine.id, role: "ADMIN" });

    const decision = await openDecision(admin.id, theirs.id);
    const options = await prisma.decisionOption.findMany({ where: { decisionId: decision.id } });

    await expect(respondToDecision(clientAdmin, decision.id, options[0].id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("releases the promise that was waiting on the client", async () => {
    const client = await createTestClient({ name: "Client Release" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: clientAdmin } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });

    const task = await prisma.task.create({
      data: {
        clientId: client.id,
        title: "ביקור טכנאי",
        clientVisible: true,
        blockedOn: "CLIENT",
        blockedSince: new Date(),
      },
    });

    const decision = await openDecision(admin.id, client.id, { taskId: task.id });
    const options = await prisma.decisionOption.findMany({ where: { decisionId: decision.id } });

    await respondToDecision(clientAdmin, decision.id, options[0].id);

    const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.blockedOn).toBeNull();
    expect(after.blockedSince).toBeNull();
  });
});

describe("the two views", () => {
  it("splits the portal's decisions into open and closed", async () => {
    const client = await createTestClient({ name: "Client Split" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: clientAdmin } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });

    const answered = await openDecision(admin.id, client.id, { question: "כבר נענתה" });
    const options = await prisma.decisionOption.findMany({ where: { decisionId: answered.id } });
    await respondToDecision(clientAdmin, answered.id, options[0].id);

    const cancelled = await openDecision(admin.id, client.id, { question: "בוטלה" });
    await cancelDecision(admin, cancelled.id);

    await openDecision(admin.id, client.id, { question: "פתוחה" });

    const view = await getPortalDecisions(clientAdmin);

    expect(view.open.map((d) => d.question)).toEqual(["פתוחה"]);
    expect(view.closed.map((d) => d.question).sort()).toEqual(["בוטלה", "כבר נענתה"].sort());
    expect(view.closed.find((d) => d.question === "כבר נענתה")?.answer?.optionLabel).toBe("יום שלישי בבוקר");
  });

  it("marks an amount above the copied ceiling", async () => {
    const client = await createTestClient({ name: "Client Above" });
    await prisma.client.update({ where: { id: client.id }, data: { approvalCeilingMinor: 50000 } });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: clientAdmin } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });

    await openDecision(admin.id, client.id, { question: "מעל התקרה", amountMinor: 90000 });
    await openDecision(admin.id, client.id, { question: "מתחת לתקרה", amountMinor: 20000 });

    const view = await getPortalDecisions(clientAdmin);
    const byQuestion = Object.fromEntries(view.open.map((d) => [d.question, d.aboveCeiling]));

    expect(byQuestion).toEqual({ "מעל התקרה": true, "מתחת לתקרה": false });
  });

  it("refuses to cancel a decision that was already answered", async () => {
    const client = await createTestClient({ name: "Client Late Cancel" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });
    const { user: clientAdmin } = await createTestClientUser({ clientId: client.id, role: "ADMIN" });

    const decision = await openDecision(admin.id, client.id);
    const options = await prisma.decisionOption.findMany({ where: { decisionId: decision.id } });
    await respondToDecision(clientAdmin, decision.id, options[0].id);

    await expect(cancelDecision(admin, decision.id)).rejects.toThrow();
  });

  it("lists a client's decisions for staff assigned to that client", async () => {
    const client = await createTestClient({ name: "Client Staff List" });
    const { user: admin } = await createTestUser({ role: "SUPER_ADMIN" });

    await openDecision(admin.id, client.id, { question: "שאלה אחת" });

    const rows = await listDecisionsForClient(admin, client.id);
    expect(rows.map((d) => d.question)).toEqual(["שאלה אחת"]);
    expect(rows[0].options).toHaveLength(2);
    expect(rows[0].options.filter((o) => o.recommended)).toHaveLength(1);
  });
});
