import { describe, expect, it } from "vitest";
import {
  assertApprovable,
  APPROVAL_WITHOUT_SUPERVISOR_MESSAGE,
  NEEDS_APPROVAL_MESSAGE,
  NOT_THE_SUPERVISOR_MESSAGE,
} from "@/lib/app-domain/tasks";
import type { TaskStatus } from "@prisma/client";

// Tasks phase 2. The whole transition matrix, in milliseconds.
//
// This rule decides whether a task can close, and it is the one piece of
// phase 2 where being wrong is expensive in both directions: too loose
// and the approval Hadas asked for is decorative, too tight and somebody
// has a task they cannot close and no way to find out why. Reaching it
// only through `updateTask` would mean a database, which means CI, which
// means one answer every twelve minutes. So it is a pure function and it
// is tested as one.
//
// The property under all of it: **every refusal here is about a MOVE,
// never about the shape a row happens to be in.** A rule stated on state
// applies retroactively to every row written before it existed, and the
// day it ships, edits with nothing to do with approval start failing on
// old data for reasons nobody can see. The team-adoption phase paid for
// that lesson once; the last describe block in this file is what keeps
// it paid.

const DOER = { id: "u-doer", role: "ANKORA_EMPLOYEE" as const };
const BOSS = { id: "u-boss", role: "ANKORA_EMPLOYEE" as const };
const ADMIN = { id: "u-admin", role: "ANKORA_ADMIN" as const };

function task(over: Partial<{ status: TaskStatus; supervisorId: string | null; requiresApproval: boolean }> = {}) {
  return { status: "IN_PROGRESS" as TaskStatus, supervisorId: null, requiresApproval: false, ...over };
}

const SUPERVISED = task({ supervisorId: BOSS.id, requiresApproval: true });

describe("a task cannot demand a signature from nobody", () => {
  it("refuses approval turned on with no supervisor", () => {
    expect(() => assertApprovable(DOER, task(), { requiresApproval: true })).toThrow(
      APPROVAL_WITHOUT_SUPERVISOR_MESSAGE
    );
  });

  it("allows approval turned on in the same breath as choosing a supervisor", () => {
    // One gesture on the screen, one patch here. Refusing this would
    // force the person to save twice for a single decision.
    expect(() =>
      assertApprovable(DOER, task(), { requiresApproval: true, supervisorId: BOSS.id })
    ).not.toThrow();
  });

  it("refuses removing the supervisor from a task that still requires approval", () => {
    // The same unclosable task, reached from the other side. Without
    // this, the rule above is one edit away from being pointless.
    expect(() => assertApprovable(DOER, SUPERVISED, { supervisorId: null })).toThrow(
      APPROVAL_WITHOUT_SUPERVISOR_MESSAGE
    );
  });

  it("allows removing the supervisor and the requirement together", () => {
    expect(() =>
      assertApprovable(DOER, SUPERVISED, { supervisorId: null, requiresApproval: false })
    ).not.toThrow();
  });
});

describe("the gate", () => {
  it("refuses a supervised task going straight to DONE", () => {
    expect(() => assertApprovable(DOER, SUPERVISED, { status: "DONE" })).toThrow(NEEDS_APPROVAL_MESSAGE);
  });

  it("refuses it even for the supervisor", () => {
    // Not a permission check. Signing off work that was never submitted
    // skips the step that tells the supervisor there is anything to look
    // at, so the route matters more than the person.
    expect(() => assertApprovable(BOSS, SUPERVISED, { status: "DONE" })).toThrow(NEEDS_APPROVAL_MESSAGE);
  });

  it("refuses it even for an admin", () => {
    expect(() => assertApprovable(ADMIN, SUPERVISED, { status: "DONE" })).toThrow(NEEDS_APPROVAL_MESSAGE);
  });

  it("allows submitting for approval", () => {
    expect(() => assertApprovable(DOER, SUPERVISED, { status: "PENDING_APPROVAL" })).not.toThrow();
  });

  it("does not gate a task that requires no approval", () => {
    expect(() => assertApprovable(DOER, task(), { status: "DONE" })).not.toThrow();
  });

  it("does not gate a task that has a supervisor but no requirement", () => {
    // Both modes Hadas asked for, and this is the line between them.
    // A supervisor alone is somebody who wants to know. The flag is
    // somebody who has to agree. Watching must not slow anyone down or
    // the field stops being filled in.
    const watched = task({ supervisorId: BOSS.id, requiresApproval: false });
    expect(() => assertApprovable(DOER, watched, { status: "DONE" })).not.toThrow();
  });
});

