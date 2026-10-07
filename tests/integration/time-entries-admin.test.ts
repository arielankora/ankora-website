import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { NextRequest } from "next/server";
import { prisma } from "./setup";
import { createTestUser, createTestClient, createTestCategory, createTestClientUser, createTestTimeEntry } from "./factories";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { dayEndInZone, dayStartInZone } from "@/lib/timezone";

// The time-entry functions behind the timer's running note, the admin
// "דיווחי זמן" screen (list, restore, revision history), "my time" and the
// timer's quick-start chips. Several of them (listTimeEntriesForAdmin,
// getEntryRevisions) carry no permission check of their own; the gate is
// the route or server action that calls them, so those are exercised
// through that caller with the session mocked to whoever is acting.

const session = vi.hoisted(() => ({ user: null as User | null }));

vi.mock("@/lib/app-auth/session", () => {
  class UnauthorizedError extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "UnauthorizedError";
    }
  }
  const current = async () => {
    if (!session.user) throw new UnauthorizedError();
    return session.user;
  };
  return { UnauthorizedError, requireUser: current, requireUserOrThrow: current, getCurrentUser: async () => session.user };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import {
  updateActiveTimerNote,
  restoreTimeEntry,
  deleteTimeEntry,
  updateTimeEntry,
  getActiveTimers,
  listMyTimeEntries,
  listTimeEntriesForAdmin,
  listRecentCombinations,
} from "@/lib/app-domain/time-entries";
import { getCurrentHourBank, openHourBankCycle } from "@/lib/app-domain/hour-banks";
import { getEntryRevisionsAction } from "@/app/(product)/app/(authenticated)/time-entries/actions";
import { GET as exportTimeEntries } from "@/app/api/time-entries/export/route";

beforeEach(() => {
  session.user = null;
});

async function setup() {
  const { user: superAdmin } = await createTestUser({ role: "SUPER_ADMIN" });
  const { user: admin } = await createTestUser({ role: "ANKORA_ADMIN" });
  const { user: alice } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const { user: bob } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  const clientA = await createTestClient({ name: "Client A" });
  const clientB = await createTestClient({ name: "Client B" });
  const category = await createTestCategory({ name: "Ops" });
  await prisma.userClientAccess.createMany({
    data: [
      { userId: alice.id, clientId: clientA.id },
      { userId: alice.id, clientId: clientB.id },
      { userId: bob.id, clientId: clientA.id },
    ],
  });
  return { superAdmin, admin, alice, bob, clientA, clientB, category };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

describe("updateActiveTimerNote() - only the owner's own running timer", () => {
  it("saves the note on my running timer, trimmed, without turning it into an audited edit", async () => {
    const { alice, clientA, category } = await setup();
    const timer = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(1), endAt: null });

    await updateActiveTimerNote(alice, timer.id, "  drafting the board pack  ");
    let row = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timer.id } });
    expect(row.note).toBe("drafting the board pack");
    // An autosaving scratchpad: no isEdited flag, no revision row per keystroke,
    // and the timer is still running.
    expect(row.isEdited).toBe(false);
    expect(row.endAt).toBeNull();
    expect(await prisma.timeEntryRevision.count({ where: { timeEntryId: timer.id } })).toBe(0);

    // Clearing the field clears the note, rather than storing whitespace.
    await updateActiveTimerNote(alice, timer.id, "   ");
    row = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timer.id } });
    expect(row.note).toBeNull();
  });

  it("refuses someone else's running timer - a colleague, and an admin too - and leaves its note alone", async () => {
    const { superAdmin, alice, bob, clientA, category } = await setup();
    const timer = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(1), endAt: null });
    await prisma.timeEntry.update({ where: { id: timer.id }, data: { note: "Alice's note" } });

    await expect(updateActiveTimerNote(bob, timer.id, "overwritten")).rejects.toThrow("Active timer not found.");
    // No edit_others escape hatch here: an admin corrects a finished entry
    // through the audited edit, not someone's in-progress note.
    await expect(updateActiveTimerNote(superAdmin, timer.id, "overwritten")).rejects.toThrow("Active timer not found.");

    const row = await prisma.timeEntry.findUniqueOrThrow({ where: { id: timer.id } });
    expect(row.note).toBe("Alice's note");
  });

  it("refuses a stopped entry and a discarded (soft-deleted) timer", async () => {
    const { alice, clientA, clientB, category } = await setup();
    const stopped = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(3) });
    const discarded = await createTestTimeEntry({ userId: alice.id, clientId: clientB.id, categoryId: category.id, startAt: hoursAgo(1), endAt: null });
    await prisma.timeEntry.update({ where: { id: discarded.id }, data: { deletedAt: new Date() } });

    // A stopped entry is a finished record: changing its note must go
    // through updateTimeEntry, which leaves a revision.
    await expect(updateActiveTimerNote(alice, stopped.id, "late note")).rejects.toThrow("Active timer not found.");
    await expect(updateActiveTimerNote(alice, discarded.id, "late note")).rejects.toThrow("Active timer not found.");
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: stopped.id } })).note).toBeNull();
  });
});

