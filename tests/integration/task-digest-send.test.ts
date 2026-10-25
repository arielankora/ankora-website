import { describe, expect, it, beforeEach, vi } from "vitest";

// The morning email, from the outside: who gets one, who does not, and
// what the stamp does afterwards.
//
// Written 25.10.2026, because the weekly coverage check reported
// sendDailyTaskDigest as never executed by a test. The pure parts of
// this module are covered well in tests/unit/task-digest.test.ts -
// ranking, the subject line, the day boundary, the rendering. The
// function that actually sends was not, and it is the one with the
// decisions in it.
//
// Three of those decisions are written in the source as comments, which
// is a good sign about the thinking and no guarantee at all about the
// behaviour:
//
// - A digest with nothing in it still moves the stamp. Without that, a
//   quiet Tuesday makes Wednesday's "חדש אצלך" reach back two days and
//   re-announce work the person already saw in the app.
// - A failed send does NOT move it. A stamp moved after a failure
//   swallows the day: tomorrow would treat today's new work as already
//   reported.
// - Client users never receive it, by role rather than by a filter
//   somebody has to remember.

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { prisma } from "./setup";
import { createTestClient, createTestClientUser, createTestUser } from "./factories";
import { createTask } from "@/lib/app-domain/tasks";
import { isWorkingDay, sendDailyTaskDigest } from "@/lib/app-domain/task-digest";
import { sendEmail } from "@/lib/email";

// A Wednesday morning in Israel, and a Friday, asserted rather than
// assumed: a date that quietly stopped being a working day would make
// most of this file pass by sending nothing.
const WEDNESDAY = new Date("2026-03-11T06:00:00+02:00");
const FRIDAY = new Date("2026-03-13T06:00:00+02:00");

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, providerMessageId: "msg" });
});

/// Somebody with one late task, which is the shortest way to a digest
/// that is not empty.
async function personWithLateWork(over: { digestByEmail?: boolean } = {}) {
  const client = await createTestClient();
  const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });
  await prisma.userClientAccess.create({ data: { userId: user.id, clientId: client.id } });
  await createTask(user, {
    clientId: client.id,
    title: "משימה שאיחרה",
    assignedToId: user.id,
    dueDate: new Date("2026-03-01T10:00:00+02:00"),
  });
  if (over.digestByEmail === false) {
    await prisma.user.update({ where: { id: user.id }, data: { dailyDigestByEmail: false } });
  }
  return { user, client };
}

const recipients = () => vi.mocked(sendEmail).mock.calls.flatMap(([input]) => input.to);
const stampOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id }, select: { dailyDigestAt: true } })).dailyDigestAt;

describe("the days it runs at all", () => {
  it("agrees with the calendar about which day these are", () => {
    expect(isWorkingDay(WEDNESDAY)).toBe(true);
    expect(isWorkingDay(FRIDAY)).toBe(false);
  });

  it("sends nothing on a Friday, and does not move anybody's stamp", async () => {
    const { user } = await personWithLateWork();

    const result = await sendDailyTaskDigest(FRIDAY);

    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await stampOf(user.id)).toBeNull();
  });
});

describe("who gets the morning email", () => {
  it("sends one to a person with late work, and stamps them", async () => {
    const { user } = await personWithLateWork();

    const result = await sendDailyTaskDigest(WEDNESDAY);

    expect(result.sent).toBe(1);
    expect(recipients()).toContain(user.email);
    expect(await stampOf(user.id)).toEqual(WEDNESDAY);
  });

  it("never sends one to a client user", async () => {
    // By role, not by a filter somebody has to remember: there is no
    // version of this email a client should receive.
    const { user } = await personWithLateWork();
    const client = await createTestClient();
    const { user: portalUser } = await createTestClientUser({ clientId: client.id });
    await prisma.user.update({ where: { id: portalUser.id }, data: { dailyDigestByEmail: true } });

    await sendDailyTaskDigest(WEDNESDAY);

    expect(recipients()).toContain(user.email);
    expect(recipients()).not.toContain(portalUser.email);
  });

  it("leaves out somebody who turned it off", async () => {
    const { user } = await personWithLateWork({ digestByEmail: false });

    const result = await sendDailyTaskDigest(WEDNESDAY);

    expect(result.sent).toBe(0);
    expect(recipients()).not.toContain(user.email);
    // And their stamp is untouched, because nothing was reported to them.
    expect(await stampOf(user.id)).toBeNull();
  });

  it("leaves out somebody who is not active", async () => {
    const { user } = await personWithLateWork();
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });

    expect((await sendDailyTaskDigest(WEDNESDAY)).sent).toBe(0);
    expect(recipients()).not.toContain(user.email);
  });
});

describe("the stamp, which decides what tomorrow calls new", () => {
  it("moves on a quiet day even though no email went out", async () => {
    // The comment in the source: without this, a quiet Tuesday makes
    // Wednesday reach back two days and re-announce work already seen.
    const { user } = await createTestUser({ role: "ANKORA_EMPLOYEE" });

    const result = await sendDailyTaskDigest(WEDNESDAY);

    expect(result.sent).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await stampOf(user.id), "a quiet day left the stamp behind").toEqual(WEDNESDAY);
  });

  it("does not move when the send failed", async () => {
    // A stamp moved after a failure swallows the day: tomorrow would
    // treat today's new work as already reported, and nobody would ever
    // learn that the email had not arrived.
    const { user } = await personWithLateWork();
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "provider refused" });

    const result = await sendDailyTaskDigest(WEDNESDAY);

    expect(sendEmail).toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(await stampOf(user.id), "the day was swallowed by a stamp after a failed send").toBeNull();
  });

  it("goes on to the next person when one of them throws", async () => {
    // One address the provider chokes on must not cost everybody else
    // their morning.
    const first = await personWithLateWork();
    const second = await personWithLateWork();

    vi.mocked(sendEmail).mockImplementation(async (input) => {
      if (input.to.includes(first.user.email)) throw new Error("provider exploded");
      return { ok: true, providerMessageId: "msg" };
    });

    const result = await sendDailyTaskDigest(WEDNESDAY);

    expect(result.sent).toBe(1);
    expect(await stampOf(second.user.id)).toEqual(WEDNESDAY);
    expect(await stampOf(first.user.id), "a thrown send still moved the stamp").toBeNull();
  });
});
