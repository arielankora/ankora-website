"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Mail, MessageCircle } from "lucide-react";
import { whatsappHref } from "@/lib/whatsapp";
import type { TaskPriority, TaskStatus } from "@prisma/client";

// ADR 0006: the message itself (subject, body, these labels, the date) is
// content for a colleague, written in Hebrew whatever the sharer's
// interface language. Only the panel around it is translated.
export const MESSAGE_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "פתוחה",
  IN_PROGRESS: "בביצוע",
  PENDING_APPROVAL: "ממתינה לאישור",
  DONE: "הושלמה",
  ARCHIVED: "בארכיון",
};

export const MESSAGE_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "נמוכה",
  NORMAL: "רגילה",
  HIGH: "גבוהה",
  URGENT: "דחופה",
};

export type SharePerson = { id: string; name: string; email: string; whatsappNumber: string | null };

const FIELD =
  "w-full rounded-[9px] border border-app-border-strong bg-white px-2.5 py-2.5 text-[13px] text-app-text-primary outline-none focus:border-gold";

// 28.10.2026: "שיתוף" on a task. A task handed to Hadas is one she should
// hear about from the person who handed it, in their words.
//
// Nothing is sent from here. Like the client message button, it opens a
// draft in the person's own mail or WhatsApp with the task's details and
// its link, and they press send. That needs no mail server and no
// WhatsApp API, and the message comes from them, not from the system.
//
// The recipient starts as the task's assignee unless that is the person
// sharing. A colleague with no WhatsApp number on their profile cannot be
// reached that way, and the panel says so instead of offering a link to
// nobody. "בלי נמען" opens WhatsApp's own contact picker, or a mail with
// an empty "to".
//
// 31.10.2026: the mail button was a bare mailto: link. In a browser with
// no mail app set up to handle mailto the click did nothing and said
// nothing. Everyone on the team works in Gmail in the browser, so the
// button opens a Gmail draft in a new tab, with authuser set to the
// sharer's own address: a browser signed in to a private Google account
// as well would otherwise open the draft there. No mailto: fallback, since
// nobody uses a mail app. "העתקת ההודעה" covers a blocked tab, and after
// either action a line says what happened.
export function TaskShare({
  task,
  url,
  people,
  defaultRecipientId,
  senderEmail = null,
  onDone,
}: {
  task: { title: string; clientName: string; statusLabel: string; dueDate: string | null; priorityLabel: string | null };
  url: string;
  people: SharePerson[];
  defaultRecipientId: string | null;
  /// The sharer's work address, so the draft opens in that Google account.
  senderEmail?: string | null;
  onDone: () => void;
}) {
  const t = useTranslations("tasks.detail.share");
  const [recipientId, setRecipientId] = useState(defaultRecipientId ?? "");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<"gmail" | "copied" | "copy-failed" | null>(null);
  const recipient = people.find((p) => p.id === recipientId) ?? null;

  const subject = `משימה: ${task.title} (${task.clientName})`;
  const body = useMemo(() => {
    const lines: string[] = [];
    if (recipient) lines.push(`היי ${recipient.name.split(" ")[0]},`, "");
    if (note.trim()) lines.push(note.trim(), "");
    lines.push(`משימה: ${task.title}`, `לקוח: ${task.clientName}`, `סטטוס: ${task.statusLabel}`);
    if (task.priorityLabel) lines.push(`עדיפות: ${task.priorityLabel}`);
    if (task.dueDate) lines.push(`תאריך יעד: ${formatDay(task.dueDate)}`);
    lines.push("", `לפתיחת המשימה: ${url}`);
    return lines.join("\n");
  }, [recipient, note, task, url]);

  // encodeURIComponent, not URLSearchParams: the latter writes spaces as
  // "+", and a "+" in the note must stay a "+".
  const gmailQuery: [string, string][] = [
    ...(senderEmail ? [["authuser", senderEmail] as [string, string]] : []),
    ["view", "cm"],
    ["fs", "1"],
    ["to", recipient?.email ?? ""],
    ["su", subject],
    ["body", body],
  ];
  const gmailHref = `https://mail.google.com/mail/?${gmailQuery
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")}`;
  // wa.me with no number opens WhatsApp's contact picker with the text.
  const waHref = recipient
    ? whatsappHref(recipient.whatsappNumber, body)
    : `https://wa.me/?text=${encodeURIComponent(body)}`;

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setFeedback("copied");
    } catch {
      setFeedback("copy-failed");
    }
  }

  return (
    <div data-testid="task-share" className="mt-4 rounded-xl border border-app-border bg-app-surface-sunken p-4">
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="block min-w-0" style={{ flex: "0 1 220px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">{t("recipient")}</span>
          <select
            aria-label={t("recipient")}
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className={FIELD}
          >
            <option value="">{t("noRecipient")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0" style={{ flex: "1 1 260px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">{t("note")}</span>
          <input
            dir="auto"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            className={FIELD}
          />
        </label>
        <div className="flex shrink-0 items-center gap-2" style={{ marginInlineStart: "auto" }}>
          <button
            type="button"
            onClick={onDone}
            className="rounded-full px-3 py-2.5 text-sm text-app-text-secondary hover:text-app-text-primary"
          >
            {t("close")}
          </button>
          <a
            href={gmailHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setFeedback("gmail")}
            data-testid="task-share-mail"
            className="flex items-center gap-1.5 rounded-full border border-app-surface-nav bg-white px-4 py-2.5 text-sm font-medium text-app-text-primary"
          >
            <Mail size={15} />
            {t("gmail")}
          </a>
          {waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="task-share-whatsapp"
              className="flex items-center gap-1.5 rounded-full bg-app-accent px-4 py-2.5 text-sm font-medium text-app-text-primary"
            >
              <MessageCircle size={15} />
              {t("whatsapp")}
            </a>
          ) : (
            <span
              aria-disabled="true"
              className="flex cursor-not-allowed items-center gap-1.5 rounded-full bg-app-neutral-soft px-4 py-2.5 text-sm font-medium text-app-text-tertiary"
            >
              <MessageCircle size={15} />
              {t("whatsapp")}
            </span>
          )}
        </div>
      </div>
      {recipient && !waHref && (
        <p data-testid="task-share-no-whatsapp" className="mt-3 text-[12.5px] text-app-text-secondary">
          {t("noWhatsapp", { name: recipient.name })}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-app-text-secondary">
        <button
          type="button"
          onClick={copyMessage}
          data-testid="task-share-copy"
          className="flex items-center gap-1 underline underline-offset-2 hover:text-app-text-primary"
        >
          {feedback === "copied" ? <Check size={13} /> : <Copy size={13} />}
          {t("copy")}
        </button>
      </div>
      {feedback && (
        <p role="status" data-testid="task-share-feedback" className="mt-2 text-[12.5px] text-app-text-primary">
          {t(FEEDBACK_KEY[feedback])}
        </p>
      )}
      {feedback === "gmail" && (
        // 1.11.2026: Gmail fills the body from the link as plain text and
        // takes no direction from it, so Hebrew lands left-aligned. Nothing
        // in the link can change that; the fix is one click inside Gmail.
        <div data-testid="task-share-rtl-hint" className="mt-2 text-[12px] leading-relaxed text-app-text-secondary">
          <p>{t("rtlHint")}</p>
          <p className="mt-1">{t("rtlSetting")}</p>
        </div>
      )}
    </div>
  );
}

const FEEDBACK_KEY = {
  gmail: "feedback.gmail",
  copied: "feedback.copied",
  "copy-failed": "feedback.copyFailed",
} as const;

// Hebrew on purpose: part of the message, not of the interface.
function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}
