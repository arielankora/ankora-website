"use client";
import { useMemo, useState } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { whatsappHref } from "@/lib/whatsapp";

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
export function TaskShare({
  task,
  url,
  people,
  defaultRecipientId,
  onDone,
}: {
  task: { title: string; clientName: string; statusLabel: string; dueDate: string | null; priorityLabel: string | null };
  url: string;
  people: SharePerson[];
  defaultRecipientId: string | null;
  onDone: () => void;
}) {
  const [recipientId, setRecipientId] = useState(defaultRecipientId ?? "");
  const [note, setNote] = useState("");
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

  const mailHref = `mailto:${recipient ? encodeURIComponent(recipient.email) : ""}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
  // wa.me with no number opens WhatsApp's contact picker with the text.
  const waHref = recipient
    ? whatsappHref(recipient.whatsappNumber, body)
    : `https://wa.me/?text=${encodeURIComponent(body)}`;

  return (
    <div data-testid="task-share" className="mt-4 rounded-xl border border-app-border bg-app-surface-sunken p-4">
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="block min-w-0" style={{ flex: "0 1 220px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">למי</span>
          <select
            aria-label="למי"
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className={FIELD}
          >
            <option value="">בלי נמען (אבחר בעצמי)</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0" style={{ flex: "1 1 260px" }}>
          <span className="mb-1.5 block text-[11px] text-app-text-secondary">הערה (לא חובה)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="למשל: העברתי אלייך, הלקוח מחכה לתשובה עד יום חמישי"
            className={FIELD}
          />
        </label>
        <div className="flex shrink-0 items-center gap-2" style={{ marginInlineStart: "auto" }}>
          <button
            type="button"
            onClick={onDone}
            className="rounded-full px-3 py-2.5 text-sm text-app-text-secondary hover:text-app-text-primary"
          >
            סגירה
          </button>
          <a
            href={mailHref}
            data-testid="task-share-mail"
            className="flex items-center gap-1.5 rounded-full border border-app-surface-nav bg-white px-4 py-2.5 text-sm font-medium text-app-text-primary"
          >
            <Mail size={15} />
            מייל
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
              וואטסאפ
            </a>
          ) : (
            <span
              aria-disabled="true"
              className="flex cursor-not-allowed items-center gap-1.5 rounded-full bg-app-neutral-soft px-4 py-2.5 text-sm font-medium text-app-text-tertiary"
            >
              <MessageCircle size={15} />
              וואטסאפ
            </span>
          )}
        </div>
      </div>
      {recipient && !waHref && (
        <p data-testid="task-share-no-whatsapp" className="mt-3 text-[12.5px] text-app-text-secondary">
          ל{recipient.name} אין מספר וואטסאפ בפרופיל. אפשר לשלוח במייל, או לבחור &quot;בלי נמען&quot; ולבחור איש קשר
          בוואטסאפ עצמו. כל אחד מוסיף את המספר שלו במסך הפרופיל.
        </p>
      )}
    </div>
  );
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}
