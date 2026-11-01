"use client";
import { useActionState, useState } from "react";
import { transcribeRecordingAction, transcribeVoiceNoteAction, type TranscribeState } from "./actions";

// One button for both kinds of audio: a call recording (by email id) and a
// WhatsApp voice message (by chat and message id). Once there is a text,
// it can be hidden and shown again, and copied (to paste into a task).
type Target = { kind: "recording"; emailId: string } | { kind: "voice"; chatId: string; messageId: string };

export function TranscribeButton(props: Target) {
  const serverAction = props.kind === "recording" ? transcribeRecordingAction : transcribeVoiceNoteAction;
  const [state, action, pending] = useActionState<TranscribeState | undefined, FormData>(serverAction, undefined);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

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
          className="min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm text-app-text-primary disabled:opacity-60"
        >
          {pending ? "מתמלל... (עד דקה)" : "תמלול"}
        </button>
      ) : (
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" onClick={() => setHidden((h) => !h)} className="min-h-11 text-app-text-primary underline">
            {hidden ? "הצגת התמלול" : "הסתרת התמלול"}
          </button>
          <button type="button" onClick={() => copy(state.text ?? "")} className="min-h-11 text-app-text-primary underline">
            {copied ? "הועתק" : "העתקת התמלול"}
          </button>
        </div>
      )}
      {state?.error ? (
        <p role="alert" className="text-sm text-app-error">
          {state.error}
        </p>
      ) : null}
      {state?.text && !hidden ? (
        <p className="whitespace-pre-wrap rounded-lg bg-app-surface-sunken p-3 text-sm leading-relaxed text-app-text-primary">{state.text}</p>
      ) : null}
    </form>
  );
}
