// "קדם עם קלוד" (10.10.2026): the rules a work plan has to pass before it
// is stored, kept free of project imports so tests/unit can run them in the
// sandbox (same convention as lib/client-activity-prompt.ts).
//
// lib/app-domain/task-plans.ts calls these and is the only writer. The MCP
// tool and the task screen both reach the database through it, so a plan
// written by Claude and a plan edited by hand obey the same limits.

/// Long enough for a real plan with its reasoning, short enough that a
/// paste of a whole email thread is refused rather than stored as "the
/// plan". About eight printed pages of Hebrew.
export const MAX_PLAN_LENGTH = 20000;

/// The same ceiling as create_task and replace_task_steps: a checklist
/// longer than this is a project, and should be split into tasks.
export const MAX_PLAN_STEPS = 15;

/// A step is one line. Anything longer is a paragraph of the plan.
export const MAX_STEP_LENGTH = 200;

/// A plan that breaks one of these rules. Its message is a sentence for a
/// person, in Hebrew, and both callers show it as it is: the screen next
/// to the editor, and the MCP tools back to the model, which relays it.
/// A separate class so the MCP error mapper can tell it apart from an
/// unexpected failure, which it must never echo.
export class TaskPlanRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskPlanRuleError";
  }
}

export const EMPTY_PLAN_MESSAGE = "אין מה לשמור: התוכנית ריקה.";
export const PLAN_TOO_LONG_MESSAGE = `התוכנית ארוכה מ-${MAX_PLAN_LENGTH} תווים. אפשר לקצר את הנימוקים ולהשאיר את השלבים.`;
export const TOO_MANY_STEPS_MESSAGE = `אפשר עד ${MAX_PLAN_STEPS} שלבים. משימה שצריכה יותר מזה היא כמה משימות.`;

/// The plan text as it will be stored: trimmed, line endings unified.
/// Throws a sentence a person can act on when it cannot be stored.
export function normalizePlanBody(body: string): string {
  const text = body.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new TaskPlanRuleError(EMPTY_PLAN_MESSAGE);
  if (text.length > MAX_PLAN_LENGTH) throw new TaskPlanRuleError(PLAN_TOO_LONG_MESSAGE);
  return text;
}

/// The proposed steps as they will be stored.
///
/// Each one trimmed and stripped of a leading "1." or "-" (a model writing
/// a list will add one, and the checklist numbers itself), empty lines
/// dropped, and an exact repeat dropped: two identical lines in a
/// checklist are one thing to do, ticked twice.
export function normalizePlanSteps(steps: readonly string[] | undefined | null): string[] {
  if (!steps) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of steps) {
    const line = raw
      .replace(/\s+/g, " ")
      .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "")
      .trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line.length > MAX_STEP_LENGTH ? `${line.slice(0, MAX_STEP_LENGTH - 1).trimEnd()}…` : line);
  }
  if (out.length > MAX_PLAN_STEPS) throw new TaskPlanRuleError(TOO_MANY_STEPS_MESSAGE);
  return out;
}

/// Whether a save written against `baseVersion` may land on a task whose
/// latest stored version is `latest`.
///
/// `baseVersion` is the version the writer READ before writing: 0 when it
/// saw no plan at all. Anything else means somebody saved in between, and
/// writing anyway would silently throw their version away. Undefined is
/// accepted only when there is no plan yet, so a first save does not have
/// to know about versions, and a second save always does.
export function planVersionConflict(latest: number, baseVersion: number | undefined | null): boolean {
  if (baseVersion === undefined || baseVersion === null) return latest !== 0;
  return baseVersion !== latest;
}
