// Plain constants, in a module with no "use client" on purpose.
//
// A value exported from a client component and imported by a Server
// Component does not arrive as the value: it arrives as a client
// reference, and a string compared against one is never equal. The tasks
// page is a Server Component and needs NEW_TASK_KEY, so the keys live
// here and both sides import them.

/// The event and query parameter that open a drawer from outside it.
///
/// 26.9.2026: "משימה חדשה" moved up beside "דיווח חדש" in the top bar,
/// which lives in the layout and cannot reach a drawer on a page. From
/// another screen it links to `/app/tasks?new=task`; on the tasks screen
/// itself the URL would not change enough to remount anything, so it
/// fires this event instead.
export const OPEN_DRAWER_EVENT = "ankora:open-drawer";
export const OPEN_DRAWER_PARAM = "new";

/// Set by the top bar when it asked a drawer to open and nobody answered.
///
/// The top bar is in the layout and hydrates before the page under it,
/// which streams in behind a loading boundary. A click in that gap fires
/// an event no drawer is listening for yet. So the asker leaves a note
/// on `window`, and a drawer checks for it the moment it mounts. The
/// browser suite caught the gap on the first run (26.9.2026).
export const PENDING_OPEN_KEY = "__ankoraPendingDrawer";

/// Detail of OPEN_DRAWER_EVENT. `handled` is set by the drawer that
/// opened, so the sender knows whether to leave the note.
export type OpenDrawerDetail = { key: string; handled: boolean };

/// The key the tasks screen's create-task drawer answers to.
export const NEW_TASK_KEY = "task";
