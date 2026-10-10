import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { User } from "@prisma/client";
import { actorFromAuthInfo } from "@/lib/mcp/auth";
import { PortalUserOnStaffConnectorError, toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient, lookupTask, lookupTaskById } from "@/lib/mcp/lookup";
import { describeResolveFailure, resolveByName } from "@/lib/mcp/resolve";
import { addTaskComment, createTask, getTaskDetail, removeTaskSteps, updateTask } from "@/lib/app-domain/tasks";
import { createDecision, listDecisionsForClient } from "@/lib/app-domain/decisions";
import { localDateKey, localDateTimeToUtc } from "@/lib/timezone";
import { READ_ONLY, TOOL_ANNOTATIONS, WRITES } from "@/lib/mcp/annotations";
import { taskUrl } from "@/lib/mcp/serialize";
import { appBaseUrl } from "@/lib/email-templates";
import { PlanVersionConflictError, applyPlanSteps, getTaskPlans, saveTaskPlan, type TaskPlanRow } from "@/lib/app-domain/task-plans";
import { MAX_PLAN_LENGTH, MAX_PLAN_STEPS, TaskPlanRuleError } from "@/lib/task-plan-rules";

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

/// Finds the task a tool is about, inside what this actor may see.
///
/// By exact id when the model has one (the "קדם עם קלוד" prompt carries
/// it, because titles repeat), otherwise by title, with the client name
/// narrowing the search. The id is checked against client access exactly
/// like a title is, so it opens nothing a title would not.
async function findTask(actor: User, args: { task?: string; taskId?: string; client?: string; includeDone?: boolean }) {
  if (args.taskId?.trim()) return lookupTaskById(actor, args.taskId);
  if (!args.task?.trim()) {
    return { ok: false as const, message: "Say which task: pass its title in `task`, or its id in `taskId`." };
  }
  let clientId: string | undefined;
  if (args.client) {
    const client = await lookupClient(actor, args.client);
    if (!client.ok) return { ok: false as const, message: client.message };
    clientId = client.value.id;
  }
  return lookupTask(actor, args.task, { clientId, includeClosed: args.includeDone });
}

const TASK_ARGS = {
  task: z.string().optional().describe("The task's title, or enough of it to identify it. Not needed when `taskId` is given."),
  taskId: z
    .string()
    .optional()
    .describe("The task's exact id, when you have it (an Ankora prompt or an earlier tool result gives it). Preferred over the title: titles can repeat."),
  client: z.string().optional().describe("Client name, to disambiguate when several tasks share a title."),
};

/// A plan as the model reads it. Dates as the user's calendar day.
function serializePlan(p: TaskPlanRow, timeZone: string) {
  return {
    version: p.version,
    status: p.status,
    plan: p.body,
    steps: p.steps,
    writtenVia: p.origin === "MCP" ? "Claude" : "Ankora app",
    savedBy: p.createdBy?.name ?? null,
    savedOn: localDateKey(p.createdAt, timeZone),
    approvedBy: p.approvedBy?.name ?? null,
    approvedOn: p.approvedAt ? localDateKey(p.approvedAt, timeZone) : null,
    changeNote: p.changeNote,
    stepsCopiedToTask: p.stepsAppliedAt !== null,
  };
}

/// A refusal the user should hear in the domain's own words. Anything else
/// goes through toolFailure, which never echoes an unexpected error.
function planRefusal(err: unknown) {
  if (err instanceof TaskPlanRuleError) return { content: [{ type: "text" as const, text: err.message }], isError: true as const };
  return null;
}

