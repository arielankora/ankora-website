import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { User } from "@prisma/client";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupClient } from "@/lib/mcp/lookup";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import {
  asOfCutoff,
  getHourBankStatement,
  type BankFiguresAt,
  type HourBankStatement,
} from "@/lib/app-domain/hour-bank-statement";
import { dayStartInZone, localDateKey } from "@/lib/timezone";

// 1.11.2026: get_hours_bank. What the "בנק שעות" screen shows for one
// client, as of a date, in whole minutes. Built for the weekly RIMED
// report, which used to rebuild the balance from entries and a typed
// anchor.
//
// Who sees what (Ariel, 1.11.2026): anyone who works on the client (an
// admin, or an employee assigned to it, the same set lookupClient
// resolves) gets the figures. Only managers get the adjustments and their
// reasons, and those come under `internalOnly`, flagged as not for the
// client: a reason such as "a free hour on us" must not reach a report.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function seesAdjustments(actor: Pick<User, "role">): boolean {
  return actor.role === "SUPER_ADMIN" || actor.role === "ANKORA_ADMIN";
}

const day = (d: Date) => localDateKey(d);

function packageOut(f: BankFiguresAt) {
  return {
    kind: f.kind === "PREPAID" ? "prepaid_package" : "cycle",
    sizeMinutes: f.utilization.purchasedMinutes,
    loadedOn: day(f.loadedAt),
    validUntil: day(f.validUntil),
    status: f.status,
  };
}

export function serializeStatement(
  statement: HourBankStatement,
  opts: { client: string; asOf: string | null; since: string | null; withAdjustments: boolean; now: Date }
) {
  const a = statement.active;
  const base = {
    client: opts.client,
    asOf: opts.asOf ?? `${day(opts.now)} (now)`,
    units:
      "All values are whole minutes, never decimal hours. Convert to HH:MM only for display. A balance can be negative.",
  };
  if (!a) {
    return {
      ...base,
      activePackage: null,
      message: opts.asOf ? `No hour bank or package had started by ${opts.asOf}.` : "This client has no hour bank or package.",
      newPackageLoadedSince: statement.newPackageLoadedSince,
    };
  }
  const u = a.utilization;
  return {
    ...base,
    activePackage: packageOut(a),
    carriedInMinutes: u.rolloverInMinutes,
    consumedBillableMinutes: u.consumedMinutes,
    totalMinutes: u.totalMinutes,
    usedMinutes: a.usedMinutes,
    usedMinutesMeaning:
      a.kind === "PREPAID"
        ? "As on the screen's main card: how much of the package loaded is gone, with the carried-in balance and adjustments counted."
        : "As on the screen's main card: billable minutes in the cycle.",
    balanceMinutes: u.remainingMinutes,
    utilizationPct: u.utilizationPct,
    internalOnly: opts.withAdjustments
      ? {
          doNotSendToClient: true,
          adjustmentsTotalMinutes: u.adjustmentMinutes,
          adjustments: a.adjustments.map((x) => ({ minutes: x.minutes, reason: x.reason, effectiveOn: day(x.effectiveAt) })),
        }
      : { doNotSendToClient: true, note: "Adjustments are shown to managers only. They are already counted in totalMinutes and balanceMinutes." },
    previousPackages: statement.previous.map((p) => ({
      ...packageOut(p),
      carriedInMinutes: p.utilization.rolloverInMinutes,
      consumedBillableMinutes: p.utilization.consumedMinutes,
      closingBalanceMinutes: p.utilization.remainingMinutes,
    })),
    newPackageLoadedSince: opts.since
      ? { since: opts.since, loaded: statement.newPackageLoadedSince === true }
      : null,
  };
}

export function registerHourBankTools(server: McpServer): void {
  server.registerTool(
    "get_hours_bank",
    {
      title: "Get a client's hour bank balance",
      description: [
        "What the Hour Banks screen shows for one client: the active package or cycle (size, load date, expiry), the balance carried in from the previous one, billable minutes used since the load, the total, the screen's \"used\" figure, and the balance, which can be negative. Also the previous packages with their closing balance.",
        "Every value is in whole minutes. `asOf` (YYYY-MM-DD) gives the state at the end of that day, Israel time: entries that started by then, adjustments that took effect by then. Without it, the figures match the screen now.",
        "`since` (YYYY-MM-DD) answers whether a new package was loaded from that day on, for a period report.",
        "Adjustments and their reasons are internal: managers get them under `internalOnly`, and they must never be copied into anything sent to the client.",
      ].join(" "),
      inputSchema: z.object({
        client: z.string().describe("Client name, as the user said it."),
        asOf: z.string().optional().describe("YYYY-MM-DD. The state at the end of this day, Israel time. Omit for now."),
        since: z.string().optional().describe("YYYY-MM-DD. Report whether a package was loaded on or after this day."),
      }),
      annotations: TOOL_ANNOTATIONS.get_hours_bank,
    },
    async (args: { client: string; asOf?: string; since?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const client = await lookupClient(actor, args.client);
        if (!client.ok) return toolText(client.message);
        if (args.asOf && !DATE.test(args.asOf)) return toolText("asOf must be YYYY-MM-DD.");
        if (args.since && !DATE.test(args.since)) return toolText("since must be YYYY-MM-DD.");
        const cutoff = args.asOf ? asOfCutoff(args.asOf) : null;
        if (cutoff === undefined) return toolText("asOf is not a valid date.");
        const since = args.since ? dayStartInZone(args.since) : null;
        if (since === undefined) return toolText("since is not a valid date.");

        const now = new Date();
        const statement = await getHourBankStatement(client.value.id, { cutoff, since, now });
        return toolJson(
          serializeStatement(statement, {
            client: client.value.name,
            asOf: args.asOf ?? null,
            since: args.since ?? null,
            withAdjustments: seesAdjustments(actor),
            now,
          })
        );
      } catch (err) {
        console.error("[mcp] get_hours_bank failed", err);
        return toolFailure(err);
      }
    }
  );
}
