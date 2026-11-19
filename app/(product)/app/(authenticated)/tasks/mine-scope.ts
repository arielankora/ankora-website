// "שלי" on the tasks screen, and the two halves of it.
//
// Ariel, 15.10.2026: "שלי" brings the tasks I carry and the tasks I
// supervise together, and some days the question is only one of them:
// "what do I have to do" or "what is waiting on my sign-off". So the
// toggle became a choice of four, and "שלי" stays the default it has
// been since 26.9.2026.
//
// One URL key, `mine`, so every link written before today keeps its
// meaning: no value and `1` are both halves, `0` is everyone's work.

export type MineScope = "involved" | "assigned" | "supervising" | "all";

/// What the screen shows when `mine` says nothing it recognises. The
/// default, rather than everyone's work: a mistyped link should land on
/// the person's own list, the same as a bare /app/tasks.
export function parseMineScope(value?: string | null): MineScope {
  if (value === "0") return "all";
  if (value === "assigned") return "assigned";
  if (value === "supervising") return "supervising";
  return "involved";
}

/// The `mine` value to write for a scope. `undefined` for the default,
/// so the default's address stays a bare /app/tasks.
export function mineParam(scope: MineScope): string | undefined {
  if (scope === "all") return "0";
  if (scope === "assigned" || scope === "supervising") return scope;
  return undefined;
}

/// The three person filters `listTasks` understands, for a scope. At
/// most one is set.
export function mineFilters(
  scope: MineScope,
  userId: string
): { involvedUserId?: string; assignedToId?: string; supervisorId?: string } {
  if (scope === "involved") return { involvedUserId: userId };
  if (scope === "assigned") return { assignedToId: userId };
  if (scope === "supervising") return { supervisorId: userId };
  return {};
}

/// In the order they sit on screen, right to left: the default first,
/// its two halves, then everyone's work. Their names are
/// tasks.list.mine.<scope> in the dictionary (ADR 0006), on the tasks
/// screen and the calendar alike.
export const MINE_SCOPES: MineScope[] = ["involved", "assigned", "supervising", "all"];

// Remembered since 19.11.2026 (Ariel): "אני רוצה שהפילטר של ״לביצוע״
// ישמר. כל פעם זה חוזר לשלי". The same rule as the list / board switch
// (lib/tasks-view.ts): a click on one of the four writes a cookie, and
// an address that says nothing about `mine` (the side menu, a bare
// /app/tasks) shows what was picked last. An address that does say
// (`mine=1` from the home screen, `mine=supervising` from "בפיקוח")
// still wins, and does not change what was remembered.

export const TASKS_MINE_COOKIE = "ankora-tasks-mine";

/// The scope to show: the address first, then what this person chose
/// last, then "שלי". An empty `mine=` counts as saying nothing.
export function resolveMineScope(param: unknown, remembered: unknown): MineScope {
  if (typeof param === "string" && param !== "") return parseMineScope(param);
  if (typeof remembered === "string" && (MINE_SCOPES as string[]).includes(remembered)) {
    return remembered as MineScope;
  }
  return "involved";
}

/// The `mine` value the screen's own links write: always said, never
/// left to the address being bare, so a link for "שלי" keeps meaning
/// "שלי" for someone whose remembered choice is another one.
export function explicitMineParam(scope: MineScope): string {
  return mineParam(scope) ?? "1";
}
