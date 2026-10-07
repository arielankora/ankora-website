import { ArrowRight, ChevronLeft } from "lucide-react";
import { carriedListQuery, tasksListHref } from "../list-query";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getTaskDetail, assignableUsers } from "@/lib/app-domain/tasks";
import { markTaskNotificationsRead } from "@/lib/app-domain/notifications";
import { clientDocumentsFolder } from "@/lib/google-drive";
import { MAX_DOCUMENT_BYTES } from "@/lib/app-domain/client-documents";
import { listCategories } from "@/lib/app-domain/categories";
import { getActiveTimers } from "@/lib/app-domain/time-entries";
import { Forbidden } from "@/components/app/Forbidden";
import { NotFound } from "@/components/app/states/NotFound";
import { TaskDetail } from "./TaskDetail";
import { TaskThread } from "./TaskThread";
import { TaskSteps } from "./TaskSteps";
import { TASK_TEMPLATES } from "@/lib/app-domain/sop-templates";
import { MessageClient } from "@/components/app/MessageClient";
import { messageComposerProps } from "@/lib/app-domain/client-messages";
import { appBaseUrl } from "@/lib/email-templates";
import { TaskTimeSummary } from "./TaskTimeSummary";
import { listCredentials } from "@/lib/app-domain/credentials";
import { isVaultConfigured } from "@/lib/vault/keys";
import { RevealCredential } from "@/components/app/vault/RevealCredential";

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
export default async function TaskDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { id } = await props.params;
  // The list this task was opened from: its client, search, pills and
  // view. See list-query.ts. Without it, "back" is the list's defaults.
  const rawFrom = (await props.searchParams).from;
  const from = typeof rawFrom === "string" ? rawFrom : undefined;
  const backHref = tasksListHref(from);
  const listQuery = carriedListQuery(from);
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
        backHref={backHref}
        backLabel="חזרה למשימות"
      />
    );
  }

  const { task, time, thread, commentCount, subtasks } = detail;

  // Opening the task is reading what the bell said about it.
  await markTaskNotificationsRead(user.id, task.id);

  // When nobody wrote a description, the first comment usually is one:
  // 6.10.2026, the whole of a task Hadas handed over was in a comment,
  // under a card that said "אין תיאור". The thread is newest first.
  const firstComment = [...thread].reverse().find((e) => e.kind === "comment");
  const leadComment =
    firstComment && firstComment.kind === "comment"
      ? { author: firstComment.actorName, body: firstComment.body }
      : null;

  // Everything the "הודעה ללקוח" button needs, and nothing it does not.
  //
  // The client's own words about how to reach them travel to the screen
  // and are SHOWN there. They are never parsed into a preferred channel:
  // see the comment in lib/app-domain/client-messages.ts for the version
  // that was, and the sentence that killed it.
  // The client's logins, for work that needs them. A reveal from here
  // carries this task's id into the audit row, so the trail says not only
  // who looked but for what. Only the safe projection is fetched; see
  // lib/app-domain/credentials.ts.
  const credentials =
    can(user.role, "credential.view") && isVaultConfigured()
      ? (await listCredentials(user, task.clientId).catch(() => [])).filter((c) => c.hasUsername || c.hasPassword || c.hasNotes)
      : [];

  const [composer, people, allCategories, activeTimers] = await Promise.all([
    messageComposerProps({
      clientId: task.clientId,
      fromName: user.name,
      // What the CLIENT calls this piece of work. The internal title is
      // our shorthand and has no business in a message to them; it is
      // the fallback only so the draft is never about nothing.
      subject: task.clientTitle || task.title,
      outcome: task.clientOutcome,
      portalUrl: `${appBaseUrl()}/app/portal`,
    }),
    assignableUsers(user, task.clientId),
    listCategories(),
    getActiveTimers(user.id),
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
      {/* Ariel, 7.10.2026: a way back that says it is one, and lands on
          the list as it was left. It used to be a breadcrumb "משימות"
          pointing at the bare list, which read as a label and reset
          every filter. The arrow points right because right is back in
          Hebrew. A plain anchor, like the links that lead here, so the
          navigation cannot be quietly cancelled (see TaskRow). */}
      <nav className="flex items-center gap-1.5 text-[13px] text-appNavy/50">
        <a
          href={backHref}
          data-testid="task-back"
          className="inline-flex items-center gap-1.5 rounded-full border border-lineDark bg-white px-3 py-1.5 font-medium text-appNavy/70 transition-colors hover:border-appNavy/30 hover:text-appNavy"
        >
          <ArrowRight size={14} />
          חזרה למשימות
        </a>
        <ChevronLeft size={14} className="text-appNavy/30" />
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
          clientRequest: task.clientRequest,
          clientOutcome: task.clientOutcome,
          blockedOn: task.blockedOn,
          blockedReason: task.blockedReason,
          blockedSince: task.blockedSince?.toISOString() ?? null,
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
        leadComment={leadComment}
        viewerId={user.id}
        // Only this person's own timers, and only enough of each to
        // answer three questions: is it on this task, is it on this
        // task's client (then it has to stop first), and what to call it.
        activeTimers={activeTimers.map((t) => ({
          id: t.id,
          startAt: t.startAt.toISOString(),
          clientName: t.client.name,
          onThisTask: t.taskId === task.id,
          onThisClient: t.clientId === task.clientId,
        }))}
      />

      {/* The button that writes to the client, above the steps and above
          the record below them. Nothing here sends by itself: it opens a
          draft, and a person presses send. See
          claude/client-communication-rule-2026-09-25.md. */}
      {composer && (
        <div className="flex flex-wrap items-center gap-2">
          <MessageClient
            clientId={task.clientId}
            taskId={task.id}
            // Waiting on the client is the one situation where the
            // product knows which draft is wanted, so it opens on it.
            preselectKind={task.blockedOn === "CLIENT" ? "need_information" : undefined}
            {...composer}
          />
        </div>
      )}

      {/* Above the hours and the thread, and that placement is the
          argument: the steps are what is left to do, and the two panels
          below are the record of what has been done. A person opening
          this screen mid-task is asking the first question. */}
      <TaskSteps
        listQuery={listQuery}
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

      {credentials.length > 0 && (
        <details className="rounded-2xl border border-lineDark bg-white p-5">
          <summary className="cursor-pointer text-sm font-medium text-appNavy">
            גישות למערכות של {task.client.name} ({credentials.length})
          </summary>
          <ul className="mt-4 space-y-4">
            {credentials.map((c) => (
              <li key={c.id} className="flex flex-col gap-2">
                <span className="text-sm text-appNavy">
                  {c.systemName}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="ms-2 text-xs text-gold hover:underline">
                      פתיחה
                    </a>
                  )}
                </span>
                <RevealCredential credentialId={c.id} taskId={task.id} />
              </li>
            ))}
          </ul>
        </details>
      )}

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
