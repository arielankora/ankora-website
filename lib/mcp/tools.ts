import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { actorFromAuthInfo } from "@/lib/mcp/auth";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import {
  elapsedMinutes,
  serializeClient,
  serializeTimeEntry,
  type SerializedTimeEntry,
} from "@/lib/mcp/serialize";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { getActiveTimer, listMyTimeEntries } from "@/lib/app-domain/time-entries";
import { localDateTimeToUtc } from "@/lib/timezone";

// Phase 13 (MCP server, docs/adr/0005): the tool surface.
//
// Phase 1 is READ ONLY, on purpose. docs/adr/0005 records the reasoning:
// these three tools exercise the entire chain - token -> User ->
// assertCan/listAccessibleClients -> lib/app-domain -> serialised output -
// on the smallest surface that can prove it works. Write tools land in
// Phase 2, once `createdVia` exists on TimeEntry and the RBAC integration
// tests are in place.
//
// Two conventions every tool here follows:
//
//   * It calls lib/app-domain/* and NOTHING else. No Prisma query lives in
//     this file. That is what makes the MCP surface inherit `assertCan`,
//     the UserClientAccess scoping, the audit trail and the billing rules
//     for free instead of re-deriving them - and it is why a permission
//     fix in the domain layer fixes the MCP server at the same time.
//   * It never trusts the model for identity. `userId` is taken from the
//     resolved token, never from a tool argument, so there is no shape of
//     call that reads another employee's hours.

/// Registered on every tool. `readOnlyHint` is what lets a client present
/// these as safe to call without asking - and is exactly why it must not
/// be copy-pasted onto the Phase 2 write tools.
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/// An upper bound on rows returned in one call. A model asking for "this
/// year" on a busy employee would otherwise pull several thousand entries
/// into the context in a single result.
const MAX_ENTRIES = 200;

export function registerAnkoraTools(server: McpServer): void {
  server.registerTool(
    "list_my_clients",
    {
      title: "List my clients",
      description:
        "Lists the Ankora clients the signed-in employee is allowed to log time against. Call this before any tool that takes a client name, and use the names exactly as returned. Admins see every active client; other employees see only the clients explicitly assigned to them.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async (_args: unknown, ctx: ServerContext) => {
      try {
        const actor = actorFromAuthInfo(ctx.http?.authInfo);
        const clients = await listAccessibleClients(actor);
        return toolJson({
          count: clients.length,
          clients: clients.map(serializeClient),
        });
      } catch (err) {
        console.error("[mcp] list_my_clients failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "get_active_timer",
    {
      title: "Get the running timer",
      description:
        "Returns the employee's currently running Ankora timer, or reports that none is running. Ankora allows exactly one running timer per user. Call this before starting a timer, and whenever the user asks what they are working on.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async (_args: unknown, ctx: ServerContext) => {
      try {
        const actor = actorFromAuthInfo(ctx.http?.authInfo);
        const entry = await getActiveTimer(actor.id);
        if (!entry) {
          return toolText("No timer is currently running for this user.");
        }
        // getActiveTimer includes client/category/task, which is what
        // TimeEntryLike asks for - serializeTimeEntry is structurally typed
        // precisely so this file never re-declares Prisma's generated
        // include type.
        const serialized = serializeTimeEntry(entry);
        return toolJson({
          ...serialized,
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
        "Lists the signed-in employee's own Ankora time entries, newest first. Only their own - this tool cannot read another employee's hours. `from` is inclusive and `to` is exclusive, both as YYYY-MM-DD dates interpreted in the user's own timezone (returned as `userTimezone`). Omit both for the most recent entries.",
      inputSchema: z.object({
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .optional()
          .describe("Inclusive start date, YYYY-MM-DD."),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .optional()
          .describe("Exclusive end date, YYYY-MM-DD. To cover a single day, set it to the next day."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_ENTRIES)
          .optional()
          .describe(`Maximum entries to return (default and maximum ${MAX_ENTRIES}).`),
      }),
      annotations: READ_ONLY,
    },
    async (
      args: { from?: string; to?: string; limit?: number },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorFromAuthInfo(ctx.http?.authInfo);
        // Resolved through localDateTimeToUtc against the USER's timezone,
        // never `new Date("YYYY-MM-DDT00:00:00")`. That constructor parses
        // in the *server's* local zone, which on Vercel is UTC - so on the
        // Israel winter offset a "from" of 2026-01-01 would silently
        // include entries logged on 2025-12-31 after 22:00 local. This is
        // the same class of bug lib/timezone.ts's header documents finding
        // in reports.ts and client-portal.ts.
        const entries = await listMyTimeEntries(actor.id, {
          from: args.from ? localDateTimeToUtc(args.from, "00:00", actor.timezone) : undefined,
          to: args.to ? localDateTimeToUtc(args.to, "00:00", actor.timezone) : undefined,
        });

        const limit = args.limit ?? MAX_ENTRIES;
        const page = entries.slice(0, limit);
        const serialized: SerializedTimeEntry[] = [];
        for (const entry of page) {
          serialized.push(serializeTimeEntry(entry));
        }
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
}
