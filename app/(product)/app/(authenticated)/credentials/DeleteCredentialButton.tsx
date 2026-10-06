"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCredentialAction } from "./actions";

// Two steps on the row itself rather than a browser confirm(): deleting
// removes the secret for good, so it deserves a second look, and a modal
// dialog would block the browser test harness.
export function DeleteCredentialButton({ id, systemName }: { id: string; systemName: string }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-xs text-appNavy/50 hover:text-error">
        מחיקה
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-appNavy/70">למחוק את הגישה ל{systemName}? הסיסמה תימחק לצמיתות.</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await deleteCredentialAction(id);
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
        className="font-medium text-error"
      >
        {pending ? "נמחק..." : "למחוק"}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="text-appNavy/60">
        ביטול
      </button>
      {error && <span className="text-error">{error}</span>}
    </span>
  );
}