describe("restoreTimeEntry() - undoing a delete", () => {
  it("an admin restores an employee's deleted entry: it counts in the hour bank again, and the restore is audited", async () => {
    const { superAdmin, admin, alice, clientA, category } = await setup();
    await openHourBankCycle(superAdmin, clientA.id, {
      cycleStart: new Date(Date.now() - 7 * 86_400_000),
      cycleEnd: new Date(Date.now() + 7 * 86_400_000),
      purchasedMinutes: 600,
      rolloverMode: "NONE",
    });
    const e = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5), endAt: hoursAgo(4) });

    expect((await getCurrentHourBank(clientA.id))!.utilization.consumedMinutes).toBe(60);
    await deleteTimeEntry(admin, e.id);
    expect((await getCurrentHourBank(clientA.id))!.utilization.consumedMinutes).toBe(0);
    expect(await listMyTimeEntries(alice.id)).toHaveLength(0);

    await restoreTimeEntry(admin, e.id);

    expect((await getCurrentHourBank(clientA.id))!.utilization.consumedMinutes).toBe(60);
    expect((await listMyTimeEntries(alice.id)).map((x) => x.id)).toEqual([e.id]);
    const audit = await prisma.auditEvent.findFirst({ where: { action: "time_entry.restore", entityId: e.id } });
    expect(audit?.actorId).toBe(admin.id);
    expect(audit?.clientId).toBe(clientA.id);
  });

  it("an employee may restore their own deleted entry, but not a colleague's", async () => {
    const { alice, bob, clientA, category } = await setup();
    const mine = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5), endAt: hoursAgo(4) });
    const bobs = await createTestTimeEntry({ userId: bob.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5), endAt: hoursAgo(4) });
    await prisma.timeEntry.updateMany({ where: { id: { in: [mine.id, bobs.id] } }, data: { deletedAt: new Date() } });

    await restoreTimeEntry(alice, mine.id);
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: mine.id } })).deletedAt).toBeNull();

    await expect(restoreTimeEntry(alice, bobs.id)).rejects.toThrow(ForbiddenError);
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: bobs.id } })).deletedAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "time_entry.restore", entityId: bobs.id } })).toBe(0);
  });

  it("a client portal user cannot restore anything", async () => {
    const { alice, clientA, category } = await setup();
    const { user: portal } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });
    const e = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5), endAt: hoursAgo(4) });
    await prisma.timeEntry.update({ where: { id: e.id }, data: { deletedAt: new Date() } });

    await expect(restoreTimeEntry(portal, e.id)).rejects.toThrow(ForbiddenError);
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).deletedAt).not.toBeNull();
  });

  it("restoring a discarded running timer brings back a closed zero-minute entry, never a second running timer", async () => {
    const { alice, clientA, category } = await setup();
    const timer = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(2), endAt: null });
    await deleteTimeEntry(alice, timer.id); // the timer screen's "discard without saving"

    const restored = await restoreTimeEntry(alice, timer.id);
    expect(restored.endAt).not.toBeNull();
    expect(restored.actualSeconds).toBe(0);
    expect(restored.billableSeconds).toBe(0);
    expect(await getActiveTimers(alice.id)).toHaveLength(0);
  });

  // QUESTION (not marked as a bug): restore, like deleteTimeEntry, has no
  // 48-hour self-edit window, while updateTimeEntry does. An employee can
  // delete and restore their own entry from last month - moving a closed
  // hour-bank cycle's consumption - without a manager. Asserted as it is.
  it("an employee's restore of an old entry is not limited by the 48-hour self-edit window (current behaviour)", async () => {
    const { alice, clientA, category } = await setup();
    const old = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(24 * 30), endAt: hoursAgo(24 * 30 - 1) });
    await prisma.timeEntry.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
    await expect(restoreTimeEntry(alice, old.id)).resolves.toMatchObject({ deletedAt: null });
  });
});

