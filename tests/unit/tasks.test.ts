import { describe, expect, it } from "vitest";
import { TASK_STATUS_LABELS } from "@/lib/app-domain/tasks";

// Phase 9 gap-fix (docs/adr/0001 section 17.2, spec §5/§10.2's
// Open/In-progress/Done/Archived statuses). Note: importing
// "@/lib/app-domain/tasks" pulls in lib/prisma.ts through its own import
// (same as every other lib/app-domain/*.ts test file - see
// tests/unit/reports.test.ts's comment for the full explanation), so this
// file cannot actually RUN in this sandbox (documented, pre-existing
// limitation: @prisma/client cannot reach binaries.prisma.sh here). It
// runs normally on Vercel's Preview build, which has network access.
describe("TASK_STATUS_LABELS - spec §5/§10.2", () => {
  it("defines exactly the four statuses the spec's data model requires", () => {
    expect(Object.keys(TASK_STATUS_LABELS).sort()).toEqual(
      ["ARCHIVED", "DONE", "IN_PROGRESS", "OPEN"].sort()
    );
  });

  it("gives every status a non-empty Hebrew label", () => {
    for (const label of Object.values(TASK_STATUS_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
