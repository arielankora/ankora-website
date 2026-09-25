import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getTaskDetail, assignableUsers } from "@/lib/app-domain/tasks";
import { clientDocumentsFolder } from "@/lib/google-drive";
import { MAX_DOCUMENT_BYTES } from "@/lib/app-domain/client-documents";
import { listCategories } from "@/lib/app-domain/categories";
import { getActiveTimer } from "@/lib/app-domain/time-entries";
import { prisma } from "@/lib/prisma";
import { Forbidden } from "@/components/app/Forbidden";
import { NotFound } from "@/components/app/states/NotFound";
import { TaskDetail } from "./TaskDetail";
import { TaskThread } from "./TaskThread";
import { TaskSteps } from "./TaskSteps";
import { TASK_TEMPLATES } from "@/lib/app-domain/sop-templates";
import { MessageClient } from "@/components/app/MessageClient";
import { MESSAGE_KINDS, buildMessage, whatsappDigits } from "@/lib/app-domain/client-messages";
import { TaskTimeSummary } from "./TaskTimeSummary";

export const metadata = { robots: { index: false, follow: false } };

// Tasks phase 1 (tasks-system spec, stage 1): the screen a task never had.
//
// Everything on it is either a field that existed with no control, or a
// read that existed with no reader. `assignedToId` and `dueDate` have been
// on the model since phase 10 and only the important-dates job and the MCP
// server ever wrote them. `AuditEvent` has recorded every task mutation
// since phase 1 and nothing displayed it. `TimeEntry.taskId` has existed
// since phase 2. The three genuinely new columns are description, priority
// and startedAt.
//
// Gated exactly like the Tasks list (time_entry.create_self): there is no
// task.* permission by design - see lib/app-auth/permissions.ts's phase 9
// note. Whether a person may act on this task reduces to whether they may
// act on its client, and getTaskDetail answers that by returning null.
export default async function TaskDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) return <Forbidden />;

  const detail = await getTaskDetail(user, id);
  // Null covers both "no such task" and "not your client", and the screen
  // says the same thing for both on purpose: a different message for the
  // second would confirm that a task exists on a client this person has
  // no access to.
  if (!detail) {
    return (
      <NotFound
        title="המשימה לא נמצאה"
        description="ייתכן שהמשימה נמחקה, או שהיא שייכת ללקוח שאינו משויך אליך."
        backHref="/app/tasks"
        backLabel="חזרה למשימות"
      />
    );
  }

  const { task, time, thread, commentCount, subtasks } = detail;

  // Everything the "הודעה ללקוח" button needs, and nothing it does not.
  //
  // The client's own words about how to reach them travel to the screen
  // and are SHOWN there. They are never parsed into a preferred channel:
  // see the comment in lib/app-domain/client-messages.ts for the version
  // that was, and the sentence that killed it.
  const [contact, people, allCategories, activeTimer] = await Promise.all([
    prisma.client.findUnique({
      where: { id: task.clientId },
      select: {
        whatsappNumber: true,
        preferenceContact: true,
        preferenceNever: true,
        portalUsers: {
          where: { role: "ADMIN", user: { deletedAt: null, status: { in: ["ACTIVE", "INVITED"] } } },
          select: { user: { select: { email: true } } },
        },
      },
    }),
    assignableUsers(user, task.clientId),
    listCategories(),
    getActiveTimer(user.id),
  ]);

  // The same filter the create form uses: global categories, plus the
  // client-specific ones belonging to THIS client. An inactive category
  // stays in the list only when it is the one already on the task, so
  // that opening the screen cannot silently blank a field.
  const categories = allCategories
    .filter(
      (c) =>
        (c.active || c.id === task.categoryId) &&
        (c.visibility === "GLOBAL" || c.clientId === task.clientId)
    )
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-[13px] text-appNavy/50">
        <Link href="/app/tasks" className="hover:text-appNavy">
          משימות
        </Link>
        <ChevronRight size={14} className="rotate-180" />
        <span className="truncate text-appNavy/70">{task.client.name}</span>
      </nav>

      <TaskDetail
        task={{
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: task.status,
          clientName: task.client.name,
          categoryId: task.categoryId,
          assignedToId: task.assignedToId,
          assignedToName: task.assignedTo?.name ?? null,
          supervisorId: task.supervisorId,
          supervisorName: task.supervisor?.name ?? null,
          requiresApproval: task.requiresApproval,
          approvedByName: task.approvedBy?.name ?? null,
          approvedAt: task.approvedAt?.toISOString() ?? null,
          dueDate: task.dueDate?.toISOString() ?? null,
          clientVisible: task.clientVisible,
          clientTitle: task.clientTitle,
          clientOutcome: task.clientOutcome,
          startedAt: task.startedAt?.toISOString() ?? null,
          completedAt: task.completedAt?.toISOString() ?? null,
          createdAt: task.createdAt.toISOString(),
        }}
        people={people}
        categories={categories}
        // Whether THIS person may sign. Computed on the server beside the
        // rule it mirrors (assertApprovable), not guessed in the browser:
        // the screen uses it to decide which button to show, and the
        // domain refuses the write regardless, so a wrong answer here is
        // a confusing screen rather than a hole.
        canApprove={user.id === task.supervisorId || can(user.role, "time_entry.edit_others")}
        // Only this person's own timer, and only enough of it to answer
        // two questions: is one running, and is it on this task.
        activeTimer={
          activeTimer
            ? {
                id: activeTimer.id,
                startAt: activeTimer.startAt.toISOString(),
                onThisTask: activeTimer.taskId === task.id,
              }
            : null
        }
      />

      {/* Above the hours and the thread, and that placement is the
          argument: the steps are what is left to do, and the two panels
          below are the record of what has been done. A person opening
          this screen mid-task is asking the first question. */}
      {/* Beside the steps, because the two answer the same question from
          opposite ends: what is left to do, and what the client has been
          told about it. Nothing here sends by itself - the button opens
          a draft and a person presses send. */}
      <div className="flex flex-wrap items-center gap-2">
        <MessageClient
          clientId={task.clientId}
          taskId={task.id}
          clientName={task.client.name}
          preference={contact?.preferenceContact ?? null}
          never={contact?.preferenceNever ?? null}
          whatsappDigits={whatsappDigits(contact?.whatsappNumber)}
          emails={(contact?.portalUsers ?? []).map((p) => p.user.email)}
          drafts={MESSAGE_KINDS.map((kind) => {
            const draft = buildMessage(kind, {
              clientName: task.client.name,
              fromName: user.name,
              // What the CLIENT calls this piece of work. The internal
              // title is our shorthand and has no business in a message
              // to them; it is the fallback only so the draft is never
              // about nothing.
              subject: task.clientTitle || task.title,
              outcome: task.clientOutcome,
            });
            return { kind: draft.kind, label: draft.label, emailSubject: draft.emailSubject, body: draft.body };
          })}
        />
      </div>

      <TaskSteps
        // The book itself, reduced to what the picker shows. The step
        // titles stay on the server: the screen never renders them, and
        // shipping seven procedures to every browser to display seven
        // names would be the list nobody reads, downloaded.
        templates={TASK_TEMPLATES.map((t) => ({
          id: t.id,
          name: t.name,
          when: t.when,
          stepCount: t.steps.length,
        }))}
        taskId={task.id}
        clientId={task.clientId}
        parentIsClosed={task.status === "DONE" || task.status === "ARCHIVED"}
        steps={subtasks.map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          dueDate: s.dueDate?.toISOString() ?? null,
          assignedToName: s.assignedTo?.name ?? null,
        }))}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <TaskTimeSummary time={time} />
        <TaskThread
          taskId={task.id}
          commentCount={commentCount}
          // Same signal the client file screen uses: the composer works
          // either way, and only the paperclip has to explain itself.
          storageReady={clientDocumentsFolder() !== null}
          maxBytes={MAX_DOCUMENT_BYTES}
          entries={thread.map((e) => ({ ...e, at: e.at.toISOString() }))}
        />
      </div>
    </div>
  );
}
