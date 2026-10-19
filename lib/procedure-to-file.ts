// A new procedure reaches the client file before its task closes
// (19.10.2026, task "נוהל חדש נרשם אוטומטית בתיק הלקוח לפני סגירת משימה").
//
// What happened: on NUX's "ניהול Google Workspace" the procedure was filed
// as a document and the task was ready to close, but nothing of it was in
// the client file until Ariel asked. A document in a folder is something a
// person has to remember exists; a process in the file is something every
// later conversation about the client reads. So two things change:
//
// 1. The "advance with Claude" prompt tells Claude to propose a procedure
//    (and what a mapping task learned) to the client file before closing.
//    Proposals wait on the review screen, so sending them needs no
//    permission.
// 2. Closing a task checks whether that happened, and reminds when it did
//    not. It never blocks: a proposal from another source (a meeting) is a
//    legitimate way to have done it, and a check that refuses a close on a
//    guess is a check people learn to work around.
//
// Pure and free of project imports, so tests/unit runs it in the sandbox.

/// A task in the "mapping and watching" stage of a handover, read from
/// the line the handover plan writes into the description, "**HND-029** |
/// שלב: מיפוי וצפייה | ...". Since 20.10.2026 the task carries its own
/// flag (Task.mappingTask), and this only marks it when it is created or
/// its description is rewritten. Narrow on purpose: the stage name itself,
/// after "שלב:", and not any task that mentions mapping in its title.
const MAPPING_STAGE = /שלב:\s*מיפוי\s+וצפייה/;

export function isMappingTask(description: string | null | undefined): boolean {
  return !!description && MAPPING_STAGE.test(description);
}

/// A document filed under another kind whose name says it is a procedure
/// (20.10.2026). Procedures have their own kind, PROCEDURE ("נוהל"). Until
/// then the template filed them as POLICY, which the screens show as
/// "פוליסה", an insurance policy; and a person uploading by hand picks the
/// kind, with OTHER as the default. Narrow on purpose: words that name a
/// procedure, not any document on the task, so an insurance policy filed
/// as POLICY is not mistaken for one.
const PROCEDURE_NAME = /(נוהל|נהלים|תהליך|\bSOP\b|procedure|playbook|runbook)/i;

export function looksLikeProcedure(title: string | null | undefined): boolean {
  return !!title && PROCEDURE_NAME.test(title);
}

/// The step every plan ends with when the task produces a procedure or
/// maps something. The prompt quotes it, so the words are the same in
/// every plan and the check below can be read against them.
export const PROPOSE_STEP_TITLE = "הצע את הנוהל לתיק הלקוח כתהליך";
export const PROPOSE_MAPPING_STEP_TITLE = "הצע את ממצאי המיפוי לתיק הלקוח";

export type ProcedureReminderKind = "PROCEDURE" | "MAPPING";

/// What the closing check found, before any words.
export type ProcedureCheckFacts = {
  /// The task is finished in this change: DONE or PENDING_APPROVAL.
  closing: boolean;
  /// Procedure documents filed on the task (ClientDocument.kind PROCEDURE).
  procedureDocumentIds: string[];
  /// Documents of another kind whose name says procedure (looksLikeProcedure).
  namedProcedureDocumentIds?: string[];
  isMapping: boolean;
  /// A proposal batch exists whose source points at one of the task's
  /// documents, or at the task itself.
  hasProposalFromTask: boolean;
};

export function procedureReminderKind(f: ProcedureCheckFacts): ProcedureReminderKind | null {
  if (!f.closing || f.hasProposalFromTask) return null;
  if (f.procedureDocumentIds.length > 0 || (f.namedProcedureDocumentIds?.length ?? 0) > 0) return "PROCEDURE";
  if (f.isMapping) return "MAPPING";
  return null;
}

/// For Claude, in English like the rest of a tool result. It says what to
/// do, with the ids it needs, and that the close already went through.
export function reminderForClaude(
  kind: ProcedureReminderKind,
  taskId: string,
  documentIds: string[],
  opts: { misfiled?: boolean } = {}
): string {
  if (kind === "PROCEDURE") {
    return [
      "The task closed, but its procedure was not proposed to the client file.",
      ...(opts.misfiled
        ? ["It was filed with a kind other than PROCEDURE; tell the user, so the next procedure is filed as PROCEDURE."]
        : []),
      `Propose it now with propose_knowledge: the procedure as a PROCESS item (and SYSTEM, REQUEST_TYPE or POLICY items as needed), with newSource kind ANKORA_DOCUMENT and documentId ${documentIds[0]}.`,
      "Proposals wait for approval on the review screen, so no permission is needed to send them. Then remind the user to approve them. If it was already proposed from another source, tell the user and ignore this.",
    ].join(" ");
  }
  return [
    "The task closed, but nothing it mapped was proposed to the client file.",
    `Propose what was learned (systems, contacts, request types, rules) with propose_knowledge, with newSource kind TASK and taskId ${taskId}.`,
    "Proposals wait for approval on the review screen, so no permission is needed to send them. Then remind the user to approve them. If it was already proposed from another source, tell the user and ignore this.",
  ].join(" ");
}

/// For the person on the task screen, in Hebrew.
export function reminderForScreen(kind: ProcedureReminderKind, opts: { misfiled?: boolean } = {}): string {
  if (kind === "MAPPING") return "המשימה נסגרה, אבל מה שמופה בה עוד לא הוצע לתיק הלקוח. כדאי להציע את הממצאים, ולאשר במסך הבדיקה.";
  const base = "המשימה נסגרה, אבל הנוהל שתויק בה עוד לא הוצע לתיק הלקוח. כדאי להציע אותו כתהליך, ולאשר במסך הבדיקה.";
  return opts.misfiled ? `${base} הנוהל תויק בסוג אחר, ובפעם הבאה כדאי לתייק נוהל בסוג "נוהל".` : base;
}