export function registerTaskExtraTools(server: McpServer): void {
  server.registerTool(
    "get_task",
    {
      title: "Read one task in full",
      description:
        "Reads one Ankora task with everything on it: details, owner, supervisor and approval, portal visibility and outcome, what it is waiting on, its steps with their status, recent comments, the time logged against it, and its current work plan. Use it to answer 'where does X stand'. Identify the task by its title. The result includes `url`, the task's address in the Ankora app: quote it exactly when the user wants a link (it needs an Ankora staff sign-in; clients cannot open it).",
      inputSchema: z.object({
        ...TASK_ARGS,
        includeDone: z.boolean().optional().describe("Look among completed and archived tasks too."),
      }),
      annotations: READ_ONLY,
    },
    async (args: { task?: string; taskId?: string; client?: string; includeDone?: boolean }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);

        const detail = await getTaskDetail(actor, found.value.id);
        if (!detail) return toolText("That task is not available to this user.");
        const { task, subtasks, thread, time } = detail;
        const tz = actor.timezone;
        const plans = task.parentId ? null : await getTaskPlans(actor, task.id);

        const comments = thread
          .filter((e) => e.kind === "comment")
          .slice(0, MAX_COMMENTS)
          .map((e) => ({
            by: e.actorName,
            at: e.at.toISOString(),
            text: "body" in e ? e.body : "",
          }));

        return toolJson({
          id: task.id,
          url: taskUrl(appBaseUrl(), task.id),
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
          clientRequest: task.clientRequest,
          outcome: task.clientOutcome,
          waitingOn: task.blockedOn,
          waitingReason: task.blockedReason,
          waitingSince: task.blockedSince ? localDateKey(task.blockedSince, tz) : null,
          steps: subtasks.map((s) => ({ title: s.title, status: s.status, assignedTo: s.assignedTo?.name ?? null })),
          stepsDone: subtasks.filter((s) => s.status === "DONE").length,
          stepsTotal: subtasks.filter((s) => s.status !== "ARCHIVED").length,
          comments,
          loggedMinutes: Math.round(time.totalSeconds / 60),
          // "קדם עם קלוד": the current work plan, or null. Read and save
          // it with get_task_plan and save_task_plan.
          plan: plans?.current ? serializePlan(plans.current, tz) : null,
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
    async (args: { task?: string; taskId?: string; client?: string; steps: string[] }, ctx: ServerContext) => {
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
    "replace_task_steps",
    {
      title: "Replace a task's steps",
      description:
        "Replaces the checklist steps of an existing, unfinished task with a new list, in order. Steps already done, and steps with time logged against them, are kept and reported, never removed; every other step is removed. Use it when the way a process is run has changed and the old steps no longer describe it. Running it twice with the same list leaves the same result.",
      inputSchema: z.object({
        ...TASK_ARGS,
        steps: z
          .array(z.string().min(1))
          .min(1)
          .max(MAX_STEPS)
          .describe(`The new one-line step titles, in order, up to ${MAX_STEPS}.`),
      }),
      annotations: TOOL_ANNOTATIONS.replace_task_steps,
    },
    async (args: { task?: string; taskId?: string; client?: string; steps: string[] }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);

        const detail = await getTaskDetail(actor, found.value.id);
        if (!detail) return toolText("That task is not available to this user.");
        if (detail.task.parentId) return toolText(`"${found.value.name}" is itself a step. Name the task it belongs to.`);

        const result = await removeTaskSteps(
          actor,
          found.value.id,
          detail.subtasks.map((s) => s.id)
        );

        // A kept step whose title is already in the new list stays as
        // that step; adding it again would show it twice.
        const keptTitles = new Set(result.kept.map((s) => s.title.trim()));
        const added: string[] = [];
        for (const step of args.steps) {
          if (keptTitles.has(step.trim())) continue;
          try {
            await createTask(actor, { clientId: found.value.clientId, title: step, parentId: found.value.id });
            added.push(step);
          } catch (err) {
            console.error("[mcp] replace_task_steps step failed", err);
            return toolJson({
              task: found.value.name,
              removed: result.removed.map((s) => s.title),
              kept: result.kept,
              added,
              warning: `Stopped at "${step}". The old steps are already removed; run replace_task_steps again with the same list to finish.`,
            });
          }
        }
        return toolJson({
          task: found.value.name,
          removed: result.removed.map((s) => s.title),
          kept: result.kept.map((s) => ({
            title: s.title,
            why: s.why === "done" ? "already done" : "has time logged against it",
          })),
          added,
        });
      } catch (err) {
        console.error("[mcp] replace_task_steps failed", err);
        return toolFailure(err);
      }
    }
  );

  // "קדם עם קלוד" (10.10.2026): the task's work plan.
  //
  // The flow: a person copies a prompt from the task screen, Claude writes
  // a plan with them, and saves it here only once they have agreed to it.
  // Later Claude reads it back to revise it or carry it out. Versions are
  // never overwritten: a save names the version it was written against,
  // and is refused if somebody saved a newer one in between.
  server.registerTool(
    "get_task_plan",
    {
      title: "Read a task's work plan",
      description:
        "Reads the current work plan of an Ankora task, with its proposed steps and who approved it, plus how many earlier versions exist. Use it before revising or carrying out a plan, and pass its `version` as `baseVersion` when you save. Prefer `taskId` when you have it.",
      inputSchema: z.object({
        ...TASK_ARGS,
        includeDone: z.boolean().optional().describe("Look among completed and archived tasks too."),
        includeHistory: z.boolean().optional().describe("Also return the earlier versions, newest first."),
      }),
      annotations: READ_ONLY,
    },
    async (
      args: { task?: string; taskId?: string; client?: string; includeDone?: boolean; includeHistory?: boolean },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);
        const plans = await getTaskPlans(actor, found.value.id);
        if (!plans) return toolText("That task is not available to this user.");
        const tz = actor.timezone;
        return toolJson({
          taskId: found.value.id,
          task: found.value.name,
          client: found.value.clientName,
          url: taskUrl(appBaseUrl(), found.value.id),
          plan: plans.current ? serializePlan(plans.current, tz) : null,
          // What to pass as baseVersion on the next save.
          baseVersion: plans.current?.version ?? 0,
          versions: plans.versions.length,
          ...(args.includeHistory ? { history: plans.versions.slice(1).map((p) => serializePlan(p, tz)) } : {}),
        });
      } catch (err) {
        console.error("[mcp] get_task_plan failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "save_task_plan",
    {
      title: "Save a task's work plan",
      description:
        `Saves a new version of an Ankora task's work plan. Call it ONLY after the user has explicitly approved the plan in this conversation, and then with approved: true; save with approved: false only when the user asks to keep a draft. The approval is recorded in the signed-in user's name. Pass the full plan text in \`plan\` (light markdown: **bold** section labels and lists, no # headings, up to ${MAX_PLAN_LENGTH} characters) and one short imperative line per numbered step in \`steps\` (up to ${MAX_PLAN_STEPS}). \`baseVersion\` is the version you read: 0 when the task had no plan. If someone saved a newer version meanwhile, nothing is saved and the result says so; read it with get_task_plan, show the user the difference, and ask before saving again. Saving does not change the task's steps; offer apply_task_plan_steps for that. Internal: never shown to the client.`,
      inputSchema: z.object({
        ...TASK_ARGS,
        plan: z.string().min(1).max(MAX_PLAN_LENGTH).describe("The full plan text."),
        steps: z
          .array(z.string().min(1))
          .max(MAX_PLAN_STEPS)
          .optional()
          .describe("One short line per numbered step of the plan, in order."),
        approved: z.boolean().describe("true only if the user explicitly approved this plan; false saves a draft."),
        baseVersion: z.number().int().min(0).describe("The plan version you read before writing: 0 when there was none."),
        changeNote: z.string().max(300).optional().describe("What changed from the previous version, in one line, in the user's language."),
      }),
      annotations: TOOL_ANNOTATIONS.save_task_plan,
    },
    async (
      args: {
        task?: string;
        taskId?: string;
        client?: string;
        plan: string;
        steps?: string[];
        approved: boolean;
        baseVersion: number;
        changeNote?: string;
      },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);
        try {
          const saved = await saveTaskPlan(actor, found.value.id, {
            body: args.plan,
            steps: args.steps,
            approved: args.approved,
            baseVersion: args.baseVersion,
            changeNote: args.changeNote,
            origin: "MCP",
          });
          return toolJson({
            saved: true,
            taskId: found.value.id,
            task: found.value.name,
            url: taskUrl(appBaseUrl(), found.value.id),
            version: saved.version,
            status: saved.status,
            steps: saved.steps,
            next: saved.steps.length > 0 && saved.status === "APPROVED"
              ? "Ask the user whether to turn these steps into the task's steps (apply_task_plan_steps)."
              : null,
          });
        } catch (err) {
          if (err instanceof PlanVersionConflictError) {
            return toolJson({
              saved: false,
              conflict: true,
              latestVersion: err.latestVersion,
              message: "A newer version of this plan was saved after the one you read. Nothing was saved. Read it with get_task_plan, show the user what differs, and ask before saving again with that version as baseVersion.",
            });
          }
          const refusal = planRefusal(err);
          if (refusal) return refusal;
          throw err;
        }
      } catch (err) {
        console.error("[mcp] save_task_plan failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "apply_task_plan_steps",
    {
      title: "Turn a plan into the task's steps",
      description:
        "Makes the steps of a task's current, approved work plan the task's checklist steps. Open steps that are not in the plan are removed; steps already done, and steps with time logged against them, are always kept and reported. Ask the user before calling it, and tell them that. Running it twice leaves the same steps.",
      inputSchema: z.object({ ...TASK_ARGS }),
      annotations: TOOL_ANNOTATIONS.apply_task_plan_steps,
    },
    async (args: { task?: string; taskId?: string; client?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const found = await findTask(actor, args);
        if (!found.ok) return toolText(found.message);
        try {
          const result = await applyPlanSteps(actor, found.value.id);
          return toolJson({
            taskId: found.value.id,
            task: found.value.name,
            planVersion: result.version,
            added: result.added,
            removed: result.removed.map((s) => s.title),
            kept: result.kept.map((s) => ({
              title: s.title,
              why: s.why === "done" ? "already done" : "has time logged against it",
            })),
          });
        } catch (err) {
          const refusal = planRefusal(err);
          if (refusal) return refusal;
          throw err;
        }
      } catch (err) {
        console.error("[mcp] apply_task_plan_steps failed", err);
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
    async (args: { task?: string; taskId?: string; client?: string; step: string; done: boolean }, ctx: ServerContext) => {
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
    async (args: { task?: string; taskId?: string; client?: string; includeDone?: boolean; text: string }, ctx: ServerContext) => {
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
        taskId: z
          .string()
          .optional()
          .describe("The exact id of that task, when you have it (an Ankora prompt gives it). Preferred over `task`: titles can repeat."),
        markTaskWaiting: z
          .boolean()
          .optional()
          .describe("With `task` or `taskId`: mark that task as waiting on the client. It clears by itself when the client answers."),
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
        taskId?: string;
        markTaskWaiting?: boolean;
      },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        if (args.options.filter((o) => o.recommended).length > 1) {
          return toolText("Only one option can be marked as recommended.");
        }
        if (args.markTaskWaiting && !args.task && !args.taskId) {
          return toolText("markTaskWaiting needs `task` or `taskId` - name the task this decision blocks.");
        }

        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);

        let taskId: string | null = null;
        let taskTitle: string | null = null;
        if (args.taskId?.trim()) {
          // By exact id ("קדם עם קלוד", 10.10.2026), checked against client
          // access like a title, and against THIS client: a decision filed
          // on one client's portal that blocks another client's task would
          // pass every check on its own and still be wrong.
          const task = await lookupTaskById(actor, args.taskId);
          if (!task.ok) return toolText(task.message);
          if (task.value.clientId !== client.value.id) {
            return toolText(`That task belongs to ${task.value.clientName ?? "another client"}, not ${client.value.name}. Nothing was created.`);
          }
          taskId = task.value.id;
          taskTitle = task.value.name;
        } else if (args.task) {
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
