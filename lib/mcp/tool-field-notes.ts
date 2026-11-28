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
  reverted: "Taken back (\"ביטול\"): a new item was taken out of the file again, or a change (SUPERSEDE, CONTRADICT) was undone and the item put back as it was.",
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
  blockChanges:
    'On an agent row that is one client\'s addition (versioned apart from the agent): its change against the addition in use, block by block, a line naming the block ("נוסף", "שונה" or "הוסר") and then its + and - lines. Show it to the user before deciding.',
  openLessons:
    "On a procedure row: the lessons people left on its process when closing runs, still open. Approving the version never closes them by itself. Ask the user which of them this version covers, and pass those ids to decide_approval as `appliedLessonIds`; they close as applied in this version, and the rest stay open.",
  proposals:
    "Each proposal has its own `proposalId` (for decide_knowledge_proposals) and `url`. An update to an item already in the file (action SUPERSEDE) has `changes`: each field it changes, with `before` (what the file says now) and `after` (what it will say once approved). Approving changes only those fields; the item stays, with everything else as it is. `says` is then the item it updates.",
  enteredAutomatically:
    'Items that entered a client file on their own and still need a person to look: each with `proposalId`, `result` (the item in the file), `url` (its row) and `decisions`: what decide_knowledge_proposals can do with it ("reviewed_ok" for "תקין", "revert" for "ביטול"). `action` CREATE: "revert" takes the new item out of the file. SUPERSEDE or CONTRADICT: "revert" puts the item it changed back as it was before (a fact\'s old version is current again, or the alternative and the uncertain mark are taken off), and is refused, with why, when the item changed after.',
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
    "A share read against the time gone in its window: `usedPct` of the limit, `elapsedPct` of the time, `projectedPct` where it ends at the same pace (null while it is too early: the first half hour of a window, the first day of a week, unless half the limit is already used), and `state`: ok (on track for 80% or less), watch (80 to 100), over (runs out before the reset, at `projectedHitAt`), stuck, or early. Linear, so early in a week it leans pessimistic. Judge a person by the pace, not by the share: 87% of the week a few hours before the reset is fine.",
  weekly: "The pace against the weekly limit (see `pace`).",
  reading: "On each person's `fiveHour`: the extension reading behind `current` and `weekly`, up to a day old. `stale` means it is over an hour old (their browser is closed), so both figures are as of `observedAt`: say so when you report them. `windowReset` means the five-hour window has reset since, so how much of it is used now is not known.",
  fastestWeekly: "The person furthest ahead of the weekly pace, by projection.",
  unmatchedLimitEmails: "Addresses the browser extension sent that match no Ankora user, probably an alias of a work account: those people's limits are missing until matched. A super admin matches one by adding it to the person's other Claude addresses in the screen's settings (`settings.aliases`).",
  aliases: "In `settings`: userId to the other addresses that person signs in to Claude with. Cowork's telemetry and the browser extension under those addresses count as that person's.",
  summary: "The managers' summary: a verdict, the leading indicators against their targets, and at most three things to do.",
};

/// New-client wizard (26.11.2026): start_client_onboarding,
/// get_client_onboarding and update_client_onboarding.
export const CLIENT_ONBOARDING_NOTES: FieldNotes = {
  step: "The furthest of the setup's four steps saved: 1 identity and the AI decision, 2 domains, partners and channel, 3 contacts, 4 rules and team.",
  missing: "What the client still needs before a person can activate it, each with the step it is filled in. Ask the user for these; never fill one with a guess.",
  ready: "true when nothing is missing. Tell the user the client is ready and give them `url`: activation happens on the setup's summary screen, by a person, and no tool does it.",
  url: "The setup screen of this client. Give it to the user as it is.",
  contacts: "`hasEmail` and `hasPhone` say whether the contact can be matched to emails, WhatsApp and calls; the addresses themselves are not sent. A contact with neither blocks activation.",
  source: "Where an item came from when it is not the setup itself: the title of the source it cites.",
  sources: "The client's source register: cite one by its `code` in update_client_onboarding's `sourceCode`.",
  errors: "Items that were not saved, each with why, in the domain's own words. The rest were saved.",
  setups: "Every client being set up, with what each still needs.",
};

