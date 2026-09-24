import { describe, expect, it } from "vitest";
import { serializeTask, type TaskLike } from "@/lib/mcp/serialize";

// Phase 16 (MCP tasks, docs/adr/0005).
//
// Two things here are easy to get wrong and expensive to notice late:
// which calendar day a stored instant falls on, and whether a task counts
// as overdue. Both are computed on the server precisely so a model never
// has to, and both are asserted below against the boundary cases that
// would otherwise only show up as a user saying "that was due Thursday,
// not Wednesday."

const IL = "Asia/Jerusalem";

function task(over: Partial<TaskLike> = {}): TaskLike {
  return {
    id: "t1",
    title: "Send the monthly report",
    status: "OPEN",
    priority: "NORMAL",
    dueDate: null,
    createdAt: new Date("2026-09-01T08:00:00Z"),
    client: { name: "RIMED" },
    category: { name: "Reporting" },
    assignedTo: { name: "הדס" },
    ...over,
  };
}

describe("the due date is a day, not an instant", () => {
  it("emits YYYY-MM-DD, never an ISO timestamp", () => {
    const out = serializeTask(task({ dueDate: new Date("2026-09-24T20:59:00Z") }), { timeZone: IL });
    expect(out.dueDate).toBe("2026-09-24");
  });

  it("uses the user's timezone, not the server's", () => {
    // 21:30 UTC on the 24th is 00:30 on the 25th in Jerusalem. A due date
    // rendered in UTC would tell the user Thursday when Ankora means
    // Friday - the single most likely way this goes wrong on Vercel,
    // whose processes run in UTC.
    const due = new Date("2026-09-24T21:30:00Z");
    expect(serializeTask(task({ dueDate: due }), { timeZone: IL }).dueDate).toBe("2026-09-25");
    expect(serializeTask(task({ dueDate: due }), { timeZone: "UTC" }).dueDate).toBe("2026-09-24");
  });

  it("survives the DST boundary", () => {
    // Israel leaves DST on 2026-10-25. An offset hardcoded at +03:00
    // would shift dates either side of it.
    const beforeDst = new Date("2026-10-20T20:59:00Z"); // 23:59 IDT (+03)
    const afterDst = new Date("2026-11-03T21:59:00Z"); // 23:59 IST (+02)
    expect(serializeTask(task({ dueDate: beforeDst }), { timeZone: IL }).dueDate).toBe("2026-10-20");
    expect(serializeTask(task({ dueDate: afterDst }), { timeZone: IL }).dueDate).toBe("2026-11-03");
  });

  it("emits null when there is no due date", () => {
    expect(serializeTask(task(), { timeZone: IL }).dueDate).toBeNull();
  });
});

describe("overdue", () => {
  const now = new Date("2026-09-21T09:00:00Z");

  it("is false for a task due later today", () => {
    // create_task stores the END of the due day precisely so this holds:
    // a task due today must not read as overdue at nine in the morning.
    const endOfToday = new Date("2026-09-21T20:59:00Z");
    expect(serializeTask(task({ dueDate: endOfToday }), { timeZone: IL, now }).overdue).toBe(false);
  });

  it("is true once the due instant has passed", () => {
    const yesterday = new Date("2026-09-20T20:59:00Z");
    expect(serializeTask(task({ dueDate: yesterday }), { timeZone: IL, now }).overdue).toBe(true);
  });

  it("is false for a task with no due date, however old", () => {
    const ancient = task({ createdAt: new Date("2020-01-01T00:00:00Z") });
    expect(serializeTask(ancient, { timeZone: IL, now }).overdue).toBe(false);
  });

  it("is false for a finished task, however far past its date", () => {
    // Otherwise every completed task in the archive reads as a fire.
    const past = new Date("2026-01-01T00:00:00Z");
    for (const status of ["DONE", "ARCHIVED"]) {
      expect(serializeTask(task({ status, dueDate: past }), { timeZone: IL, now }).overdue, status).toBe(
        false
      );
    }
  });

  it("is true for an in-progress task past its date", () => {
    const past = new Date("2026-01-01T00:00:00Z");
    expect(
      serializeTask(task({ status: "IN_PROGRESS", dueDate: past }), { timeZone: IL, now }).overdue
    ).toBe(true);
  });
});

describe("the payload", () => {
  it("names every field it emits, and no others", () => {
    // The same rule serializeTimeEntry follows: never spread a row, so a
    // column added later cannot silently join the payload.
    const out = serializeTask(task({ dueDate: new Date("2026-09-24T20:59:00Z") }), { timeZone: IL });
    expect(Object.keys(out).sort()).toEqual(
      [
        "assignedTo",
        "category",
        "client",
        "createdAt",
        "dueDate",
        "id",
        "overdue",
        "priority",
        "requiresApproval",
        "status",
        "supervisor",
        "title",
      ].sort()
    );
  });

  it("says who supervises a task, and whether they have to agree", () => {
    // Two fields rather than one, because watching and approving are
    // different arrangements. A model that reported "Dana has to approve
    // this" about a task Dana is only watching would be wrong in the
    // direction that stops work.
    const watched = serializeTask(task({ supervisor: { name: "דנה" } }), { timeZone: IL });
    expect(watched.supervisor).toBe("דנה");
    expect(watched.requiresApproval).toBe(false);

    const gated = serializeTask(task({ supervisor: { name: "דנה" }, requiresApproval: true }), {
      timeZone: IL,
    });
    expect(gated.requiresApproval).toBe(true);
  });

  it("emits both for an unsupervised task rather than leaving them out", () => {
    // The same reasoning as `priority` above: a field that vanishes when
    // it is ordinary reads as missing data, and a model that cannot see
    // "nobody supervises this" will ask.
    const out = serializeTask(task(), { timeZone: IL });
    expect(out.supervisor).toBeNull();
    expect(out.requiresApproval).toBe(false);
  });

  it("flattens relations to names, and tolerates missing ones", () => {
    const bare = serializeTask(
      { id: "t2", title: "x", status: "OPEN", priority: "NORMAL", dueDate: null, createdAt: new Date(0) },
      { timeZone: IL }
    );
    expect(bare.client).toBeNull();
    expect(bare.category).toBeNull();
    expect(bare.assignedTo).toBeNull();
  });

  it("emits the status as the machine value, not a Hebrew label", () => {
    // TASK_STATUS_LABELS belongs on the screen. A model comparing
    // statuses needs the enum.
    expect(serializeTask(task({ status: "IN_PROGRESS" }), { timeZone: IL }).status).toBe("IN_PROGRESS");
  });
});
