"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { dismissPdfUploadAction, recordPdfUploadAction } from "../actions";

// 5.11.2026: the approvals screen's "לבדיקה" row for a signed PDF links to
// this page, and the page used to have nothing on it about the upload. An
// admin landed among role, permissions and the deletion declaration and
// had to guess. This card sits first, says what to check, and records or
// returns the file here. Claude can still do the same through the tools.

export interface PendingPdf {
  documentId: string;
  kindLabel: string;
  code: string;
  uploadedOn: string; // YYYY-MM-DD, Israel date
  uploadedLabel: string;
  fileUrl: string | null;
}

function Submit({ children, pendingText, primary }: { children: string; pendingText: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        primary
          ? "min-h-[44px] rounded-full bg-app-accent px-5 py-2 text-sm font-medium text-app-text-primary disabled:opacity-50"
          : "min-h-[44px] rounded-full border border-app-border px-4 py-2 text-sm text-app-text-secondary hover:border-app-error hover:text-app-error disabled:opacity-50"
      }
    >
      {pending ? pendingText : children}
    </button>
  );
}

function PendingPdfItem({ userId, userName, item }: { userId: string; userName: string; item: PendingPdf }) {
  const [recordState, recordAction] = useFormState(recordPdfUploadAction, {});
  const [dismissState, dismissAction] = useFormState(dismissPdfUploadAction, {});
  const [returning, setReturning] = useState(false);
  const t = useTranslations("users.pendingPdf");

  if (recordState.ok) return <p className="text-sm text-app-success">{t("recorded")}</p>;
  if (dismissState.ok) return <p className="text-sm text-app-success">{t("returned")}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-app-text-primary">
        {t("uploaded", { date: item.uploadedLabel, kind: item.kindLabel, name: userName })}
        {item.fileUrl && (
          <>
            {" "}
            <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="text-app-text-accent underline underline-offset-2 hover:text-app-text-primary">
              {t("openFile")}
            </a>
          </>
        )}
      </p>

      <div>
        <p className="text-xs font-medium text-app-text-primary">{t("whatToCheck")}</p>
        <ul className="mt-1 list-disc space-y-0.5 ps-5 text-xs text-app-text-secondary">
          <li>
            {t.rich("checkCode", {
              code: item.code,
              mono: (chunks) => (
                <span dir="ltr" className="font-jbmono">
                  {chunks}
                </span>
              ),
            })}
          </li>
          <li>{t("checkSignature")}</li>
        </ul>
      </div>

      <form action={recordAction} className="space-y-3">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="documentId" value={item.documentId} />
        <div className="flex flex-wrap gap-3">
          <label className="block min-w-[200px] flex-1">
            <span className="mb-1.5 block text-xs text-app-text-secondary">{t("signedName")}</span>
            <input
              name="signedName"
              required
              dir="auto"
              className="w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-app-text-secondary">{t("signedAt")}</span>
            <input
              name="signedAt"
              type="date"
              required
              defaultValue={item.uploadedOn}
              className="rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-app-text-secondary">
          <input type="checkbox" name="checked" required className="h-4 w-4 accent-gold" />
          {t("checkedConfirm")}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Submit primary pendingText={t("recording")}>
            {t("record")}
          </Submit>
          {!returning && (
            <button type="button" onClick={() => setReturning(true)} className="min-h-[44px] text-sm text-app-text-secondary hover:text-app-text-primary">
              {t("returnPrompt")}
            </button>
          )}
        </div>
        {recordState.error && <p className="text-sm text-app-error">{recordState.error}</p>}
      </form>

      {returning && (
        <form action={dismissAction} className="space-y-3 border-t border-app-border pt-4">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="documentId" value={item.documentId} />
          <label className="block">
            <span className="mb-1.5 block text-xs text-app-text-secondary">{t("reasonLabel")}</span>
            <input
              name="reason"
              required
              dir="auto"
              placeholder={t("reasonPlaceholder")}
              className="w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Submit pendingText={t("returning")}>{t("returnSubmit")}</Submit>
            <button type="button" onClick={() => setReturning(false)} className="min-h-[44px] text-sm text-app-text-secondary hover:text-app-text-primary">
              {t("cancel")}
            </button>
          </div>
          {dismissState.error && <p className="text-sm text-app-error">{dismissState.error}</p>}
        </form>
      )}
    </div>
  );
}

export function PendingPdfReview({ userId, userName, items }: { userId: string; userName: string; items: PendingPdf[] }) {
  const t = useTranslations("users.pendingPdf");
  return (
    <section className="rounded-2xl border border-gold/40 bg-gold/[0.04] p-6" data-testid="pending-pdf-review">
      <h2 className="text-sm font-medium text-app-text-primary">{t("title")}</h2>
      <p className="mt-1 text-xs text-app-text-secondary">
        {t("intro")}
      </p>
      <div className="mt-4 space-y-6">
        {items.map((item) => (
          <PendingPdfItem key={item.documentId} userId={userId} userName={userName} item={item} />
        ))}
      </div>
    </section>
  );
}
