import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { User } from "@prisma/client";
import { actorFromAuthInfo } from "@/lib/mcp/auth";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import {
  elapsedMinutes,
  serializeClient,
  serializeTask,
  serializeTeamTimeEntry,
  serializeTimeEntry,
  type SerializedTimeEntry,
  type TaskLike,
} from "@/lib/mcp/serialize";
import {
  canSeeOthersTime,
  lookupAssignee,
  lookupCategory,
  lookupClient,
  lookupTask,
  lookupTeamMember,
  teamMembers,
  usableCategories,
} from "@/lib/mcp/lookup";
import { assertCan } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import {
  OPEN_STATUSES,
  assignableUsers,
  createTask,
  listTasks,
  updateTask,
} from "@/lib/app-domain/tasks";
import {
  combineWallClockTime,
  createManualEntry,
  getActiveTimer,
  listMyTimeEntries,
  listTimeEntriesForAdmin,
  startTimer,
  stopTimer,
  updateActiveTimerNote,
} from "@/lib/app-domain/time-entries";
import { localDateTimeToUtc } from "@/lib/timezone";
import { READ_ONLY, WRITES } from "@/lib/mcp/annotations";

// Phase 13/14 (MCP server, docs/adr/0005): the tool surface.
//
// Conventions every tool here follows:
//
//   * It calls lib/app-domain/* and NOTHING else. No Prisma query lives in
//     this file. That is what makes the MCP surface inherit `assertCan`,
//     the UserClientAccess scoping, the audit trail and the billing rules
//     instead of re-deriving them - and it is why a permission fix in the
//     domain layer fixes the MCP server at the same time.
//   * It never trusts the model for identity. The acting user comes from
//     the verified token, never from a tool argument.
//   * It never takes a raw id. Ids are cuids; a model given one as a
//     required argument will eventually invent it, and in a write tool
//     that means time booked against the wrong client - silent, plausible
//     and unnoticed for a month. Everything resolves by name through
//     lib/mcp/lookup.ts, against what THIS actor may see.

const MAX_ENTRIES = 200;

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const CLOCK = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Use 24-hour HH:MM");

function actorOf(ctx: ServerContext): User {
  return actorFromAuthInfo(ctx.http?.authInfo);
}

