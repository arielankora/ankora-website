import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type getTaskDetail } from "@/lib/app-domain/tasks";
import { TASK_BLOCKER_LABELS } from "@/lib/app-domain/portal-labels";
import type { TaskPlanRow } from "@/lib/app-domain/task-plans";
import { formatDecimalHours } from "@/lib/hours-format";
import { taskUrl } from "@/lib/mcp/serialize";
import { appBaseUrl } from "@/lib/email-templates";
import { buildAdvancePrompt } from "@/lib/advance-prompt";

// "קדם עם קלוד" (10.10.2026): turns what the task screen already loaded
// into the prompt. One extra read, the decisions filed against the task;
// everything else comes from getTaskDetail and getTaskPlans, which the
// page calls anyway, so pressing the button costs no request at all and
// the copy happens inside the click (Safari refuses a clipboard write that
// waits on the network first).
//
// The access rule is inherited, not restated: `detail` exists only if
// getTaskDetail decided this person may see the task.

/// Recent comments carried in the prompt. The rest stay one get_task away.
const MAX_PROMPT_COMMENTS = 30;

type Detail = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>;

export async function advancePromptFor(actor: User, detail: Detail, plan: TaskPlanRow | null): Promise<string> {
  const { task, subtasks, thread, time } = detail;
  const tz = actor.timezone || "Asia/Jerusalem";
  const day = new Intl.DateTimeFormat("he-IL", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" });
  const dayTime = new Intl.DateTimeFormat("he-IL", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const decisions = await prisma.decision.findMany({
    where: { taskId: task.id, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { question: true, status: true, dueAt: true },
  });

  // The thread arrives newest first. The prompt reads like a story, so
  // the most recent ones are kept and then put back in time order.
  const allComments = thread.filter((e) => e.kind === "comment");
  const recent = allComments.slice(0, MAX_PROMPT_COMMENTS).reverse();
  const fileTitles = thread.filter((e) => e.kind === "file").map((e) => ("title" in e ? e.title : ""));

  const loggedMinutes = Math.round(time.totalSeconds / 60);

  return buildAdvancePrompt({
    taskId: task.id,
    url: taskUrl(appBaseUrl(), task.id),
    title: task.title,
    clientName: task.client.name,
    statusLabel: TASK_STATUS_LABELS[task.status],
    priorityLabel: TASK_PRIORITY_LABELS[task.priority],
    categoryName: task.category?.name ?? null,
    assignedTo: task.assignedTo?.name ?? null,
    supervisor: task.supervisor?.name ?? null,
    requiresApproval: task.requiresApproval,
    dueLabel: task.dueDate ? day.format(task.dueDate) : null,
    createdLabel: day.format(task.createdAt),
    description: task.description,
    clientVisible: task.clientVisible,
    clientTitle: task.clientTitle,
    clientRequest: task.clientRequest,
    clientOutcome: task.clientOutcome,
    waiting: task.blockedOn
      ? {
          onLabel: TASK_BLOCKER_LABELS[task.blockedOn],
          reason: task.blockedReason,
          sinceLabel: task.blockedSince ? day.format(task.blockedSince) : null,
        }
      : null,
    steps: subtasks
      .filter((s) => s.status !== "ARCHIVED")
      .map((s) => ({
        title: s.title,
        statusLabel: TASK_STATUS_LABELS[s.status],
        assignedTo: s.assignedTo?.name ?? null,
        dueLabel: s.dueDate ? day.format(s.dueDate) : null,
      })),
    comments: recent.map((c) => ({
      atLabel: dayTime.format(c.at),
      by: c.actorName,
      body: "body" in c ? c.body : "",
    })),
    commentsOmitted: Math.max(0, allComments.length - recent.length),
    decisions: decisions.map((d) => ({
      question: d.question,
      statusLabel: d.status === "OPEN" ? "ממתינה לתשובת הלקוח" : "הלקוח ענה",
      dueLabel: d.dueAt ? day.format(d.dueAt) : null,
    })),
    fileTitles,
    loggedLabel: loggedMinutes > 0 ? `${formatDecimalHours(loggedMinutes)} שעות` : null,
    plan: plan
      ? { version: plan.version, approved: plan.status === "APPROVED", body: plan.body, steps: plan.steps }
      : null,
    requestedBy: actor.name,
    todayLabel: day.format(new Date()),
  });
}
