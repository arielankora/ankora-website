"use client";
import { useState, useTransition } from "react";
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

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-xs text-app-text-tertiary hover:text-app-error">
        מחיקה
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-app-text-secondary">למחוק את הגישה ל{systemName}? הסיסמה תימחק לצמיתות.</span>
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
        {pending ? "נמחק..." : "למחוק"}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="text-app-text-secondary">
        ביטול
      </button>
      {error && <span className="text-app-error">{error}</span>}
    </span>
  );
}
