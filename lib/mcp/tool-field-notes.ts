// The field notes of the tools whose results explain themselves
// (lib/mcp/field-notes.ts). A new field in one of these results gets its
// note here, and the tool's definition stays as it is.

import type { FieldNotes } from "@/lib/mcp/field-notes";

export const PROPOSAL_STATS_NOTES: FieldNotes = {
  groups:
    "Per kind (a fact's own kind, contact, rule, process, date...) and action (CREATE, SUPERSEDE, CONTRADICT): how many are pending, approved as is, approved after an edit, approved together with others, found already in the file, rejected, or turned into a task.",
  leftOutAiExcluded: 'Proposals of clients marked "בלי AI": left out of everything else, only counted here.',
  guideVersions: "When each version of the extraction guide was approved, to compare periods.",
  autoApply:
    "Whether auto-apply is on, since when, and which kinds and clients (by key) are paused back to a person. Each pause gives the errors that caused it by type (`byType`) and the fields fixed most often (`topFields`, names with counts), so you can say what to fix before a manager lifts it. A pause has no link here, since a link would name the client: for the link to a pause, call list_approvals (`autoApplyPauses`).",
  rows:
    'One row per proposal with its metadata: source kind, Claude\'s confidence and the review screen\'s level, flags, whether it is sensitive, client-visible or carries a "do not disclose", why it could not be approved together with others (`aloneBecause`), the outcome and how long the decision took. Rows are written short: a field that is false, null or an empty list is left out (so a missing `autoError` on an auto-applied row means no error), `rejected` is left out (state REJECTED says it), `decidedAt` is left out (createdAt plus hoursToDecision), and createdAt is to the minute.',
  autoApplied: "The server approved it with no person.",
  autoReviewed: "Auto-applied, and a person looked at it after and marked it right.",
  reverted: "Its item was taken out of the file again.",
  autoError:
    "For an auto-applied proposal, the error it counted as: its `type` (REVERTED, or SUPERSEDED, CONTRADICTED, UPDATED or REMOVED within 30 days of entering) and `fields`, the names of the fields changed in the file. A replacement or contradiction that came from an approved proposal of a different, later source (a later meeting or message) is new information and not an error.",
  autoChange: "NEWER_SOURCE: a later-source replacement or contradiction happened, and was not counted as an error.",
  autoTask: "A date that opens a task before it.",
  edited: "Something was changed before approval. Proposals approved before 3.11.2026 have `edited` with no `editedFields` and no `editKind`.",
  editedFields: "The names of the payload fields that were changed, never their values.",
  editKind:
    "WORDING (free text reworded, same numbers), FACT (a name, date, amount, kind, contact detail or other fact, or text added, removed or rewritten), or MIXED (both).",
  nextOffset: "More rows wait: call again with this as `offset`.",
};

export const LIST_APPROVALS_NOTES: FieldNotes = {
  approvals:
    "Each row has its kind and id (pass them to decide_approval), Ankora's recommendation and why, `approve` and `reject` (the button's label, or null when the row has none here; `reject.needsReason` when rejecting needs a reason), and `url`: a direct link that opens the screen on that very row. Give the user the links as they are.",
  proposals:
    "Each proposal has its own `proposalId` (for decide_knowledge_proposals) and `url`. An update to an item already in the file (action SUPERSEDE) has `changes`: each field it changes, with `before` (what the file says now) and `after` (what it will say once approved). Approving changes only those fields; the item stays, with everything else as it is. `says` is then the item it updates.",
  enteredAutomatically:
    'Items that entered a client file on their own and still need a person to look: each with `proposalId`, `result` (the item in the file), `url` (its row) and `decisions`: what decide_knowledge_proposals can do with it ("reviewed_ok" for "תקין", "revert" for "ביטול").',
  autoApplyPauses:
    "For a manager: the kinds and clients sent back to a person after too many errors, each with `label`, `since`, `errors` and `url` (its row, where the manager lifts it on the screen).",
};

export const DECIDE_PROPOSALS_NOTES: FieldNotes = {
  results:
    'Each has `url` (the proposal on its card, or its row under "נכנס אוטומטית"), and `result` (the item in the client\'s file) or `task` where the decision made one: give the user those to see the outcome.',
  procedure:
    "The procedure the process proposal brought. Approved: the process is active and runs. Not approved: it says why, and the process entered as a draft; tell the user what to fix.",
  errors: "Proposals that failed, each with why. The rest were decided.",
};