describe("listMyTimeEntries() - my own entries only", () => {
  it("returns only my entries, never deleted ones, newest first, including my running timer", async () => {
    const { alice, bob, clientA, clientB, category } = await setup();
    const older = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(10), endAt: hoursAgo(9) });
    const running = await createTestTimeEntry({ userId: alice.id, clientId: clientB.id, categoryId: category.id, startAt: hoursAgo(1), endAt: null });
    const deleted = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5), endAt: hoursAgo(4) });
    await prisma.timeEntry.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await createTestTimeEntry({ userId: bob.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(3), endAt: hoursAgo(2) });

    const mine = await listMyTimeEntries(alice.id);
    expect(mine.map((e) => e.id)).toEqual([running.id, older.id]);
  });

  it("treats the range as half-open: an entry at exactly `to` belongs to the next week, not both", async () => {
    const { alice, clientA, category } = await setup();
    const from = dayStartInZone("2026-09-20")!; // Sunday, Israel midnight
    const to = dayStartInZone("2026-09-27")!; // the next Sunday
    const atFrom = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: from });
    await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: to });
    await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: new Date(from.getTime() - 60_000) });

    const week = await listMyTimeEntries(alice.id, { from, to });
    expect(week.map((e) => e.id)).toEqual([atFrom.id]);
  });
});

