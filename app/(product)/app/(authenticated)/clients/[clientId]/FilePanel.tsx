"use client";
import { useState, useTransition } from "react";
import {
  addClientDocumentAction,
  approveSummaryAction,
  discardSummaryAction,
  generateSummaryAction,
  removeClientDocumentAction,
  setClientDocumentKindAction,
  setClientDocumentVisibilityAction,
} from "../actions";
import { useActionForm } from "@/components/app/useActionForm";
import { MessageClient, type ComposerProps } from "@/components/app/MessageClient";
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
    <section className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium text-app-text-primary">מסמכים</h2>
        <p className="text-[11.5px] text-app-text-tertiary">הלקוח מוריד אותם מהתיק שלו. אנחנו היחידים שמעלים.</p>
      </div>

      {documents.length > 0 && (
        <ul className="mt-4 divide-y divide-app-border">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3">
              <span className="text-sm text-app-text-primary">
                {d.title}
                <span className="text-app-text-secondary">
                  {" · "}
                  {/* 20.10.2026: the kind can be corrected after filing. A
                      procedure filed as "פוליסה" used to stay one. */}
                  <select
                    aria-label={`סוג המסמך: ${d.title}`}
                    value={d.kind}
                    disabled={busy}
                    onChange={(e) => {
                      const kind = e.target.value as ClientDocumentKind;
                      startTransition(async () => {
                        const res = await setClientDocumentKindAction(d.id, kind);
                        setRowError(res.ok ? null : res.error);
                      });
                    }}
                    className="cursor-pointer appearance-none bg-transparent text-app-text-secondary underline decoration-dotted underline-offset-2 outline-none hover:text-app-text-primary disabled:opacity-50"
                  >
                    {(Object.keys(DOCUMENT_KIND_LABELS) as ClientDocumentKind[]).map((k) => (
                      <option key={k} value={k}>
                        {DOCUMENT_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  {d.taskTitle ? ` · ${d.taskTitle}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2.5 text-[11.5px] text-app-text-tertiary">
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
                      ? "border-app-success/25 bg-app-success-soft text-app-success"
                      : "border-app-border bg-app-surface-sunken text-app-text-secondary"
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
                  className="text-app-text-tertiary hover:text-app-error"
                >
                  הסרה
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {rowError && <p className="mt-3 text-sm text-app-error">{rowError}</p>}

      {!storageReady && (
        <p className="mt-4 rounded-[10px] border border-gold/40 bg-app-surface-sunken px-3 py-2.5 text-[12.5px] text-app-text-secondary">
          אחסון המסמכים עדיין בפיתוח. הטופס למטה מוכן, ומה שנשאר הוא לפתוח את התיקייה המשותפת ולשתף אותה. עד אז אפשר
          לשלוח מסמך בוואטסאפ כרגיל.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <input type="hidden" name="clientId" value={clientId} />

        <label className="block sm:col-span-2">
          <span className="block text-xs font-medium text-app-text-secondary">שם המסמך</span>
          <input
            name="title"
            required
            placeholder="פוליסת רכב 2026"
            className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-app-text-secondary">סוג</span>
          <select
            name="kind"
            defaultValue="OTHER"
            className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          >
            {(Object.keys(DOCUMENT_KIND_LABELS) as ClientDocumentKind[]).map((k) => (
              <option key={k} value={k}>
                {DOCUMENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-app-text-secondary">קובץ (עד 4MB)</span>
          <input
            type="file"
            name="file"
            required
            className="mt-1.5 w-full rounded-lg border border-app-border bg-white px-3 py-1.5 text-xs text-app-text-primary outline-none file:me-2 file:rounded-full file:border-0 file:bg-app-surface-sunken file:px-3 file:py-1.5 file:text-xs"
          />
        </label>

        <div className="flex items-center gap-4 sm:col-span-4">
          <label className="flex items-center gap-2 text-sm text-app-text-primary">
            <input type="checkbox" name="clientVisible" defaultChecked className="h-4 w-4 rounded border-app-border" />
            הלקוח רואה את זה בתיק שלו
          </label>
          {error && <p className="text-sm text-app-error">{error}</p>}
          {ok && <p className="text-sm text-app-success">המסמך נוסף לתיק.</p>}
          <button
            type="submit"
            disabled={pending}
            className="ms-auto rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
          >
            {pending ? "מעלה..." : "צירוף מסמך"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function SummaryPanel({
  clientId,
  summaries,
  composer,
}: {
  clientId: string;
  summaries: SummaryRow[];
  composer: ComposerProps | null;
}) {
  const generate = useActionForm(generateSummaryAction);
  const latest = summaries[0];

  return (
    <section className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium text-app-text-primary">סיכום חודשי</h2>
        <p className="text-[11.5px] text-app-text-tertiary">נבנה מהרשומות. מגיע ללקוח רק אחרי שמישהו אישר.</p>
      </div>

      <form onSubmit={generate.onSubmit} className="mt-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="clientId" value={clientId} />
        <button
          type="submit"
          disabled={generate.pending}
          className="rounded-full border border-app-border px-4 py-2 text-[13px] text-app-text-primary hover:border-gold disabled:opacity-50"
        >
          {generate.pending ? "מפיק..." : "הפקת טיוטה לחודש הנוכחי"}
        </button>
        {generate.error && <p className="text-sm text-app-error">{generate.error}</p>}
      </form>

      {latest ? <SummaryEditor key={latest.id} summary={latest} clientId={clientId} composer={composer} /> : null}

      {summaries.length > 1 && (
        <ul className="mt-4 space-y-2 border-t border-app-border pt-4">
          {summaries.slice(1).map((s) => (
            <li key={s.id} className="text-[12.5px] text-app-text-secondary">
              <span className="font-medium text-app-text-secondary">{s.periodLabel}</span>
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
function SummaryEditor({
  summary,
  clientId,
  composer,
}: {
  summary: SummaryRow;
  clientId: string;
  composer: ComposerProps | null;
}) {
  const { onSubmit, pending, error, ok } = useActionForm(approveSummaryAction);
  const [busy, startTransition] = useTransition();
  const [discardError, setDiscardError] = useState<string | null>(null);

  return (
    <div className="mt-4 rounded-[14px] border border-app-border bg-app-surface-sunken p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium text-app-text-primary">{summary.periodLabel}</p>
        <p className="text-[11.5px] text-app-text-tertiary">
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
          className="w-full rounded-lg border border-app-border bg-white px-3 py-2.5 text-sm leading-relaxed text-app-text-primary outline-none focus:border-gold"
        />

        <div className="flex flex-wrap items-center gap-3">
          {error && <p className="text-sm text-app-error">{error}</p>}
          {discardError && <p className="text-sm text-app-error">{discardError}</p>}
          {ok && <p className="text-sm text-app-success">אושר. הלקוח יראה את זה בדוח החודשי.</p>}

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              startTransition(async () => {
                const res = await discardSummaryAction(summary.id);
                setDiscardError(res.ok ? null : res.error);
              })
            }
            className="text-[13px] text-app-text-secondary hover:text-app-error"
          >
            ביטול הטיוטה
          </button>

          {/* Only once it is published. Before that there is nothing to
              tell anybody about, and a button offering to announce a
              draft is a button offering to be wrong. */}
          {summary.status === "APPROVED" && composer && (
            <MessageClient
              clientId={clientId}
              buttonLabel="להודיע ללקוח"
              preselectKind="summary_ready"
              {...composer}
            />
          )}

          <button
            type="submit"
            disabled={pending}
            className="ms-auto rounded-full bg-app-accent px-5 py-2.5 text-sm font-medium text-app-text-primary disabled:opacity-50"
          >
            {/* Not "שליחה". Approving publishes the summary to the
                portal; nothing leaves the building. The button beside
                this one is how a client finds out. */}
            {pending ? "מאשר..." : summary.status === "APPROVED" ? "שמירה ואישור מחדש" : "אישור ופרסום בפורטל"}
          </button>
        </div>
      </form>
    </div>
  );
}
