import { PORTAL_STAGE_LABELS, type PortalPromise } from "@/lib/app-domain/client-portal";

// Portal phase 1. One row shape for a promise, used by the home screen
// and by the activity stream, so the client learns to read it once.
//
// Deliberately absent from the row: hours, the employee who did the work,
// the internal category, and the internal status. Spec 13's isolation
// list covers the first three; the fourth is phase 1's own rule - a
// client reads their outcome, not our workflow.

const STAGE_TONE: Record<PortalPromise["stage"], string> = {
  WAITING_ON_CLIENT: "border-gold/45 bg-gold/12 text-appNavy",
  IN_PROGRESS: "border-lineDark bg-appNavy/5 text-appNavy/70",
  RECEIVED: "border-lineDark bg-appNavy/5 text-appNavy/70",
  DONE: "border-success/25 bg-success-soft text-success",
};

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", timeZone: "Asia/Jerusalem" }).format(date);
}

/// Whole days, floored, in the client's own timezone sense of "a day".
/// Zero reads as "today" rather than "0 days", because "מחכה לך 0 ימים"
/// is the kind of sentence that makes a product feel unattended.
function daysSince(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function waitingLabel(since: Date): string {
  const days = daysSince(since);
  if (days === 0) return "מהיום";
  if (days === 1) return "מאתמול";
  return `כבר ${days} ימים`;
}

export function PromiseRow({ promise, showStage = true }: { promise: PortalPromise; showStage?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5 px-[18px] py-3.5">
      <span className="min-w-0 flex-1 text-sm text-appNavy">
        {promise.title}
        {/* Team adoption: what came of it.

            A finished promise used to be its own title with a green pill
            beside it - the client read back the thing they had asked
            for, dated, and learned nothing about what happened. This
            line is the answer, and it is why closing a visible promise
            without one is refused upstream rather than nudged. */}
        {promise.outcome && (
          <span className="mt-1 block text-[12.5px] leading-relaxed text-appNavy/60">{promise.outcome}</span>
        )}
      </span>
      <span className="flex items-center gap-2.5">
        {promise.stage === "WAITING_ON_CLIENT" && promise.waitingSince && (
          <span className="text-[11.5px] text-appNavy/55">{waitingLabel(promise.waitingSince)}</span>
        )}
        {promise.stage === "DONE" && (
          <span dir="ltr" className="font-jbmono text-[11.5px] text-appNavy/45">
            {formatDay(promise.movedAt)}
          </span>
        )}
        {promise.stage !== "DONE" && promise.dueDate && (
          <span dir="ltr" className="font-jbmono text-[11.5px] text-appNavy/45">
            {formatDay(promise.dueDate)}
          </span>
        )}
        {showStage && (
          <span className={`rounded-full border px-2.5 py-1 text-[11px] ${STAGE_TONE[promise.stage]}`}>
            {PORTAL_STAGE_LABELS[promise.stage]}
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
        tone === "attention" ? "border-gold/40 bg-[#FBF7F0]" : "border-lineDark bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2.5 border-b border-lineDark px-[18px] py-3.5">
        <span className="text-[13.5px] font-medium text-appNavy">{title}</span>
        {action}
      </div>
      {promises.length === 0 ? (
        <p className="px-[18px] py-8 text-center text-sm text-appNavy/50">{emptyText}</p>
      ) : (
        <div className="divide-y divide-lineDark/60">
          {promises.map((p) => (
            <PromiseRow key={p.id} promise={p} showStage={showStage} />
          ))}
        </div>
      )}
    </div>
  );
}
