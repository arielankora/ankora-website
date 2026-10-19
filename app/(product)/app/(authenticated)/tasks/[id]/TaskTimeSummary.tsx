import { Clock } from "lucide-react";
import { formatDuration } from "@/lib/time-entry-format";

// Tasks phase 1: what this task has cost, by person.
//
// A server component, because it only reads. This is the number the whole
// tasks-system spec argues a task tracker built inside a time-tracking
// product should be able to answer and a general one never can: not "is it
// done" but "what did it take".
//
// A running timer is counted as an entry but contributes no seconds,
// because its seconds do not exist yet - they are computed on the stop.
// Saying so in a line is better than either rounding it to zero silently
// or guessing at the elapsed time here, which would disagree with the
// number the stop eventually writes.
export function TaskTimeSummary({
  time,
}: {
  time: {
    totalSeconds: number;
    byUser: { userId: string; userName: string; seconds: number }[];
    runningCount: number;
    entryCount: number;
  };
}) {
  return (
    <section id="task-time" className="scroll-mt-24 rounded-2xl border border-app-border bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-app-text-secondary">
          <Clock size={15} strokeWidth={1.75} className="text-app-text-tertiary" />
          שעות על המשימה
        </h2>
        <span className="font-jbmono text-[22px] font-medium text-app-text-primary">
          {formatDuration(time.totalSeconds)}
        </span>
      </div>

      {time.entryCount === 0 ? (
        <p className="mt-4 text-sm text-app-text-secondary">עדיין לא דווח זמן על המשימה הזו.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {time.byUser.map((row) => (
            <li key={row.userId} className="flex items-center justify-between text-[13.5px]">
              <span className="truncate text-app-text-primary">{row.userName}</span>
              <span className="font-jbmono text-app-text-secondary">{formatDuration(row.seconds)}</span>
            </li>
          ))}
        </ul>
      )}

      {time.runningCount > 0 && (
        <p className="mt-3 border-t border-app-border pt-3 text-[12.5px] text-app-warning">
          {time.runningCount === 1
            ? "טיימר אחד רץ על המשימה הזו כרגע, והזמן שלו ייספר בעצירה."
            : `${time.runningCount} טיימרים רצים על המשימה הזו כרגע, והזמן שלהם ייספר בעצירה.`}
        </p>
      )}
    </section>
  );
}
