import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { PortalPromise } from "@/lib/app-domain/client-portal";
import { TIMEZONE } from "@/lib/timezone";

// Portal phase 1. One row shape for a promise, used by the home screen
// and by the activity stream, so the client learns to read it once.
//
// Deliberately absent from the row: hours, the employee who did the work,
// the internal category, and the internal status. Spec 13's isolation
// list covers the first three; the fourth is phase 1's own rule - a
// client reads their outcome, not our workflow.

const STAGE_TONE: Record<PortalPromise["stage"], string> = {
  // 20.10.2026: the app's status tones (StatusBadge, TaskRow): waiting is the
  // warning tone, in progress the info tone, received the neutral one.
  WAITING_ON_CLIENT: "border-transparent bg-app-warning-soft text-app-warning",
  IN_PROGRESS: "border-transparent bg-app-info-soft text-app-info",
  RECEIVED: "border-transparent bg-app-neutral-soft text-app-text-secondary",
  DONE: "border-transparent bg-app-success-soft text-app-success",
};

/// Whole days, floored, in the client's own timezone sense of "a day".
/// Zero reads as "today" rather than "0 days", because "מחכה לך 0 ימים"
/// is the kind of sentence that makes a product feel unattended.
function daysSince(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

export async function PromiseRow({ promise, showStage = true }: { promise: PortalPromise; showStage?: boolean }) {
  const t = await getTranslations("portal.promises");
  const format = await getFormatter();
  // ADR 0006: in the reader's language. A due date is an Israeli day, so it
  // is written in Israel time; when the work moved is an instant, written
  // in the reader's own time zone.
  const formatDay = (date: Date, timeZone?: string) => format.dateTime(date, { day: "numeric", month: "short", timeZone });
  const waitingLabel = (since: Date) => {
    const days = daysSince(since);
    if (days === 0) return t("waitingToday");
    if (days === 1) return t("waitingYesterday");
    return t("waitingDays", { days: String(days) });
  };

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5 px-[18px] py-3.5">
      <span className="min-w-0 flex-1 text-sm text-app-text-primary">
        <bdi dir="auto">{promise.title}</bdi>
        {/* Team adoption: what came of it.

            A finished promise used to be its own title with a green pill
            beside it - the client read back the thing they had asked
            for, dated, and learned nothing about what happened. This
            line is the answer, and it is why closing a visible promise
            without one is refused upstream rather than nudged. */}
        {promise.outcome && (
          <span dir="auto" className="mt-1 block text-[12.5px] leading-relaxed text-app-text-secondary">
            {promise.outcome}
          </span>
        )}
        {/* What is being asked of the client, and the shortest way to do
            it. The title says what the task is called; this says what to
            do, so the row can be acted on in ten seconds. */}
        {promise.stage === "WAITING_ON_CLIENT" && promise.waitingFor && (
          <span className="mt-1 block text-[12.5px] leading-relaxed text-app-text-secondary">
            {t("whatIsNeeded", { what: promise.waitingFor })}
          </span>
        )}
        {/* 4.11.2026: the lines Ankora wrote for the client under this task,
            such as who was booked and when (TaskPortalNote). */}
        {promise.notes.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[12.5px] leading-relaxed text-app-text-secondary">
            {promise.notes.map((n, i) => (
              <li key={i} dir="auto">
                {n}
              </li>
            ))}
          </ul>
        )}
        {promise.stage !== "DONE" && promise.openDecisions > 0 && (
          <Link
            href="/app/portal/decisions"
            className="mt-1.5 inline-block rounded-full border border-gold/50 bg-white px-3 py-1 text-[12px] font-medium text-app-text-primary hover:border-gold"
          >
            {t("answerDecisions", { count: promise.openDecisions })}
          </Link>
        )}
      </span>
      <span className="flex items-center gap-2.5">
        {promise.stage === "WAITING_ON_CLIENT" && promise.waitingSince && (
          <span className="text-[11.5px] text-app-text-secondary">{waitingLabel(promise.waitingSince)}</span>
        )}
        {promise.stage === "DONE" && (
          <span dir="ltr" className="font-jbmono text-[11.5px] text-app-text-tertiary">
            {formatDay(promise.movedAt)}
          </span>
        )}
        {promise.stage !== "DONE" && promise.dueDate && (
          <span dir="ltr" className="font-jbmono text-[11.5px] text-app-text-tertiary">
            {formatDay(promise.dueDate, TIMEZONE)}
          </span>
        )}
        {showStage && (
          <span className={`rounded-full border px-2.5 py-1 text-[11px] ${STAGE_TONE[promise.stage]}`}>
            {t(`stages.${promise.stage}`)}
          </span>
        )}
      </span>
    </div>
  );
}

export function PromiseList({
  title,
  promises,
  emptyText,
  tone = "plain",
  action,
  showStage = true,
}: {
  title: string;
  promises: PortalPromise[];
  emptyText?: string;
  /// "attention" is the one card on the home screen that may use gold.
  /// Reserving it for the single thing the client has to act on is what
  /// makes it mean anything.
  tone?: "plain" | "attention";
  action?: React.ReactNode;
  showStage?: boolean;
}) {
  if (promises.length === 0 && !emptyText) return null;

  return (
    <div
      className={`overflow-hidden rounded-2xl border ${
        tone === "attention" ? "border-app-warning/25 bg-app-warning-soft" : "border-app-border bg-white"
      }`}
    >
      <div className={`flex items-center justify-between gap-2.5 border-b px-[18px] py-3.5 ${tone === "attention" ? "border-app-warning/25" : "border-app-border"}`}>
        <span className={`text-[13.5px] font-medium ${tone === "attention" ? "text-app-warning" : "text-app-text-primary"}`}>{title}</span>
        {action}
      </div>
      {promises.length === 0 ? (
        <p className="px-[18px] py-8 text-center text-sm text-app-text-tertiary">{emptyText}</p>
      ) : (
        <div className={`divide-y ${tone === "attention" ? "divide-app-warning/25" : "divide-app-border"}`}>
          {promises.map((p) => (
            <PromiseRow key={p.id} promise={p} showStage={showStage} />
          ))}
        </div>
      )}
    </div>
  );
}
