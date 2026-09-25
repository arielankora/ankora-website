import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { OPEN_STATUSES, listTasks } from "@/lib/app-domain/tasks";
import { Forbidden } from "@/components/app/Forbidden";
import { EmptyState } from "@/components/app/states/EmptyState";
import { TaskRow } from "../tasks/TaskRow";
import { ShieldCheck } from "lucide-react";

export const metadata = { robots: { index: false, follow: false } };

// Tasks phase 2: "בפיקוח שלי".
//
// A screen rather than a fifth pill on the tasks list, for one reason:
// approval only works if the person who has to give it finds out there
// is something to give. A filter answers a question somebody thought to
// ask. This, plus the count beside it in the nav, is what tells them
// without being asked.
//
// Two groups and nothing else. Work waiting on this person comes first,
// because it is the only part of the screen that is a request. Everything
// else they supervise sits below it, because "what am I responsible for"
// is a real question and a second screen for it would be one screen too
// many.
//
// Gated exactly like the Tasks list (time_entry.create_self): there is no
// task.* permission by design, and being a supervisor is a fact about a
// row rather than a role - see lib/app-domain/tasks.ts's phase 9 note.
// Nothing here can show a task on a client this person cannot reach:
// listTasks scopes to their accessible clients before it filters.
export default async function SupervisingPage() {
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) return <Forbidden />;

  const tasks = await listTasks(user, { supervisorId: user.id });
  const waiting = tasks.filter((t) => t.status === "PENDING_APPROVAL");
  const rest = tasks.filter((t) => t.status !== "PENDING_APPROVAL");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-appNavy">בפיקוח שלי</h1>
        <p className="mt-1 text-sm text-appNavy/60">
          משימות שאתם המפקחים עליהן. מה שממתין לאישור שלכם מופיע ראשון.
        </p>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="אין משימות בפיקוח שלכם"
          description="כשמישהו יבחר אתכם כמפקחים על משימה, היא תופיע כאן."
        />
      ) : (
        <div className="space-y-6">
          {waiting.length > 0 && (
            <Section
              title={`ממתינות לאישור שלכם (${waiting.length})`}
              description="הצוות סיים את העבודה. חסרה ההחלטה שלכם."
              tasks={waiting}
            />
          )}
          {rest.length > 0 && (
            <Section
              title={`בפיקוח, לא ממתינות (${rest.length})`}
              description={
                waiting.length > 0
                  ? "אין מה לעשות כאן עכשיו."
                  : "אף משימה לא ממתינה לאישור שלכם כרגע."
              }
              tasks={rest}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  tasks,
}: {
  title: string;
  description: string;
  tasks: Awaited<ReturnType<typeof listTasks>>;
}) {
  return (
    <section>
      <h2 className="text-sm font-medium text-appNavy">{title}</h2>
      <p className="mt-0.5 text-[12.5px] text-appNavy/55">{description}</p>
      <div className="mt-3 divide-y divide-lineDark rounded-2xl border border-lineDark bg-white">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={{
              id: task.id,
              title: task.title,
              clientName: task.client.name,
              categoryName: task.category?.name ?? null,
              dueDate: task.dueDate?.toISOString() ?? null,
              status: task.status,
              priority: task.priority,
              clientVisible: task.clientVisible,
              supplierName: task.supplierName,
              supplierExperience: task.supplierExperience,
              clientTitle: task.clientTitle,
              waitingOnClient: task.waitingOnClientSince !== null,
              clientOutcome: task.clientOutcome,
              stepsTotal: task.subtasks.length,
              stepsDone: task.subtasks.filter((s) => !OPEN_STATUSES.includes(s.status)).length,
            }}
          />
        ))}
      </div>
    </section>
  );
}
