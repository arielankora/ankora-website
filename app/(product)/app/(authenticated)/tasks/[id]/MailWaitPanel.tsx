"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Bell, Mail } from "lucide-react";
import { useToast } from "@/components/app/toast/ToastProvider";
import { rescheduleMailAction, sendReminderAction, stopMailAction } from "./mail-actions";

// Stage 2 of "התיבות שלי" (27.11.2026): the email part of "ממתינים למשהו?"
// on the task screen. The picker sits in the marking form; the status shows
// what the task waits for, the overdue box with its three buttons, the
// reminder composer, and "הגיעה תשובה".

export type MailCandidate = { threadId: string; mailbox: string; sentTo: string[]; sentAt: string };
export type MailWaitInfo = {
  state: "waiting" | "overdue" | "replied" | "stopped";
  sentTo: string[];
  sentAt: string;
  mailbox: string | null;
  remindAt: string | null;
  replyAt: string | null;
  replyFrom: string | null;
  via: "MANUAL" | "CLAUDE";
  mine: boolean;
};

const field = "mt-1 block min-h-11 rounded-lg border border-app-border-strong px-2 text-[13px] text-app-text-primary";

function useWhen() {
  const format = useFormatter();
  return {
    when: (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }),
    day: (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "numeric" }),
  };
}

