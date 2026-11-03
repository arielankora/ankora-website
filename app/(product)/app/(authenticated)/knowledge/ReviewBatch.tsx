"use client";
import { batchAnchor, proposalAnchor } from "@/lib/approval-links";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import { FACT_KIND_LABELS, type FactKindLike } from "@/lib/client-facts";
import { POLICY_KIND_LABELS, type PolicyKindLike } from "@/lib/client-policies";
import { ACTION_LABELS, CONFIDENCE_LABELS, MAX_BULK, NARRATIVE_KIND_LABELS, TARGET_LABELS, bulkApproveBlocker, EDIT_FIELD_LABELS, proposalDetails, reviewSummary, suggestedFix, type ConfidenceLike, type ProposalFlag, type ProposalActionLike, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { COMBINED_APPROVE_LABEL } from "@/lib/procedure-approval";
import type { ProcedureAlongside } from "@/lib/app-domain/processes";
import { approveProposalAction, approveEditedProposalAction, approveWithSuggestionAction, approveProposalsAction, attachProposalAction, mergeProposalAction, proposalToTaskAction, rejectProposalAction, rejectProposalsAction, revertProposalAction } from "./actions";

// One batch: one meeting or one document, and what Claude proposed from
// it (spec 5.2). Each proposal shows what it would write, how sure it is
// and why, the moment in the recording, and the rule flags. Three
// actions: approve, edit and approve, reject with a line.

export type ReviewProposal = {
  id: string;
  target: ProposalTargetLike;
  action: ProposalActionLike;
  state: "PENDING" | "APPROVED" | "REJECTED" | "TASK";
  headline: string;
  payload: Record<string, unknown>;
  sources: string[];
  reason: string | null;
  quote: string | null;
  flags: ProposalFlag[];
  link: string | null;
  existing: { body: string } | null;
  /// A new item that is already in the file, as it stands now: what is
  /// there, and whether "כבר בתיק" adds this proposal's sources to it.
  alreadyIn: { body: string; addsSources: boolean } | null;
  /// Closed by "כבר בתיק": nothing was created.
  attached: boolean;
  /// Approved, and its item taken out of the file again ("ביטול").
  reverted: boolean;
  /// Approved by the server on arrival (the AUTO tier), not by a person.
  autoApplied?: boolean;
  /// Approved, and its item may still be taken out again (revertBlocker).
  revertible: boolean;
  rejectReason: string | null;
  /// Sensitive and this person is not an approver (R6): who decides it.
  hiddenFor: string | null;
  /// Spec 5.2: how sure, with why it is lower, and its place on the card.
  confidence: { level: ConfidenceLike; why: string[] };
  rank: number;
  /// Something to do, not to know: the task it would open, why it cannot
  /// (taskBlocker), and the task it opened once it did.
  /// `needsTitle`: it was something to know, so the person writes what to
  /// do; `said` is what was said; `due` the date already filled in.
  task: { title: string; description: string; needsTitle?: boolean; said?: string; due?: string };
  taskBlocked: string | null;
  taskId: string | null;
  /// A process proposal whose approval also approves its procedure, when
  /// it passes the checks (3.11.2026): the button says so.
  combinedProcedure?: boolean;
};

export type ReviewStaff = { id: string; name: string }[];

const INPUT = "mt-1.5 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold";

/// The fields a reviewer may change, per kind of item.
/// The kind of item, as the reviewer reads it: a fact by its kind, a rule
/// by its kind, everything else by what it is.
function targetLabel(p: { target: ProposalTargetLike; payload: Record<string, unknown> }): string {
  if (p.target === "FACT" && p.payload.kind) return FACT_KIND_LABELS[p.payload.kind as FactKindLike];
  if (p.target === "POLICY" && p.payload.kind) return `כלל: ${POLICY_KIND_LABELS[p.payload.kind as PolicyKindLike] ?? ""}`;
  if (p.target === "NARRATIVE" && p.payload.kind) return NARRATIVE_KIND_LABELS[p.payload.kind as keyof typeof NARRATIVE_KIND_LABELS] ?? TARGET_LABELS.NARRATIVE;
  return TARGET_LABELS[p.target];
}

const EDIT_FIELDS: Record<ProposalTargetLike, { key: string; label: string; long?: boolean }[]> = {
  FACT: [
    { key: "body", label: EDIT_FIELD_LABELS.body, long: true },
    { key: "validUntilEvent", label: EDIT_FIELD_LABELS.validUntilEvent },
    { key: "decidedBy", label: "מי החליט" },
    { key: "decidedAt", label: `${EDIT_FIELD_LABELS.decidedAt} (2026-10-17)` },
  ],
  CONTACT: [
    { key: "name", label: "שם" },
    { key: "role", label: "תפקיד" },
    { key: "context", label: "מה צריך לדעת", long: true },
  ],
  ORGANIZATION: [
    { key: "name", label: "שם" },
    { key: "role", label: "מה הוא ללקוח" },
    { key: "notes", label: "הערות", long: true },
  ],
  REQUEST_TYPE: [
    { key: "title", label: "סוג הפנייה" },
    { key: "handling", label: "איך עונים ולאן מעבירים", long: true },
  ],
  POLICY: [
    { key: "title", label: "שם הכלל" },
    { key: "statement", label: "הכלל", long: true },
    { key: "interimStatement", label: EDIT_FIELD_LABELS.interimStatement, long: true },
  ],
  SYSTEM: [
    { key: "systemName", label: "מערכת" },
    { key: "purpose", label: "למה היא משמשת" },
    { key: "blocker", label: "מה חוסם" },
    { key: "notes", label: "הערות", long: true },
  ],
  ENTITY: [
    { key: "name", label: "שם" },
    { key: "legalName", label: "שם משפטי" },
    { key: "registrationNumber", label: "ח.פ. או EIN" },
  ],
  NARRATIVE: [{ key: "body", label: "הטקסט", long: true }],
  PROCESS: [
    { key: "title", label: "שם התהליך" },
    { key: "purpose", label: "למה הוא קיים" },
    { key: "triggerText", label: "מה מפעיל אותו" },
  ],
  DOMAIN: [{ key: "domain", label: "דומיין" }],
  TASK: [
    { key: "title", label: "מה עושים" },
    { key: "description", label: "פירוט", long: true },
    { key: "assigneeName", label: "אחראי באנקורה (שם)" },
    { key: "dueDate", label: "תאריך יעד (2026-10-22)" },
  ],
  DATE: [
    { key: "title", label: "מה המועד" },
    { key: "date", label: `${EDIT_FIELD_LABELS.date} (2026-10-22), לחד-פעמי או שנתי` },
    { key: "responsibleName", label: "אחראי באנקורה (שם)" },
    { key: "notes", label: "הערות", long: true },
  ],
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/// 3.11.2026: what approving a process proposal did to its procedure, as
/// the toast says it. Null when it did nothing to it (as before).
function procedureToast(procedure: ProcedureAlongside | null | undefined, headline: string) {
  if (!procedure) return null;
  return procedure.approved
    ? { tone: "info" as const, title: "התהליך והנוהל אושרו", description: headline.slice(0, 80) }
    : { tone: "info" as const, title: "התהליך נכנס כטיוטה. הנוהל ממתין", description: procedure.reason };
}

function EditForm({ p }: { p: ReviewProposal }) {
  const close = useDrawerClose();
  const { showToast } = useToast();
  const { onSubmit, pending, error } = useActionForm(approveEditedProposalAction, (r) => {
    const t = procedureToast(r.procedure, p.headline);
    if (t) showToast(t);
    close();
  });
  const status = (str(p.payload.knowledgeStatus) || "CONFIRMED") as KnowledgeStatusLike;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={p.id} />
      {EDIT_FIELDS[p.target]
        .filter((f) => f.key !== "validUntilEvent" || p.payload.kind === "TEMPORARY")
        .filter((f) => (f.key !== "decidedBy" && f.key !== "decidedAt") || p.payload.kind === "ONE_OFF_DECISION")
        .map((f) => (
          <label key={f.key} className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{f.label}</span>
            {f.long ? (
              <textarea name={f.key} rows={3} defaultValue={str(p.payload[f.key])} className={INPUT} />
            ) : (
              <input name={f.key} defaultValue={str(p.payload[f.key])} className={INPUT} />
            )}
          </label>
        ))}
      {p.target !== "TASK" && p.target !== "DATE" && (p.target !== "FACT" || p.payload.kind !== "QUESTION") ? (
        <>
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">סטטוס</span>
            <select name="knowledgeStatus" defaultValue={status} className={INPUT}>
              <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
              <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
              <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{EDIT_FIELD_LABELS.toResolve} (אם לא מאושר)</span>
            <input name="toResolve" defaultValue={str(p.payload.toResolve)} className={INPUT} />
          </label>
        </>
      ) : p.target === "FACT" && p.payload.kind === "QUESTION" ? (
        // A question has no status, but what closes it may still be said.
        <label className="block">
          <span className="block text-xs font-medium text-app-text-secondary">מה יסגור אותה</span>
          <input name="toResolve" defaultValue={str(p.payload.toResolve)} className={INPUT} />
        </label>
      ) : null}
      {p.target !== "NARRATIVE" && p.target !== "DOMAIN" && p.target !== "TASK" && p.target !== "DATE" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">בעלים באנקורה (שם)</span>
            <input name="ownerName" defaultValue={str(p.payload.ownerName)} className={INPUT} />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-app-text-secondary">{EDIT_FIELD_LABELS.clientVisible}</span>
            <select name="clientVisible" defaultValue={p.payload.clientVisible === true ? "yes" : "no"} className={INPUT}>
              <option value="no">לא</option>
              <option value="yes">כן</option>
            </select>
          </label>
        </div>
      )}
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : p.target === "TASK" ? "פתיחת המשימה" : p.combinedProcedure ? `${COMBINED_APPROVE_LABEL} עם השינויים` : "אישור עם השינויים"}
      </button>
    </form>
  );
}

