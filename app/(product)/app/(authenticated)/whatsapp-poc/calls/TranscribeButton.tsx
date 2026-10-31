"use client";
import { useActionState } from "react";
import { transcribeRecordingAction, type TranscribeState } from "./actions";

export function TranscribeButton({ emailId, attachmentId }: { emailId: string; attachmentId: string }) {
  const [state, action, pending] = useActionState<TranscribeState | undefined, FormData>(transcribeRecordingAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="emailId" value={emailId} />
      <input type="hidden" name="attachmentId" value={attachmentId} />
      {!state?.text ? (
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg border border-app-border-strong px-4 text-sm text-app-text-primary disabled:opacity-60"
        >
          {pending ? "מתמלל... (עד דקה)" : "תמלול"}
        </button>
      ) : null}
      {state?.error ? (
        <p role="alert" className="text-sm text-app-error">
          {state.error}
        </p>
      ) : null}
      {state?.text ? (
        <p className="whitespace-pre-wrap rounded-lg bg-app-surface-sunken p-3 text-sm text-app-text-primary">{state.text}</p>
      ) : null}
    </form>
  );
}
