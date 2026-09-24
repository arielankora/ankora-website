import { History } from "lucide-react";

// Tasks phase 1: the history that was always being recorded.
//
// `AuditEvent` has written a before and an after for every task mutation
// since phase 1, with an actor and a timestamp, and no screen in the
// product has ever shown it. The data is not new; the reader is.
//
// A server component and a read-only list. It is deliberately NOT a
// conversation: the thread the tasks-system spec plans for stage 3 merges
// these same rows with TaskComment, and nothing here should become a
// second place that writes them (spec decision 2 - the thread is composed
// at read time, never at write time).
//
// Capped at fifty rows in the query. A task with more than fifty changes
// on it has a story the audit-log screen tells better, and an unbounded
// list on a task page is a page that gets slower for as long as the task
// stays open.
export function TaskHistory({
  entries,
}: {
  entries: { id: string; at: string; actorName: string | null; label: string; changed: string[] }[];
}) {
  return (
    <section className="rounded-2xl border border-lineDark bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-appNavy/70">
        <History size={15} strokeWidth={1.75} className="text-appNavy/40" />
        היסטוריה
      </h2>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-appNavy/55">אין עדיין שינויים מתועדים.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-3">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-appNavy/25" />
              <div className="min-w-0">
                <p className="text-[13.5px] text-appNavy">
                  {entry.label}
                  {entry.changed.length > 0 && (
                    <span className="text-appNavy/55">: {entry.changed.join(", ")}</span>
                  )}
                </p>
                <p className="mt-0.5 text-[12px] text-appNavy/45">
                  {/* The actor is nullable: a task opened by the nightly
                      important-dates job has no person behind it, and
                      saying "המערכת" is more honest than a blank. */}
                  {entry.actorName ?? "המערכת"} · {formatWhen(entry.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(iso));
}