function RejectForm({ p }: { p: ReviewProposal }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectProposalAction, close);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={p.id} />
      <p className="text-sm text-app-text-primary">{p.headline}</p>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">למה, בשורה אחת *</span>
        <input name="reason" required placeholder="שיחת חולין, לא רלוונטי לעבודה" className={INPUT} />
      </label>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "דחייה"}
      </button>
    </form>
  );
}

function TaskForm({ p, staff, meId }: { p: ReviewProposal; staff: ReviewStaff; meId: string }) {
  const close = useDrawerClose();
  const { showToast } = useToast();
  const { onSubmit, pending, error } = useActionForm(proposalToTaskAction, () => {
    showToast({ tone: "info", title: "נפתחה משימה", description: p.task.title.slice(0, 80) });
    close();
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5" data-testid="proposal-task-form">
      <input type="hidden" name="id" value={p.id} />
      <p className="text-xs text-app-text-secondary">ההצעה לא תיכנס לתיק. במקומה תיפתח משימה על הלקוח, וההצעה תסומן &quot;הפכה למשימה&quot;.</p>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">מה עושים? כותרת המשימה *</span>
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={p.task.title}
          placeholder={p.task.needsTitle ? "לברר עם... / לשלוח ל... / להזמין..." : undefined}
          className={INPUT}
          data-testid="proposal-task-title"
        />
      </label>
      {p.task.needsTitle && p.task.said && (
        <p className="-mt-2 text-[11px] text-app-text-tertiary">
          מה שנאמר: {p.task.said}. בכותרת כותבים מה צריך לעשות, לא את מה שנאמר.
        </p>
      )}
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">תיאור</span>
        <textarea name="description" rows={6} defaultValue={p.task.description} className={INPUT} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-app-text-secondary">אחראי</span>
          <select name="assignedToId" defaultValue={meId} className={INPUT}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-app-text-secondary">תאריך יעד</span>
          <input type="date" name="dueDate" defaultValue={p.task.due} className={INPUT} />
        </label>
      </div>
      <p className="-mt-1.5 text-[11px] text-app-text-tertiary">הקטגוריה נבחרת לפי הכותרת, ואפשר לשנות אותה במשימה.</p>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">עדיפות</span>
        <select name="priority" defaultValue="NORMAL" className={INPUT}>
          <option value="LOW">נמוכה</option>
          <option value="NORMAL">רגילה</option>
          <option value="HIGH">גבוהה</option>
          <option value="URGENT">דחופה</option>
        </select>
      </label>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "פותח..." : "פתיחת משימה"}
      </button>
    </form>
  );
}