describe("listTimeEntriesForAdmin() - the admin screen's cross-client table", () => {
  it("filters by client, by employee and by an Israel-day range with the 'to' day inclusive, never showing deleted rows", async () => {
    const { alice, bob, clientA, clientB, category } = await setup();
    const mk = (userId: string, clientId: string, iso: string) =>
      createTestTimeEntry({ userId, clientId, categoryId: category.id, startAt: new Date(iso), endAt: new Date(new Date(iso).getTime() + 1800_000) });

    const a1 = await mk(alice.id, clientA.id, "2026-09-10T07:00:00Z");
    const a2 = await mk(alice.id, clientB.id, "2026-09-10T08:00:00Z");
    const b1 = await mk(bob.id, clientA.id, "2026-09-10T09:00:00Z");
    // 30.9 at 23:30 Israel (20:30Z, summer time): inside a range ending 30.9.
    const late = await mk(alice.id, clientA.id, "2026-09-30T20:30:00Z");
    // 1.10 at 00:30 Israel: outside it.
    await mk(alice.id, clientA.id, "2026-09-30T21:30:00Z");
    const gone = await mk(bob.id, clientA.id, "2026-09-11T09:00:00Z");
    await prisma.timeEntry.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    const september = { from: dayStartInZone("2026-09-01"), to: dayEndInZone("2026-09-30") };

    const all = await listTimeEntriesForAdmin(september);
    expect(all.map((e) => e.id)).toEqual([late.id, b1.id, a2.id, a1.id]);

    const onlyA = await listTimeEntriesForAdmin({ ...september, clientId: clientA.id });
    expect(onlyA.map((e) => e.id).sort()).toEqual([late.id, b1.id, a1.id].sort());
    expect(onlyA.every((e) => e.clientId === clientA.id)).toBe(true);

    const onlyBob = await listTimeEntriesForAdmin({ ...september, userId: bob.id });
    expect(onlyBob.map((e) => e.id)).toEqual([b1.id]);
  });

  it("is reachable through the CSV export only for staff with time_entry.edit_others", async () => {
    const { admin, alice, bob, clientA, clientB, category } = await setup();
    const { user: portal } = await createTestClientUser({ clientId: clientA.id, role: "ADMIN" });
    const note = async (userId: string, clientId: string, text: string) => {
      const e = await createTestTimeEntry({ userId, clientId, categoryId: category.id, startAt: hoursAgo(5), endAt: hoursAgo(4) });
      return prisma.timeEntry.update({ where: { id: e.id }, data: { note: text } });
    };
    await note(alice.id, clientA.id, "note-alice-A");
    await note(bob.id, clientA.id, "note-bob-A");
    await note(alice.id, clientB.id, "note-alice-B");
    const del = await note(bob.id, clientA.id, "note-deleted");
    await prisma.timeEntry.update({ where: { id: del.id }, data: { deletedAt: new Date() } });

    const req = (qs: string) => new NextRequest(`http://localhost/api/time-entries/export?${qs}`);

    // An employee asking for the whole team's hours, and a client asking
    // for its own client, are both refused.
    session.user = alice;
    expect((await exportTimeEntries(req(`clientId=${clientA.id}`))).status).toBe(403);
    session.user = portal;
    expect((await exportTimeEntries(req(`clientId=${clientA.id}`))).status).toBe(403);
    session.user = null;
    expect((await exportTimeEntries(req(""))).status).toBe(401);

    session.user = admin;
    const res = await exportTimeEntries(req(`clientId=${clientA.id}`));
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("note-alice-A");
    expect(csv).toContain("note-bob-A");
    expect(csv).not.toContain("note-alice-B"); // another client
    expect(csv).not.toContain("note-deleted");
  });
});

