import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { describeResolveFailure, resolveByName } from "@/lib/mcp/resolve";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { prisma } from "@/lib/prisma";
import { updateImportantDate, updateImportantDateStatus } from "@/lib/app-domain/important-dates";
import { localDateKey, TIMEZONE } from "@/lib/timezone";

// 14.11.2026: changing a date already in a client's file (Ariel: "Guy's
// last day moves to 30.11"). propose_knowledge only creates dates; this
// moves, renames, annotates, pauses or archives one, the way the dates
// screen does. A date a process's rhythm made is changed with
// set_process_rhythm instead, so the rhythm and its dates never disagree.

const day = (d: Date | null) => (d ? localDateKey(d, TIMEZONE) : null);

export function registerDateTools(server: McpServer): void {
  server.registerTool(
    "update_date",
    {
      title: "Change a date in a client's file",
      description:
        "Changes one date already in a client's file (get_client_file lists them with their id): `newDate` moves a one-time or yearly date to that day; `dayOfMonth` moves a monthly one, `weekday` a weekly one; `title` and `notes` rename and annotate it; `status` PAUSED stops its reminders and tasks for now, ACTIVE resumes it, ARCHIVED retires it. Identify it by its id, or by its title. A date that a process's rhythm made is changed with set_process_rhythm. Only after the user said what to change. Answers with the date as it now stands and its next occurrence.",
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        date: z.string().describe("The date's id (from get_client_file) or its title."),
        newDate: z.string().optional().describe("YYYY-MM-DD. For a one-time date, the day itself; for a yearly date, its day and month."),
        dayOfMonth: z.number().int().min(1).max(31).optional().describe("A monthly date: its day of the month."),
        weekday: z.number().int().min(0).max(6).optional().describe("A weekly date: 0 Sunday to 6 Saturday."),
        title: z.string().min(1).max(200).optional(),
        notes: z.string().max(1000).nullable().optional().describe("Replaces the date's notes; null clears them."),
        status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
      }),
      annotations: TOOL_ANNOTATIONS.update_date,
    },
    async (
      args: { client: string; date: string; newDate?: string; dayOfMonth?: number; weekday?: number; title?: string; notes?: string | null; status?: "ACTIVE" | "PAUSED" | "ARCHIVED" },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        const rows = await prisma.importantDate.findMany({
          where: { clientId: client.value.id, deletedAt: null, sensitivity: { not: "SENSITIVE" } },
          select: { id: true, title: true, recurrence: true, processStartId: true },
        });
        const byId = rows.find((r) => r.id === args.date.trim());
        const candidates = rows.map((r) => ({ id: r.id, name: r.title }));
        const pick = byId ? { status: "ok" as const, match: { id: byId.id, name: byId.title } } : resolveByName(args.date, candidates);
        if (pick.status !== "ok") return toolText(describeResolveFailure(pick, "date", candidates));
        const row = rows.find((r) => r.id === pick.match.id)!;
        if (row.processStartId) return toolText(`"${row.title}" is a date of a process's rhythm. Change it with set_process_rhythm on that process.`);

        const input: Parameters<typeof updateImportantDate>[2] = {};
        if (args.newDate !== undefined) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(args.newDate)) return toolText("newDate must be YYYY-MM-DD.");
          if (row.recurrence !== "ONCE" && row.recurrence !== "ANNUAL") return toolText(`"${row.title}" repeats ${row.recurrence.toLowerCase()}: use dayOfMonth or weekday.`);
          const d = new Date(`${args.newDate}T00:00:00Z`);
          if (row.recurrence === "ONCE") input.onceDate = d;
          input.month = d.getUTCMonth() + 1;
          input.day = d.getUTCDate();
        }
        if (args.dayOfMonth !== undefined) {
          if (row.recurrence !== "MONTHLY") return toolText(`"${row.title}" is not monthly.`);
          input.day = args.dayOfMonth;
        }
        if (args.weekday !== undefined) {
          if (row.recurrence !== "WEEKLY") return toolText(`"${row.title}" is not weekly.`);
          input.weekday = args.weekday;
        }
        if (args.title !== undefined) input.title = args.title.trim();
        if (args.notes !== undefined) input.notes = args.notes?.trim() || null;

        if (!Object.keys(input).length && !args.status) return toolText("Nothing to change: send newDate, dayOfMonth, weekday, title, notes or status.");
        if (Object.keys(input).length) await updateImportantDate(actor, row.id, input);
        if (args.status) await updateImportantDateStatus(actor, row.id, args.status);
        const after = await prisma.importantDate.findUniqueOrThrow({ where: { id: row.id }, select: { title: true, status: true, nextOccurrenceAt: true, notes: true } });
        return toolJson({ saved: true, id: row.id, title: after.title, status: after.status, next: day(after.nextOccurrenceAt), notes: after.notes });
      } catch (err) {
        console.error("[mcp] update_date failed", err);
        return toolFailure(err);
      }
    }
  );
}