function RejectManyForm({ ids }: { ids: string[] }) {
  // The selection is not cleared here. Clearing it empties `chosen`,
  // which unmounts this drawer in the same commit, and the drawer is the
  // one that refreshes the screen after a write (see Drawer). Rejected
  // proposals leave `decidable` on that refresh, so they leave `chosen`
  // with it; any that failed stay selected for another try.
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectProposalsAction, () => close());
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      {ids.map((id) => (
        <input key={id} type="hidden" name="id" value={id} />
      ))}
      <p className="text-sm text-app-text-primary">{ids.length === 1 ? "הצעה אחת נדחית." : `${ids.length} הצעות נדחות, עם אותה סיבה.`}</p>
      <label className="block">
        <span className="block text-xs font-medium text-app-text-secondary">למה, בשורה אחת *</span>
        <input name="reason" required placeholder="כבר בתיק מהחילוץ היומי" className={INPUT} />
      </label>
      {error && <p className="text-sm text-app-error">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-app-border px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50">
        {pending ? "שומר..." : "דחייה"}
      </button>
    </form>
  );
}

/// "ביטול" on an approved new item (3.11.2026): the item is taken out of
/// the file again, and the proposal stays approved, marked reverted. Two
/// steps on the row, not the browser's confirm() (see SetupForms.tsx).
function RevertButton({ p }: { p: ReviewProposal }) {
  const { showToast } = useToast();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="ms-1.5 text-app-text-accent hover:underline" data-testid="proposal-revert">
        ביטול
      </button>
    );
  }
  async function revert() {
    setPending(true);
    const r = await revertProposalAction(p.id);
    setPending(false);
    setAsking(false);
    if (r.error) showToast({ tone: "error", title: "הביטול נכשל", description: r.error });
    else showToast({ tone: "info", title: "בוטל: הפריט הוסר מהתיק", description: p.headline.slice(0, 80) });
  }
  return (
    <span className="ms-1.5 inline-flex flex-wrap items-center gap-2">
      <span className="text-app-text-secondary">להסיר את הפריט מהתיק?</span>
      <button type="button" disabled={pending} onClick={revert} className="font-medium text-app-error disabled:opacity-50" data-testid="proposal-revert-confirm">
        {pending ? "מסיר..." : "להסיר"}
      </button>
      <button type="button" disabled={pending} onClick={() => setAsking(false)} className="text-app-text-secondary">
        להשאיר
      </button>
    </span>
  );
}