describe("getEntryRevisions() via getEntryRevisionsAction - who may read an entry's edit history", () => {
  it("an admin reads the history of that entry only, newest version first, with who and why", async () => {
    const { admin, alice, clientA, category } = await setup();
    const e = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5), endAt: hoursAgo(4) });
    const other = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(8), endAt: hoursAgo(7) });
    await updateTimeEntry(alice, e.id, { note: "first", reason: "typo" });
    await updateTimeEntry(admin, e.id, { note: "second", reason: "client asked" });
    await updateTimeEntry(admin, other.id, { note: "unrelated", reason: "other entry" });

    session.user = admin;
    const revisions = await getEntryRevisionsAction(e.id);
    expect(revisions.map((r) => [r.version, r.changedByName, r.reason])).toEqual([
      [2, admin.name, "client asked"],
      [1, alice.name, "typo"],
    ]);
  });

  it("an employee is refused - another employee's entry, and (by design) their own entry's history too", async () => {
    const { alice, bob, clientA, category } = await setup();
    const e = await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5), endAt: hoursAgo(4) });
    await updateTimeEntry(alice, e.id, { note: "edited", reason: "typo" });

    session.user = bob;
    await expect(getEntryRevisionsAction(e.id)).rejects.toThrow(ForbiddenError);
    // The revision view lives on the admin screen and is gated on
    // time_entry.edit_others (see the action's comment); the owner reads
    // their entry, not its audit trail.
    session.user = alice;
    await expect(getEntryRevisionsAction(e.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("listRecentCombinations() - the timer's quick-start chips", () => {
  it("offers only my own recent client/category pairs, newest first, de-duplicated, without deleted entries", async () => {
    const { alice, bob, clientA, clientB, category } = await setup();
    const other = await createTestCategory({ name: "Calls" });
    const clientC = await createTestClient({ name: "Client C" });
    await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(1) });
    await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(3) }); // same pair again
    await createTestTimeEntry({ userId: alice.id, clientId: clientB.id, categoryId: category.id, startAt: hoursAgo(5) });
    await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: other.id, startAt: hoursAgo(7) });
    const deleted = await createTestTimeEntry({ userId: alice.id, clientId: clientC.id, categoryId: category.id, startAt: hoursAgo(2) });
    await prisma.timeEntry.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await createTestTimeEntry({ userId: bob.id, clientId: clientA.id, categoryId: other.id, startAt: hoursAgo(0.5) });

    const combos = await listRecentCombinations(alice.id, 5);
    expect(combos.map((c) => [c.client.name, c.category.name])).toEqual([
      ["Client A", "Ops"],
      ["Client B", "Ops"],
      ["Client A", "Calls"],
    ]);
    expect(combos.every((c) => c.userId === alice.id)).toBe(true);

    // The timer screen asks for three; the limit is respected.
    expect(await listRecentCombinations(alice.id, 2)).toHaveLength(2);
  });

  // Found 2026-10-07, fixed the same day. Was: listRecentCombinations
  // (lib/app-domain/time-entries.ts:978) reads raw history with no check
  // of the client's status or the person's current access, and the timer
  // page (timer/page.tsx:54, :92) passes the result straight to the
  // quick-start chips. An employee taken off a client keeps seeing that
  // client's name as a one-click start, and tapping it fails with "not
  // assigned"; an archived client's chip fails with "inactive". Each dead
  // chip also takes one of only three slots.
  it("does not offer a client I no longer have access to", async () => {
    const { alice, clientA, clientB, category } = await setup();
    await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5) });
    await createTestTimeEntry({ userId: alice.id, clientId: clientB.id, categoryId: category.id, startAt: hoursAgo(1) });
    await prisma.userClientAccess.delete({ where: { userId_clientId: { userId: alice.id, clientId: clientB.id } } });

    const combos = await listRecentCombinations(alice.id, 3);
    expect(combos.map((c) => c.client.name)).toEqual(["Client A"]);
  });

  it("does not offer an archived client", async () => {
    const { alice, clientA, clientB, category } = await setup();
    await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5) });
    await createTestTimeEntry({ userId: alice.id, clientId: clientB.id, categoryId: category.id, startAt: hoursAgo(1) });
    await prisma.client.update({ where: { id: clientB.id }, data: { status: "ARCHIVED" } });

    const combos = await listRecentCombinations(alice.id, 3);
    expect(combos.map((c) => c.client.name)).toEqual(["Client A"]);
  });

  it("does not offer a category that was retired", async () => {
    const { alice, clientA, category } = await setup();
    const retired = await createTestCategory({ name: "Retired" });
    await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5) });
    await createTestTimeEntry({ userId: alice.id, clientId: clientA.id, categoryId: retired.id, startAt: hoursAgo(1) });
    await prisma.category.update({ where: { id: retired.id }, data: { active: false } });

    const combos = await listRecentCombinations(alice.id, 3);
    expect(combos.map((c) => c.category.name)).toEqual(["Ops"]);
  });

  it("still offers an admin their recent clients, though admins have no per-client access rows", async () => {
    const { admin, clientA, clientB, category } = await setup();
    await createTestTimeEntry({ userId: admin.id, clientId: clientA.id, categoryId: category.id, startAt: hoursAgo(5) });
    await createTestTimeEntry({ userId: admin.id, clientId: clientB.id, categoryId: category.id, startAt: hoursAgo(1) });

    const combos = await listRecentCombinations(admin.id, 3);
    expect(combos.map((c) => c.client.name)).toEqual(["Client B", "Client A"]);
  });
});