describe("who may sign, and who may waive", () => {
  const WAITING = task({ status: "PENDING_APPROVAL", supervisorId: BOSS.id, requiresApproval: true });

  it("lets the supervisor approve", () => {
    expect(() => assertApprovable(BOSS, WAITING, { status: "DONE" })).not.toThrow();
  });

  it("lets an admin approve", () => {
    // A supervisor on holiday must not be a task nobody in the company
    // can close. The alternative is people switching the flag off, which
    // leaves no record at all; an admin closing it leaves one.
    expect(() => assertApprovable(ADMIN, WAITING, { status: "DONE" })).not.toThrow();
  });

  it("refuses the person who did the work", () => {
    expect(() => assertApprovable(DOER, WAITING, { status: "DONE" })).toThrow(NOT_THE_SUPERVISOR_MESSAGE);
  });

  it("refuses that person switching the requirement off instead", () => {
    // The move that would make the gate decorative: cannot close it, so
    // remove the reason it cannot be closed.
    expect(() => assertApprovable(DOER, WAITING, { requiresApproval: false })).toThrow(
      NOT_THE_SUPERVISOR_MESSAGE
    );
  });

  it("refuses the two moves combined", () => {
    expect(() =>
      assertApprovable(DOER, WAITING, { requiresApproval: false, status: "DONE" })
    ).toThrow(NOT_THE_SUPERVISOR_MESSAGE);
  });

  it("lets the supervisor waive it", () => {
    expect(() => assertApprovable(BOSS, WAITING, { requiresApproval: false })).not.toThrow();
  });

  it("lets anyone withdraw a submission back to open work", () => {
    // Sending it back is not a decision that needs protecting, from
    // either side: a supervisor returning work and a person realising
    // they submitted too early are the same harmless move.
    expect(() => assertApprovable(DOER, WAITING, { status: "IN_PROGRESS" })).not.toThrow();
    expect(() => assertApprovable(BOSS, WAITING, { status: "IN_PROGRESS" })).not.toThrow();
  });

  it("does not guard the flag before anything is riding on it", () => {
    // Up to the moment of submission the switch is an ordinary setting.
    // Guarding it earlier would mean asking the supervisor's permission
    // to decide whether a supervisor is needed.
    expect(() => assertApprovable(DOER, SUPERVISED, { requiresApproval: false })).not.toThrow();
  });
});

describe("the rule is about the move, not the row", () => {
  // Every case here is a row that could not have been created today, and
  // an edit with nothing to do with approval. All of them must pass, or
  // the feature ships by quietly locking history.
  const IMPOSSIBLE = task({ status: "PENDING_APPROVAL", supervisorId: null, requiresApproval: true });

  it("lets an unrelated edit through on a row the rules would now reject", () => {
    expect(() => assertApprovable(DOER, IMPOSSIBLE, { title: "משהו אחר" })).not.toThrow();
    expect(() => assertApprovable(DOER, IMPOSSIBLE, { priority: "HIGH" })).not.toThrow();
    expect(() => assertApprovable(DOER, IMPOSSIBLE, { clientOutcome: "נסגר מול הספק" })).not.toThrow();
  });

  it("lets an empty patch through", () => {
    expect(() => assertApprovable(DOER, IMPOSSIBLE, {})).not.toThrow();
  });

  it("still refuses once that row is actually moved", () => {
    // The flip side, and what makes the guard above a rule rather than a
    // hole: touch the thing the rule is about and it applies.
    expect(() => assertApprovable(DOER, IMPOSSIBLE, { status: "DONE" })).toThrow();
  });
});
