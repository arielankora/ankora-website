import { beforeEach, describe, expect, it, vi } from "vitest";

// 27.11.2026, silent failures plan stage 1c: the last line of every screen
// action's error handling. A Hebrew sentence is a refusal meant for the
// person and goes back as it is; anything else is a fault, becomes a system
// issue, and the person gets the screen's generic line, never the raw text.

const issues = vi.hoisted(() => ({ reportIssue: vi.fn(async () => {}) }));
vi.mock("@/lib/system-issues", () => issues);

import { unexpectedActionError } from "@/lib/action-errors";

beforeEach(() => issues.reportIssue.mockClear());

describe("unexpectedActionError", () => {
  it("hides a technical error from the person and reports it", async () => {
    const err = new Error("Invalid `prisma.task.update()` invocation: column secret_x");
    expect(await unexpectedActionError(err, "משהו השתבש", "tasks")).toBe("משהו השתבש");
    expect(issues.reportIssue).toHaveBeenCalledWith(expect.objectContaining({ area: "action", key: "tasks:Error", severity: "WARNING", error: err }));
  });

  it("passes a Hebrew refusal through, without an issue", async () => {
    expect(await unexpectedActionError(new Error("החיבור ל-Google לא פעיל יותר."), "x", "connections")).toBe("החיבור ל-Google לא פעיל יותר.");
    expect(issues.reportIssue).not.toHaveBeenCalled();
  });

  it("reports something thrown that is not an Error", async () => {
    expect(await unexpectedActionError("boom", "generic", "portal")).toBe("generic");
    expect(issues.reportIssue).toHaveBeenCalledWith(expect.objectContaining({ key: "portal:string" }));
  });
});