export function registerAnkoraTools(server: McpServer): void {
  // ---------------------------------------------------------------- reads

  server.registerTool(
    "list_my_clients",
    {
      title: "List my clients",
      description:
        "Lists the Ankora clients the signed-in employee is allowed to log time against. Use it when the user asks which clients they have, or when another tool reports a client name it could not match - not as a routine preamble, since every tool matches client names itself. Admins see every active client; other employees see only the clients assigned to them.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async (_args: unknown, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const clients = await listAccessibleClients(actor);
        return toolJson({ count: clients.length, clients: clients.map(serializeClient) });
      } catch (err) {
        console.error("[mcp] list_my_clients failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_categories",
    {
      title: "List categories for a client",
      description:
        "Lists the activity categories usable when logging time against one client. Every time entry needs one. Use this when the user asks what the options are, or when a category name could not be matched - the write tools match category names themselves. Some categories are global and some belong to a single client, so pass the client you are logging against.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it. Ankora matches it and says so if it is unrecognised or ambiguous."),
      }),
      annotations: READ_ONLY,
    },
    async (args: { client: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const categories = await usableCategories(client.value.id);
        return toolJson({ client: client.value.name, count: categories.length, categories });
      } catch (err) {
        console.error("[mcp] list_categories failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "get_active_timer",
    {
      title: "Get the running timer",
      description:
        "Returns the employee's currently running Ankora timer, or reports that none is running. Ankora allows exactly one running timer per user. Use it when the user asks what they are working on, or after start_timer reports that a timer is already running - not as a routine check before starting one, since start_timer refuses on its own and says what to do.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async (_args: unknown, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const entry = await getActiveTimer(actor.id);
        if (!entry) return toolText("No timer is currently running for this user.");
        return toolJson({
          ...serializeTimeEntry(entry),
          elapsedMinutes: elapsedMinutes(entry.startAt),
          userTimezone: actor.timezone,
        });
      } catch (err) {
        console.error("[mcp] get_active_timer failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_my_time_entries",
    {
      title: "List my time entries",
      description:
        "Lists the signed-in employee's own Ankora time entries, newest first. Only their own - use list_team_time_entries for anyone else. `from` is inclusive and `to` is exclusive, both as YYYY-MM-DD dates. Omit both for the most recent entries.",
      inputSchema: z.object({
        from: DATE.optional().describe("Inclusive start date, YYYY-MM-DD."),
        to: DATE.optional().describe("Exclusive end date. For a single day, set it to the next day."),
        limit: z.number().int().min(1).max(MAX_ENTRIES).optional(),
      }),
      annotations: READ_ONLY,
    },
    async (args: { from?: string; to?: string; limit?: number }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        // Resolved against the USER's timezone, never `new Date("...T00:00:00")`,
        // which parses in the server's zone (UTC on Vercel) and would pull in
        // entries from the previous evening. Same class of bug lib/timezone.ts's
        // header documents finding in reports.ts and client-portal.ts.
        const entries = await listMyTimeEntries(actor.id, {
          from: args.from ? localDateTimeToUtc(args.from, "00:00", actor.timezone) : undefined,
          to: args.to ? localDateTimeToUtc(args.to, "00:00", actor.timezone) : undefined,
        });
        const page = entries.slice(0, args.limit ?? MAX_ENTRIES);
        const serialized: SerializedTimeEntry[] = [];
        for (const entry of page) serialized.push(serializeTimeEntry(entry));
        return toolJson({
          count: page.length,
          truncated: entries.length > page.length,
          totalMatching: entries.length,
          userTimezone: actor.timezone,
          entries: serialized,
        });
      } catch (err) {
        console.error("[mcp] list_my_time_entries failed", err);
        return toolFailure(err);
      }
    }
  );

  // ------------------------------------------------------- team (admin only)

  server.registerTool(
    "list_team_members",
    {
      title: "List team members",
      description:
        "Lists the active Ankora staff whose time the signed-in user is allowed to see. Only managers and admins may call this. Use it to get exact names before calling list_team_time_entries.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async (_args: unknown, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        // Same permission the admin time-entries screen and the CSV export
        // route already gate this data on - see canSeeOthersTime.
        assertCan(actor.role, "time_entry.edit_others");
        const members = await teamMembers(actor);
        return toolJson({ count: members.length, members });
      } catch (err) {
        console.error("[mcp] list_team_members failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_team_time_entries",
    {
      title: "List a teammate's time entries",
      description:
        "Lists Ankora time entries across the team, optionally filtered to one person and/or one client. Only managers and admins may call this; an employee asking about a colleague will be refused. Answers questions like 'what did Hadas work on last week'. `from` is inclusive, `to` is exclusive, both YYYY-MM-DD.",
      inputSchema: z.object({
        person: z
          .string()
          .optional()
          .describe("Teammate's name or email. Omit for the whole team."),
        client: z.string().optional().describe("Client name. Omit for all clients."),
        from: DATE.optional(),
        to: DATE.optional(),
        limit: z.number().int().min(1).max(MAX_ENTRIES).optional(),
      }),
      annotations: READ_ONLY,
    },
    async (
      args: { person?: string; client?: string; from?: string; to?: string; limit?: number },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        assertCan(actor.role, "time_entry.edit_others");

        let userId: string | undefined;
        let personName: string | null = null;
        if (args.person) {
          const person = await lookupTeamMember(actor, args.person);
          if (!person.ok) return toolText(person.message);
          userId = person.value.id;
          personName = person.value.name;
        }

        let clientId: string | undefined;
        if (args.client) {
          const client = await lookupClient(actor, args.client);
          if (!client.ok) return toolText(client.message);
          clientId = client.value.id;
        }

        // listTimeEntriesForAdmin carries no permission check of its own -
        // see the comment on it, and the identical assertCan in
        // app/api/time-entries/export/route.ts. The gate above is what
        // authorises this call.
        const entries = await listTimeEntriesForAdmin({
          userId,
          clientId,
          from: args.from ? localDateTimeToUtc(args.from, "00:00", actor.timezone) : undefined,
          to: args.to ? localDateTimeToUtc(args.to, "00:00", actor.timezone) : undefined,
        });
        const page = entries.slice(0, args.limit ?? MAX_ENTRIES);
        const serialized = [];
        for (const entry of page) serialized.push(serializeTeamTimeEntry(entry));
        return toolJson({
          person: personName,
          count: page.length,
          truncated: entries.length > page.length,
          totalMatching: entries.length,
          timezone: actor.timezone,
          entries: serialized,
        });
      } catch (err) {
        console.error("[mcp] list_team_time_entries failed", err);
        return toolFailure(err);
      }
    }
  );

  // --------------------------------------------------------------- writes

  server.registerTool(
    "start_timer",
    {
      title: "Start a timer",
      description:
        "Starts a running Ankora timer for the signed-in employee, against one client and category. Ankora allows exactly one running timer per user: if one is already running this refuses and tells you what is running, so there is no need to check first. The entry is recorded as created through Claude.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it. Ankora matches it and says so if it is unrecognised or ambiguous."),
        category: z.string().describe("Category name. Ankora matches it against the categories usable for this client and lists them if it cannot."),
        note: z.string().optional().describe("What the user is working on. Free text, shown in Ankora."),
        task: z
          .string()
          .optional()
          .describe("Title of an existing Ankora task to log this time against, as the user referred to it."),
      }),
      annotations: WRITES,
    },
    async (args: { client: string; category: string; note?: string; task?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const category = await lookupCategory(actor, client.value.id, args.category);
        if (!category.ok) return toolText(category.message);

        // Phase 16: TimeEntry.taskId and startTimer's input have accepted a
        // task since Phase 2 - the MCP surface simply never passed one, so
        // "start a timer on this task" was impossible through Claude while
        // being a single field in the app.
        let taskId: string | null = null;
        let taskTitle: string | null = null;
        if (args.task) {
          const task = await lookupTask(actor, args.task, { clientId: client.value.id });
          if (!task.ok) return toolText(task.message);
          taskId = task.value.id;
          taskTitle = task.value.name;
        }

        const entry = await startTimer(actor, {
          clientId: client.value.id,
          categoryId: category.value.id,
          note: args.note ?? null,
          taskId,
          createdVia: "MCP",
        });
        return toolJson({
          started: true,
          client: client.value.name,
          category: category.value.name,
          task: taskTitle,
          startAt: entry.startAt.toISOString(),
          entryId: entry.id,
        });
      } catch (err) {
        console.error("[mcp] start_timer failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "stop_timer",
    {
      title: "Stop the running timer",
      description:
        "Stops the signed-in employee's running timer and records the elapsed time. Refuses if no timer is running. An optional note replaces whatever note the timer was carrying.",
      inputSchema: z.object({
        note: z.string().optional().describe("Final note for the entry. Omit to keep the existing one."),
      }),
      annotations: WRITES,
    },
    async (args: { note?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        // The id comes from the server, never from the model: there is
        // exactly one running timer per user, so asking for it would only
        // create an opportunity to stop the wrong entry.
        const running = await getActiveTimer(actor.id);
        if (!running) {
          return toolText(
            "No timer is running for this user, so there is nothing to stop. If the user meant to record time they already spent, use create_time_entry instead."
          );
        }
        const entry = await stopTimer(actor, running.id, args.note ? { note: args.note } : undefined);
        return toolJson({
          stopped: true,
          entryId: entry.id,
          actualMinutes: entry.actualSeconds === null ? null : Math.round(entry.actualSeconds / 60),
          billableMinutes: entry.billableSeconds === null ? null : Math.round(entry.billableSeconds / 60),
        });
      } catch (err) {
        console.error("[mcp] stop_timer failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "update_timer_note",
    {
      title: "Update the running timer's note",
      description:
        "Replaces the note on the signed-in employee's running timer, without stopping it. Use this when the user says what they are working on while the clock is already going.",
      inputSchema: z.object({
        note: z.string().describe("The new note. Replaces the existing one entirely."),
      }),
      annotations: { ...WRITES, idempotentHint: true },
    },
    async (args: { note: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const running = await getActiveTimer(actor.id);
        if (!running) return toolText("No timer is running for this user, so there is no note to update.");
        await updateActiveTimerNote(actor, running.id, args.note);
        return toolJson({ updated: true, entryId: running.id, note: args.note });
      } catch (err) {
        console.error("[mcp] update_timer_note failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "create_time_entry",
    {
      title: "Record time already spent",
      description:
        "Creates a completed Ankora time entry for the signed-in employee - time they already spent, rather than a running timer. Times are the wall clock in Ankora's own timezone (Asia/Jerusalem), matching what the app's manual-entry form does. Calling this twice creates two entries, so confirm with the user before retrying. Entries more than a couple of days old need `backdateReason`.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it. Ankora matches it and says so if it is unrecognised or ambiguous."),
        category: z.string().describe("Category name. Ankora matches it against the categories usable for this client and lists them if it cannot."),
        date: DATE.describe("The day the work happened, YYYY-MM-DD."),
        start: CLOCK.describe("Start time, 24-hour HH:MM."),
        end: CLOCK.describe("End time, 24-hour HH:MM. Must be after start."),
        note: z.string().optional().describe("What the work was."),
        task: z
          .string()
          .optional()
          .describe("Title of an existing Ankora task this time belongs to, as the user referred to it."),
        backdateReason: z
          .string()
          .optional()
          .describe("Why this is being recorded late. Required for older entries; Ankora will say so if it is."),
      }),
      annotations: WRITES,
    },
    async (
      args: {
        client: string;
        category: string;
        date: string;
        start: string;
        end: string;
        note?: string;
        task?: string;
        backdateReason?: string;
      },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const category = await lookupCategory(actor, client.value.id, args.category);
        if (!category.ok) return toolText(category.message);

        // combineWallClockTime, not the actor's own timezone: this is the
        // exact helper the manual-entry form uses, and an entry created
        // here must land on the same instant as the same input typed into
        // the screen. (Reads above filter by the actor's timezone, which is
        // the more correct choice for a question about "my Tuesday" - the
        // asymmetry is deliberate.)
        const startAt = combineWallClockTime(args.date, args.start);
        const endAt = combineWallClockTime(args.date, args.end);
        if (endAt <= startAt) {
          return toolText(
            `The end time (${args.end}) is not after the start time (${args.start}). Ankora does not record entries that span midnight as one row - split them into two days.`
          );
        }

        let taskId: string | null = null;
        let taskTitle: string | null = null;
        if (args.task) {
          const task = await lookupTask(actor, args.task, { clientId: client.value.id });
          if (!task.ok) return toolText(task.message);
          taskId = task.value.id;
          taskTitle = task.value.name;
        }

        const entry = await createManualEntry(actor, actor.id, {
          clientId: client.value.id,
          categoryId: category.value.id,
          startAt,
          endAt,
          note: args.note ?? null,
          taskId,
          backdateReason: args.backdateReason ?? null,
          createdVia: "MCP",
        });
        return toolJson({
          created: true,
          entryId: entry.id,
          client: client.value.name,
          category: category.value.name,
          task: taskTitle,
          startAt: entry.startAt.toISOString(),
          endAt: entry.endAt ? entry.endAt.toISOString() : null,
          actualMinutes: entry.actualSeconds === null ? null : Math.round(entry.actualSeconds / 60),
          billableMinutes: entry.billableSeconds === null ? null : Math.round(entry.billableSeconds / 60),
        });
      } catch (err) {
        console.error("[mcp] create_time_entry failed", err);
        return toolFailure(err);
      }
    }
  );

  // ---------------------------------------------------------------- tasks
  //
  // Phase 16. Tasks existed in Ankora since Phase 9, with assignee and due
  // date added in Phase 10 and written by the important-dates job ever
  // since - but no read or write path exposed either. The domain functions
  // these tools call were completed in the same change; see the Phase 16
  // note at the top of lib/app-domain/tasks.ts.
  //
  // Note what these tools do NOT assert: `time_entry.edit_others`. Task
  // visibility has always followed client access, not the hours
  // permission, and assignableUsers() keeps assignment inside the same
  // boundary.

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Lists Ankora tasks on the clients the signed-in employee works with. Defaults to unfinished tasks (open and in progress) assigned to nobody in particular - pass `mine: true` for the user's own plate, or `overdue: true` for anything past its due date. Answers 'what do I need to do today', 'what's overdue', 'what's open on this client'.",
      inputSchema: z.object({
        client: z.string().optional().describe("Client name, as the user said it. Omit for all clients."),
        mine: z.boolean().optional().describe("Only tasks assigned to the signed-in employee."),
        person: z
          .string()
          .optional()
          .describe("Only tasks assigned to this colleague, by name or email. Requires `client`. Ignored when `mine` is set."),
        unassigned: z.boolean().optional().describe("Only tasks with nobody assigned."),
        overdue: z.boolean().optional().describe("Only tasks whose due date has passed."),
        dueBy: DATE.optional().describe("Only tasks due on or before this date, YYYY-MM-DD."),
        includeDone: z.boolean().optional().describe("Include completed and archived tasks. Off by default."),
        limit: z.number().int().min(1).max(MAX_ENTRIES).optional(),
      }),
      annotations: READ_ONLY,
    },
    async (
      args: {
        client?: string;
        mine?: boolean;
        person?: string;
        unassigned?: boolean;
        overdue?: boolean;
        dueBy?: string;
        includeDone?: boolean;
        limit?: number;
      },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);

        let clientId: string | undefined;
        let clientName: string | null = null;
        if (args.client) {
          const client = await lookupClient(actor, args.client);
          if (!client.ok) return toolText(client.message);
          clientId = client.value.id;
          clientName = client.value.name;
        }

        let assignedToId: string | undefined;
        if (args.mine) {
          assignedToId = actor.id;
        } else if (args.person) {
          if (!clientId) {
            return toolText(
              "Filtering by colleague needs a client too, because who may be assigned work is decided per client. Pass `client` as well, or use `mine` for your own tasks."
            );
          }
          const person = await lookupAssignee(actor, clientId, args.person);
          if (!person.ok) return toolText(person.message);
          assignedToId = person.value.id;
        }

        const now = new Date();
        // `overdue` and `dueBy` are the same filter with a different
        // cutoff; when both arrive, the tighter one wins rather than
        // silently dropping one of the user's two conditions.
        const dueBy = args.dueBy ? localDateTimeToUtc(args.dueBy, "23:59", actor.timezone) : undefined;
        const dueBefore =
          args.overdue && dueBy ? new Date(Math.min(now.getTime(), dueBy.getTime())) : args.overdue ? now : dueBy;

        const tasks = await listTasks(actor, {
          clientId,
          assignedToId,
          unassigned: args.unassigned || undefined,
          dueBefore,
          statusIn: args.includeDone ? undefined : OPEN_STATUSES,
        });

        const page = tasks.slice(0, args.limit ?? MAX_ENTRIES);
        return toolJson({
          client: clientName,
          count: page.length,
          truncated: tasks.length > page.length,
          totalMatching: tasks.length,
          userTimezone: actor.timezone,
          tasks: page.map((t: TaskLike) => serializeTask(t, { timeZone: actor.timezone, now })),
        });
      } catch (err) {
        console.error("[mcp] list_tasks failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_assignable_people",
    {
      title: "List who a task can be assigned to",
      description:
        "Lists the colleagues who can be given a task on one client. Only people with access to that client appear, because anyone else would never see the task. Use this when the user asks who could take something on, or when create_task/update_task reports a person it could not match - those tools match names themselves.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it. Ankora matches it and says so if it is unrecognised or ambiguous."),
      }),
      annotations: READ_ONLY,
    },
    async (args: { client: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const people = await assignableUsers(actor, client.value.id);
        return toolJson({ client: client.value.name, count: people.length, people });
      } catch (err) {
        console.error("[mcp] list_assignable_people failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "create_task",
    {
      title: "Open a task",
      description:
        "Creates a new Ankora task on one client. The task is visible to everyone who works on that client. Assigning it to a colleague is allowed only if they have access to that client; pass the name the user said and Ankora will refuse with the usable names if it does not match. Calling this twice creates two tasks, so confirm the title, client and owner with the user before retrying.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it. Ankora matches it and says so if it is unrecognised or ambiguous."),
        title: z.string().min(1).describe("What needs to be done. One line, as a person would write it."),
        category: z.string().optional().describe("Category name. Omit unless the user named one."),
        assignTo: z
          .string()
          .optional()
          .describe("Colleague's name or email. Omit to leave it unassigned; pass the user's own name for themselves."),
        due: DATE.optional().describe("Due date, YYYY-MM-DD. Treated as the end of that day in the user's timezone."),
        details: z
          .string()
          .optional()
          .describe(
            "Everything a colleague needs to pick this up without asking: an address, a reference number, what was already tried. Markdown for emphasis, lists and links; no headings or tables. Omit when the title says it all."
          ),
        priority: z
          .enum(["LOW", "NORMAL", "HIGH", "URGENT"])
          .optional()
          .describe("How urgent. Omit unless the user said so - NORMAL is the default and most work is ordinary."),
      }),
      annotations: WRITES,
    },
    async (
      args: {
        client: string;
        title: string;
        category?: string;
        assignTo?: string;
        due?: string;
        details?: string;
        priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
      },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);

        let categoryId: string | null = null;
        let categoryName: string | null = null;
        if (args.category) {
          const category = await lookupCategory(actor, client.value.id, args.category);
          if (!category.ok) return toolText(category.message);
          categoryId = category.value.id;
          categoryName = category.value.name;
        }

        let assignedToId: string | null = null;
        let assigneeName: string | null = null;
        if (args.assignTo) {
          const person = await lookupAssignee(actor, client.value.id, args.assignTo);
          if (!person.ok) return toolText(person.message);
          assignedToId = person.value.id;
          assigneeName = person.value.name;
        }

        const task = await createTask(actor, {
          clientId: client.value.id,
          categoryId,
          title: args.title,
          description: args.details ?? null,
          priority: args.priority,
          assignedToId,
          // End of the due day, not its start: a task due today should not
          // read as overdue at nine in the morning.
          dueDate: args.due ? localDateTimeToUtc(args.due, "23:59", actor.timezone) : null,
        });

        return toolJson({
          created: true,
          taskId: task.id,
          title: task.title,
          client: client.value.name,
          category: categoryName,
          assignedTo: assigneeName,
          dueDate: args.due ?? null,
          status: task.status,
          priority: task.priority,
        });
      } catch (err) {
        console.error("[mcp] create_task failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      title: "Update a task",
      description:
        "Changes an existing Ankora task: its status, owner, due date, title or category. Identify the task by its title; if two tasks share one, Ankora will say so rather than guess. Only the fields you pass are changed - omitting a field leaves it alone. Use `clearAssignee` or `clearDue` to empty a field rather than passing an empty string. Finishing a task the client can see also needs `outcome`, one sentence in their language saying what came of it; Ankora refuses the close without it, because that sentence is what the client reads on their portal.",
      inputSchema: z.object({
        task: z.string().describe("The task's title, or enough of it to identify it."),
        client: z.string().optional().describe("Client name, to disambiguate when several tasks share a title."),
        includeDone: z
          .boolean()
          .optional()
          .describe("Look among completed and archived tasks too - needed to reopen something already finished."),
        status: z
          .enum(["OPEN", "IN_PROGRESS", "DONE", "ARCHIVED"])
          .optional()
          .describe("New status. DONE means finished; ARCHIVED means dropped without being done."),
        title: z.string().min(1).optional().describe("New title, replacing the old one."),
        category: z.string().optional().describe("New category for the task."),
        assignTo: z.string().optional().describe("Colleague's name or email to hand it to."),
        clearAssignee: z.boolean().optional().describe("Remove the current owner, leaving it unassigned."),
        due: DATE.optional().describe("New due date, YYYY-MM-DD."),
        clearDue: z.boolean().optional().describe("Remove the due date."),
        details: z
          .string()
          .optional()
          .describe(
            "Replace the task's details with this. Markdown for emphasis, lists and links. Pass an empty string to clear them."
          ),
        priority: z
          .enum(["LOW", "NORMAL", "HIGH", "URGENT"])
          .optional()
          .describe("New priority."),
        outcome: z
          .string()
          .min(1)
          .optional()
          .describe(
            "One sentence, in the client's own language, saying what actually came of this. Required to finish a task the client can see - Ankora refuses DONE without it. Write what happened, not what it was called: the client reads this on their portal and it goes into their monthly summary."
          ),
      }),
      annotations: { ...WRITES, idempotentHint: true },
    },
    async (
      args: {
        task: string;
        client?: string;
        includeDone?: boolean;
        status?: "OPEN" | "IN_PROGRESS" | "DONE" | "ARCHIVED";
        title?: string;
        category?: string;
        assignTo?: string;
        clearAssignee?: boolean;
        due?: string;
        clearDue?: boolean;
        details?: string;
        priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
        outcome?: string;
      },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);

        if (args.assignTo && args.clearAssignee) {
          return toolText("Pass either assignTo or clearAssignee, not both - they contradict each other.");
        }
        if (args.due && args.clearDue) {
          return toolText("Pass either due or clearDue, not both - they contradict each other.");
        }

        let clientId: string | undefined;
        if (args.client) {
          const client = await lookupClient(actor, args.client);
          if (!client.ok) return toolText(client.message);
          clientId = client.value.id;
        }

        const found = await lookupTask(actor, args.task, {
          clientId,
          includeClosed: args.includeDone,
        });
        if (!found.ok) return toolText(found.message);

        // The task's OWN client, not the optional `client` argument: that
        // one is only a disambiguation hint and may well be absent, while
        // an assignee or a category must be validated against the client
        // the task actually sits on.
        const taskClientId = found.value.clientId;

        const patch: Parameters<typeof updateTask>[2] = {};
        if (args.status !== undefined) patch.status = args.status;
        if (args.title !== undefined) patch.title = args.title;
        if (args.clearAssignee) patch.assignedToId = null;
        if (args.clearDue) patch.dueDate = null;
        if (args.due !== undefined) patch.dueDate = localDateTimeToUtc(args.due, "23:59", actor.timezone);
        if (args.outcome !== undefined) patch.clientOutcome = args.outcome;
        // An empty string is the model's only way to say "clear this",
        // since the schema has no clearDetails flag - updateTask already
        // reads a blank string as null.
        if (args.details !== undefined) patch.description = args.details;
        if (args.priority !== undefined) patch.priority = args.priority;

        if (args.category !== undefined) {
          const category = await lookupCategory(actor, taskClientId, args.category);
          if (!category.ok) return toolText(category.message);
          patch.categoryId = category.value.id;
        }
        if (args.assignTo !== undefined) {
          const person = await lookupAssignee(actor, taskClientId, args.assignTo);
          if (!person.ok) return toolText(person.message);
          patch.assignedToId = person.value.id;
        }

        if (Object.keys(patch).length === 0) {
          return toolText("Nothing to change - pass at least one of status, title, category, assignTo, due or outcome.");
        }

        const updated = await updateTask(actor, found.value.id, patch);
        return toolJson({
          updated: true,
          taskId: updated.id,
          title: updated.title,
          status: updated.status,
          client: found.value.clientName,
          changed: Object.keys(patch),
        });
      } catch (err) {
        console.error("[mcp] update_task failed", err);
        return toolFailure(err);
      }
    }
  );
}

export { TOOL_ANNOTATIONS, TEAM_TOOLS, WRITE_TOOLS } from "@/lib/mcp/annotations";
export { canSeeOthersTime };
