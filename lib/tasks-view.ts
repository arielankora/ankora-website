// The tasks screen opens on the board (task "משימות", Ariel, 10.11.2026):
// "לסדר שהתצוגה ברירת מחדל תהיה על לוח ולא רשימה".
//
// The board is where a first visit lands. Whoever switches to the list
// gets the list again next time, by a cookie, the same way the client
// file remembers its last part (lib/client-file-parts.ts). The address
// still wins: `?view=list` or `?view=board` in a link or a bookmark
// shows that view, whatever was remembered. That is why every link into
// this screen that means the list (a status pill, "בפיקוח" waiting for
// sign-off) says `view=list` out loud: on the board a status filter is
// ignored, and a link that relied on the old default would silently
// lose what it was filtering for.
//
// Pure, so the page, the switch and the tests agree on one rule.

export type TasksView = "list" | "board";

export const TASKS_VIEW_COOKIE = "ankora-tasks-view";
export const DEFAULT_TASKS_VIEW: TasksView = "board";

function parse(v: unknown): TasksView | null {
  return v === "list" || v === "board" ? v : null;
}

/// The view to show: the address first, then what this person chose
/// last, then the board.
export function resolveTasksView(param: unknown, remembered: unknown): TasksView {
  return parse(param) ?? parse(remembered) ?? DEFAULT_TASKS_VIEW;
}
