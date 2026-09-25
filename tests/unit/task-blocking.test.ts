import { describe, expect, it } from "vitest";
import { BLOCK_ON_CLOSED_MESSAGE, assertBlockable } from "@/lib/app-domain/tasks";
import { TASK_BLOCKER_LABELS, waitingTitle } from "@/lib/app-domain/portal-labels";

// Tasks phase 5, "חסימה פשוטה".
//
// Two pure things, checked without a database for the same reason
// `assertApprovable` is: they are functions of their arguments, and a
// question that can be answered in a millisecond should not wait twelve
// minutes for CI.

describe("finished work is not waiting for anybody", () => {
  it("refuses a block on a task that is already closed", () => {
    for (const status of ["DONE", "ARCHIVED"] as const) {
      expect(() => assertBlockable({ status }, { blockedOn: "CLIENT" })).toThrow(BLOCK_ON_CLOSED_MESSAGE);
    }
  });

  it("refuses a block applied on the way out", () => {
    // The interesting one. Both halves in a single patch look innocent
    // field by field, and the result is a closed task that still claims
    // somebody owes us an answer.
    expect(() =>
      assertBlockable({ status: "IN_PROGRESS" }, { blockedOn: "SUPPLIER", status: "DONE" })
    ).toThrow(BLOCK_ON_CLOSED_MESSAGE);
  });

  it("allows a block on open work, in every shape it comes in", () => {
    for (const status of ["OPEN", "IN_PROGRESS", "PENDING_APPROVAL"] as const) {
      expect(() => assertBlockable({ status }, { blockedOn: "CLIENT" })).not.toThrow();
    }
  });

  it("never gets in the way of lifting one, or of a patch that says nothing", () => {
    // Clearing a block on a closed task is how `updateTask` tidies up
    // after a close. A rule that refused it would refuse the close.
    expect(() => assertBlockable({ status: "DONE" }, { blockedOn: null })).not.toThrow();
    expect(() => assertBlockable({ status: "DONE" }, {})).not.toThrow();
  });
});

describe("how long we have been waiting, in words", () => {
  const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  it("counts whole days, because that is the question", () => {
    expect(waitingTitle("CLIENT", since(0))).toBe("ממתין ללקוח, מהיום");
    expect(waitingTitle("CLIENT", since(1))).toBe("ממתין ללקוח, מאתמול");
    expect(waitingTitle("SUPPLIER", since(6))).toBe("ממתין לספק, 6 ימים");
  });

  it("still says who, when it does not know since when", () => {
    // Every blocked row has a date in practice, because the server
    // writes it. A badge that renders "undefined ימים" on the one row
    // that slipped through is worse than a badge that says less.
    expect(waitingTitle("INTERNAL", null)).toBe("ממתין לגורם פנימי");
  });

  it("has a Hebrew word for every blocker the database can hold", () => {
    for (const label of Object.values(TASK_BLOCKER_LABELS)) {
      expect(label.trim()).not.toBe("");
    }
    expect(Object.keys(TASK_BLOCKER_LABELS).sort()).toEqual([
      "CLIENT",
      "INTERNAL",
      "OTHER",
      "SUPPLIER",
    ]);
  });
});
