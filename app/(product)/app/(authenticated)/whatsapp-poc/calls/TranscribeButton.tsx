"use client";
import { useActionState, useState } from "react";
import { transcribeRecordingAction, transcribeVoiceNoteAction, type TranscribeState } from "./actions";

// One button for both kinds of audio: a call recording (by email id) and a
// WhatsApp voice message (by chat and message id). Once there is a text,
// it can be hidden and shown again, and copied (to paste into a task).
type Target = { kind: "recording"; emailId: string } | { kind: "voice"; chatId: string; messageId: string; numberKey: string };

/// A transcript with "hide" and "copy". Used for a stored transcript too
/// (1.11.2026: recordings are transcribed on arrival, no button needed).
export function TranscriptText({ text }: { text: string }) {
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Older Safari, or a page without clipboard permission: the old way.
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      ok = document.execCommand("copy");
      area.remove();
    }
    setCopied(ok);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={() => setHidden((h) => !h)} className="min-h-11 text-app-text-primary underline">
          {hidden ? "הצגת התמלול" : "הסתרת התמלול"}
        </button>
        <button type="button" onClick={copy} className="min-h-11 text-app-text-primary underline">
          העתקת התמלול
        </button>
        <span role="status" className="inline-flex min-h-11 items-center text-app-success">
          {copied ? "התמלול הועתק" : ""}
        </span>
      </div>
      {!hidden ? (
        <p className="whitespace-pre-wrap rounded-lg bg-app-surface-sunken p-3 text-sm leading-relaxed text-app-text-primary">{text}</p>
      ) : null}
    </div>
  );
}

export function TranscribeButton(props: Target & { label?: string }) {
  const serverAction = props.kind === "recording" ? transcribeRecordingAction : transcribeVoiceNoteAction;
  const [state, action, pending] = useActionState<TranscribeState | undefined, FormData>(serverAction, undefined);

  if (state?.text) return <TranscriptText text={state.text} />;
  return (
    <form action={action} className="space-y-2">
      {props.kind === "recording" ? (
        <input type="hidden" name="emailId" value={props.emailId} />
      ) : (
        <>
          <input type="hidden" name="chatId" value={props.chatId} />
          <input type="hidden" name="messageId" value={props.messageId} />
          <input type="hidden" name="numberKey" value={props.numberKey} />
        </>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm text-app-text-primary disabled:opacity-60"
      >
        {pending ? "מתמלל... (עד דקה)" : (props.label ?? "תמלול")}
      </button>
      {state?.error ? (
        <p role="alert" className="text-sm text-app-error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
