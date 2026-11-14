import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { createImportantDate, updateImportantDate } from "@/lib/app-domain/important-dates";

// update_date (14.11.2026): Guy's last day at NUX moved from 15.11 to
// 30.11, and the connector could not move a date already in the file.
// What is worth holding: a one-time date moves to the new day with its
// note, a date a process's rhythm made is refused with the way to change
// it, and a sensitive date is not a candidate.

vi.mock("@/lib/mcp/auth", () => ({
  actorFromAuthInfo: (authInfo: { extra: { user: User } }) => authInfo.extra.user,
}));

import { registerAnkoraTools } from "@/lib/mcp/tools";

type Handler = (args: unknown, ctx: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
const tools = new Map<string, Handler>();
registerAnkoraTools({ registerTool: (name: string, _c: unknown, h: Handler) => tools.set(name, h) } as never);

async function call(user: User, name: string, args: unknown) {
  const result = await tools.get(name)!(args, { http: { authInfo: { extra: { user } } } });
  const text = result.content.map((c) => c.text).join("");
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

const once = (actor: User, clientId: string, title: string, day: string, extra: Record<string, unknown> = {}) =>
  createImportantDate(actor, {
    clientId,
    title,
    type: "CLIENT",
    category: "GENERAL",
    calendarType: "GREGORIAN",
    month: Number(day.slice(5, 7)),
    day: Number(day.slice(8, 10)),
    recurrence: "ONCE",
    onceDate: new Date(`${day}T00:00:00Z`),
    responsibleUserId: actor.id,
    useDefaultReminders: false,
    reminderRules: [],
    ...extra,
  });

describe("update_date", () => {
  it("moves a one-time date and writes its note", async () => {
    const client = await createTestClient({ name: "NUX" });
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
    const d = await once(hadas, client.id, "היום האחרון של גיא זינמן ב-NUX", "2026-12-15");

    const moved = await call(hadas, "update_date", { client: "NUX", date: "היום האחרון של גיא", newDate: "2026-12-30", notes: "התאריך לא סופי" });
    expect(moved.json).toMatchObject({ saved: true, id: d.id, next: "2026-12-30", notes: "התאריך לא סופי" });
    const row = await prisma.importantDate.findUniqueOrThrow({ where: { id: d.id } });
    expect([row.month, row.day, row.onceDate?.toISOString().slice(0, 10)]).toEqual([12, 30, "2026-12-30"]);

    const paused = await call(hadas, "update_date", { client: "NUX", date: d.id, status: "PAUSED" });
    expect(paused.json.status).toBe("PAUSED");
  });

  it("refuses a rhythm's date and does not see a sensitive one", async () => {
    const client = await createTestClient({ name: "NUX" });
    const { user: hadas } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
    await prisma.userClientAccess.create({ data: { userId: hadas.id, clientId: client.id } });
    const p = await prisma.process.create({ data: { clientId: client.id, seq: 1, code: "P1", title: "תשלומים" } });
    const start = await prisma.processStart.create({ data: { processId: p.id, clientId: client.id, kind: "SCHEDULE", sortOrder: 0 } });
    const r = await once(hadas, client.id, "P1 תשלומים", "2026-12-10");
    await prisma.importantDate.update({ where: { id: r.id }, data: { processId: p.id, processStartId: start.id } });
    expect((await call(hadas, "update_date", { client: "NUX", date: r.id, newDate: "2026-12-11" })).text).toContain("set_process_rhythm");
    // The dates screen's save goes through the same domain: refused too.
    await expect(updateImportantDate(hadas, r.id, { title: "x" })).rejects.toMatchObject({ code: "importantDates.fromRhythm" });

    await once(hadas, client.id, "בדיקה רפואית", "2026-12-20", { sensitivity: "SENSITIVE" });
    expect((await call(hadas, "update_date", { client: "NUX", date: "בדיקה רפואית", newDate: "2026-12-21" })).json).toBeNull();
  });
});
