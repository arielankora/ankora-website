"use client";
import { useState, useTransition } from "react";
import {
  addClientDocumentAction,
  approveSummaryAction,
  discardSummaryAction,
  generateSummaryAction,
  removeClientDocumentAction,
  setClientDocumentVisibilityAction,
} from "../actions";
import { useActionForm } from "@/components/app/useActionForm";
import { DOCUMENT_KIND_LABELS } from "@/lib/app-domain/portal-labels";
import type { ClientDocumentKind } from "@prisma/client";

// Portal phase 3, the staff side of the client's file.
//
// Two panels rather than four: preferences are edited in the client form
// above this, and recurring dates already have a screen of their own -
// what is new here is the paperwork and the summary, and both are things
// somebody does WHILE working rather than as an errand of their own.

export interface DocumentRow {
  id: string;
  title: string;
  kind: ClientDocumentKind;
  clientVisible: boolean;
  sizeBytes: number | null;
  createdAt: string;
  uploadedByName: string | null;
  taskTitle: string | null;
}

export interface SummaryRow {
  id: string;
  periodLabel: string;
  draft: string;
  status: "DRAFT" | "APPROVED" | "DISCARDED";
  approvedByName: string | null;
  approvedAt: string | null;
  sourceCount: number;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsPanel({
  clientId,
  documents,
  storageReady,
}: {
  clientId: string;
  documents: DocumentRow[];
  /// False until the Drive folder for client documents exists and is
  /// shared with the service account. The form is built either way and
  /// says so, per the spec's rule for a capability waiting on something
  /// outside the code.
  storageReady: boolean;
}) {
  const { onSubmit, pending, error, ok } = useActionForm(addClientDocumentAction);
  const [busy, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium text-appNavy">מסמכים</h2>
        <p className="text-[11.5px] text-appNavy/50">הלקוח מוריד אותם מהתיק שלו. אנחנו היחידים שמעלים.</p>
      </div>

      {documents.length > 0 && (
        <ul className="mt-4 divide-y divide-lineDark/60">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3">
              <span className="text-sm text-appNavy">
                {d.title}
                <span className="text-appNavy/55">
                  {" · "}
                  {DOCUMENT_KIND_LABELS[d.kind]}
                  {d.taskTitle ? ` · ${d.taskTitle}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2.5 text-[11.5px] text-appNavy/50">
                {d.uploadedByName && <span>{d.uploadedByName}</span>}
                <span dir="ltr" className="font-jbmono">
                  {formatSize(d.sizeBytes)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await setClientDocumentVisibilityAction(d.id, !d.clientVisible);
                      setRowError(res.ok ? null : res.error);
                    })
                  }
                  className={`rounded-full border px-2.5 py-1 ${
                    d.clientVisible
                      ? "border-success/25 bg-success-soft text-success"
                      : "border-lineDark bg-appNavy/5 text-appNavy/60"
                  }`}
                >
                  {d.clientVisible ? "הלקוח רואה" : "מוסתר"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await removeClientDocumentAction(d.id);
                      setRowError(res.ok ? null : res.error);
                    })
                  }
                  className="text-appNavy/45 hover:text-error"
                >
                  הסרה
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {rowError && <p className="mt-3 text-sm text-error">{rowError}</p>}

      {!storageReady && (
        <p className="mt-4 rounded-[10px] border border-gold/40 bg-[#FBF7F0] px-3 py-2.5 text-[12.5px] text-appNavy/70">
          אחסון המסמכים עדיין בפיתוח. הטופס למטה מוכן, ומה שנשאר הוא לפתוח את התיקייה המשותפת ולשתף אותה. עד אז אפשר
          לשלוח מסמך בוואטסאפ כרגיל.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <input type="hidden" name="clientId" value={clientId} />

        <label className="block sm:col-span-2">
          <span className="block text-xs font-medium text-appNavy/60">שם המסמך</span>
          <input
            name="title"
            required
            placeholder="פוליסת רכב 2026"
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-appNavy/60">סוג</span>
          <select
            name="kind"
            defaultValue="OTHER"
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-appNavy outline-none focus:border-gold"
          >
            {(Object.keys(DOCUMENT_KIND_LABELS) as ClientDocumentKind[]).map((k) => (
              <option key={k} value={k}>
                {DOCUMENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-appNavy/60">קובץ (עד 4MB)</span>
          <input
            type="file"
            name="file"
            required
            className="mt-1.5 w-full rounded-lg border border-lineDark bg-white px-3 py-1.5 text-xs text-appNavy outline-none file:me-2 file:rounded-full file:border-0 file:bg-appNavy/5 file:px-3 file:py-1.5 file:text-xs"
          />
        </label>

        <div className="flex items-center gap-4 sm:col-span-4">
          <label className="flex items-center gap-2 text-sm text-appNavy">
            <input type="checkbox" name="clientVisible" defaultChecked className="h-4 w-4 rounded border-lineDark" />
            הלקוח רואה את זה בתיק שלו
          </label>
          {error && <p className="text-sm text-error">{error}</p>}
          {ok && <p className="text-sm text-success">המסמך נוסף לתיק.</p>}
          <button
            type="submit"
            disabled={pending}
            className="ms-auto rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
          >
            {pending ? "מעלה..." : "צירוף מסמך"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function SummaryPanel({ clientId, summaries }: { clientId: string; summaries: SummaryRow[] }) {
  const generate = useActionForm(generateSummaryAction);
  const latest = summaries[0];

  return (
    <section className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium text-appNavy">סיכום חודשי</h2>
        <p className="text-[11.5px] text-appNavy/50">נבנה מהרשומות. מגיע ללקוח רק אחרי שמישהו אישר.</p>
      </div>

      <form onSubmit={generate.onSubmit} className="mt-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="clientId" value={clientId} />
        <button
          type="submit"
          disabled={generate.pending}
          className="rounded-full border border-lineDark px-4 py-2 text-[13px] text-appNavy hover:border-gold disabled:opacity-50"
        >
          {generate.pending ? "מפיק..." : "הפקת טיוטה לחודש הנוכחי"}
        </button>
        {generate.error && <p className="text-sm text-error">{generate.error}</p>}
      </form>

      {latest ? <SummaryEditor key={latest.id} summary={latest} /> : null}

      {summaries.length > 1 && (
        <ul className="mt-4 space-y-2 border-t border-lineDark pt-4">
          {summaries.slice(1).map((s) => (
            <li key={s.id} className="text-[12.5px] text-appNavy/60">
              <span className="font-medium text-appNavy/75">{s.periodLabel}</span>
              {" · "}
              {s.status === "APPROVED"
                ? `אושר על ידי ${s.approvedByName ?? "מנהל התיק"}`
                : s.status === "DISCARDED"
                  ? "בוטל"
                  : "טיוטה"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/// The draft, editable, with the approval beside it.
///
/// The text in the box is what gets approved. A "generate then approve"
/// flow that discards the approver's edits would be asking someone to put
/// their name to something they were not allowed to change.
function SummaryEditor({ summary }: { summary: SummaryRow }) {
  const { onSubmit, pending, error, ok } = useActionForm(approveSummaryAction);
  const [busy, startTransition] = useTransition();
  const [discardError, setDiscardError] = useState<string | null>(null);

  return (
    <div className="mt-4 rounded-[14px] border border-lineDark bg-appNavy/[0.03] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-appNavy">{summary.periodLabel}</p>
        <p className="text-[11.5px] text-appNavy/50">
          {summary.status === "APPROVED"
            ? `אושר על ידי ${summary.approvedByName ?? "מנהל התיק"}`
            : summary.status === "DISCARDED"
              ? "בוטל, לא יגיע ללקוח"
              : `טיוטה, נבנתה מ-${summary.sourceCount} רשומות`}
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <input type="hidden" name="summaryId" value={summary.id} />
        <textarea
          name="draft"
          rows={4}
          defaultValue={summary.draft}
          className="w-full rounded-lg border border-lineDark bg-white px-3 py-2.5 text-sm leading-relaxed text-appNavy outline-none focus:border-gold"
        />

        <div className="flex flex-wrap items-center gap-3">
          {error && <p className="text-sm text-error">{error}</p>}
          {discardError && <p className="text-sm text-error">{discardError}</p>}
          {ok && <p className="text-sm text-success">אושר. הלקוח יראה את זה בדוח החודשי.</p>}

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              startTransition(async () => {
                const res = await discardSummaryAction(summary.id);
                setDiscardError(res.ok ? null : res.error);
              })
            }
            className="text-[13px] text-appNavy/55 hover:text-error"
          >
            ביטול הטיוטה
          </button>

          <button
            type="submit"
            disabled={pending}
            className="ms-auto rounded-full bg-gold-gradient px-5 py-2.5 text-sm font-medium text-navy disabled:opacity-50"
          >
            {pending ? "מאשר..." : summary.status === "APPROVED" ? "שמירה ואישור מחדש" : "אישור ושליחה ללקוח"}
          </button>
        </div>
      </form>
    </div>
  );
}
