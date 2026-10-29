import "server-only";
import { aiExcludedTaskIds } from "@/lib/app-domain/ai-exclusion-db";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { User } from "@prisma/client";
import { actorFromAuthInfo } from "@/lib/mcp/auth";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { describeResolveFailure, resolveByName } from "@/lib/mcp/resolve";
import { serializeDecision } from "@/lib/mcp/task-extra-tools";
import { READ_ONLY as PORTAL_READ_ONLY, WRITES as PORTAL_WRITES } from "@/lib/mcp/annotations";
import {
  PORTAL_STAGE_LABELS,
  getCategorySummary,
  getMonthlyDetailed,
  getPortalDashboard,
  getPortalHistory,
  getPortalHome,
  getPortalProgress,
  getPortalTimeline,
  getWeeklyActivity,
  resolvePortalClient,
  type PortalPromise,
  type PortalStage,
  type PortalStageCounts,
} from "@/lib/app-domain/client-portal";
import { getPortalDecisions, respondToDecision } from "@/lib/app-domain/decisions";
import { getApprovedSummaries } from "@/lib/app-domain/portal-summary";
import { localDateKey, localDateTimeToUtc } from "@/lib/timezone";

// The client's side of the MCP server (NUX handover, 3.10.2026).
//
// lib/mcp/tools.ts is for Ankora's staff. This file is for the people
// Ankora works FOR: a client's portal users, reaching their own portal
// from their own Claude. It is served from its own endpoint,
// /api/mcp/portal, so a client's Claude never even sees the staff tool
// list.
//
// The rules, and where each one is enforced:
//
//   * Only a CLIENT_USER gets an answer. Checked first in every tool
//     (portalActor below). Staff have the portal preview in the app and
//     the staff connector in Claude; a staff identity here is refused
//     rather than quietly mapped onto some client.
//   * The client is never an argument. Every tool calls a function in
//     lib/app-domain/client-portal.ts or decisions.ts that resolves the
//     client from the signed-in user's own membership - the exact
//     functions the portal screens call. So this surface can show a
//     client nothing their portal does not already show them: tasks only
//     when Ankora marked them visible, titles in the client's words, no
//     internal notes, no actual-time, no other client.
//   * One write, and it is the portal's one write: answering a decision,
//     which respondToDecision allows only to the client's admin.

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const MONTH = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM");
const MAX_ROWS = 200;

export const STAFF_ON_PORTAL_MESSAGE =
  "This connector is the Ankora client portal and answers only client portal users. Ankora staff should use the staff connector at /api/mcp, or the portal preview in the app. Do not retry.";

/// The acting user, or null when they are not a client portal user.
export function portalActor(ctx: ServerContext): User | null {
  const actor = actorFromAuthInfo(ctx.http?.authInfo);
  return actor.role === "CLIENT_USER" ? actor : null;
}

const minutesToHours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

function day(date: Date | null, tz: string): string | null {
  return date ? localDateKey(date, tz) : null;
}

/// A promise as the client reads it. Stage in English for the model and
/// in Hebrew as the portal labels it, so an answer can quote the screen.
function serializePromise(p: PortalPromise, tz: string) {
  return {
    title: p.title,
    stage: p.stage,
    stageLabel: PORTAL_STAGE_LABELS[p.stage],
    due: day(p.dueDate, tz),
    waitingForYouSince: day(p.waitingSince, tz),
    lastMoved: day(p.movedAt, tz),
    outcome: p.outcome,
    whatIsNeededFromYou: p.waitingFor,
    decisionsToAnswer: p.openDecisions,
  };
}

/// Progress as the model should report it, from the server's own counts
/// over ALL visible promises (getPortalProgress), never from a list the
/// model or a capped query would have to count.
export function progressOf(c: PortalStageCounts) {
  return {
    total: c.total,
    done: c.DONE,
    inProgress: c.IN_PROGRESS,
    notStarted: c.RECEIVED,
    waitingForYou: c.WAITING_ON_CLIENT,
    percentDone: c.total > 0 ? Math.round((c.DONE / c.total) * 100) : 0,
  };
}

/// The local noon of a calendar day. Noon, not midnight, so the instant
/// falls inside that day in any timezone the week/month helpers use.
function noonOf(date: string): Date {
  return localDateTimeToUtc(date, "12:00");
}

/// 28.10.2026: "בלי AI". A client who asked that nothing of theirs pass
/// through AI gets no answers through this connector either: it is an AI
/// reading their data, whoever connected it. Null when the client is not
/// marked.
async function portalAiBlocked(actor: User): Promise<string | null> {
  const { client } = await resolvePortalClient(actor);
  return client.aiExcluded
    ? 'This account is marked "בלי AI": at the client\'s own request, nothing of theirs is available through an AI connection. Tell the user to use the Ankora portal in the browser, or to ask their operations manager.'
    : null;
}

