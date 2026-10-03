import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { User } from "@prisma/client";
import { actorFromAuthInfo } from "@/lib/mcp/auth";
import { PortalUserOnStaffConnectorError, toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient, lookupTask } from "@/lib/mcp/lookup";
import { describeResolveFailure, resolveByName } from "@/lib/mcp/resolve";
import { addTaskComment, createTask, getTaskDetail, updateTask } from "@/lib/app-domain/tasks";
import { createDecision, listDecisionsForClient } from "@/lib/app-domain/decisions";
import { localDateKey, localDateTimeToUtc } from "@/lib/timezone";
import { READ_ONLY, WRITES } from "@/lib/mcp/annotations";

// MCP tasks, second pass (NUX handover, 3.10.2026).
//
// The first task tools (create_task, update_task, list_tasks) covered the
// fields a person sets in the drawer. Running a real project through
// Claude needed the rest of what the task screen already does: read one
// task in full, tick its steps, leave a note in its thread, and ask the
// client a question through the portal's decisions. Every tool here calls
// lib/app-domain/* exactly like lib/mcp/tools.ts does, so client scoping,
// the close rule and the audit trail come from the same functions the
// screens use. Nothing here takes a raw id from the model.

/// Steps added in one call. Same ceiling as create_task's `steps`.
const MAX_STEPS = 15;
/// Comments returned by get_task. The thread can be long; the model needs
/// the recent conversation, not the archive.
const MAX_COMMENTS = 20;
/// Mirrors MAX_OPTIONS in lib/app-domain/decisions.ts. Checked here as
/// well so a refused call says why instead of reaching the domain's
/// plain Error, which the MCP error mapper reports as unexpected.
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 3;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

function actorOf(ctx: ServerContext): User {
  const actor = actorFromAuthInfo(ctx.http?.authInfo);
  // A portal user on the staff connector gets pointed at their own one
  // rather than a run of generic refusals (see lib/mcp/portal-tools.ts).
  if (actor.role === "CLIENT_USER") throw new PortalUserOnStaffConnectorError();
  return actor;
}

/// Shekels as the model says them, to agorot as the database stores them.
/// Rounded, because 0.1 + 0.2 is not a price anyone agreed to.
export function shekelsToMinor(amount: number | undefined | null): number | null {
  if (amount === undefined || amount === null) return null;
  return Math.round(amount * 100);
}

/// Finds the task a tool is about, by title, inside what this actor may
/// see. The client name narrows the search when titles repeat.
async function findTask(actor: User, args: { task: string; client?: string; includeDone?: boolean }) {
  let clientId: string | undefined;
  if (args.client) {
    const client = await lookupClient(actor, args.client);
    if (!client.ok) return { ok: false as const, message: client.message };
    clientId = client.value.id;
  }
  return lookupTask(actor, args.task, { clientId, includeClosed: args.includeDone });
}

const TASK_ARGS = {
  task: z.string().describe("The task's title, or enough of it to identify it."),
  client: z.string().optional().describe("Client name, to disambiguate when several tasks share a title."),
};