/// list_connected_mailboxes (27.11.2026, "התיבות שלי").
export const CONNECTED_MAILBOXES_NOTES: FieldNotes = {
  kind: "ANKORA: an Ankora mailbox with several clients, each thread matched to a client by its participants. CLIENT: a client's own mailbox (`client`), every email in it that client's. null: the owner has not chosen yet.",
  clientAiExcluded: 'The mailbox is a client\'s marked "בלי AI": its name is not given, and nothing from it is for you.',
  state:
    'choose-kind (connected, whose it is not chosen), not-scanning (the owner has not pressed "הפעלת סריקה"), scanning, disconnected (nothing new comes in until the owner reconnects at `connectUrl`), or unknown (Unipile did not answer now).',
  lastEmailAt: "The newest email recorded from it with a client. Emails that are not with a client, the team writing to itself, and automatic mail (newsletters, notifications, marketing, no-reply senders, \"out of office\" answers) are never recorded.",
  threadsRecorded: "How many threads with clients were recorded: who and when only, never the content.",
  extractionAllowed: "Whether a manager allows knowledge extraction from this mailbox.",
  pendingDoNotRead: 'Requests by the owner not to read an address or a domain, waiting for a manager on the settings screen. Threads they cover are held meanwhile.',
  doNotRead:
    'The mailbox\'s "לא לקרוא" list: each `value` (an address, or a domain with everything under it), its `kind`, and `status` APPROVED (not read) or PENDING (asked by the owner, held until a manager decides with manage_connected_mailbox).',
};

/// list_sent_emails (27.11.2026, stage 2 of "התיבות שלי").
export const SENT_EMAILS_NOTES: FieldNotes = {
  emails:
    "Each email: `to` (whom it went to), `sentAt`, `mailbox` (which of the user's mailboxes sent it), and `clients` (the clients its thread is with, empty for a supplier or a colleague). Only who and when: the content stays in the mailbox. Kept 14 days unless a task follows it.",
};

/// list_email_waits (27.11.2026, stage 2 of "התיבות שלי").
export const EMAIL_WAITS_NOTES: FieldNotes = {
  state: "waiting, or overdue: the reminder time passed with no reply (offer manage_email_wait: send_reminder, postpone or not_waiting).",
  url: "The task in Ankora. Give it as is.",
};

/// get_task: what the task, and each step, waits for by email.
export const GET_TASK_NOTES: FieldNotes = {
  waitingOnEmail:
    'An email this task (or step) waits for a reply to: `state` waiting, overdue (its reminder passed with no reply) or replied (someone answered; Ankora lifted the wait itself), `to`, `sentAt`, `remindAt`, `replyFrom` and `replyAt`, and `followedBy` ("you" or a colleague: only whoever sent the email may send a reminder). Change it with manage_email_wait.',
};

/// list_email_threads_to_extract (27.11.2026, stage 3 of "התיבות שלי").
export const EXTRACT_THREADS_NOTES: FieldNotes = {
  thread: "The thread's id: pass it to read_email_thread, and as newSource.mailThread.thread to propose_knowledge.",
  clients: "The clients the thread was matched to: in a client's own mailbox, that client; otherwise by the participants' domains and contacts. Two clients: decide from the content, as for a meeting.",
  readThrough: "Where the extraction stopped last time (null: never read). Only later emails are new.",
};

/// read_email_thread (27.11.2026, stage 3 of "התיבות שלי").
export const READ_THREAD_NOTES: FieldNotes = {
  emails:
    "Oldest first. `fromTeam` true: written by Ankora's team, which is never a source of knowledge about the client (only what the client or their supplier wrote). `text` is the body, cut when long (`textTruncated`). `attachments` gives ids for read_email_thread_attachment.",
  newestAt: "The newest email returned: pass it as `through` (to propose_knowledge's newSource.mailThread, or to mark_email_threads_extracted).",
};