/// The list in the marking form. `value` is the thread picked, or "".
export function MailPicker({
  candidates,
  suggested,
  value,
  onChange,
  remindAt,
  onRemindAt,
  disabled,
}: {
  candidates: MailCandidate[];
  suggested: string | null;
  value: string;
  onChange: (threadId: string) => void;
  remindAt: string;
  onRemindAt: (v: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations("tasks.detail.mail");
  const { when } = useWhen();
  if (!candidates.length) return null;
  return (
    <fieldset className="space-y-2 rounded-xl border border-app-border p-3">
      <legend className="flex items-center gap-2 px-1 text-[13px] font-medium text-app-text-primary">
        <Mail size={15} aria-hidden />
        {t("heading")}
      </legend>
      <p className="text-[12px] text-app-text-secondary">{t("hint")}</p>
      {candidates.map((c) => (
        <label key={c.threadId} className="flex min-h-11 items-start gap-2 text-[13px] text-app-text-primary">
          <input type="radio" name="mail-wait" className="mt-1" checked={value === c.threadId} disabled={disabled} onChange={() => onChange(c.threadId)} />
          <span>
            {t.rich("row", {
              to: () => <bdi dir="ltr">{c.sentTo.join(", ")}</bdi>,
              when: () => when(c.sentAt),
              mailbox: () => <bdi dir="ltr">{c.mailbox}</bdi>,
            })}
            {c.threadId === suggested && <span className="ms-1 rounded-full bg-app-info-soft px-2 py-0.5 text-[11px] text-app-info">{t("suggested")}</span>}
          </span>
        </label>
      ))}
      <label className="flex min-h-11 items-start gap-2 text-[13px] text-app-text-secondary">
        <input type="radio" name="mail-wait" className="mt-1" checked={value === ""} disabled={disabled} onChange={() => onChange("")} />
        <span>{t("none")}</span>
      </label>
      {value && (
        <div className="border-t border-app-border pt-2">
          <label className="block text-[12.5px] text-app-text-secondary">
            {t("remindLabel")}
            <input type="datetime-local" value={remindAt} disabled={disabled} onChange={(e) => onRemindAt(e.target.value)} className={field} />
          </label>
          <p className="mt-1 text-[11.5px] text-app-text-tertiary">{t("remindHint")}</p>
        </div>
      )}
    </fieldset>
  );
}

/// What the task waits for, or the reply that came.
export function MailWaitStatus({ taskId, wait, defaultRemindAt }: { taskId: string; wait: MailWaitInfo; defaultRemindAt: string }) {
  const t = useTranslations("tasks.detail.mail");
  const { when, day } = useWhen();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"idle" | "reschedule" | "compose">("idle");
  const [date, setDate] = useState(defaultRemindAt);
  const [text, setText] = useState(t("composerText"));
  const to = wait.sentTo.join(", ");

  async function act(work: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setPending(true);
    const result = await work();
    setPending(false);
    if (!result.ok) {
      showToast({ tone: "error", title: result.error || t("cancel") });
      return;
    }
    showToast({ tone: "success", title: done });
    setMode("idle");
    router.refresh();
  }

  if (wait.state === "replied") {
    return (
      <div className="mt-3 space-y-1 rounded-[10px] bg-app-success-soft px-3.5 py-3" data-testid="mail-wait-replied">
        <p className="text-[14px] font-bold text-app-success">
          {t.rich("arrived", { from: () => <bdi dir="ltr">{wait.replyFrom}</bdi>, when: () => when(wait.replyAt!) })}
        </p>
        <p className="text-[12.5px] text-app-success">{t("arrivedBody")}</p>
      </div>
    );
  }
  if (wait.state === "stopped") return null;

  const reschedule = (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-[12.5px] text-app-text-secondary">
        {t("newDate")}
        <input type="datetime-local" value={date} disabled={pending} onChange={(e) => setDate(e.target.value)} className={field} />
      </label>
      <button type="button" disabled={pending} onClick={() => act(() => rescheduleMailAction({ taskId, remindAt: date }), t("rescheduled"))} className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-40">
        {t("save")}
      </button>
      <button type="button" disabled={pending} onClick={() => setMode("idle")} className="min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm">
        {t("cancel")}
      </button>
    </div>
  );

  const composer = (
    <div className="mt-3 space-y-3 rounded-xl border border-app-border p-3" data-testid="mail-wait-composer">
      <h3 className="text-[14px] font-medium text-app-text-primary">{t.rich("composerTitle", { to: () => <bdi dir="ltr">{to}</bdi> })}</h3>
      <p className="text-[12.5px] text-app-text-secondary">{t.rich("composerHint", { mailbox: () => <bdi dir="ltr">{wait.mailbox}</bdi> })}</p>
      <textarea rows={5} dir="auto" value={text} disabled={pending} onChange={(e) => setText(e.target.value)} aria-label={t("composerTitle", { to })} className="block w-full rounded-lg border border-app-border px-3 py-2 text-[13px]" />
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" disabled={pending || !text.trim()} onClick={() => act(() => sendReminderAction({ taskId, text, nextRemindAt: date }), t("sent"))} className="min-h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-40">
          {t("send")}
        </button>
        <label className="text-[12.5px] text-app-text-secondary">
          {t("newDate")}
          <input type="datetime-local" value={date} disabled={pending} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <button type="button" disabled={pending} onClick={() => setMode("idle")} className="min-h-11 rounded-lg border border-app-border-strong bg-white px-4 text-sm">
          {t("cancel")}
        </button>
      </div>
    </div>
  );

  if (wait.state === "overdue") {
    return (
      <div data-testid="mail-wait-overdue">
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-app-warning-soft px-3.5 py-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-[14px] font-bold text-app-warning">{t.rich("overdue", { to: () => <bdi dir="ltr">{to}</bdi>, day: () => day(wait.sentAt) })}</p>
            {wait.remindAt && <p className="text-[12.5px] text-app-warning">{t("overdueSub", { when: when(wait.remindAt) })}</p>}
            {!wait.mine && <p className="text-[12px] text-app-warning">{t("notMine")}</p>}
          </div>
          {wait.mine && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={() => setMode("compose")} className="h-[38px] rounded-[9px] bg-app-surface-nav px-3.5 text-[14px] font-bold text-white">
                {t("sendReminder")}
              </button>
              <button type="button" disabled={pending} onClick={() => setMode("reschedule")} className="h-[38px] rounded-[9px] border border-app-border-strong bg-white px-3.5 text-[14px]">
                {t("postpone")}
              </button>
              <button type="button" disabled={pending} onClick={() => act(() => stopMailAction({ taskId, unblock: true }), t("stopped"))} className="h-[38px] rounded-[9px] border border-app-border-strong bg-white px-3.5 text-[14px]">
                {t("notWaiting")}
              </button>
            </div>
          )}
        </div>
        {mode === "reschedule" && <div className="mt-3">{reschedule}</div>}
        {mode === "compose" && composer}
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5" data-testid="mail-wait-waiting">
      <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-app-text-secondary">
        <Mail size={15} className="shrink-0 text-app-info" aria-hidden />
        <span>{t.rich("waitingFor", { to: () => <bdi dir="ltr">{to}</bdi>, when: () => when(wait.sentAt) })}</span>
      </p>
      <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-app-text-secondary">
        <Bell size={15} className="shrink-0 text-app-info" aria-hidden />
        <span>{wait.remindAt ? t("remindAt", { when: when(wait.remindAt) }) : t("noReminder")}</span>
        {wait.mine && (
          <>
            <button type="button" disabled={pending} onClick={() => setMode(mode === "reschedule" ? "idle" : "reschedule")} className="text-app-text-accent underline">
              {t("change")}
            </button>
            <span aria-hidden>·</span>
            <button type="button" disabled={pending} onClick={() => act(() => stopMailAction({ taskId, unblock: false }), t("stopped"))} className="text-app-text-accent underline">
              {t("stop")}
            </button>
          </>
        )}
      </p>
      {wait.via === "CLAUDE" && <p className="text-[11.5px] text-app-text-tertiary">{t("byClaude")}</p>}
      {!wait.mine && <p className="text-[11.5px] text-app-text-tertiary">{t("notMine")}</p>}
      {mode === "reschedule" && reschedule}
    </div>
  );
}
