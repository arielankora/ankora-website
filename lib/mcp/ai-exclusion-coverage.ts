// 28.10.2026: how every MCP tool honours "בלי AI" (lib/ai-exclusion.ts).
//
// One line per registered tool, staff and portal alike. The point is the
// test that reads it (tests/unit/mcp/ai-exclusion-coverage.test.ts): a
// tool registered without a line here fails the suite, so a new tool
// cannot reach a client's data without somebody deciding, in writing, how
// it keeps marked items out. The line names the mechanism, so a reviewer
// can check it against the code.
//
// The shared mechanisms:
//   lookupClient   a marked client is no candidate; naming it gets the
//                  "בלי AI" answer (lib/mcp/lookup.ts)
//   lookupTask     the same for a marked task, a step under one, or any
//                  task of a marked client (listTasks forAi, lookupTaskById)
//   findTask       lookupTask or lookupTaskById (task-extra-tools.ts)

export const AI_EXCLUSION_COVERAGE: Record<string, string> = {
  // lib/mcp/tools.ts
  list_my_clients: "marked clients are not listed",
  list_categories: "lookupClient",
  get_active_timer: "a timer on a marked task or client is shown without client, task or note (redactEntriesForAi)",
  list_my_time_entries: "entries of a marked client are left out; on a marked task, title and note are hidden (redactEntriesForAi)",
  list_team_members: "staff only, no client data",
  list_team_time_entries: "lookupClient; entries redacted as in list_my_time_entries",
  start_timer: "lookupClient and lookupTask",
  stop_timer: "refuses a running timer on a marked task or client (guardRunning)",
  update_timer_note: "refuses a running timer on a marked task or client (guardRunning)",
  create_time_entry: "lookupClient and lookupTask",
  list_tasks: "listTasks forAi; lookupClient",
  list_assignable_people: "lookupClient",
  create_task: "lookupClient; category evidence leaves out marked tasks and their notes (autoPickCategory)",
  update_task: "lookupTask or lookupTaskById",

  // lib/mcp/task-extra-tools.ts
  get_task: "findTask",
  add_task_steps: "findTask",
  replace_task_steps: "findTask",
  get_task_plan: "findTask",
  save_task_plan: "findTask",
  apply_task_plan_steps: "findTask",
  set_task_step: "findTask",
  add_task_comment: "findTask",
  create_decision: "lookupClient, then lookupTask or lookupTaskById",
  list_decisions: "lookupClient; decisions about a marked task are left out",

  // lib/mcp/client-file-tools.ts
  get_client_file: "lookupClient; buildClientFile for AI refuses a marked client and leaves out marked task titles",
  get_client_brief: "lookupClient; buildClientFile for AI",
  get_client_changes: "lookupClient; buildClientFile for AI",
  propose_knowledge: "lookupClient for every client named; a marked task or document as newSource is refused",
  lookup_contact: "links of a marked client are left out (lookupContact)",
  list_processes: "lookupClient",
  get_process: "lookupClient; marked runs are left out of recentRuns",
  get_procedure_for_translation: "lookupClient",
  save_procedure_translation: "lookupClient",
  list_policies: "lookupClient",
  start_process: "lookupClient",
  record_run_lesson: "findTask",
  record_stranger_test: "lookupClient",
  answer_stranger_question: "lookupClient; the question must be of that client",
  list_my_routines: "routines of a marked client are left out",
  record_process_check: "lookupClient",
  get_extraction_brief: "a marked client is listed by name and domains only, with the instruction to skip its meetings; its recordings are left out",

  // lib/mcp/document-tools.ts
  list_documents: "findTask or lookupClient; listDocumentsForMcp leaves out marked documents",
  set_document_kind: "findDocumentForMcp refuses a marked document",
  read_document: "findDocumentForMcp refuses a marked document; by title, only unmarked ones are candidates",
  upload_document: "findTask or lookupClient",
  start_document_upload: "findTask or lookupClient",

  // lib/mcp/employee-tools.ts
  get_blank_agreement_pdf: "a blank form, no client data",
  issue_agreement_upload_code: "a staff member, no client data",
  dismiss_pdf_upload: "refuses a marked document",
  get_employee_status: "marked lifecycle tasks are left out",
  record_pdf_signature: "refuses a marked document",

  // lib/mcp/portal-tools.ts (the client's own connector)
  get_status: "a marked client gets no answer (portalAiBlocked); marked tasks are left out of the lists",
  "portal:list_tasks": "portalAiBlocked; marked tasks are left out",
  "portal:list_decisions": "portalAiBlocked; decisions about a marked task are left out",
  answer_decision: "portalAiBlocked; decisions about a marked task are not candidates",
  weekly_report: "portalAiBlocked; an entry on a marked task is named by its category",
  monthly_report: "portalAiBlocked; an entry on a marked task is named by its category",
  hour_bank: "portalAiBlocked; numbers only",
};
