"use client";
import { useActionState } from "react";
import { transcribeRecordingAction, transcribeVoiceNoteAction, type TranscribeState } from "./actions";

// One button for both kinds of audio: a call recording (by email id) and a
// WhatsApp voice message (by chat and message id).
type Target = { kind: "recording"; emailId: string } | { kind: "voice"; chatId: string; messageId: string };

export function TranscribeButton(props: Target) {
  const serverAction = props.kind === "recording" ? transcribeRecordingAction : transcribeVoiceNoteAction;
  const [state, action, pending] = useActionState<TranscribeState | undefined, FormData>(serverAction, undefined);
  return (
    <form action={action} className="space-y-2">
      {props.kind === "recording" ? (
        <input type="hidden" name="emailId" value={props.emailId} />
      ) : (
        <>
          <input type="hidden" name="chatId" value={props.chatId} />
          <input type="hidden" name="messageId" value={props.messageId} />
        </>
      )}
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
