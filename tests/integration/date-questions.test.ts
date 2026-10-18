import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { askCondition, askUnknownDates } from "@/lib/app-domain/date-questions";
import { listClientFacts } from "@/lib/app-domain/client-facts";

// A date that cannot be scheduled is a question in the client's file
// (claude/org-brain-spec-2026-10-12.md, 3.10, 5.3). What is worth holding:
// asked once per date (unknown) or per occurrence (conditional), of the
// date's owner, and a sensitive date's question is seen by its owner only.

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: ana } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  for (const u of [hadas, ana]) await prisma.userClientAccess.create({ data: { userId: u.id, clientId: client.id } });
  return { client, hadas, ana };
}

const date = (clientId: string, responsibleUserId: string, data: Record<string, unknown>) =>
  prisma.importantDate.create({ data: { clientId, responsibleUserId, title: "דוח שנתי לרשם", type: "CUSTOM", category: "BUSINESS_FINANCE", month: 6, day: 30, recurrence: "ANNUAL", ...data } as never });

describe("dates as questions in the file", () => {
  it("an unknown date asks its owner once", async () => {
    const { client, hadas } = await setup();
    await date(client.id, hadas.id, { precision: "UNKNOWN" });
    expect(await askUnknownDates()).toEqual({ asked: 1 });
    expect(await askUnknownDates()).toEqual({ asked: 0 });
    const q = (await listClientFacts(hadas, client.id)).current.filter((f) => f.kind === "QUESTION");
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ assigneeId: hadas.id, knowledgeStatus: "MISSING" });
    expect(q[0].body).toContain("מתי דוח שנתי לרשם");
  });

  it("a conditional date asks once per occurrence; a sensitive one only of its owner", async () => {
    const { client, hadas, ana } = await setup();
    const d = await date(client.id, hadas.id, { title: "פיצוי SLA", conditionText: "לא עמדנו ב-SLA ברבעון", sensitivity: "SENSITIVE" });
    expect(await askCondition(d, "2026-12-31", "31/12/2026")).toBe(true);
    expect(await askCondition(d, "2026-12-31", "31/12/2026")).toBe(false);
    expect(await askCondition(d, "2027-03-31", "31/03/2027")).toBe(true);
    expect((await listClientFacts(hadas, client.id)).current.filter((f) => f.kind === "QUESTION")).toHaveLength(2);
    expect((await listClientFacts(ana, client.id)).current.filter((f) => f.kind === "QUESTION")).toHaveLength(0);
  });
});
