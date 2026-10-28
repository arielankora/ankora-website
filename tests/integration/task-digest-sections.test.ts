import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { buildDigest } from "@/lib/app-domain/task-digest";

// The parts of the morning email that are not tasks: a procedure due for
// review, an exception waiting for a decision, a date coming up.
//
// Written 28.10.2026 because the coverage floor caught it: on run #606
// task-digest.ts had fallen from 95% of its functions run to 84.1%, and
// every function missing was the inside of one of these sections. The
// tests that build a digest only ever gave it tasks, so each section ran
// its query, found nothing and returned an empty list - which is also
// exactly what a section does when its query throws, because
// beyondTasks() catches and logs instead. A section that broke would have
// looked like a quiet morning.

const DAY = 24 * 3600_000;

async function staffOn(clientId: string, name: string, over: { canApproveExceptions?: boolean } = {}) {
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.user.update({ where: { id: user.id }, data: { name, ...over } });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId } });
  return { ...user, name };
}

const digestOf = (userId: string, now = new Date()) => buildDigest({ id: userId, dailyDigestAt: new Date(now.getTime() - DAY) }, now);

describe("a procedure due for review", () => {
  it("reaches its owner, with the reason, and only its owner", async () => {
    const client = await createTestClient({ name: "RIMED" });
    const hadas = await staffOn(client.id, "הדס");
    const ariel = await staffOn(client.id, "אריאל");
    await prisma.process.create({
      data: {
        clientId: client.id,
        seq: 1,
        code: "RIM-01",
        title: "דיווח מע״מ",
        status: "ACTIVE",
        ownerId: hadas.id,
        reviewReason: "RULES",
      },
    });

    const mine = await digestOf(hadas.id);
    expect(mine.reviews).toHaveLength(1);
    expect(mine.reviews![0].title).toBe("RIM-01 דיווח מע״מ");
    expect(mine.reviews![0].meta).toBe("RIMED · לא עומד עוד בכללי הלקוח");

    expect((await digestOf(ariel.id)).reviews).toEqual([]);
  });

  it("goes to the backup when the procedure has no owner", async () => {
    const client = await createTestClient({ name: "RIMED" });
    const hadas = await staffOn(client.id, "הדס");
    await prisma.process.create({
      data: { clientId: client.id, seq: 1, code: "RIM-02", title: "סגירת חודש", status: "PAUSED", backupOwnerId: hadas.id, reviewReason: "PERIODIC" },
    });

    const [review] = (await digestOf(hadas.id)).reviews!;
    expect(review.meta).toBe("RIMED · הגיע מועד הסקירה התקופתית");
  });
});

describe("an exception waiting for a decision", () => {
  async function requested(clientId: string, requestedById: string) {
    const policy = await prisma.clientPolicy.create({
      data: { clientId, kind: "THRESHOLD", title: "סף אישור", statement: "מעל 5,000 באישור", status: "ACTIVE" },
    });
    return prisma.policyException.create({
      data: { clientId, policyId: policy.id, what: "העברה של 7,000 לספק", reason: "תשלום דחוף", validUntil: new Date(Date.now() + 7 * DAY), requestedById },
    });
  }

  it("reaches a named approver of that client, with who asked", async () => {
    const client = await createTestClient({ name: "RIMED" });
    const hadas = await staffOn(client.id, "הדס");
    const ariel = await staffOn(client.id, "אריאל");
    await prisma.client.update({ where: { id: client.id }, data: { ruleApproverIds: [ariel.id] } });
    await requested(client.id, hadas.id);

    const [exception] = (await digestOf(ariel.id)).exceptions!;
    expect(exception.title).toBe("סף אישור: העברה של 7,000 לספק");
    expect(JSON.stringify(exception)).toContain("הדס");
    expect(exception.clientName).toBe("RIMED");

    // The person who asked is not who decides.
    expect((await digestOf(hadas.id)).exceptions).toEqual([]);
  });

  it("falls back to anyone allowed to approve exceptions when the client names nobody", async () => {
    const client = await createTestClient({ name: "RIMED" });
    const hadas = await staffOn(client.id, "הדס");
    const approver = await staffOn(client.id, "מאשר", { canApproveExceptions: true });
    await requested(client.id, hadas.id);

    expect((await digestOf(approver.id)).exceptions).toHaveLength(1);
    expect((await digestOf(hadas.id)).exceptions).toEqual([]);
  });
});

describe("a date coming up", () => {
  async function dateFor(clientId: string, responsibleUserId: string, over: { sensitivity?: "NORMAL" | "SENSITIVE"; inDays?: number } = {}) {
    return prisma.importantDate.create({
      data: {
        clientId,
        title: "חידוש רישיון עסק",
        type: "custom",
        category: "DOCUMENTS_AUTHORITIES",
        month: 1,
        day: 1,
        responsibleUserId,
        sensitivity: over.sensitivity ?? "NORMAL",
        nextOccurrenceAt: new Date(Date.now() + (over.inDays ?? 2) * DAY),
      },
    });
  }

  it("reaches the person responsible, and says no more than the date's sensitivity allows", async () => {
    const client = await createTestClient({ name: "RIMED" });
    const hadas = await staffOn(client.id, "הדס");
    await dateFor(client.id, hadas.id);
    await dateFor(client.id, hadas.id, { sensitivity: "SENSITIVE", inDays: 3 });

    const dates = (await digestOf(hadas.id)).dates!;
    expect(dates.map((d) => d.title)).toEqual(["חידוש רישיון עסק", "מועד רגיש"]);
    expect(dates[0].clientName).toBe("RIMED");
  });

  it("leaves out a date that already has an open task carrying it", async () => {
    const client = await createTestClient({ name: "RIMED" });
    const hadas = await staffOn(client.id, "הדס");
    const date = await dateFor(client.id, hadas.id);
    await prisma.task.create({
      data: { clientId: client.id, title: "לחדש רישיון", assignedToId: hadas.id, importantDateId: date.id },
    });

    expect((await digestOf(hadas.id)).dates).toEqual([]);
  });

  it("leaves out a date further away than the horizon", async () => {
    const client = await createTestClient({ name: "RIMED" });
    const hadas = await staffOn(client.id, "הדס");
    await dateFor(client.id, hadas.id, { inDays: 30 });

    expect((await digestOf(hadas.id)).dates).toEqual([]);
  });
});
