"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { MAX_PORTAL_NOTE_LENGTH } from "@/lib/task-portal-note-text";
import { addTaskPortalNoteAction, removeTaskPortalNoteAction } from "./actions";

/// 4.11.2026: the lines the client reads under this task on their portal,
/// such as who was booked and when. Shown only on a task visible to the
/// client. Each line is written by hand and leaves the portal at once when
/// removed.
export function PortalNotesPanel(props: { taskId: string; notes: Array<{ id: string; body: string; mine: boolean }>; canRemoveAny: boolean }) {
  const t = useTranslations("tasks.detail.portalNotes");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      setError(null);
      const res = await addTaskPortalNoteAction({ taskId: props.taskId, body: text });
      if (res.ok) setText("");
      else setError(res.error);
    });
  const remove = (noteId: string) =>
    start(async () => {
      setError(null);
      const res = await removeTaskPortalNoteAction({ taskId: props.taskId, noteId });
      if (!res.ok) setError(res.error);
    });

  return (
    <section aria-labelledby="portal-notes-title" className="space-y-3 rounded-2xl border border-app-border bg-white p-4">
      <div className="space-y-0.5">
        <h2 id="portal-notes-title" className="text-sm font-medium text-app-text-primary">
          {t("title")}
        </h2>
        <p className="text-xs text-app-text-secondary">{t("hint")}</p>
      </div>
      {props.notes.length > 0 ? (
        <ul className="divide-y divide-app-border text-sm">
          {props.notes.map((n) => (
            <li key={n.id} className="flex min-h-11 items-center justify-between gap-3">
              <span dir="auto" className="min-w-0 break-words text-app-text-primary">{n.body}</span>
              {n.mine || props.canRemoveAny ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(n.id)}
                  className="min-h-11 flex-none px-2 text-xs text-app-text-secondary underline disabled:opacity-50"
                >
                  {t("remove")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-app-text-secondary">{t("empty")}</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs font-medium text-app-text-secondary">
          {t("newLine")}
          <input
            dir="auto"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_PORTAL_NOTE_LENGTH}
            placeholder={t("placeholder")}
            className="mt-1 w-full rounded-lg border border-app-border-strong bg-white px-3 py-2 text-sm text-app-text-primary outline-none focus:border-gold"
          />
        </label>
        <button
          type="button"
          disabled={pending || !text.trim()}
          onClick={add}
          className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {t("add")}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-app-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