/// The promises an AI may read: none of a task marked "בלי AI".
async function aiVisible(promises: PortalPromise[]): Promise<PortalPromise[]> {
  const marked = await aiExcludedTaskIds(promises.map((p) => p.id));
  return promises.filter((p) => !marked.has(p.id));
}

/// The decisions an AI may read: none about a task marked "בלי AI".
async function aiVisibleDecisions<T extends { taskId: string | null }>(decisions: T[]): Promise<T[]> {
  const marked = await aiExcludedTaskIds(decisions.flatMap((d) => (d.taskId ? [d.taskId] : [])));
  return decisions.filter((d) => !d.taskId || !marked.has(d.taskId));
}

export function registerPortalTools(server: McpServer): void {
  server.registerTool(
    "get_status",
    {
      title: "Where things stand",
      description:
        "The client's own overview, as their Ankora portal shows it: how many of the tasks Ankora is handling for them are done, in progress or waiting for them; what is waiting for them right now; what was finished recently, with what came of it; how many decisions are waiting for their answer; and the current hour bank. Start here for any 'what's the status' question.",
      inputSchema: z.object({}),
      annotations: PORTAL_READ_ONLY,
    },
    async (_args: unknown, ctx: ServerContext) => {
      try {
        const actor = portalActor(ctx);
        if (!actor) return toolText(STAFF_ON_PORTAL_MESSAGE);
        const blocked = await portalAiBlocked(actor);
        if (blocked) return toolText(blocked);
        const tz = actor.timezone;
        const [home, counts] = await Promise.all([getPortalHome(actor), getPortalProgress(actor)]);
        return toolJson({
          client: home.client.name,
          progress: progressOf(counts),
          decisionsWaitingForYou: home.openDecisions,
          waitingForYou: (await aiVisible(home.waitingOnClient)).map((p) => serializePromise(p, tz)),
          inProgress: (await aiVisible(home.inProgress)).map((p) => serializePromise(p, tz)),
          recentlyDone: (await aiVisible(home.recentlyDone)).map((p) => serializePromise(p, tz)),
          hourBank: home.cycle
            ? {
                usedHours: minutesToHours(home.cycle.usedMinutes),
                totalHours: minutesToHours(home.cycle.totalMinutes),
                percentUsed: home.cycle.pct,
                daysLeftInCycle: home.cycle.daysLeft,
                // 12.10.2026: a prepaid package's percentage is of the
                // hours loaded; projectedDepletionDate is when they run out
                // at the last four weeks' pace.
                model: home.cycle.kind === "PREPAID" ? "prepaid_package" : "cycle",
                ...(home.cycle.kind === "PREPAID"
                  ? {
                      packageHours: minutesToHours(home.cycle.purchasedMinutes),
                      remainingHours: minutesToHours(home.cycle.remainingMinutes),
                      projectedDepletionDate:
                        home.cycle.forecast?.status === "projected" ? day(home.cycle.forecast.depletionDate, tz) : null,
                    }
                  : {}),
              }
            : null,
          accountManager: home.contact.managerName,
        });
      } catch (err) {
        console.error("[mcp-portal] get_status failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      title: "Tasks Ankora is handling",
      description:
        "Lists the tasks Ankora is handling for the client, as their portal shows them, newest movement first: each with its stage (not started, in progress, waiting for you, done), due date and, when done, what came of it. Filter by stage or by words in the title.",
      inputSchema: z.object({
        stage: z
          .enum(["RECEIVED", "IN_PROGRESS", "WAITING_ON_CLIENT", "DONE"])
          .optional()
          .describe("Only tasks at this stage. RECEIVED means not started yet."),
        search: z.string().optional().describe("Words that appear in the task title."),
      }),
      annotations: PORTAL_READ_ONLY,
    },
    async (args: { stage?: PortalStage; search?: string }, ctx: ServerContext) => {
      try {
        const actor = portalActor(ctx);
        if (!actor) return toolText(STAFF_ON_PORTAL_MESSAGE);
        const blocked = await portalAiBlocked(actor);
        if (blocked) return toolText(blocked);
        const [{ client, promises: all }, counts] = await Promise.all([getPortalTimeline(actor), getPortalProgress(actor)]);
        const promises = await aiVisible(all);
        const q = args.search?.trim().toLowerCase();
        const shown = promises
          .filter((p) => !args.stage || p.stage === args.stage)
          .filter((p) => !q || p.title.toLowerCase().includes(q));
        return toolJson({
          client: client.name,
          progress: progressOf(counts),
          count: shown.length,
          // The stream is bounded (TIMELINE_TAKE); say so rather than let
          // the model present a partial list as the whole of it.
          listTruncated: all.length < counts.total,
          tasks: shown.map((p) => serializePromise(p, actor.timezone)),
        });
      } catch (err) {
        console.error("[mcp-portal] list_tasks failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "list_decisions",
    {
      title: "Decisions Ankora asked you",
      description:
        "Lists the decisions Ankora has asked the client: open ones with their options and Ankora's recommendation, and, when asked, the ones already answered with what was chosen, by whom and when.",
      inputSchema: z.object({
        includeAnswered: z.boolean().optional().describe("Include answered and withdrawn decisions."),
      }),
      annotations: PORTAL_READ_ONLY,
    },
    async (args: { includeAnswered?: boolean }, ctx: ServerContext) => {
      try {
        const actor = portalActor(ctx);
        if (!actor) return toolText(STAFF_ON_PORTAL_MESSAGE);
        const blocked = await portalAiBlocked(actor);
        if (blocked) return toolText(blocked);
        const decisions = await getPortalDecisions(actor);
        const [open, closed] = await Promise.all([aiVisibleDecisions(decisions.open), aiVisibleDecisions(decisions.closed)]);
        const tz = actor.timezone;
        return toolJson({
          open: open.map((d) => serializeDecision(d, tz)),
          ...(args.includeAnswered ? { answered: closed.map((d) => serializeDecision(d, tz)) } : {}),
        });
      } catch (err) {
        console.error("[mcp-portal] list_decisions failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "answer_decision",
    {
      title: "Answer a decision",
      description:
        "Records the client's answer to an open decision. Only the client's admin may answer, and the answer is final: it is kept as a signed record and cannot be changed afterwards (a change of mind needs a new decision from Ankora). Always read the options back to the user and get an explicit choice before calling this. Identify the decision by its question and the choice by the option's label.",
      inputSchema: z.object({
        decision: z.string().describe("The decision's question, or enough of it to identify it."),
        option: z.string().describe("The chosen option's label, exactly as the user chose it."),
      }),
      annotations: PORTAL_WRITES,
    },
    async (args: { decision: string; option: string }, ctx: ServerContext) => {
      try {
        const actor = portalActor(ctx);
        if (!actor) return toolText(STAFF_ON_PORTAL_MESSAGE);
        const blocked = await portalAiBlocked(actor);
        if (blocked) return toolText(blocked);

        // Said here, in words, before the domain's ForbiddenError would
        // say it as a generic refusal.
        const membership = await resolvePortalClient(actor);
        if (membership.clientUserRole !== "ADMIN") {
          return toolText(
            "Only the client's admin can answer a decision, and this user is a viewer. Tell the user to ask their admin to answer it. Do not retry."
          );
        }

        const open = await aiVisibleDecisions((await getPortalDecisions(actor)).open);
        const candidates = open.map((d) => ({ id: d.id, name: d.question, view: d }));
        if (candidates.length === 0) return toolText("There are no open decisions to answer.");
        const decision = resolveByName(args.decision, candidates);
        if (decision.status !== "ok") return toolText(describeResolveFailure(decision, "open decision", candidates));

        const options = decision.match.view.options.map((o) => ({ id: o.id, name: o.label }));
        const option = resolveByName(args.option, options);
        if (option.status !== "ok") return toolText(describeResolveFailure(option, "option", options));

        await respondToDecision(actor, decision.match.id, option.match.id);
        return toolJson({
          answered: true,
          question: decision.match.name,
          chose: option.match.name,
          note: "Recorded on the portal. Ankora sees the answer; it cannot be changed from here.",
        });
      } catch (err) {
        console.error("[mcp-portal] answer_decision failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "weekly_report",
    {
      title: "Weekly activity",
      description:
        "The client's weekly activity report, as on their portal: billable hours per day, per category and per activity for one week (Sunday to Saturday). Defaults to the current week; pass any date inside another week to see that one.",
      inputSchema: z.object({
        weekOf: DATE.optional().describe("Any day in the wanted week, YYYY-MM-DD."),
      }),
      annotations: PORTAL_READ_ONLY,
    },
    async (args: { weekOf?: string }, ctx: ServerContext) => {
      try {
        const actor = portalActor(ctx);
        if (!actor) return toolText(STAFF_ON_PORTAL_MESSAGE);
        const blocked = await portalAiBlocked(actor);
        if (blocked) return toolText(blocked);
        const w = await getWeeklyActivity(actor, args.weekOf ? noonOf(args.weekOf) : undefined, { forAi: true });
        const tz = actor.timezone;
        return toolJson({
          from: day(w.from, tz),
          toExclusive: day(w.to, tz),
          totalHours: minutesToHours(w.totalMinutes),
          byDay: w.dailyTotals.map((d) => ({ date: d.date, hours: minutesToHours(d.minutes) })),
          byCategory: w.byCategory.map((c) => ({ category: c.category, hours: minutesToHours(c.minutes) })),
          topActivities: w.topActivities.map((a) => ({ activity: a.activity, hours: minutesToHours(a.minutes) })),
          entries: w.rows.slice(0, MAX_ROWS).map((r) => ({ ...r, hours: minutesToHours(r.billableMinutes) })),
        });
      } catch (err) {
        console.error("[mcp-portal] weekly_report failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "monthly_report",
    {
      title: "Monthly report",
      description:
        "The client's monthly report, as on their portal: total billable hours, hours by category with their share, how many tasks were completed, every entry, and Ankora's written summary of the month once Ankora has approved it. Defaults to the current month.",
      inputSchema: z.object({
        month: MONTH.optional().describe("The month, YYYY-MM."),
      }),
      annotations: PORTAL_READ_ONLY,
    },
    async (args: { month?: string }, ctx: ServerContext) => {
      try {
        const actor = portalActor(ctx);
        if (!actor) return toolText(STAFF_ON_PORTAL_MESSAGE);
        const blocked = await portalAiBlocked(actor);
        if (blocked) return toolText(blocked);
        const anchor = args.month ? noonOf(`${args.month}-01`) : undefined;
        const monthly = await getMonthlyDetailed(actor, anchor, { forAi: true });
        const [categories, summaries] = await Promise.all([
          getCategorySummary(actor, monthly.from, monthly.to),
          getApprovedSummaries(actor),
        ]);
        const tz = actor.timezone;
        const monthKey = day(monthly.from, tz)?.slice(0, 7);
        const summary = summaries.find((s) => day(s.periodStart, tz)?.slice(0, 7) === monthKey) ?? null;
        return toolJson({
          month: monthKey,
          totalHours: minutesToHours(monthly.totalMinutes),
          tasksCompleted: monthly.tasksCompleted,
          byCategory: categories.rows.map((r) => ({
            category: r.category,
            hours: minutesToHours(r.minutes),
            percent: r.pctOfTotal,
          })),
          summary: summary ? { text: summary.draft, approvedOn: day(summary.approvedAt, tz) } : null,
          entries: monthly.rows.slice(0, MAX_ROWS).map((r) => ({ ...r, hours: minutesToHours(r.billableMinutes) })),
          entriesTruncated: monthly.rows.length > MAX_ROWS,
        });
      } catch (err) {
        console.error("[mcp-portal] monthly_report failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "hour_bank",
    {
      title: "Hour bank",
      description:
        "The client's hour bank: the current cycle's total, used and remaining hours and how many days are left in it, plus past cycles.",
      inputSchema: z.object({}),
      annotations: PORTAL_READ_ONLY,
    },
    async (_args: unknown, ctx: ServerContext) => {
      try {
        const actor = portalActor(ctx);
        if (!actor) return toolText(STAFF_ON_PORTAL_MESSAGE);
        const blocked = await portalAiBlocked(actor);
        if (blocked) return toolText(blocked);
        const [dash, history] = await Promise.all([getPortalDashboard(actor), getPortalHistory(actor)]);
        const tz = actor.timezone;
        const u = dash.snapshot?.utilization;
        return toolJson({
          client: dash.client.name,
          current: u
            ? {
                cycleStart: day(dash.snapshot!.bank.cycleStart, tz),
                cycleEnd: day(dash.snapshot!.bank.cycleEnd, tz),
                totalHours: minutesToHours(u.totalMinutes),
                usedHours: minutesToHours(u.consumedMinutes),
                remainingHours: minutesToHours(u.remainingMinutes),
                percentUsed: u.utilizationPct,
                daysLeft: dash.daysUntilCycleEnd,
                model: dash.snapshot!.bank.kind === "PREPAID" ? "prepaid_package" : "cycle",
                ...(dash.snapshot!.bank.kind === "PREPAID"
                  ? {
                      packageHours: minutesToHours(dash.snapshot!.bank.purchasedMinutes),
                      carriedInHours: minutesToHours(dash.snapshot!.bank.rolloverInMinutes),
                      weeklyPaceHours:
                        dash.forecast && dash.forecast.weeklyMinutes !== null ? minutesToHours(dash.forecast.weeklyMinutes) : null,
                      projectedDepletionDate:
                        dash.forecast?.status === "projected" ? day(dash.forecast.depletionDate, tz) : null,
                    }
                  : {}),
              }
            : null,
          pastCycles: history.cycles.map((c) => ({
            model: c.kind === "PREPAID" ? "prepaid_package" : "cycle",
            cycleStart: day(c.cycleStart, tz),
            cycleEnd: day(c.cycleEnd, tz),
            status: c.status,
            usedHours: minutesToHours(c.consumedMinutes),
            totalHours: minutesToHours(c.totalMinutes),
            percentUsed: c.utilizationPct,
          })),
        });
      } catch (err) {
        console.error("[mcp-portal] hour_bank failed", err);
        return toolFailure(err);
      }
    }
  );
}
