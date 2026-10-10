// Phase 14 (MCP server writes, docs/adr/0005): the read/write split,
// kept in its own pure module.
//
// These constants could sit in lib/mcp/tools.ts, and did in Phase 13. They
// moved here for one reason: tools.ts imports the domain layer, which
// imports Prisma, so a test cannot load it in the sandbox (see
// tests/unit/reports.test.ts for that limitation). This file has no
// imports at all, so tests/unit/mcp/annotations.test.ts can assert the
// split directly - and the split is worth asserting, because
// `readOnlyHint: true` is what tells a client a tool is safe to call
// without asking the user first. Copying it onto a write tool would be a
// quiet, serious mistake.

/// Tools that only read.
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/// Tools that write.
///
/// `destructiveHint: false` is accurate and deliberate: almost every write
/// in this surface creates or amends, and nothing else deletes. The single
/// exception, replace_task_steps, says so in its own entry below.
///
/// `idempotentHint: false` matters most on create_time_entry: calling it
/// twice makes two entries, and a client that assumed otherwise could
/// silently double-book an afternoon on a retry.
export const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/// Every registered tool and the annotations it carries. The registration
/// in lib/mcp/tools.ts reads from here, so this map and the live server
/// cannot drift apart.
export const TOOL_ANNOTATIONS = {
  list_my_clients: READ_ONLY,
  list_categories: READ_ONLY,
  get_active_timer: READ_ONLY,
  list_my_time_entries: READ_ONLY,
  list_team_members: READ_ONLY,
  list_team_time_entries: READ_ONLY,
  start_timer: WRITES,
  stop_timer: WRITES,
  // Replacing a note with the same text twice leaves the same state, so
  // unlike the other writes this one is genuinely idempotent.
  update_timer_note: { ...WRITES, idempotentHint: true },
  create_time_entry: WRITES,
  // Phase 16 (MCP tasks).
  list_tasks: READ_ONLY,
  list_assignable_people: READ_ONLY,
  create_task: WRITES,
  // A patch that sets the same fields twice leaves the same state - unlike
  // create_task, which makes a second task. Same reasoning as
  // update_timer_note.
  update_task: { ...WRITES, idempotentHint: true },
  // NUX handover pass (lib/mcp/task-extra-tools.ts).
  get_task: READ_ONLY,
  list_decisions: READ_ONLY,
  add_task_steps: WRITES,
  // Ticking a step that is already ticked leaves it ticked.
  set_task_step: { ...WRITES, idempotentHint: true },
  add_task_comment: WRITES,
  create_decision: WRITES,
  // The one tool here that removes something: the open steps of a task,
  // replaced by a new list. Marked destructive so a client asks before
  // calling it. It never removes a step already done or one with time
  // logged against it (removeTaskSteps in lib/app-domain/tasks.ts), and
  // running it twice with the same list leaves the same steps.
  replace_task_steps: { ...WRITES, destructiveHint: true, idempotentHint: true },
  // "קדם עם קלוד" (10.10.2026). Saving a plan adds a version and never
  // overwrites one, and a second identical call is refused by the version
  // check rather than applied twice, so it is a plain write.
  get_task_plan: READ_ONLY,
  save_task_plan: WRITES,
  // The same replacement as replace_task_steps, from the plan's steps, so
  // it carries the same warning: it removes open steps not in the plan.
  apply_task_plan_steps: { ...WRITES, destructiveHint: true, idempotentHint: true },
} as const;

export type ToolName = keyof typeof TOOL_ANNOTATIONS;

/// Tools that read data belonging to someone other than the caller. Each
/// must assert `time_entry.edit_others` - the same permission the admin
/// screen and the CSV export route already gate this data on.
export const TEAM_TOOLS = ["list_team_members", "list_team_time_entries"] as const;

/// Tools that write.
export const WRITE_TOOLS = [
  "start_timer",
  "stop_timer",
  "update_timer_note",
  "create_time_entry",
  "create_task",
  "update_task",
  "add_task_steps",
  "set_task_step",
  "add_task_comment",
  "create_decision",
  "replace_task_steps",
  "save_task_plan",
  "apply_task_plan_steps",
] as const;

/// Phase 16: task tools are NOT in TEAM_TOOLS.
///
/// Reading a colleague's hours needs `time_entry.edit_others`; seeing and
/// assigning a task on a client you share does not - see assignableUsers()
/// in lib/app-domain/tasks.ts for why the two questions get different
/// gates. list_tasks does surface an assignee's name, but only for tasks
/// on clients the caller already works on, which is the same scope the
/// Tasks screen has always had.

// The client portal connector (lib/mcp/portal-tools.ts, /api/mcp/portal).
// A separate table because it is a separate server: a client's Claude
// sees these and nothing from TOOL_ANNOTATIONS. One write, the portal's
// own: answering a decision. It is final, so it is not idempotent - a
// second call is refused by the domain, never applied twice.
export const PORTAL_TOOL_ANNOTATIONS = {
  get_status: READ_ONLY,
  list_tasks: READ_ONLY,
  list_decisions: READ_ONLY,
  answer_decision: WRITES,
  weekly_report: READ_ONLY,
  monthly_report: READ_ONLY,
  hour_bank: READ_ONLY,
} as const;

export const PORTAL_WRITE_TOOLS = ["answer_decision"] as const;