export function registerTaskExtraTools(server: McpServer): void {
  server.registerTool(
    "get_task",
    {
      title: "Read one task in full",
      description:
        "Reads one Ankora task with everything on it: details, owner, supervisor and approval, portal visibility and outcome, what it is waiting on, its steps with their status, recent comments and the time logged against it. Use it to answer 'where does X stand'. Identify the task by its title.",
      inputSchema: z.object({
        ...TASK_ARGS,
        includeDone: z.boolean().optional().describe("Look among completed and archived tasks too."),
      }),
      annotations: READ_ONLY,
    },
    async (args: { task: string; client?: string; includeDone?: boolean }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);

        const detail = await getTaskDetail(actor, found.value.id);
        if (!detail) return toolText("That task is not available to this user.");
        const { task, subtasks, thread, time } = detail;
        const tz = actor.timezone;

        const comments = thread
          .filter((e) => e.kind === "comment")
          .slice(0, MAX_COMMENTS)
          .map((e) => ({
            by: e.actorName,
            at: e.at.toISOString(),
            text: "body" in e ? e.body : "",
          }));

        return toolJson({
          title: task.title,
          client: task.client.name,
          status: task.status,
          priority: task.priority,
          category: task.category?.name ?? null,
          assignedTo: task.assignedTo?.name ?? null,
          supervisor: task.supervisor?.name ?? null,
          requiresApproval: task.requiresApproval,
          approvedBy: task.approvedBy?.name ?? null,
          dueDate: task.dueDate ? localDateKey(task.dueDate, tz) : null,
          details: task.description,
          clientVisible: task.clientVisible,
          clientTitle: task.clientTitle,
          outcome: task.clientOutcome,
          waitingOn: task.blockedOn,
          waitingReason: task.blockedReason,
          waitingSince: task.blockedSince ? localDateKey(task.blockedSince, tz) : null,
          steps: subtasks.map((s) => ({ title: s.title, status: s.status, assignedTo: s.assignedTo?.name ?? null })),
          stepsDone: subtasks.filter((s) => s.status === "DONE").length,
          stepsTotal: subtasks.filter((s) => s.status !== "ARCHIVED").length,
          comments,
          loggedMinutes: Math.round(time.totalSeconds / 60),
        });
      } catch (err) {
        console.error("[mcp] get_task failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "add_task_steps",
    {
      title: "Add steps to a task",
      description:
        "Adds checklist steps under an existing, unfinished task, in order. Steps are internal and never shown on the client's portal. Calling this twice adds the steps twice, so confirm before retrying.",
      inputSchema: z.object({
        ...TASK_ARGS,
        steps: z.array(z.string().min(1)).min(1).max(MAX_STEPS).describe(`One-line step titles, up to ${MAX_STEPS}.`),
      }),
      annotations: WRITES,
    },
    async (args: { task: string; client?: string; steps: string[] }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);

        const created: string[] = [];
        for (const step of args.steps) {
          try {
            await createTask(actor, { clientId: found.value.clientId, title: step, parentId: found.value.id });
            created.push(step);
          } catch (err) {
            console.error("[mcp] add_task_steps step failed", err);
            return toolJson({
              task: found.value.name,
              added: created,
              warning: `Stopped at "${step}". The steps listed in 'added' exist; add only the remaining ones if you retry.`,
            });
          }
        }
        return toolJson({ task: found.value.name, added: created });
      } catch (err) {
        console.error("[mcp] add_task_steps failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "set_task_step",
    {
      title: "Tick or untick a step",
      description:
        "Marks one step of a task as done, or reopens it. Identify the task by its title and the step by its title within that task - step titles repeat across tasks, so the task is always required.",
      inputSchema: z.object({
        ...TASK_ARGS,
        step: z.string().describe("The step's title, or enough of it to identify it within this task."),
        done: z.boolean().describe("true to mark it done, false to reopen it."),
      }),
      annotations: { ...WRITES, idempotentHint: true },
    },
    async (args: { task: string; client?: string; step: string; done: boolean }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);

        const detail = await getTaskDetail(actor, found.value.id);
        if (!detail) return toolText("That task is not available to this user.");
        const candidates = detail.subtasks
          .filter((s) => s.status !== "ARCHIVED")
          .map((s) => ({ id: s.id, name: s.title }));
        if (candidates.length === 0) return toolText(`"${found.value.name}" has no steps. Add them with add_task_steps.`);

        const step = resolveByName(args.step, candidates);
        if (step.status !== "ok") return toolText(describeResolveFailure(step, "step", candidates));

        const updated = await updateTask(actor, step.match.id, { status: args.done ? "DONE" : "OPEN" });
        const doneCount = detail.subtasks.filter((s) =>
          s.id === step.match.id ? args.done : s.status === "DONE"
        ).length;
        return toolJson({
          task: found.value.name,
          step: step.match.name,
          status: updated.status,
          stepsDone: doneCount,
          stepsTotal: candidates.length,
        });
      } catch (err) {
        console.error("[mcp] set_task_step failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "add_task_comment",
    {
      title: "Comment on a task",
      description:
        "Adds a comment to a task's thread, as the signed-in employee. Use it to record what was agreed, what someone said in a meeting, or why something is stuck. Internal: comments are never shown on the client's portal. Calling this twice posts twice.",
      inputSchema: z.object({
        ...TASK_ARGS,
        includeDone: z.boolean().optional().describe("Look among completed and archived tasks too."),
        text: z.string().min(1).max(4000).describe("The comment. Plain text or light markdown."),
      }),
      annotations: WRITES,
    },
    async (args: { task: string; client?: string; includeDone?: boolean; text: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);
        const comment = await addTaskComment(actor, found.value.id, args.text);
        return toolJson({ commented: true, task: found.value.name, at: comment.createdAt.toISOString() });
      } catch (err) {
        console.error("[mcp] add_task_comment failed", err);
        return toolFailure(err);
      }
    }
  );

  // ------------------------------------------------------------ decisions

  server.registerTool(
    "create_decision",
    {
      title: "Ask the client to decide",
      description:
        "Opens a decision on the client's portal: a question with two or three options, optionally Ankora's recommendation and an amount. Only the client's admin can answer it, and the answer is kept as a signed record. Nothing is sent to the client automatically - tell the user to let the client know. Optionally link it to a task and mark that task as waiting on the client until they answer. Calling this twice opens two decisions.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        question: z.string().min(1).describe("The question, in the client's language, as they will read it."),
        background: z.string().optional().describe("Short context the client needs to decide. Plain text."),
        options: z
          .array(
            z.object({
              label: z.string().min(1).describe("The option, in a few words."),
              detail: z.string().optional().describe("One line on what choosing it means."),
              amount: z.number().nonnegative().optional().describe("Cost of this option in shekels, when it has one."),
              recommended: z.boolean().optional().describe("Ankora's recommendation. At most one option."),
            })
          )
          .min(MIN_OPTIONS)
          .max(MAX_OPTIONS)
          .describe("Two or three options."),
        amount: z.number().nonnegative().optional().describe("The amount at stake overall, in shekels, when the decision is about money."),
        due: DATE.optional().describe("When an answer is needed, YYYY-MM-DD."),
        task: z.string().optional().describe("Title of an existing task on this client that this decision blocks."),
        markTaskWaiting: z
          .boolean()
          .optional()
          .describe("With `task`: mark that task as waiting on the client. It clears by itself when the client answers."),
      }),
      annotations: WRITES,
    },
    async (
      args: {
        client: string;
        question: string;
        background?: string;
        options: { label: string; detail?: string; amount?: number; recommended?: boolean }[];
        amount?: number;
        due?: string;
        task?: string;
        markTaskWaiting?: boolean;
      },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        if (args.options.filter((o) => o.recommended).length > 1) {
          return toolText("Only one option can be marked as recommended.");
        }
        if (args.markTaskWaiting && !args.task) {
          return toolText("markTaskWaiting needs `task` - name the task this decision blocks.");
        }

        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);

        let taskId: string | null = null;
        let taskTitle: string | null = null;
        if (args.task) {
          const task = await lookupTask(actor, args.task, { clientId: client.value.id });
          if (!task.ok) return toolText(task.message);
          taskId = task.value.id;
          taskTitle = task.value.name;
        }

        const decision = await createDecision(actor, {
          clientId: client.value.id,
          taskId,
          question: args.question,
          background: args.background ?? null,
          amountMinor: shekelsToMinor(args.amount),
          dueAt: args.due ? localDateTimeToUtc(args.due, "23:59", actor.timezone) : null,
          options: args.options.map((o) => ({
            label: o.label,
            detail: o.detail ?? null,
            amountMinor: shekelsToMinor(o.amount),
            recommended: o.recommended ?? false,
          })),
        });

        let waiting = false;
        if (taskId && args.markTaskWaiting) {
          await updateTask(actor, taskId, { block: { on: "CLIENT", reason: args.question } });
          waiting = true;
        }

        return toolJson({
          created: true,
          client: client.value.name,
          question: decision.question,
          options: decision.options.map((o) => o.label),
          linkedTask: taskTitle,
          taskMarkedWaitingOnClient: waiting,
          note: "The client is not notified automatically. Tell the user to send them a message.",
        });
      } catch (err) {
        console.error("[mcp] create_decision failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_decisions",
    {
      title: "List a client's decisions",
      description:
        "Lists the decisions Ankora has asked one client: open ones first, with their options, and answered ones with what was chosen, by whom and when.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        includeClosed: z.boolean().optional().describe("Include answered and withdrawn decisions. Off by default."),
      }),
      annotations: READ_ONLY,
    },
    async (args: { client: string; includeClosed?: boolean }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const all = await listDecisionsForClient(actor, client.value.id);
        const shown = args.includeClosed ? all : all.filter((d) => d.status === "OPEN");
        return toolJson({
          client: client.value.name,
          open: all.filter((d) => d.status === "OPEN").length,
          decisions: shown.map((d) => serializeDecision(d, actor.timezone)),
        });
      } catch (err) {
        console.error("[mcp] list_decisions failed", err);
        return toolFailure(err);
      }
    }
  );
}

