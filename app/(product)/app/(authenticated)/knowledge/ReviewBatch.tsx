"use client";
import { useState } from "react";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import { FACT_KIND_LABELS, type FactKindLike } from "@/lib/client-facts";
import { POLICY_KIND_LABELS, type PolicyKindLike } from "@/lib/client-policies";
import { ACTION_LABELS, CONFIDENCE_LABELS, MAX_BULK, NARRATIVE_KIND_LABELS, TARGET_LABELS, bulkApproveBlocker, proposalDetails, reviewSummary, type ConfidenceLike, type ProposalActionLike, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { approveProposalAction, approveEditedProposalAction, approveProposalsAction, proposalToTaskAction, rejectProposalAction, rejectProposalsAction } from "./actions";

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
  flags: { code: string; message: string; block?: boolean }[];
  link: string | null;
  existing: { body: string } | null;
  rejectReason: string | null;
  /// Sensitive and this person is not an approver (R6): who decides it.
  hiddenFor: string | null;
  /// Spec 5.2: how sure, with why it is lower, and its place on the card.
  confidence: { level: ConfidenceLike; why: string[] };
  rank: number;
  /// Something to do, not to know: the task it would open, why it cannot
  /// (taskBlocker), and the task it opened once it did.
  task: { title: string; description: string };
  taskBlocked: string | null;
  taskId: string | null;
};

export type ReviewStaff = { id: string; name: string }[];

const INPUT = "mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold";

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
    { key: "body", label: "מה", long: true },
    { key: "validUntilEvent", label: "בתוקף עד אירוע" },
    { key: "decidedBy", label: "מי החליט" },
    { key: "decidedAt", label: "תאריך ההחלטה (2026-10-17)" },
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
    { key: "interimStatement", label: "עד שיאושר", long: true },
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
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function EditForm({ p }: { p: ReviewProposal }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(approveEditedProposalAction, close);
  const status = (str(p.payload.knowledgeStatus) || "CONFIRMED") as KnowledgeStatusLike;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="id" value={p.id} />
      {EDIT_FIELDS[p.target]
        .filter((f) => f.key !== "validUntilEvent" || p.payload.kind === "TEMPORARY")
        .filter((f) => (f.key !== "decidedBy" && f.key !== "decidedAt") || p.payload.kind === "ONE_OFF_DECISION")
        .map((f) => (
          <label key={f.key} className="block">
            <span className="block text-xs font-medium text-appNavy/60">{f.label}</span>
            {f.long ? (
              <textarea name={f.key} rows={3} defaultValue={str(p.payload[f.key])} className={INPUT} />
            ) : (
              <input name={f.key} defaultValue={str(p.payload[f.key])} className={INPUT} />
            )}
          </label>
        ))}
      {p.target !== "FACT" || p.payload.kind !== "QUESTION" ? (
        <>
          <label className="block">
            <span className="block text-xs font-medium text-appNavy/60">סטטוס</span>
            <select name="knowledgeStatus" defaultValue={status} className={INPUT}>
              <option value="CONFIRMED">{KNOWLEDGE_STATUS_LABELS.CONFIRMED}</option>
              <option value="UNCERTAIN">{KNOWLEDGE_STATUS_LABELS.UNCERTAIN}</option>
              <option value="MISSING">{KNOWLEDGE_STATUS_LABELS.MISSING}</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-appNavy/60">מה יסגור את זה (אם לא מאושר)</span>
            <input name="toResolve" defaultValue={str(p.payload.toResolve)} className={INPUT} />
          </label>
        </>
      ) : null}
      {p.target !== "NARRATIVE" && p.target !== "DOMAIN" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-appNavy/60">בעלים באנקורה (שם)</span>
            <input name="ownerName" defaultValue={str(p.payload.ownerName)} className={INPUT} />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-appNavy/60">גלוי ללקוח</span>
            <select name="clientVisible" defaultValue={p.payload.clientVisible === true ? "yes" : "no"} className={INPUT}>
              <option value="no">לא</option>
              <option value="yes">כן</option>
            </select>
          </label>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "שומר..." : "אישור עם השינויים"}
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
      <p className="text-sm text-appNavy">{p.headline}</p>
      <label className="block">
        <span className="block text-xs font-medium text-appNavy/60">למה, בשורה אחת *</span>
        <input name="reason" required placeholder="שיחת חולין, לא רלוונטי לעבודה" className={INPUT} />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-lineDark px-5 py-2.5 text-sm font-medium text-appNavy disabled:opacity-50">
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
      <p className="text-xs text-appNavy/60">ההצעה לא תיכנס לתיק. במקומה תיפתח משימה על הלקוח, וההצעה תסומן &quot;הפכה למשימה&quot;.</p>
      <label className="block">
        <span className="block text-xs font-medium text-appNavy/60">כותרת המשימה *</span>
        <input name="title" required maxLength={200} defaultValue={p.task.title} className={INPUT} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-appNavy/60">תיאור</span>
        <textarea name="description" rows={6} defaultValue={p.task.description} className={INPUT} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-appNavy/60">אחראי</span>
          <select name="assignedToId" defaultValue={meId} className={INPUT}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-appNavy/60">תאריך יעד</span>
          <input type="date" name="dueDate" className={INPUT} />
        </label>
      </div>
      <label className="block">
        <span className="block text-xs font-medium text-appNavy/60">עדיפות</span>
        <select name="priority" defaultValue="NORMAL" className={INPUT}>
          <option value="LOW">נמוכה</option>
          <option value="NORMAL">רגילה</option>
          <option value="HIGH">גבוהה</option>
          <option value="URGENT">דחופה</option>
        </select>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50">
        {pending ? "פותח..." : "פתיחת משימה"}
      </button>
    </form>
  );
}

