import { describe, expect, it } from "vitest";
import { TaskStatus } from "@prisma/client";
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS, OPEN_STATUSES } from "@/lib/app-domain/tasks";

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec §5/§10.2's
// Open/In-progress/Done/Archived statuses). Note: importing
// "@/lib/app-domain/tasks" pulls in lib/prisma.ts through its own import
// (same as every other lib/app-domain/*.ts test file - see
// tests/unit/reports.test.ts's comment for the full explanation), so this
// file cannot actually RUN in this sandbox (documented, pre-existing
// limitation: @prisma/client cannot reach binaries.prisma.sh here). It
// runs normally in CI, which has network access.
//
// Tasks phase 2 rewrote the first case. It used to name the four
// statuses it expected, which meant adding PENDING_APPROVAL to the model
// broke it, and the only thing that fixes a test like that is retyping
// the list - so it never actually guarded anything, it just asked to be
// edited. It now reads the enum out of the generated client, which makes
// it the guard it was meant to be: add a status to schema.prisma without
// a Hebrew label anywhere and this fails, naming the one you missed.
describe("TASK_STATUS_LABELS - spec §5/§10.2", () => {
  it("labels every status the schema defines, and invents none", () => {
    expect(Object.keys(TASK_STATUS_LABELS).sort()).toEqual(Object.keys(TaskStatus).sort());
  });

  it("gives every status a non-empty Hebrew label", () => {
    for (const label of Object.values(TASK_STATUS_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("gives every priority a non-empty Hebrew label", () => {
    for (const label of Object.values(TASK_PRIORITY_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("OPEN_STATUSES - what counts as unfinished", () => {
  // Stated as a property rather than as a list, for the same reason as
  // above. The rule is "everything except the two that are history", and
  // writing it out again here would just be a second copy to update.
  it("is every status except the finished ones", () => {
    expect([...OPEN_STATUSES].sort()).toEqual(
      Object.keys(TaskStatus)
        .filter((s) => s !== "DONE" && s !== "ARCHIVED")
        .sort()
    );
  });

  it("counts a task waiting for approval as still open", () => {
    // The person who did the work is finished with it. The task is not:
    // nobody has signed it off. Leaving it out of this set would drop a
    // task off its own owner's list at the exact moment they sent it for
    // approval, which is when they most need to find it again.
    expect(OPEN_STATUSES).toContain("PENDING_APPROVAL");
  });
});