type DecisionViewLike = {
  question: string;
  background: string | null;
  amountMinor: number | null;
  aboveCeiling: boolean;
  dueAt: Date | null;
  status: string;
  createdAt: Date;
  taskTitle: string | null;
  options: { label: string; detail: string | null; amountMinor: number | null; recommended: boolean }[];
  answer: { optionLabel: string; amountMinor: number | null; respondedAt: Date; respondedByName: string } | null;
};

/// One shape for both connectors. Money in shekels, dates as days, no ids:
/// the portal tools answer a decision by its question and option label.
export function serializeDecision(d: DecisionViewLike, timeZone: string) {
  const shekels = (minor: number | null) => (minor === null ? null : minor / 100);
  return {
    question: d.question,
    background: d.background,
    status: d.status,
    amount: shekels(d.amountMinor),
    aboveApprovalCeiling: d.aboveCeiling,
    due: d.dueAt ? localDateKey(d.dueAt, timeZone) : null,
    askedOn: localDateKey(d.createdAt, timeZone),
    relatedTo: d.taskTitle,
    options: d.options.map((o) => ({
      label: o.label,
      detail: o.detail,
      amount: shekels(o.amountMinor),
      recommended: o.recommended,
    })),
    answer: d.answer
      ? {
          chose: d.answer.optionLabel,
          amount: shekels(d.answer.amountMinor),
          by: d.answer.respondedByName,
          on: localDateKey(d.answer.respondedAt, timeZone),
        }
      : null,
  };
}
