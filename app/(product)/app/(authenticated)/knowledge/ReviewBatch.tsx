"use client";
import { Drawer, useDrawerClose } from "@/components/app/Drawer";
import { useActionForm } from "@/components/app/useActionForm";
import { useToast } from "@/components/app/toast/ToastProvider";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KNOWLEDGE_STATUS_LABELS, type KnowledgeStatusLike } from "@/lib/knowledge";
import { FACT_KIND_LABELS, type FactKindLike } from "@/lib/client-facts";
import { POLICY_KIND_LABELS, type PolicyKindLike } from "@/lib/client-policies";
import { ACTION_LABELS, TARGET_LABELS, type ProposalActionLike, type ProposalTargetLike } from "@/lib/knowledge-proposals";
import { approveProposalAction, approveEditedProposalAction, rejectProposalAction } from "./actions";

// One batch: one meeting or one document, and what Claude proposed from
// it (spec 5.2). Each proposal shows what it would write, how sure it is
// and why, the moment in the recording, and the rule flags. Three
// actions: approve, edit and approve, reject with a line.

export type ReviewProposal = {
  id: string;
  target: ProposalTargetLike;
  action: ProposalActionLike;
  state: "PENDING" | "APPROVED" | "REJECTED";
  headline: string;
  payload: Record<string, unknown>;
  sources: string[];
  reason: string | null;
  quote: string | null;
  flags: { code: string; message: string }[];
  link: string | null;
  existing: { body: string } | null;
  rejectReason: string | null;
};

const INPUT = "mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold";

/// The fields a reviewer may change, per kind of item.
/// The kind of item, as the reviewer reads it: a fact by its kind, a rule
/// by its kind, everything else by what it is.
function targetLabel(p: { target: ProposalTargetLike; payload: Record<string, unknown> }): string {
  if (p.target === "FACT" && p.payload.kind) return FACT_KIND_LABELS[p.payload.kind as FactKindLike];
  if (p.target === "POLICY" && p.payload.kind) return `כלל: ${POLICY_KIND_LABELS[p.payload.kind as PolicyKindLike] ?? ""}`;
  return TARGET_LABELS[p.target];
}

const EDIT_FIELDS: Record<ProposalTargetLike, { key: string; label: string; long?: boolean }[]> = {
  FACT: [
    { key: "body", label: "מה", long: true },
    { key: "validUntilEvent", label: "בתוקף עד אירוע" },
    { key: "decidedBy", label: "מי החליט" },
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
        .filter((f) => f.key !== "decidedBy" || p.payload.kind === "ONE_OFF_DECISION")
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

function ProposalRow({ p }: { p: ReviewProposal }) {
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
        {p.state === "APPROVED" ? "אושר: " : "נדחה: "}
        {p.headline}
        {p.rejectReason && ` (${p.rejectReason})`}
      </li>
    );
  }

  const doubtful = p.flags.some((f) => f.code === "DUPLICATE");
  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-appNavy/50">
            {kindLabel}
            {p.action !== "CREATE" && <span className="ms-1.5 text-warning">· {ACTION_LABELS[p.action]}</span>}
          </p>
          <p className="mt-0.5 text-sm text-appNavy">{p.headline}</p>
          {p.existing && (
            <p className="mt-1 text-xs text-appNavy/55">
              היום בתיק: <span className={p.action === "SUPERSEDE" ? "line-through" : ""}>{p.existing.body}</span>
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-appNavy/60">
            {status !== "CONFIRMED" && <StatusBadge label={KNOWLEDGE_STATUS_LABELS[status]} tone={status === "MISSING" ? "red" : "amber"} />}
            {str(p.payload.toResolve) && <span>{str(p.payload.toResolve)}</span>}
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
            <p key={i} className="mt-1 text-xs text-warning">
              {f.message}
            </p>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            onClick={approve}
            className={`rounded-full px-3.5 py-1.5 font-medium ${doubtful ? "border border-lineDark text-appNavy/60" : "bg-gold-gradient text-navy"}`}
          >
            אישור
          </button>
          <Drawer triggerLabel="עריכה ואישור" title="עריכה לפני אישור" variant="link">
            <EditForm p={p} />
          </Drawer>
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
}: {
  clientId: string;
  clientName: string;
  sourceLabel: string;
  sourceDetails: string;
  note: string | null;
  droppedCount: number;
  proposals: ReviewProposal[];
}) {
  const pending = proposals.filter((p) => p.state === "PENDING");
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
      {note && <p className="mt-2 text-xs text-appNavy/60">{note}</p>}
      {droppedCount > 0 && (
        <p className="mt-2 text-xs text-warning">
          {droppedCount === 1 ? "פריט אחד לא נכנס להצעות" : `${droppedCount} פריטים לא נכנסו להצעות`} (סוד, ציטוט ממקור מוגבל או מבנה שגוי). מה שנדחה לא נשמר.
        </p>
      )}
      <ul className="mt-3 divide-y divide-lineDark">
        {proposals.map((p) => (
          <ProposalRow key={p.id} p={p} />
        ))}
      </ul>
    </section>
  );
}
