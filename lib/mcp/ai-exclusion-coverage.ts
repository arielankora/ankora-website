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
  move_time_entry_to_open_bank: "refuses an entry on a marked task or client (redactEntriesForAi), and only the caller's own entries",
  update_timer_note: "refuses a running timer on a marked task or client (guardRunning)",
  create_time_entry: "lookupClient and lookupTask",
  update_time_entry: "refuses an entry on a marked task or client (ownFinishedEntry, redactEntriesForAi), only the caller's own entries; a new task through lookupTask",
  delete_time_entry: "refuses an entry on a marked task or client (ownFinishedEntry, redactEntriesForAi), and only the caller's own entries",
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
  set_task_process: "findTask",
  add_task_comment: "findTask",
  decide_vendor_check: "the detection's source task is checked with aiExcludedTaskIds and a marked one is refused",
  create_decision: "lookupClient, then lookupTask or lookupTaskById",
  list_decisions: "lookupClient; decisions about a marked task are left out",

  // lib/mcp/client-file-tools.ts
  get_client_file: "lookupClient; buildClientFile for AI refuses a marked client and leaves out marked task titles",
  get_client_brief: "lookupClient; buildClientFile for AI",
  get_client_changes: "lookupClient; buildClientFile for AI",
  list_subprocessor_notice_recipients: "marked clients are counted, never named; the person sees them on the clients screen",
  set_client_subprocessor_notice: "lookupClient",
  propose_knowledge: "lookupClient for every client named; a marked task or document as newSource is refused",
  lookup_contact: "links of a marked client are left out (lookupContact)",
  list_processes: "lookupClient",
  get_process: "lookupClient; marked runs are left out of recentRuns",
  get_procedure_for_translation: "lookupClient",
  save_procedure_translation: "lookupClient",
  save_procedure_draft: "lookupClient",
  set_process_rhythm: "lookupClient",
  create_process: "lookupClient",
  update_process: "lookupClient",
  resolve_process_lesson: "lookupClient",
  mark_process_reviewed: "lookupClient",
  set_contact_ended: "lookupClient",
  update_date: "lookupClient; a sensitive date is not a candidate",
  set_client_audit_requirements: "lookupClient",
  confirm_procedure_still_right: "lookupClient",
  save_procedure_audit_draft: "lookupClient",
  list_policies: "lookupClient",
  start_process: "lookupClient",
  record_run_lesson: "findTask",
  record_stranger_test: "lookupClient",
  answer_stranger_question: "lookupClient; the question must be of that client",
  list_my_routines: "routines of a marked client are left out",
  record_process_check: "lookupClient",
  get_extraction_brief: "a marked client is listed by name and domains only, with the instruction to skip its meetings; its recordings are left out",
  get_agent: "an installation's clients pass through resolveClients, which drops every client marked \"בלי AI\" before anything is compiled",
  get_agent_client_context: "resolveClients drops \"בלי AI\" clients, so asking for one is refused like a client outside the installation",
  get_agent_file: "returns a file of the agent's own version, for the user's own installation; no client data is read",
  accept_agent_update: "moves an installation's pinned version; returns no client data",
  save_agent_draft: "writes Ankora's own agent instructions; a client addition names a client the user can access, and \"בלי AI\" clients never reach a compiled agent",
  record_agent_run: "records how a run of the user's own installation ended; it stores the agent's words, no client data is read",
  set_agent_installation_value: "stores a value of the user's own installation (a label id); no client data is read",
  list_my_agents: "lists the user's own installations and their agents; no client data",
  propose_agent_change: "stores a lesson about the agent's own instructions; no client data is read",
  install_agent: "clients are matched among those the user can access, and \"בלי AI\" clients are dropped by resolveClients whenever the installation is compiled",
  propose_extraction_guide_version: "Ankora's own extraction guide, no client data; the guide it reads back is the same for every client",

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

  // lib/mcp/usage-tools.ts
  get_claude_usage: "staff usage measurements only: names of staff, sizes, counts and cost estimates. No client, task or document is read",

  // lib/mcp/hour-bank-tools.ts
  get_hours_bank: "lookupClient; entries of marked tasks count only as minutes in the totals, no titles or notes",
  list_client_communications: "lookupClient; a number that also belongs to a marked client is left out (lib/comms/client-comms.ts scopeFor)",
  get_client_communication: "lookupClient; the conversation or call must be one list_client_communications would list, so a marked client's number is never read",

  // lib/mcp/approval-tools.ts
  list_approvals: "lookupClient; rows of a marked client, and tasks and plans of a marked task, are left out (listApprovalsForAi); auto-applied items of a marked client are left out (listAutoReview forAi)",
  decide_approval: "only a row list_approvals would show (findApprovalForAi)",
  decide_knowledge_proposals: "a proposal of a marked client is refused (decideProposalForAi, decideAutoAppliedForAi)",
  get_proposal_stats: "proposals of a marked client are left out and only counted; no proposal text is returned (proposalStatsForAi)",

  // lib/mcp/portal-tools.ts (the client's own connector)
  get_status: "a marked client gets no answer (portalAiBlocked); marked tasks are left out of the lists",
  "portal:list_tasks": "portalAiBlocked; marked tasks are left out",
  "portal:list_decisions": "portalAiBlocked; decisions about a marked task are left out",
  answer_decision: "portalAiBlocked; decisions about a marked task are not candidates",
  weekly_report: "portalAiBlocked; an entry on a marked task is named by its category",
  monthly_report: "portalAiBlocked; an entry on a marked task is named by its category",
  hour_bank: "portalAiBlocked; numbers only",
};