function ProposalRow({ p, selected, onSelect, staff, meId }: { p: ReviewProposal; selected: boolean; onSelect: (on: boolean) => void; staff: ReviewStaff; meId: string }) {
  const { showToast } = useToast();
  const status = (str(p.payload.knowledgeStatus) || (p.payload.kind === "QUESTION" ? "MISSING" : "CONFIRMED")) as KnowledgeStatusLike;
  const kindLabel = targetLabel(p);

  async function approve() {
    const r = await approveProposalAction(p.id);
    if (r.error) showToast({ tone: "error", title: "האישור נכשל", description: r.error });
    else showToast(procedureToast(r.procedure, p.headline) ?? { tone: "info", title: p.target === "TASK" ? "נפתחה משימה" : "נכנס לתיק", description: p.headline.slice(0, 80) });
  }

  async function approveSuggested() {
    const r = await approveWithSuggestionAction(p.id);
    if (r.error) showToast({ tone: "error", title: "האישור נכשל", description: r.error });
    else showToast(procedureToast(r.procedure, p.headline) ?? { tone: "info", title: "הושלם ונכנס לתיק", description: p.headline.slice(0, 80) });
  }

  async function attach() {
    const r = await attachProposalAction(p.id);
    if (r.error) showToast({ tone: "error", title: "לא נסגר", description: r.error });
    else showToast({ tone: "info", title: p.alreadyIn?.addsSources ? "המקור נוסף לפריט שבתיק" : "נסגר: כבר בתיק", description: p.alreadyIn?.body.slice(0, 80) });
  }

  async function merge(m: { id: string; name: string }) {
    const r = await mergeProposalAction(p.id, m.id);
    if (r.error) showToast({ tone: "error", title: "ההוספה נכשלה", description: r.error });
    else showToast({ tone: "info", title: `נוסף אל ${m.name}`, description: p.headline.slice(0, 80) });
  }

  if (p.state !== "PENDING") {
    return (
      <li id={proposalAnchor(p.id)} className="py-2.5 text-xs text-app-text-tertiary scroll-mt-24 rounded-lg target:bg-app-accent-soft">
        {p.state === "APPROVED" ? (p.reverted ? "אושר ובוטל: " : p.autoApplied ? "נכנס אוטומטית: " : p.attached ? "כבר בתיק: " : p.target === "TASK" ? "נפתחה משימה: " : "אושר: ") : p.state === "TASK" ? "הפך למשימה: " : "נדחה: "}
        {p.headline}
        {p.rejectReason && ` (${p.rejectReason})`}
        {p.taskId && (
          <a href={`/app/tasks/${p.taskId}`} className="ms-1.5 text-app-text-accent hover:underline">
            למשימה
          </a>
        )}
        {p.revertible && <RevertButton p={p} />}
      </li>
    );
  }

  if (p.hiddenFor) {
    return (
      <li id={proposalAnchor(p.id)} className="py-3.5 scroll-mt-24 rounded-lg target:bg-app-accent-soft">
        <p className="text-xs text-app-text-tertiary">{kindLabel}</p>
        <p className="mt-0.5 text-sm text-app-text-secondary">פריט רגיש. רק {p.hiddenFor} רואה אותו ומחליט עליו.</p>
      </li>
    );
  }

  const doubtful = p.flags.some((f) => f.code === "DUPLICATE" || f.code === "SIMILAR");
  const blocked = p.flags.some((f) => f.block);
  // Every problem has a ready wording: one press completes and approves.
  const suggested = !p.alreadyIn && suggestedFix(p.flags) !== null;
  const alone = bulkApproveBlocker({ ...p, level: p.confidence.level });
  return (
    <li id={proposalAnchor(p.id)} className={`py-3.5 scroll-mt-24 rounded-lg target:bg-app-accent-soft ${selected ? "bg-gold/[0.04]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`בחירה: ${p.headline.slice(0, 60)}`}
          title={alone ? `אפשר לדחות יחד עם אחרות. לאשר: אחת אחת (${alone})` : undefined}
          className="mt-1 h-4 w-4 shrink-0 accent-gold"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-app-text-tertiary">
            {kindLabel}
            {p.action !== "CREATE" && <span className="ms-1.5 text-app-warning">· {ACTION_LABELS[p.action]}</span>}
          </p>
          <p className="mt-0.5 text-sm text-app-text-primary">{p.headline}</p>
          {proposalDetails(p.target, p.payload).map((line, i) => (
            <p key={i} className="mt-0.5 whitespace-pre-line text-xs text-app-text-secondary">
              {line}
            </p>
          ))}
          {p.alreadyIn && (
            <p className="mt-1 text-xs text-app-warning" data-testid="proposal-already-in">
              כבר בתיק: <span className="text-app-text-secondary">{p.alreadyIn.body}</span>
            </p>
          )}
          {p.existing && (
            <p className="mt-1 text-xs text-app-text-secondary">
              היום בתיק: <span className={p.action === "SUPERSEDE" ? "line-through" : ""}>{p.existing.body}</span>
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-app-text-secondary">
            {status !== "CONFIRMED" && <StatusBadge label={KNOWLEDGE_STATUS_LABELS[status]} tone={status === "MISSING" ? "red" : "amber"} />}
            {str(p.payload.toResolve) && <span>{str(p.payload.toResolve)}</span>}
            {p.state === "PENDING" && (
              <span title={p.confidence.why.join(" · ") || undefined} data-testid="proposal-confidence">
                <StatusBadge label={CONFIDENCE_LABELS[p.confidence.level]} tone={p.confidence.level === "HIGH" ? "green" : p.confidence.level === "LOW" ? "red" : "gray"} />
              </span>
            )}
            {p.state === "PENDING" && p.confidence.why.length > 0 && p.confidence.level !== "HIGH" && <span>{p.confidence.why.join(", ")}</span>}
            {p.sources.length > 0 && <span dir="ltr">[{p.sources.join(", ")}]</span>}
            {p.link && (
              <a href={p.link} target="_blank" rel="noreferrer" className="text-app-text-accent hover:underline">
                לרגע בשיחה
              </a>
            )}
          </div>
          {p.reason && <p className="mt-1 text-xs text-app-text-secondary">למה: {p.reason}</p>}
          {p.quote && <p className="mt-1 border-s-2 border-app-border ps-2 text-xs italic text-app-text-secondary">{p.quote}</p>}
          {/* "Already in the file" is said once, above, with what is there. */}
          {p.flags.filter((f) => !(p.alreadyIn && f.code === "DUPLICATE")).map((f, i) => (
            <p key={i} className={`mt-1 text-xs ${f.block ? "font-medium text-app-error" : "text-app-warning"}`} data-testid="proposal-flag">
              {f.message}
              {f.why && <span className="block font-normal text-app-text-secondary">למה: {f.why}</span>}
              {f.fix && (
                <span className="block font-normal text-app-text-secondary" data-testid="proposal-suggested">
                  נוסח מוצע: <span className="text-app-text-primary">{f.fix.label}</span>
                </span>
              )}
              {/* The same item under another spelling: added to it, not a second one. */}
              {/* A date is not merged: the existing one is opened and completed. */}
              {f.match && p.target === "DATE" && (
                <a href={`/app/important-dates/${f.match.id}`} className="ms-2 font-medium text-app-text-accent hover:underline" data-testid="proposal-date-match">
                  לפתוח את {f.match.name}
                </a>
              )}
              {f.match && !blocked && p.target !== "DATE" && (
                <button type="button" onClick={() => merge(f.match!)} className="ms-2 font-medium text-app-text-accent hover:underline" data-testid="proposal-merge">
                  להוסיף אל {f.match.name}
                </button>
              )}
            </p>
          ))}
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-3 text-xs">
          {/* A problem that blocks approval (spec 5.2) is fixed in the edit,
              where the server checks the approved text again. */}
          {/* Already in the file: approving would make a second copy, or
              be refused. The primary action closes it onto the item there. */}
          {p.alreadyIn ? (
            <button type="button" onClick={attach} className="rounded-full bg-app-accent px-3.5 py-1.5 font-medium text-app-text-primary">
              {p.alreadyIn.addsSources ? "כבר בתיק: הוספת המקור" : "כבר בתיק: סגירה"}
            </button>
          ) : (
            <>
              {suggested && (
                <button type="button" onClick={approveSuggested} className="rounded-full bg-app-accent px-3.5 py-1.5 font-medium text-app-text-primary" data-testid="proposal-approve-suggested">
                  {p.combinedProcedure ? "להשלים בנוסח המוצע ולאשר את ההצעה והנוהל" : "להשלים בנוסח המוצע ולאשר"}
                </button>
              )}
              {/* A process that only lacks a check enters as a draft: it may
                  also be approved as it is. */}
              {!blocked && (
                <button
                  type="button"
                  onClick={approve}
                  className={`rounded-full px-3.5 py-1.5 font-medium ${doubtful || suggested ? "border border-app-border text-app-text-secondary" : "bg-app-accent text-app-text-primary"}`}
                >
                  {p.combinedProcedure ? COMBINED_APPROVE_LABEL : "אישור"}
                </button>
              )}
            </>
          )}
          <Drawer triggerLabel="עריכה ואישור" title="עריכה לפני אישור" variant="link">
            <EditForm p={p} />
          </Drawer>
          {/* Not knowledge but something to do: a task, not a rejection
              and not an item forced into the file. */}
          {!p.taskBlocked ? (
            <Drawer triggerLabel="למשימה" title="הצעה שהיא משימה" variant="link">
              <TaskForm p={p} staff={staff} meId={meId} />
            </Drawer>
          ) : null}
          <Drawer triggerLabel="דחייה" title="דחיית הצעה" variant="link">
            <RejectForm p={p} />
          </Drawer>
        </div>
      </div>
    </li>
  );
}

export function ReviewBatch({
  batchId,
  clientId,
  clientName,
  sourceLabel,
  sourceDetails,
  note,
  droppedCount,
  proposals,
  filtered = false,
  staff,
  meId,
}: {
  /// The batch, for the link that opens it (lib/approval-links.ts).
  batchId?: string;
  clientId: string;
  clientName: string;
  sourceLabel: string;
  sourceDetails: string;
  note: string | null;
  droppedCount: number;
  proposals: ReviewProposal[];
  /// The screen is filtered, and `proposals` is only what matches. Said
  /// on the select-all, so "all" never reads as the whole batch.
  filtered?: boolean;
  /// Who a task opened from a proposal may go to, and who it goes to by default.
  staff: ReviewStaff;
  meId: string;
}) {
  const { showToast } = useToast();
  const pending = proposals.filter((p) => p.state === "PENDING");
  // What this person may decide here: not a sensitive item hidden from them.
  const decidable = pending.filter((p) => !p.hiddenFor);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = decidable.filter((p) => selected.has(p.id));
  const approvable = chosen.filter((p) => !bulkApproveBlocker({ ...p, level: p.confidence.level }));
  const allTogether = decidable.filter((p) => !bulkApproveBlocker({ ...p, level: p.confidence.level }));
  const select = (id: string, on: boolean) =>
    setSelected((all) => {
      const next = new Set(all);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const [busy, setBusy] = useState(false);

  async function approveChosen() {
    setBusy(true);
    const r = await approveProposalsAction(approvable.slice(0, MAX_BULK).map((p) => p.id));
    setBusy(false);
    if (r.error) {
      showToast({ tone: "error", title: "האישור נכשל", description: r.error });
      return;
    }
    setSelected(new Set((r.failed ?? []).map((f) => f.id)));
    if (r.failed?.length) showToast({ tone: "error", title: `${r.done} נכנסו לתיק, ${r.failed.length} לא`, description: r.failed[0].error });
    else showToast({ tone: "info", title: r.done === 1 ? "נכנס לתיק" : `${r.done} נכנסו לתיק` });
  }
  const counts = Object.entries(
    pending.reduce<Record<string, number>>((acc, p) => {
      const k = targetLabel(p);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {})
  );
  return (
    <section id={batchId ? batchAnchor(batchId) : undefined} className="scroll-mt-24 rounded-2xl border border-app-border bg-white p-6 target:border-app-accent target:ring-2 target:ring-app-accent">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-app-text-tertiary">
            <a href={`/app/clients/${clientId}/client-file`} className="hover:text-app-text-accent">
              {clientName}
            </a>
          </p>
          <h2 className="text-sm font-medium text-app-text-primary">{sourceLabel}</h2>
          {sourceDetails && <p className="text-xs text-app-text-secondary">{sourceDetails}</p>}
        </div>
        <p className="text-xs text-app-text-secondary">{counts.map(([k, n]) => `${n} ${k}`).join(" · ")}</p>
      </div>
      {/* Spec 5.2: how much of the card goes together, before reading it. */}
      {(() => {
        const line = reviewSummary(decidable.map((p) => p.rank));
        return line ? (
          <p className="mt-2 text-xs font-medium text-app-text-secondary" data-testid="review-summary">
            {line}
          </p>
        ) : null;
      })()}
      {note && <p className="mt-2 text-xs text-app-text-secondary">{note}</p>}
      {droppedCount > 0 && (
        <p className="mt-2 text-xs text-app-warning">
          {droppedCount === 1 ? "פריט אחד לא נכנס להצעות" : `${droppedCount} פריטים לא נכנסו להצעות`} (סוד, ציטוט ממקור מוגבל או מבנה שגוי). מה שנדחה לא נשמר.
        </p>
      )}
      {decidable.length > 1 && (
        // No backdrop-blur here. A backdrop filter makes this bar the
        // containing block of every fixed descendant, so the reject
        // drawer below opened inside the bar's 40px instead of the
        // viewport: clipped, with its reason field and button cut off
        // (20.10.2026). Opaque enough without it.
        <div className="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-app-border bg-white px-3 py-2 text-xs">
          <label className="flex items-center gap-1.5 text-app-text-primary">
            <input
              type="checkbox"
              checked={chosen.length > 0 && chosen.length === decidable.length}
              onChange={(e) => setSelected(new Set(e.target.checked ? decidable.map((p) => p.id) : []))}
              className="h-4 w-4 accent-gold"
            />
            {filtered ? "כל מה שבסינון" : "הכול"} ({decidable.length})
          </label>
          {allTogether.length > 0 && allTogether.length < decidable.length && (
            <button type="button" onClick={() => setSelected(new Set(allTogether.map((p) => p.id)))} className="text-app-text-accent hover:underline">
              רק מה שאפשר לאשר יחד ({allTogether.length})
            </button>
          )}
          {chosen.length > 0 && (
            <>
              <span className="text-app-text-tertiary">נבחרו {chosen.length}</span>
              <button
                type="button"
                onClick={approveChosen}
                disabled={busy || approvable.length === 0}
                className="rounded-full bg-app-accent px-3.5 py-1.5 font-medium text-app-text-primary disabled:opacity-40"
              >
                {busy ? "מאשר..." : `אישור ${approvable.length}`}
              </button>
              <Drawer triggerLabel={`דחיית ${chosen.length}`} title="דחיית הצעות" variant="link">
                <RejectManyForm ids={chosen.map((p) => p.id)} />
              </Drawer>
              {approvable.length < chosen.length && (
                <span className="text-app-text-tertiary">{chosen.length - approvable.length} מהנבחרות מאשרים אחת אחת: משנות פריט קיים, אולי כבר בתיק, או רגישות.</span>
              )}
            </>
          )}
        </div>
      )}
      <ul className="mt-3 divide-y divide-app-border">
        {proposals.map((p) => (
          <ProposalRow key={p.id} p={p} selected={selected.has(p.id)} onSelect={(on) => select(p.id, on)} staff={staff} meId={meId} />
        ))}
      </ul>
    </section>
  );
}
