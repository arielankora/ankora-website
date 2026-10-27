import type { Prisma } from "@prisma/client";

// 28.10.2026: "בלי AI". A client can ask that a task, a document, or
// everything of theirs never pass through an AI system. The security page
// promises it, and the confidentiality undertaking (clause 4.5) binds the
// team to it; this module is what makes it a fact in the product rather
// than a sentence.
//
// Three flags, one rule. The flag is stored where a person sets it, and
// everything below inherits it:
//
//   Client.aiExcluded        everything of that client
//   Task.aiExcluded          the task, its steps, and its documents
//   ClientDocument.aiExcluded the one document
//
// Inheritance is computed when read, never copied down. A step that copied
// its task's mark at creation would stay unmarked if the task was marked a
// day later, and that is exactly the gap a client would find.
//
// Pure on purpose: the screens, the prompt builders and the MCP tools all
// ask the same question, and a test should not need a database to ask it.

/// What an AI-facing reader gets instead of the item. Neutral by design:
/// no title, no content, and not even which level carries the mark.
export const AI_EXCLUDED_MESSAGE = "הפריט מסומן \"בלי AI\" ומטופל בידי אדם בלבד.";

/// Refused when someone without client.manage tries to clear a mark.
export const AI_EXCLUSION_CLEAR_FORBIDDEN_MESSAGE =
  "רק מנהל יכול להסיר סימון \"בלי AI\". הסרה שולחת את החומר חזרה למערכות AI, ולכן היא החלטה של מנהל.";

/// Refused on a step: the mark lives on its task.
export const AI_EXCLUSION_ON_STEP_MESSAGE =
  "שלב יורש את הסימון \"בלי AI\" מהמשימה שלו. כדי לסמן, מסמנים את המשימה.";

/// Where a mark comes from, so a screen can say "סומן ברמת הלקוח" and
/// lock a toggle that would otherwise look like it does something.
export type AiExclusionSource = "CLIENT" | "TASK" | "PARENT_TASK" | "DOCUMENT";

type Flag = { aiExcluded: boolean } | null | undefined;

export function taskAiExclusion(task: {
  aiExcluded: boolean;
  parent?: Flag;
  client?: Flag;
}): AiExclusionSource | null {
  if (task.client?.aiExcluded) return "CLIENT";
  if (task.parent?.aiExcluded) return "PARENT_TASK";
  if (task.aiExcluded) return "TASK";
  return null;
}

export function documentAiExclusion(doc: {
  aiExcluded: boolean;
  task?: { aiExcluded: boolean; parent?: Flag } | null;
  client?: Flag;
}): AiExclusionSource | null {
  if (doc.client?.aiExcluded) return "CLIENT";
  if (doc.task?.parent?.aiExcluded) return "PARENT_TASK";
  if (doc.task?.aiExcluded) return "TASK";
  if (doc.aiExcluded) return "DOCUMENT";
  return null;
}

export const AI_EXCLUSION_SOURCE_LABEL: Record<AiExclusionSource, string> = {
  CLIENT: "סומן ברמת הלקוח",
  TASK: "סומן במשימה",
  PARENT_TASK: "סומן במשימה שהשלב שייך לה",
  DOCUMENT: "סומן במסמך",
};

/// The same rule as a query, for lists: a task an AI-facing reader may
/// see. Steps are tasks with a parent, so the parent's mark is checked too.
export const AI_ALLOWED_TASK_WHERE = {
  aiExcluded: false,
  client: { aiExcluded: false },
  OR: [{ parentId: null }, { parent: { aiExcluded: false } }],
} satisfies Prisma.TaskWhereInput;

/// A document an AI-facing reader may see.
export const AI_ALLOWED_DOCUMENT_WHERE = {
  aiExcluded: false,
  client: { aiExcluded: false },
  OR: [{ taskId: null }, { task: { aiExcluded: false, OR: [{ parentId: null }, { parent: { aiExcluded: false } }] } }],
} satisfies Prisma.ClientDocumentWhereInput;
