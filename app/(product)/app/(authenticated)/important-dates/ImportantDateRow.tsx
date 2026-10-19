"use client";
import { useState } from "react";
import Link from "next/link";
import { withFrom } from "@/lib/list-back";
import { useToast } from "@/components/app/toast/ToastProvider";
import { setImportantDateStatusAction } from "./actions";
import type { ImportantDateStatus } from "@prisma/client";

export type DateRow = {
  id: string;
  title: string;
  day: string;
  month: string;
  meta: string;
  tag: string;
  tone: "red" | "gold" | "gray" | "green";
  remind: string;
  status: ImportantDateStatus;
  previousStatus: ImportantDateStatus;
};

const TONE_CLASSES: Record<DateRow["tone"], string> = {
  red: "bg-app-error-soft text-app-error",
  gold: "bg-app-warning-soft text-app-warning",
  gray: "bg-app-neutral-soft text-app-text-secondary",
  green: "bg-app-success-soft text-app-success",
};

// App redesign (handoff README, screen 7 "מועדים חשובים"): row = date
// square colored by urgency, title, client·recurrence, urgency tag,
// reminder policy, and a real toggle+undo action - mirrors the
// prototype's d.handle exactly (which itself toggles between "סימון
// כטופל" and "פתיחה מחדש", not a one-way action), so the undo here calls
// the real domain status-setter with the date's previous status rather
// than just rewinding local state.
export function ImportantDateRow({ date, listQuery }: { date: DateRow; listQuery?: string }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(date.status);
  const [pending, setPending] = useState(false);
  const isHandled = status === "HANDLED_CURRENT";

  async function changeStatus(next: ImportantDateStatus, isUndo = false) {
    const previous = status;
    setStatus(next);
    setPending(true);
    const result = await setImportantDateStatusAction(date.id, next);
    setPending(false);
    if (!result.ok) {
      setStatus(previous);
      showToast({ tone: "error", title: "העדכון נכשל", description: result.error });
      return;
    }
    if (isUndo) {
      showToast({ tone: "info", title: "הפעולה בוטלה", description: date.title });
      return;
    }
    showToast({
      tone: next === "HANDLED_CURRENT" ? "success" : "info",
      title: next === "HANDLED_CURRENT" ? "המועד סומן כטופל" : "המועד נפתח מחדש",
      description: date.title,
      undo: () => changeStatus(previous, true),
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-app-border bg-white p-4">
      <span className={`w-[46px] shrink-0 rounded-[10px] py-1.5 text-center ${TONE_CLASSES[isHandled ? "green" : date.tone]}`}>
        <span className="block font-jbmono text-[17px]">{date.day}</span>
        <span className="block text-[10.5px]">{date.month}</span>
      </span>
      <div className="min-w-0 flex-1 basis-[220px]">
        <Link href={withFrom(`/app/important-dates/${date.id}`, listQuery)} className="block truncate text-sm text-app-text-primary hover:text-app-text-accent">
          {date.title}
        </Link>
        <p className="mt-0.5 truncate text-[11.5px] text-app-text-tertiary">{date.meta}</p>
      </div>
      <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${TONE_CLASSES[isHandled ? "green" : date.tone]}`}>
        {isHandled ? "טופל" : date.tag}
      </span>
      <span className="text-[11.5px] text-app-text-tertiary">{date.remind}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => changeStatus(isHandled ? date.previousStatus : "HANDLED_CURRENT")}
        className="rounded-full border border-app-border px-3.5 py-2 text-xs text-app-text-primary hover:border-gold disabled:opacity-50"
      >
        {isHandled ? "פתיחה מחדש" : "סימון כטופל"}
      </button>
    </div>
  );
}