function RejectManyForm({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const close = useDrawerClose();
  const { onSubmit, pending, error } = useActionForm(rejectProposalsAction, () => {
    onDone();
    close();
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      {ids.map((id) => (
        <input key={id} type="hidden" name="id" value={id} />
      ))}
      <p className="text-sm text-appNavy">{ids.length === 1 ? "הצעה אחת נדחית." : `${ids.length} הצעות נדחות, עם אותה סיבה.`}</p>
      <label className="block">
        <span className="block text-xs font-medium text-appNavy/60">למה, בשורה אחת *</span>
        <input name="reason" required placeholder="כבר בתיק מהחילוץ היומי" className={INPUT} />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-full border border-lineDark px-5 py-2.5 text-sm font-medium text-appNavy disabled:opacity-50">
        {pending ? "שומר..." : "דחייה"}
      </button>
    </form>
  );
}

function ProposalRow({ p, selected, onSelect, staff, meId }: { p: ReviewProposal; selected: boolean; onSelect: (on: boolean) => void; staff: ReviewStaff; meId: string }) {
  const { showToast } = useToast();
  const status = (str(p.payload.knowledgeStatus) || (p.payload.kind === "QUESTION" ? "MISSING" : "CONFIRMED")) as KnowledgeStatusLike;
  const kindLabel = targetLabel(p);

  async function approve() {
    const r = await approveProposalAction(p.id);
    if (r.error) showToast({ tone: "error", title: "האישור נכשל", description: r.error });
    else showToast({ tone: "info", title: "נכנס לתיק", description: p.headline.slice(0, 80) });
  }

  if (p.state !== "PENDING") {
    return (
      <li className="py-2.5 text-xs text-appNavy/45">
        {p.state === "APPROVED" ? "אושר: " : p.state === "TASK" ? "הפך למשימה: " : "נדחה: "}
        {p.headline}
        {p.rejectReason && ` (${p.rejectReason})`}
        {p.state === "TASK" && p.taskId && (
          <a href={`/app/tasks/${p.taskId}`} className="ms-1.5 text-gold-dim hover:underline">
            למשימה
          </a>
        )}
      </li>
    );
  }

  if (p.hiddenFor) {
    return (
      <li className="py-3.5">
        <p className="text-xs text-appNavy/50">{kindLabel}</p>
        <p className="mt-0.5 text-sm text-appNavy/60">פריט רגיש. רק {p.hiddenFor} רואה אותו ומחליט עליו.</p>
      </li>
    );
  }

  const doubtful = p.flags.some((f) => f.code === "DUPLICATE");
  const blocked = p.flags.some((f) => f.block);
  const alone = bulkApproveBlocker(p);
  return (
    <li className={`py-3.5 ${selected ? "bg-gold/[0.04]" : ""}`}>
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
          <p className="text-xs text-appNavy/50">
            {kindLabel}
            {p.action !== "CREATE" && <span className="ms-1.5 text-warning">· {ACTION_LABELS[p.action]}</span>}
          </p>
          <p className="mt-0.5 text-sm text-appNavy">{p.headline}</p>
          {proposalDetails(p.target, p.payload).map((line, i) => (
            <p key={i} className="mt-0.5 whitespace-pre-line text-xs text-appNavy/65">
              {line}
            </p>
          ))}
          {p.existing && (
            <p className="mt-1 text-xs text-appNavy/55">
              היום בתיק: <span className={p.action === "SUPERSEDE" ? "line-through" : ""}>{p.existing.body}</span>
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-appNavy/60">
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
              <a href={p.link} target="_blank" rel="noreferrer" className="text-gold-dim hover:underline">
                לרגע בשיחה
              </a>
            )}
          </div>
          {p.reason && <p className="mt-1 text-xs text-appNavy/60">למה: {p.reason}</p>}
          {p.quote && <p className="mt-1 border-s-2 border-lineDark ps-2 text-xs italic text-appNavy/60">{p.quote}</p>}
          {p.flags.map((f, i) => (
            <p key={i} className={`mt-1 text-xs ${f.block ? "font-medium text-red-700" : "text-warning"}`}>
              {f.message}
            </p>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs">
          {/* A problem that blocks approval (spec 5.2) is fixed in the edit,
              where the server checks the approved text again. */}
          {!blocked && (
            <button
              type="button"
              onClick={approve}
              className={`rounded-full px-3.5 py-1.5 font-medium ${doubtful ? "border border-lineDark text-appNavy/60" : "bg-gold-gradient text-navy"}`}
            >
              אישור
            </button>
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
  const approvable = chosen.filter((p) => !bulkApproveBlocker(p));
  const allTogether = decidable.filter((p) => !bulkApproveBlocker(p));
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
    <section className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-appNavy/50">
            <a href={`/app/clients/${clientId}/client-file`} className="hover:text-gold-dim">
              {clientName}
            </a>
          </p>
          <h2 className="text-sm font-medium text-appNavy">{sourceLabel}</h2>
          {sourceDetails && <p className="text-xs text-appNavy/60">{sourceDetails}</p>}
        </div>
        <p className="text-xs text-appNavy/60">{counts.map(([k, n]) => `${n} ${k}`).join(" · ")}</p>
      </div>
      {/* Spec 5.2: how much of the card goes together, before reading it. */}
      {(() => {
        const line = reviewSummary(decidable.map((p) => p.rank));
        return line ? (
          <p className="mt-2 text-xs font-medium text-appNavy/70" data-testid="review-summary">
            {line}
          </p>
        ) : null;
      })()}
      {note && <p className="mt-2 text-xs text-appNavy/60">{note}</p>}
      {droppedCount > 0 && (
        <p className="mt-2 text-xs text-warning">
          {droppedCount === 1 ? "פריט אחד לא נכנס להצעות" : `${droppedCount} פריטים לא נכנסו להצעות`} (סוד, ציטוט ממקור מוגבל או מבנה שגוי). מה שנדחה לא נשמר.
        </p>
      )}
      {decidable.length > 1 && (
        <div className="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-lineDark bg-white/95 px-3 py-2 text-xs backdrop-blur">
          <label className="flex items-center gap-1.5 text-appNavy">
            <input
              type="checkbox"
              checked={chosen.length > 0 && chosen.length === decidable.length}
              onChange={(e) => setSelected(new Set(e.target.checked ? decidable.map((p) => p.id) : []))}
              className="h-4 w-4 accent-gold"
            />
            {filtered ? "כל מה שבסינון" : "הכול"} ({decidable.length})
          </label>
          {allTogether.length > 0 && allTogether.length < decidable.length && (
            <button type="button" onClick={() => setSelected(new Set(allTogether.map((p) => p.id)))} className="text-gold-dim hover:underline">
              רק מה שאפשר לאשר יחד ({allTogether.length})
            </button>
          )}
          {chosen.length > 0 && (
            <>
              <span className="text-appNavy/50">נבחרו {chosen.length}</span>
              <button
                type="button"
                onClick={approveChosen}
                disabled={busy || approvable.length === 0}
                className="rounded-full bg-gold-gradient px-3.5 py-1.5 font-medium text-navy disabled:opacity-40"
              >
                {busy ? "מאשר..." : `אישור ${approvable.length}`}
              </button>
              <Drawer triggerLabel={`דחיית ${chosen.length}`} title="דחיית הצעות" variant="link">
                <RejectManyForm ids={chosen.map((p) => p.id)} onDone={() => setSelected(new Set())} />
              </Drawer>
              {approvable.length < chosen.length && (
                <span className="text-appNavy/50">{chosen.length - approvable.length} מהנבחרות מאשרים אחת אחת: משנות פריט קיים, אולי כבר בתיק, או רגישות.</span>
              )}
            </>
          )}
        </div>
      )}
      <ul className="mt-3 divide-y divide-lineDark">
        {proposals.map((p) => (
          <ProposalRow key={p.id} p={p} selected={selected.has(p.id)} onSelect={(on) => select(p.id, on)} staff={staff} meId={meId} />
        ))}
      </ul>
    </section>
  );
}
