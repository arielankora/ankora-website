import { describe, expect, it } from "vitest";
import { approvesProceduresOf, mayApproveProcedure, NOT_APPROVER, procedureApprovalBlocker, SEPARATION_REQUIRED } from "@/lib/procedure-approval";

// 31.10.2026 (Ariel): a manager or the client's account manager approves a
// procedure; a client can ask that the author of a version not approve it.

const base = { userId: "anna", isManager: false, accountManagerId: "anna", separation: false, authorId: "anna" };

describe("procedure approval", () => {
  it("a manager approves any client's procedures, the account manager their own client's", () => {
    expect(approvesProceduresOf({ userId: "hadas", isManager: true, accountManagerId: null })).toBe(true);
    expect(approvesProceduresOf({ userId: "anna", isManager: false, accountManagerId: "anna" })).toBe(true);
    expect(approvesProceduresOf({ userId: "anna", isManager: false, accountManagerId: "guy" })).toBe(false);
    expect(approvesProceduresOf({ userId: "anna", isManager: false, accountManagerId: null })).toBe(false);
  });

  it("without separation the author approves; with it nobody approves their own version", () => {
    expect(procedureApprovalBlocker(base)).toBeNull();
    expect(procedureApprovalBlocker({ ...base, separation: true })).toBe(SEPARATION_REQUIRED);
    expect(procedureApprovalBlocker({ ...base, isManager: true, separation: true })).toBe(SEPARATION_REQUIRED);
    expect(mayApproveProcedure({ ...base, separation: true, authorId: "hadas" })).toBe(true);
    // An unknown author does not block.
    expect(mayApproveProcedure({ ...base, separation: true, authorId: null })).toBe(true);
  });

  it("someone who does not approve gets that reason first", () => {
    expect(procedureApprovalBlocker({ ...base, accountManagerId: "guy", separation: true })).toBe(NOT_APPROVER);
  });
});
