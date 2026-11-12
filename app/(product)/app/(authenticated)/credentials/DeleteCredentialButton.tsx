"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { deleteCredentialAction } from "./actions";
import { useHideRow } from "./CredentialRowShell";

// Two steps on the row itself rather than a browser confirm(): deleting
// removes the secret for good, so it deserves a second look, and a modal
// dialog would block the browser test harness.
export function DeleteCredentialButton({ id, systemName }: { id: string; systemName: string }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hideRow = useHideRow();
  const t = useTranslations("credentials.delete");

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-xs text-app-text-tertiary hover:text-app-error">
        {t("delete")}
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-app-text-secondary">{t("confirm", { system: systemName })}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await deleteCredentialAction(id);
            if (r.error) setError(r.error);
            else hideRow();
          })
        }
        className="font-medium text-app-error"
      >
        {pending ? t("deleting") : t("confirmButton")}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="text-app-text-secondary">
        {t("cancel")}
      </button>
      {error && <span className="text-app-error">{error}</span>}
    </span>
  );
}
