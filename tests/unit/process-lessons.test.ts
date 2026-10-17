import { describe, expect, it } from "vitest";
import { asksForLesson, lessonError, MAX_LESSON } from "@/lib/process-lessons";

// Learning from runs (spec 5.4): when the question is asked, and what an
// answer may be.

describe("asksForLesson", () => {
  const run = { parentId: null, processId: "p1", status: "DONE" };
  it("asks a done run of a process, once", () => {
    expect(asksForLesson(run, false)).toBe(true);
    expect(asksForLesson(run, true)).toBe(false);
  });
  it("not a step, not a task without a process, not a run still open", () => {
    expect(asksForLesson({ ...run, parentId: "t1" }, false)).toBe(false);
    expect(asksForLesson({ ...run, processId: null }, false)).toBe(false);
    expect(asksForLesson({ ...run, status: "IN_PROGRESS" }, false)).toBe(false);
    expect(asksForLesson({ ...run, status: "ARCHIVED" }, false)).toBe(false);
  });
});

describe("lessonError", () => {
  it("null is 'it held'; blank is not a lesson; long is cut off", () => {
    expect(lessonError(null)).toBeNull();
    expect(lessonError("שלב 2 חסר")).toBeNull();
    expect(lessonError("   ")).toContain("הנוהל היה נכון");
    expect(lessonError("א".repeat(MAX_LESSON + 1))).toContain(`${MAX_LESSON}`);
  });
});
