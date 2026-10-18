import { describe, expect, it } from "vitest";
import { prisma } from "./setup";
import { createTestClient, createTestUser } from "./factories";
import { addClientSource } from "@/lib/app-domain/client-sources";
import { addClientEntity, updateClientEntity } from "@/lib/app-domain/client-entities";
import { addProcess, linkProcessDates, updateProcess } from "@/lib/app-domain/processes";
import { updateImportantDate } from "@/lib/app-domain/important-dates";
import { syncDateCalendars } from "@/lib/app-domain/date-calendars";
import { mcpGetProcess } from "@/lib/app-domain/mcp-processes";
import { addDaysToKey } from "@/lib/business-calendar";
import { localDateKey, TIMEZONE } from "@/lib/timezone";

// Org-brain decision 6: a date that starts a process is on the process's
// calendar. What is worth holding: linking a date to a process of a US
// entity moves it to the US calendar and recomputes its day; a calendar set
// on the process wins over the entity; a change to the entity's country
// follows; the date's own form cannot pull it back; and a process with
// neither leaves the date alone.

const S1 = [{ code: "S1" }];

/// A Friday more than a month away: a business day in the US, not in Israel.
function nextFriday(): { month: number; day: number; key: string } {
  let key = addDaysToKey(localDateKey(new Date(), TIMEZONE), 40);
  while (new Date(`${key}T12:00:00Z`).getUTCDay() !== 5) key = addDaysToKey(key, 1);
  const [, m, d] = key.split("-").map(Number);
  return { month: m, day: d, key };
}

async function setup() {
  const client = await createTestClient({ name: "NUX" });
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await addClientSource(user, { clientId: client.id, kind: "TRANSCRIPT", title: "Nextage & Ankora" });
  const inc = await addClientEntity(user, { clientId: client.id, name: "NUX Inc", country: "US", sources: S1 });
  const process = await addProcess(user, { clientId: client.id, title: "Washington DOR", triggerKinds: ["SCHEDULED"], entityId: inc.id, sources: S1 });
  const friday = nextFriday();
  const date = await prisma.importantDate.create({
    data: {
      clientId: client.id,
      title: "Washington DOR",
      type: "custom",
      category: "BUSINESS_FINANCE",
      month: friday.month,
      day: friday.day,
      recurrence: "ANNUAL",
      rollConvention: "PREVIOUS_BUSINESS_DAY",
      businessCalendar: "IL",
      responsibleUserId: user.id,
      // On Israel's calendar the Friday moves to Thursday.
      nextOccurrenceAt: new Date(`${addDaysToKey(friday.key, -1)}T00:00:00Z`),
    },
  });
  return { client, user, inc, process, date, friday };
}

const dayOf = async (id: string) => {
  const d = await prisma.importantDate.findUniqueOrThrow({ where: { id } });
  return { calendar: d.businessCalendar, day: d.nextOccurrenceAt ? localDateKey(d.nextOccurrenceAt, TIMEZONE) : null };
};

describe("a date on its process's calendar", () => {
  it("follows the entity's country, then the process's own calendar, and the form cannot pull it back", async () => {
    const { client, user, inc, process, date, friday } = await setup();
    await linkProcessDates(user, process.id, [date.id]);
    // US: Friday is a business day, so the date stays on it.
    expect(await dayOf(date.id)).toEqual({ calendar: "US", day: friday.key });
    expect(await prisma.auditEvent.count({ where: { action: "important_date.calendar", entityId: date.id } })).toBe(1);

    // The date's own form sends Israel; the process decides.
    await updateImportantDate(user, date.id, { businessCalendar: "IL" });
    expect((await dayOf(date.id)).calendar).toBe("US");

    // Set on the process, it wins over the entity.
    await updateProcess(user, process.id, { businessCalendar: "IL" });
    expect(await dayOf(date.id)).toEqual({ calendar: "IL", day: addDaysToKey(friday.key, -1) });
    expect((await mcpGetProcess(user, client.id, process.id))?.businessDays).toContain("ישראל");

    // Back to the entity, then the entity's country changes.
    await updateProcess(user, process.id, { businessCalendar: null });
    expect((await dayOf(date.id)).calendar).toBe("US");
    await updateClientEntity(user, inc.id, { country: "IL" });
    expect((await dayOf(date.id)).calendar).toBe("IL");
  });

  it("a process with no calendar and no country leaves its dates alone, and the nightly sweep finds what a path missed", async () => {
    const { user, inc, process, date } = await setup();
    await updateProcess(user, process.id, { entityId: null });
    await linkProcessDates(user, process.id, [date.id]);
    expect((await dayOf(date.id)).calendar).toBe("IL");

    // Written around the domain, as an import would.
    await prisma.process.update({ where: { id: process.id }, data: { entityId: inc.id } });
    expect((await dayOf(date.id)).calendar).toBe("IL");
    expect(await syncDateCalendars()).toEqual({ changed: 1 });
    expect((await dayOf(date.id)).calendar).toBe("US");
    expect(await syncDateCalendars()).toEqual({ changed: 0 });
  });
});
