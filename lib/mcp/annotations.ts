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
/// `destructiveHint: false` is accurate and deliberate: every write in
/// this surface creates or amends the caller's own entry, and nothing
/// deletes. Deletion stays in the UI, where a human can see what is about
/// to disappear.
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
] as const;
