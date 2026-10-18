// Learning from runs (claude/org-brain-spec-2026-10-12.md, 5.4): when a
// run of a process closes, the person who did it says whether anything in
// the procedure was wrong or missing, and that goes to the next version.
// Pure, so the task screen, the processes panel, the file and the MCP tool
// say the same thing.

export type LessonStatusLike = "NOTHING" | "OPEN" | "APPLIED" | "DISMISSED";

export const LESSON_QUESTION = "האם משהו בנוהל לא היה נכון או חסר?";

export const LESSON_STATUS_LABELS: Record<LessonStatusLike, string> = {
  NOTHING: "הנוהל היה נכון",
  OPEN: "ממתין לגרסה הבאה",
  APPLIED: "נכנס לנוהל",
  DISMISSED: "לא נכנס לנוהל",
};

export const MAX_LESSON = 2000;

/// Asked on a run that is done, once. A step, a task that is not a run,
/// or an open run is not asked.
export function asksForLesson(task: { parentId: string | null; processId: string | null; status: string }, answered: boolean): boolean {
  return !task.parentId && !!task.processId && task.status === "DONE" && !answered;
}

/// What is wrong with an answer, or null. An empty answer is "nothing was
/// wrong", which is a separate choice, not a blank lesson.
export function lessonError(body: string | null | undefined): string | null {
  if (body === null || body === undefined) return null;
  const t = body.trim();
  if (!t) return "כותבים מה לא היה נכון או חסר, או בוחרים \"הנוהל היה נכון\".";
  if (t.length > MAX_LESSON) return `עד ${MAX_LESSON} תווים.`;
  return null;
}