/// list_processes, and get_process, which carries the same fields.
export const PROCESS_SUMMARY_NOTES: FieldNotes = {
  kind: 'PROCESS, or GUIDE for a work guide ("הוראת עבודה": how to do something, with steps, and no rhythm, runs or blockers).',
  rhythm: "When it runs, in one sentence built from what starts it and its dates. Quote it rather than `trigger` when asked how often a process runs.",
  backup: "The owner's backup, null when none is set.",
  handover: "Where the process stands in the handover.",
  runs: '"רץ", or the first reason it will not run: no owner, no trigger, no approved procedure, or a scheduled process with no date.',
  notRunningBecause: "Every reason it will not run, empty when it runs. Tell the user all of them.",
  documentation: "How well it is documented: the documentation fields filled, of those that apply (fields marked not relevant are left out).",
  needsReview: "Whether it needs review, and why.",
  url: "A direct link to the process in the client's file. Give it as it is.",
};

export const GET_PROCESS_NOTES: FieldNotes = {
  ...PROCESS_SUMMARY_NOTES,
  rhythmDetail: "Each start and the next three dates, with the day each run opens.",
  staleReasons: "Why the approved document is out of date.",
  audit: "For a client with audit requirements: scope, controls, classification and what an audit still misses (fill it with save_procedure_audit_draft).",
  procedure: "The approved procedure step by step, or null when no version is approved. Follow it.",
  draft: "A version waiting for approval, in the same shape as `procedure`, with what holds it back in `failsRules`.",
  steps:
    "Each step: mode, business day, actions, systems, output, how a person verifies an automated step (`verification`), whether it needs approval (such a step waits for a person), the most it moves (`amountMax`), the channel, its `approver` and `evidence`.",
  approver: "Who signs: `atAnkora` (a person at Ankora) or `atClient` (a contact, by name). On a step, `leftOn` when that contact left, and the step needs a new approver.",
  flow: "The procedure's conditions and branches.",
  failsRules: "What in this version fails the client's rules today. If the approved procedure fails a rule, say so before acting.",
  openLessons: "Open lessons people left when closing runs. Read them before drafting a new version.",
};

export const UPDATE_TASK_NOTES: FieldNotes = {
  url: "The task's address in Ankora. Always give it to the user, quoted exactly.",
  categoryOptions:
    "The task had no category and one was chosen automatically (`categoryAutoPicked`). Tell the user which category was set (`categoryNote` says how sure the pick was), and if one of `categoryOptions` clearly fits the work better, set that one instead.",
  reminder: "Act on it: it says what the task still owes the client file.",
};

/// get_claude_usage (18.11.2026, with the weekly pace and without the
/// monthly threshold).
export const CLAUDE_USAGE_NOTES: FieldNotes = {
  costUsd:
    "What the work would cost at API list prices, by Cowork's estimate: a measure of how heavy it was, never money spent. A Team seat has a fixed price and no overage; its only limits are the five-hour window and the weekly limit. Never compare it with a seat price.",
  limitHits: "Errors where a limit ran out (HTTP 429 from Cowork or Claude Code).",
  heaviestWindow: "The five-hour window with the most work in the period, by its cost estimate.",
  fiveHour:
    "The five-hour window, where people get stuck: who is stuck now and when their window resets (`stuckNow`), who is ahead of the window's pace (`fastNow`), limit hits in the past week and the hours they cluster in (`peakHours`, Israel time), and on each person the past week window by window with the peak share. Shares come from the browser extension; without it only Cowork's limit errors show, and the share is null.",
  pace:
    "A share read against the time gone in its window: `usedPct` of the limit, `elapsedPct` of the time, `projectedPct` where it ends at the same pace (null while it is too early: the first half hour of a window, the first day of a week), and `state`: ok (on track for 80% or less), watch (80 to 100), over (runs out before the reset, at `projectedHitAt`), stuck, or early. Linear, so early in a week it leans pessimistic. Judge a person by the pace, not by the share: 87% of the week a few hours before the reset is fine.",
  weekly: "The pace against the weekly limit (see `pace`).",
  fastestWeekly: "The person furthest ahead of the weekly pace, by projection.",
  unmatchedLimitEmails: "Addresses the browser extension sent that match no Ankora user, probably an alias of a work account: those people's limits are missing until matched.",
  summary: "The managers' summary: a verdict, the leading indicators against their targets, and at most three things to do.",
};
