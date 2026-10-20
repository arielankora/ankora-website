import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/email-templates";
import { localDateKey, localDateTimeToUtc, TIMEZONE } from "@/lib/timezone";
import { OPEN_STATUSES } from "@/lib/app-domain/tasks";
import { TASK_ASSIGNED_NOTIFICATION_TYPE } from "@/lib/app-domain/notifications";
import { describeChange, quoteComment } from "@/lib/app-domain/task-changes";
import type { TaskBlocker } from "@prisma/client";
import { listMyRoutines } from "@/lib/app-domain/process-checks";
import { listAccessibleClients } from "@/lib/app-domain/clients";

// The morning digest.
//
// Hadas, 25.9.2026: a task was opened on her and she did not notice.
// Anna starts soon and will have to know when work is handed to her
// before she has the habit of opening the app at all.
//
// The bell beside this answers "was I told". This answers the other
// half, which is "what do I do first" - and it is the half that decides
// whether somebody opens the app in the morning or waits to be chased
// on WhatsApp.
//
// Four decisions are load-bearing, and each one is somewhere this kind
// of email usually dies:
//
//   1. **Morning, not evening.** Work that arrives at ten and is
//      reported at six is reported when nothing can be done about it,
//      and all that produces is the feeling of having missed something.
//      Eight in the morning is when a person decides what today is.
//   2. **Never sent empty.** An email that arrives with nothing in it
//      is the fastest way to teach somebody to filter you, and a
//      filtered email is worse than none: everyone keeps believing it
//      arrived.
//   3. **Five lines to a group, then a count.** A list of twenty is a
//      list that gets closed.
//   4. **The subject line carries the answer.** It is read on a phone
//      without opening, and for most days it is the only part read at
//      all.
//
// Internal, to the team. The rule Ariel set on 25.9 is about clients,
// and nothing here reaches one.

/// After this many days, a wait is worth a line of its own.
///
/// Not a threshold anybody has tuned, and it should not pretend to be:
/// a week is simply the point at which "we are waiting on them" stops
/// being a fact and starts being a decision not to chase. The SOP
/// book's reminder ladder is what somebody does about it.
export const STALE_WAIT_DAYS = 7;

/// At most this many lines in the ranked list, and then a count.
///
/// Ariel, 20.10.2026: "the idea is that I understand what I need to
/// handle, by order of importance". One list, ranked, replaced the five
/// groups by kind (late, today, new, updated, signature): a grouping by
/// kind makes the reader do the ranking, and the ranking is the job.
export const RANKED_LINES = 7;

/// Long waits named in the list, at most. The rest are a count.
export const WAITING_NAMED = 3;

/// Late by at least this many days, a task stops being "do it" and
/// becomes "decide about it": do it, move its date, or close it.
export const DECIDE_AFTER_DAYS = 7;

/// At most this many change lines under one task, and then a count.
export const CHANGES_PER_TASK = 3;

/// One thing somebody else did to the task since the last digest.
export type DigestChange = {
  at: Date;
  actorName: string;
  text: string;
};

export type DigestTask = {
  id: string;
  title: string;
  clientName: string;
  dueDate: Date | null;
  priority?: string;
  /// "חדש אצלך" only: the description, or failing that the first
  /// comment. 6.10.2026: the whole of a task handed to Ariel was in a
  /// comment, and the email announcing it carried only the title.
  excerpt?: string | null;
  /// What others changed since the last digest, newest first, at most
  /// CHANGES_PER_TASK of them.
  changes?: DigestChange[];
  /// How many more changes there were beyond those.
  moreChanges?: number;
  /// "מחכה לחתימה שלך" only: whose work is stopped on the signature.
  assigneeName?: string | null;
  /// Since when it has been waiting: on this person's signature, or, for
  /// a long wait, on somebody outside.
  since?: Date | null;
  /// Long waits only: who it is waiting on.
  blockedOn?: TaskBlocker | null;
  /// Where the line leads, when it is not a task: an exception to decide,
  /// a routine check, a date. Relative to the app's base URL.
  href?: string;
  /// The grey line under the title, when it is not "client · due date".
  meta?: string;
};

export type Digest = {
  /// Past its date, and not because somebody else is holding it.
  overdue: DigestTask[];
  today: DigestTask[];
  /// Landed on this person since their last digest. The source is the
  /// notification rows the bell already writes, which is why this can
  /// say "since Thursday" on a Sunday without a second bookkeeping
  /// column to keep in sync.
  fresh: DigestTask[];
  /// Ariel, 7.10.2026. This person's open work that somebody ELSE
  /// changed since the last digest, and not already listed above: a
  /// task that is late or new carries its changes on its own line.
  updated: DigestTask[];
  /// Somebody else's work, stopped on this person's signature. In the
  /// digest because that is where work dies quietly.
  awaitingMySignature: DigestTask[];
  /// How many of this person's tasks have waited on somebody outside for
  /// more than STALE_WAIT_DAYS.
  staleWaits: number;
  /// The longest of those waits, by name, at most WAITING_NAMED. A count
  /// alone ("4 משימות ממתינות") says there is a reminder to send and not
  /// to whom, which is the half that gets it sent.
  waiting?: DigestTask[];

  // Stage 2 (20.10.2026): the things the bell already knows about that
  // ask something of this person, read from the state they are in now
  // rather than from the bell's rows, so a thing already dealt with is
  // never listed. Optional, so a digest built by hand in a test, or
  // before this, still means what it meant.

  /// Requests for an exception to a client's rule, waiting on this
  /// person's decision. Somebody is stopped on them, like a signature.
  exceptions?: DigestTask[];
  /// Routine checks this person owns that are due today or late.
  /// dueDate is the day the check fell due.
  routines?: DigestTask[];
  /// Important dates this person is responsible for, past or within
  /// DATE_HORIZON_DAYS, with no open task already carrying them.
  /// dueDate is the occurrence.
  dates?: DigestTask[];
  /// Procedures this person owns that are marked for review.
  reviews?: DigestTask[];
};

/// How far ahead an important date is worth a line in the morning.
export const DATE_HORIZON_DAYS = 7;

/// A date within this many days counts with today's work; further out it
/// comes after new work.
export const DATE_SOON_DAYS = 2;

export function isDigestEmpty(d: Digest): boolean {
  return (
    d.overdue.length === 0 &&
    d.today.length === 0 &&
    d.fresh.length === 0 &&
    d.updated.length === 0 &&
    d.awaitingMySignature.length === 0 &&
    d.staleWaits === 0 &&
    (d.exceptions?.length ?? 0) === 0 &&
    (d.routines?.length ?? 0) === 0 &&
    (d.dates?.length ?? 0) === 0 &&
    (d.reviews?.length ?? 0) === 0
  );
}

/// The subject line, and the most important twelve words in the email.
///
/// It is read on a phone without opening, and for most days it is the
/// only part read at all. Until 20.10.2026 it counted ("משימה אחת עליך,
/// אחת באיחור"), which says how much and not what. Now it names the
/// first thing in the ranked list, with its reason, and counts the rest.
export function digestSubject(d: Digest, now: Date = new Date()): string {
  const items = rankDigest(d, now);
  if (items.length === 0) {
    if (d.staleWaits === 1) return "משימה אחת ממתינה יותר משבוע";
    if (d.staleWaits > 1) return `${d.staleWaits} משימות ממתינות יותר משבוע`;
    return "הבוקר שלך";
  }
  const [first] = items;
  const head = `${first.short}: ${clip(first.task.title, SUBJECT_TITLE_CHARS)}`;
  const rest = items.length - 1 + Math.max(0, d.staleWaits - (d.waiting?.length ?? 0));
  if (rest <= 0) return head;
  return rest === 1 ? `${head}, ועוד אחת` : `${head}, ועוד ${rest}`;
}

/// A title longer than this is cut in the subject line. Phones show
/// about forty characters of a subject; the reason comes first so it is
/// never the part that is cut.
export const SUBJECT_TITLE_CHARS = 48;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/// The start of today, in Israel, as an instant.
///
/// Not `new Date()` with the hours zeroed. The repo's three standing
/// failures are all in this family, and "late" is exactly the kind of
/// word that quietly means something different at 01:00 UTC.
export function startOfLocalDay(now: Date): Date {
  return localDateTimeToUtc(localDateKey(now, TIMEZONE), "00:00", TIMEZONE);
}

/// Sunday to Thursday. The week here does not run Monday to Friday, and
/// an email on Saturday morning is an email that arrives already stale.
export function isWorkingDay(now: Date): boolean {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: TIMEZONE }).format(now);
  return day !== "Fri" && day !== "Sat";
}

/// What "new" means for a person who has never had a digest.
///
/// Yesterday morning, not the beginning of time. The alternative is a
/// first email that reports every task ever assigned to somebody as
/// news, which is the one email guaranteed to be the last one they read.
export function freshSince(user: { dailyDigestAt: Date | null }, now: Date): Date {
  return user.dailyDigestAt ?? new Date(startOfLocalDay(now).getTime() - 24 * 3600_000);
}

function toDigestTask(t: {
  id: string;
  title: string;
  dueDate: Date | null;
  priority: string;
  client: { name: string };
}): DigestTask {
  return { id: t.id, title: t.title, clientName: t.client.name, dueDate: t.dueDate, priority: t.priority };
}

const TASK_SELECT = {
  id: true,
  title: true,
  dueDate: true,
  priority: true,
  client: { select: { name: true } },
} as const;

/// The audit actions that can produce a change line. "task.create" is
/// not here: new work is "חדש אצלך", announced once.
const CHANGE_ACTIONS = [
  "task.update",
  "task.status_change",
  "task.blocked",
  "task.unblocked",
  "task.approve",
  "task.comment",
] as const;

/// Groups change lines by task, newest first, and trims each to
/// CHANGES_PER_TASK. Pure.
export function groupChanges(
  rows: { taskId: string; at: Date; actorName: string; text: string | null }[]
): Map<string, { changes: DigestChange[]; more: number }> {
  const byTask = new Map<string, DigestChange[]>();
  for (const r of rows) {
    if (!r.text) continue;
    const list = byTask.get(r.taskId) ?? [];
    list.push({ at: r.at, actorName: r.actorName, text: r.text });
    byTask.set(r.taskId, list);
  }
  const out = new Map<string, { changes: DigestChange[]; more: number }>();
  for (const [taskId, list] of byTask) {
    list.sort((a, b) => b.at.getTime() - a.at.getTime());
    out.set(taskId, {
      changes: list.slice(0, CHANGES_PER_TASK),
      more: Math.max(0, list.length - CHANGES_PER_TASK),
    });
  }
  return out;
}

/// What others changed on this person's open tasks since `since`.
async function changesOnMyTasks(
  userId: string,
  since: Date
): Promise<Map<string, { changes: DigestChange[]; more: number }>> {
  const myTasks = await prisma.task.findMany({
    where: { assignedToId: userId, deletedAt: null, status: { in: OPEN_STATUSES } },
    select: { id: true, clientId: true },
  });
  if (myTasks.length === 0) return new Map();
  const taskIds = myTasks.map((t) => t.id);
  const clientIds = [...new Set(myTasks.map((t) => t.clientId))];

  const [taskEvents, fileEvents] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        entityType: "Task",
        entityId: { in: taskIds },
        action: { in: [...CHANGE_ACTIONS] },
        createdAt: { gte: since },
        actorId: { not: null },
        NOT: { actorId: userId },
      },
      orderBy: { createdAt: "desc" },
      select: { action: true, entityId: true, actorId: true, beforeJson: true, afterJson: true, createdAt: true },
    }),
    // A file is filed against the CLIENT document, with the task in its
    // row, so it is found by client and matched to the task here.
    prisma.auditEvent.findMany({
      where: {
        action: "client_document.add",
        clientId: { in: clientIds },
        createdAt: { gte: since },
        actorId: { not: null },
        NOT: { actorId: userId },
      },
      select: { actorId: true, afterJson: true, createdAt: true },
    }),
  ]);

  const mine = new Set(taskIds);
  const files = fileEvents.filter((e) => {
    const taskId = (e.afterJson as Record<string, unknown> | null)?.taskId;
    return typeof taskId === "string" && mine.has(taskId);
  });

  const commentIds = taskEvents
    .filter((e) => e.action === "task.comment")
    .map((e) => (e.afterJson as Record<string, unknown> | null)?.commentId)
    .filter((id): id is string => typeof id === "string");
  const actorIds = [
    ...new Set([...taskEvents, ...files].map((e) => e.actorId).filter((id): id is string => Boolean(id))),
  ];

  const [comments, actors] = await Promise.all([
    commentIds.length
      ? prisma.taskComment.findMany({
          // A comment taken back is not news.
          where: { id: { in: commentIds }, deletedAt: null },
          select: { id: true, body: true },
        })
      : Promise.resolve([]),
    actorIds.length
      ? prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const commentBody = new Map(comments.map((c) => [c.id, c.body]));
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  const rows = [
    ...taskEvents.map((e) => {
      const commentId = (e.afterJson as Record<string, unknown> | null)?.commentId;
      return {
        taskId: e.entityId as string,
        at: e.createdAt,
        actorName: actorName.get(e.actorId as string) ?? "מישהו",
        text: describeChange({
          action: e.action,
          before: e.beforeJson,
          after: e.afterJson,
          commentBody: typeof commentId === "string" ? (commentBody.get(commentId) ?? null) : null,
        }),
      };
    }),
    ...files.map((e) => {
      const after = e.afterJson as Record<string, unknown> | null;
      return {
        taskId: after?.taskId as string,
        at: e.createdAt,
        actorName: actorName.get(e.actorId as string) ?? "מישהו",
        text: describeChange({
          action: "client_document.add",
          before: null,
          after,
          fileTitle: typeof after?.title === "string" ? after.title : null,
        }),
      };
    }),
  ];
  return groupChanges(rows);
}

/// The first line of a description, or the first comment when there is
/// no description. Null when nothing was written.
async function excerptsFor(taskIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (taskIds.length === 0) return out;
  const [tasks, comments] = await Promise.all([
    prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, description: true } }),
    prisma.taskComment.findMany({
      where: { taskId: { in: taskIds }, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { taskId: true, body: true },
    }),
  ]);
  for (const t of tasks) {
    if (t.description?.trim()) out.set(t.id, quoteComment(t.description));
  }
  for (const c of comments) {
    if (!out.has(c.taskId)) out.set(c.taskId, quoteComment(c.body));
  }
  return out;
}

/// When each task was sent for approval, from the audit log.
///
/// Not updatedAt: any edit moves it, and "waiting on your signature for
/// two days" has to mean two days since it was handed over, not since
/// somebody fixed a typo. Falls back to updatedAt where the log has no row.
async function sentForApprovalAt(taskIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (taskIds.length === 0) return out;
  const rows = await prisma.auditEvent.findMany({
    where: { entityType: "Task", entityId: { in: taskIds }, action: { in: ["task.update", "task.status_change"] } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, beforeJson: true, afterJson: true, createdAt: true },
  });
  // The newest row that MOVED the task into approval. A later edit that
  // left it there writes the whole row too, and is not the handover.
  const statusOf = (row: unknown) => (row && typeof row === "object" ? (row as Record<string, unknown>).status : undefined);
  for (const r of rows) {
    if (!r.entityId || out.has(r.entityId)) continue;
    if (statusOf(r.afterJson) === "PENDING_APPROVAL" && statusOf(r.beforeJson) !== "PENDING_APPROVAL") {
      out.set(r.entityId, r.createdAt);
    }
  }
  return out;
}

/// Everything in the digest that is not a task: exceptions to decide,
/// routine checks, important dates, procedures to review.
///
/// Each source is read on its own and a failure in one is logged and
/// left out. The morning email is the one thing here that must arrive:
/// a broken date table is a reason for a shorter email, not for none.
async function beyondTasks(userId: string, now: Date): Promise<Pick<Digest, "exceptions" | "routines" | "dates" | "reviews">> {
  const actor = await prisma.user.findUnique({ where: { id: userId } });
  if (!actor) return {};
  const safe = async <T>(name: string, run: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await run();
    } catch (err) {
      console.error(`daily digest: ${name} failed`, err);
      return [];
    }
  };
  const clients = await safe("clients", () => listAccessibleClients(actor));
  const clientIds = clients.map((c) => c.id);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const [exceptions, routines, dates, reviews] = await Promise.all([
    safe("exceptions", () => exceptionsToDecide(actor, clientIds, clientName)),
    safe("routines", async () =>
      (await listMyRoutines(actor, now))
        // The owner is the one reminded; a backup sees it in the app.
        .filter((r) => !r.asBackup && r.dueKey && (r.state === "DUE" || r.state === "OVERDUE"))
        .map(
          (r): DigestTask => ({
            id: `routine:${r.id}`,
            title: `${r.code} ${r.title}`,
            clientName: r.clientName,
            dueDate: localDateTimeToUtc(r.dueKey as string, "09:00", TIMEZONE),
            href: `/app/clients/${r.clientId}?tab=file#processes`,
            meta: r.checkText ? `${r.clientName} · ${r.checkText}` : r.clientName,
          })
        )
    ),
    safe("dates", () => datesAhead(userId, now, clientName)),
    safe("reviews", async () => {
      if (clientIds.length === 0) return [];
      const rows = await prisma.process.findMany({
        where: {
          deletedAt: null,
          clientId: { in: clientIds },
          reviewReason: { not: null },
          status: { in: ["ACTIVE", "PAUSED"] },
          OR: [{ ownerId: userId }, { ownerId: null, backupOwnerId: userId }],
        },
        orderBy: { updatedAt: "asc" },
        select: { id: true, clientId: true, code: true, title: true, reviewReason: true },
      });
      return rows.map(
        (p): DigestTask => ({
          id: `review:${p.id}`,
          title: `${p.code} ${p.title}`,
          clientName: clientName.get(p.clientId) ?? "",
          dueDate: null,
          href: `/app/clients/${p.clientId}?tab=file#processes`,
          meta: `${clientName.get(p.clientId) ?? ""} · ${
            p.reviewReason === "RULES" ? "לא עומד עוד בכללי הלקוח" : "הגיע מועד הסקירה התקופתית"
          }`,
        })
      );
    }),
  ]);
  return { exceptions, routines, dates, reviews };
}

/// Requests for an exception that this person may decide: the client's
/// named approvers, or, where the client named none, anyone given the
/// permission (lib/app-domain/rule-approvals.ts, same two layers).
async function exceptionsToDecide(
  actor: { id: string; canApproveExceptions: boolean },
  clientIds: string[],
  clientName: Map<string, string>
): Promise<DigestTask[]> {
  if (clientIds.length === 0) return [];
  const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, ruleApproverIds: true } });
  const mine = clients
    .filter((c) => (c.ruleApproverIds.length > 0 ? c.ruleApproverIds.includes(actor.id) : actor.canApproveExceptions))
    .map((c) => c.id);
  if (mine.length === 0) return [];
  const rows = await prisma.policyException.findMany({
    where: { clientId: { in: mine }, status: "REQUESTED" },
    orderBy: { createdAt: "asc" },
    select: { id: true, clientId: true, what: true, requestedById: true, createdAt: true, policy: { select: { title: true } } },
  });
  const people = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.requestedById))] } },
    select: { id: true, name: true },
  });
  const name = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    id: `exception:${r.id}`,
    title: `${r.policy.title}: ${r.what}`,
    clientName: clientName.get(r.clientId) ?? "",
    dueDate: null,
    since: r.createdAt,
    // The person who asked, unless it is this person: asking for one's
    // own exception and deciding it is allowed, and "עוצר אותך" is noise.
    assigneeName: r.requestedById === actor.id ? null : (name.get(r.requestedById) ?? null),
    href: `/app/clients/${r.clientId}?tab=file#rules`,
  }));
}

/// Important dates this person is responsible for that are close, or
/// past and not yet handled, and that no open task is carrying already.
///
/// A date with an open task appears as that task. One that was snoozed
/// stays quiet until its snooze ends. A sensitive date is named only as
/// "מועד רגיש": the email leaves the app, and the date screen is where
/// its details are shown to who may see them.
async function datesAhead(userId: string, now: Date, clientName: Map<string, string>): Promise<DigestTask[]> {
  const horizon = new Date(startOfLocalDay(now).getTime() + (DATE_HORIZON_DAYS + 1) * 24 * 3600_000);
  const rows = await prisma.importantDate.findMany({
    where: {
      deletedAt: null,
      responsibleUserId: userId,
      status: { in: ["ACTIVE", "NEEDS_ATTENTION"] },
      // A month back at most: a one-off date nobody closed is not news
      // every morning forever.
      nextOccurrenceAt: { gte: new Date(now.getTime() - 30 * 24 * 3600_000), lt: horizon },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
    orderBy: { nextOccurrenceAt: "asc" },
    select: { id: true, title: true, clientId: true, nextOccurrenceAt: true, sensitivity: true },
  });
  if (rows.length === 0) return [];
  const carried = await prisma.task.findMany({
    where: { importantDateId: { in: rows.map((r) => r.id) }, deletedAt: null, status: { in: OPEN_STATUSES } },
    select: { importantDateId: true },
  });
  const withTask = new Set(carried.map((t) => t.importantDateId));
  return rows
    .filter((r) => !withTask.has(r.id) && clientName.has(r.clientId))
    .map((r) => ({
      id: `date:${r.id}`,
      title: r.sensitivity === "SENSITIVE" ? "מועד רגיש" : r.title,
      clientName: clientName.get(r.clientId) ?? "",
      dueDate: r.nextOccurrenceAt,
      href: `/app/important-dates/${r.id}`,
      meta: `${clientName.get(r.clientId) ?? ""} · ${formatDue(r.nextOccurrenceAt)}`,
    }));
}

export async function buildDigest(
  user: { id: string; dailyDigestAt: Date | null },
  now: Date = new Date()
): Promise<Digest> {
  const dayStart = startOfLocalDay(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  const since = freshSince(user, now);
  const staleCutoff = new Date(now.getTime() - STALE_WAIT_DAYS * 24 * 3600_000);

  // Blocked work is left out of "late" and "today" on purpose, and it is
  // the same call the manager's stalled-promises number makes: a task
  // sitting on somebody else's answer is not a task this person failed
  // to do today. It comes back at the bottom, as a reminder to chase.
  const mine = {
    assignedToId: user.id,
    deletedAt: null,
    status: { in: OPEN_STATUSES },
    blockedOn: null,
  };

  const staleWhere = {
    assignedToId: user.id,
    deletedAt: null,
    status: { in: OPEN_STATUSES },
    blockedSince: { lt: staleCutoff },
  };

  const [overdue, today, freshNotifications, awaiting, staleWaits, waiting] = await Promise.all([
    prisma.task.findMany({
      where: { ...mine, dueDate: { lt: dayStart } },
      orderBy: { dueDate: "asc" },
      select: TASK_SELECT,
    }),
    prisma.task.findMany({
      where: { ...mine, dueDate: { gte: dayStart, lt: dayEnd } },
      orderBy: { priority: "desc" },
      select: TASK_SELECT,
    }),
    prisma.notification.findMany({
      where: {
        userId: user.id,
        type: TASK_ASSIGNED_NOTIFICATION_TYPE,
        createdAt: { gte: since },
        entityId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { entityId: true },
    }),
    prisma.task.findMany({
      where: {
        supervisorId: user.id,
        deletedAt: null,
        status: "PENDING_APPROVAL",
      },
      orderBy: { updatedAt: "asc" },
      select: { ...TASK_SELECT, updatedAt: true, assignedTo: { select: { name: true } }, parent: { select: { title: true } } },
    }),
    prisma.task.count({ where: staleWhere }),
    prisma.task.findMany({
      where: staleWhere,
      orderBy: { blockedSince: "asc" },
      take: WAITING_NAMED,
      select: { ...TASK_SELECT, blockedOn: true, blockedSince: true },
    }),
  ]);

  // Resolved from the notification rows rather than trusted from them:
  // a task can be reassigned away, closed or deleted between the bell
  // and the morning, and an email that lists it is an email that sends
  // somebody to a screen that no longer says what it said.
  const freshIds = [...new Set(freshNotifications.map((n) => n.entityId).filter((id): id is string => id !== null))];
  const fresh =
    freshIds.length === 0
      ? []
      : await prisma.task.findMany({
          where: { id: { in: freshIds }, ...mine },
          orderBy: { createdAt: "desc" },
          select: TASK_SELECT,
        });

  const overdueIds = new Set(overdue.map((t) => t.id));
  const todayIds = new Set(today.map((t) => t.id));
  // Something both new and already late is late. Saying it twice in
  // one email is how a short email stops being short.
  const freshOnly = fresh.filter((t) => !overdueIds.has(t.id) && !todayIds.has(t.id));

  const [changes, excerpts, approvalSince, more] = await Promise.all([
    changesOnMyTasks(user.id, since),
    excerptsFor(freshOnly.map((t) => t.id)),
    sentForApprovalAt(awaiting.map((t) => t.id)),
    beyondTasks(user.id, now),
  ]);

  const withChanges = (t: DigestTask): DigestTask => {
    const c = changes.get(t.id);
    return c ? { ...t, changes: c.changes, moreChanges: c.more } : t;
  };

  // A task listed in any group above carries its changes there. Only
  // the rest become "עודכן אצלך", urgent first, then most recent.
  const listed = new Set([...overdueIds, ...todayIds, ...freshOnly.map((t) => t.id)]);
  const updatedIds = [...changes.keys()].filter((id) => !listed.has(id));
  const updatedRows = updatedIds.length
    ? await prisma.task.findMany({ where: { id: { in: updatedIds } }, select: TASK_SELECT })
    : [];
  const latest = (id: string) => changes.get(id)?.changes[0]?.at.getTime() ?? 0;
  const updated = updatedRows
    .map(toDigestTask)
    .sort((a, b) => {
      const ua = a.priority === "URGENT" ? 1 : 0;
      const ub = b.priority === "URGENT" ? 1 : 0;
      return ub - ua || latest(b.id) - latest(a.id);
    })
    .map(withChanges);

  return {
    overdue: overdue.map(toDigestTask).map(withChanges),
    today: today.map(toDigestTask).map(withChanges),
    fresh: freshOnly
      .map(toDigestTask)
      .map((t) => {
        const excerpt = excerpts.get(t.id) ?? null;
        const c = withChanges(t);
        // The comment shown as the excerpt is not also a change line.
        // Hadas's note on the RIMED task would otherwise appear twice.
        const changes = c.changes?.filter((ch) => !excerpt || ch.text !== `תגובה: «${excerpt}»`);
        return { ...c, changes, excerpt };
      }),
    updated,
    awaitingMySignature: awaiting.map((t) => ({
      ...toDigestTask(t),
      assigneeName: t.assignedTo?.name ?? null,
      since: approvalSince.get(t.id) ?? t.updatedAt,
      // A step is sent for approval from its parent's screen, and the
      // parent is what the approver recognises.
      meta: t.parent ? `${t.client.name} · שלב במשימה: ${t.parent.title}` : undefined,
    })),
    staleWaits,
    waiting: waiting.map((t) => ({ ...toDigestTask(t), blockedOn: t.blockedOn, since: t.blockedSince })),
    ...more,
  };
}

function formatDue(date: Date | null): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: TIMEZONE }).format(date);
}

/// Whole Israel calendar days from `from` to `to`. Pure.
///
/// By day keys, not by milliseconds over 86,400,000: a task due
/// yesterday at 23:59 is one day late at 08:00, not zero.
export function daysBetween(from: Date, to: Date): number {
  const a = Date.parse(`${localDateKey(from, TIMEZONE)}T00:00:00Z`);
  const b = Date.parse(`${localDateKey(to, TIMEZONE)}T00:00:00Z`);
  return Math.round((b - a) / (24 * 3600_000));
}

function days(n: number): string {
  return n === 1 ? "יום אחד" : n === 2 ? "יומיים" : `${n} ימים`;
}

export type DigestTone = "red" | "amber" | "blue" | "gray";

/// One line of the ranked list: the task, why it is here, and the one
/// thing to do about it.
export type DigestItem = {
  task: DigestTask;
  /// The reason, as shown above the title. "באיחור 17 ימים".
  reason: string;
  /// The same, short enough for the subject line.
  short: string;
  tone: DigestTone;
  /// The button. Every line has exactly one, and it opens the task.
  action: string;
  /// A line under the title that is not a note from somebody: the
  /// question a long-late task actually asks.
  hint?: string;
};

const WAIT_LABEL: Record<TaskBlocker, string> = {
  CLIENT: "ממתינה ללקוח",
  SUPPLIER: "ממתינה לספק",
  INTERNAL: "ממתינה לגורם פנימי",
  OTHER: "ממתינה",
};

/// The whole email in one decision: what comes first. Pure.
///
/// The order, and why:
///   1. Somebody else stopped on this person: a signature on their work,
///      an exception they asked for. Waiting there costs two people.
///   2. Urgent work, wherever it would otherwise sit.
///   3. Late: tasks, routine checks and dates that have passed, the
///      latest first. 17 days late and one day late are different
///      mornings, and the old email printed them the same.
///   4. Today: tasks due, checks due, dates within DATE_SOON_DAYS.
///   5. New on this person.
///   6. Dates further out, up to DATE_HORIZON_DAYS.
///   7. Procedures to review.
///   8. Long waits on somebody outside, by name: a reminder to send.
///   9. Updated by somebody else, with nothing else making it urgent.
/// Inside a rank, the order the query returned is kept.
export function rankDigest(d: Digest, now: Date = new Date()): DigestItem[] {
  const items: DigestItem[] = [];
  const seen = new Set<string>();
  const push = (item: DigestItem) => {
    if (seen.has(item.task.id)) return;
    seen.add(item.task.id);
    items.push(item);
  };
  const lateness = (t: DigestTask) => (t.dueDate ? daysBetween(t.dueDate, now) : 0);

  for (const t of d.awaitingMySignature) {
    const waited = t.since ? daysBetween(t.since, now) : 0;
    const who = t.assigneeName ? ` · עוצר את ${t.assigneeName}` : "";
    push({
      task: t,
      reason: `מחכה לאישור שלך${waited > 0 ? ` ${days(waited)}` : ""}${who}`,
      short: "מחכה לאישור שלך",
      tone: "red",
      action: "לאשר",
    });
  }
  for (const t of d.exceptions ?? []) {
    const waited = t.since ? daysBetween(t.since, now) : 0;
    const who = t.assigneeName ? ` · ביקש/ה ${t.assigneeName}` : "";
    push({
      task: t,
      reason: `בקשת חריגה מחכה להחלטה שלך${waited > 0 ? ` ${days(waited)}` : ""}${who}`,
      short: "בקשת חריגה מחכה לך",
      tone: "red",
      action: "להחליט",
    });
  }

  const lateItem = (t: DigestTask): DigestItem => {
    const n = Math.max(1, lateness(t));
    const urgent = t.priority === "URGENT";
    return {
      task: t,
      reason: `${urgent ? "דחופה · " : ""}באיחור ${days(n)}`,
      short: `באיחור ${days(n)}`,
      tone: "red",
      action: "לפתוח",
      hint: n >= DECIDE_AFTER_DAYS ? "לבצע, לדחות את התאריך, או לסגור?" : undefined,
    };
  };
  const routineItem = (t: DigestTask): DigestItem => {
    const n = lateness(t);
    return n > 0
      ? { task: t, reason: `בדיקה שגרתית באיחור ${days(n)}`, short: "בדיקה שגרתית באיחור", tone: "red", action: "לבדוק" }
      : { task: t, reason: "בדיקה שגרתית להיום", short: "בדיקה שגרתית להיום", tone: "amber", action: "לבדוק" };
  };
  const dateItem = (t: DigestTask): DigestItem => {
    const n = lateness(t);
    if (n > 0) return { task: t, reason: `מועד שעבר לפני ${days(n)} ולא טופל`, short: "מועד שעבר", tone: "red", action: "לטפל" };
    if (n === 0) return { task: t, reason: "מועד היום", short: "מועד היום", tone: "amber", action: "לטפל" };
    const ahead = -n;
    return {
      task: t,
      reason: ahead === 1 ? "מועד מחר" : `מועד בעוד ${days(ahead)}`,
      short: ahead === 1 ? "מועד מחר" : `מועד בעוד ${days(ahead)}`,
      tone: ahead <= DATE_SOON_DAYS ? "amber" : "blue",
      action: "לטפל",
      hint: "אין עדיין משימה פתוחה למועד הזה.",
    };
  };
  const todayItem = (t: DigestTask): DigestItem => ({
    task: t,
    reason: t.priority === "URGENT" ? "דחופה · להיום" : "להיום",
    short: t.priority === "URGENT" ? "דחופה להיום" : "להיום",
    tone: t.priority === "URGENT" ? "red" : "amber",
    action: "לפתוח",
  });
  const freshItem = (t: DigestTask): DigestItem => ({
    task: t,
    reason: t.priority === "URGENT" ? "דחופה · חדשה אצלך" : "חדשה אצלך",
    short: t.priority === "URGENT" ? "דחופה חדשה" : "חדשה אצלך",
    tone: t.priority === "URGENT" ? "red" : "blue",
    action: "לפתוח",
  });
  const updatedItem = (t: DigestTask): DigestItem => ({
    task: t,
    reason: t.priority === "URGENT" ? "דחופה · עודכנה" : "עודכנה",
    short: t.priority === "URGENT" ? "דחופה עודכנה" : "עודכנה",
    tone: t.priority === "URGENT" ? "red" : "gray",
    action: "לפתוח",
  });

  const urgent = (t: DigestTask) => t.priority === "URGENT";
  const lateTasks = [...d.overdue].sort((a, b) => lateness(b) - lateness(a));
  for (const t of lateTasks.filter(urgent)) push(lateItem(t));
  for (const t of d.today.filter(urgent)) push(todayItem(t));
  for (const t of d.fresh.filter(urgent)) push(freshItem(t));
  for (const t of d.updated.filter(urgent)) push(updatedItem(t));

  // Late, from every source, the latest first. A stable sort keeps tasks
  // ahead of checks and dates that are exactly as late.
  const routines = d.routines ?? [];
  const dates = d.dates ?? [];
  const late = [
    ...lateTasks.map((t) => ({ t, item: lateItem(t) })),
    ...routines.filter((t) => lateness(t) > 0).map((t) => ({ t, item: routineItem(t) })),
    ...dates.filter((t) => lateness(t) > 0).map((t) => ({ t, item: dateItem(t) })),
  ].sort((a, b) => lateness(b.t) - lateness(a.t));
  for (const { item } of late) push(item);

  for (const t of d.today) push(todayItem(t));
  for (const t of routines.filter((r) => lateness(r) <= 0)) push(routineItem(t));
  for (const t of dates.filter((x) => lateness(x) <= 0 && -lateness(x) <= DATE_SOON_DAYS)) push(dateItem(t));

  for (const t of d.fresh) push(freshItem(t));
  for (const t of dates) push(dateItem(t));

  for (const t of d.reviews ?? []) {
    push({ task: t, reason: "נוהל לבדיקה", short: "נוהל לבדיקה", tone: "blue", action: "לבדוק" });
  }

  for (const t of d.waiting ?? []) {
    const label = WAIT_LABEL[t.blockedOn ?? "OTHER"];
    const waited = t.since ? daysBetween(t.since, now) : STALE_WAIT_DAYS;
    push({ task: t, reason: `${label} ${days(waited)}`, short: label, tone: "gray", action: "להזכיר" });
  }

  for (const t of d.updated) push(updatedItem(t));
  return items;
}

/// The sentence under the greeting. Says how much, and whether anybody
/// is stopped on this person, which is the one fact that changes the
/// order somebody opens things in. Pure.
export function digestLead(d: Digest, items: DigestItem[]): string {
  const hiddenWaits = Math.max(0, d.staleWaits - (d.waiting?.length ?? 0));
  const needs = items.filter((i) => i.short !== "עודכנה").length + hiddenWaits;
  const blocking = d.awaitingMySignature.length + (d.exceptions ?? []).filter((e) => e.assigneeName).length;
  const parts: string[] = [];
  if (needs === 0) {
    parts.push(items.length === 1 ? "משימה אחת שלך עודכנה." : `${items.length} משימות שלך עודכנו.`);
  } else {
    parts.push(needs === 1 ? "דבר אחד דורש אותך היום." : `${needs} דברים דורשים אותך היום.`);
  }
  if (blocking > 0 && needs > 1) {
    parts.push(blocking === 1 ? "אחד מהם עוצר מישהו אחר." : `${blocking} מהם עוצרים אחרים.`);
  }
  return parts.join(" ");
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIMEZONE }).format(
    date
  );
}

/// The small lines under a task: what was written on new work, and what
/// others changed. Pure.
export function taskNotes(t: DigestTask): string[] {
  const notes: string[] = [];
  if (t.excerpt) notes.push(`«${t.excerpt}»`);
  for (const c of t.changes ?? []) notes.push(`${c.actorName}, ${formatTime(c.at)}: ${c.text}`);
  if (t.moreChanges && t.moreChanges > 0) {
    notes.push(t.moreChanges === 1 ? "ועוד עדכון אחד" : `ועוד ${t.moreChanges} עדכונים`);
  }
  return notes;
}

const TONE_COLOR: Record<DigestTone, string> = {
  red: "#B42318",
  amber: "#B54708",
  blue: "#175CD3",
  gray: "#5A6676",
};

const INK = "#0B1B33";
const MUTED = "#5A6676";
const RULE = "#E6E9EE";

/// Free text, made safe for the HTML email and kept out of Gmail's
/// link finder.
///
/// 20.10.2026: a task titled "לבדוק אם לרכוש את הדומיין ankora360.com"
/// arrived with the domain turned into its own link, inside the link to
/// the task, so a tap on the title could open the website instead of the
/// task. A zero-width space after the dot (and after an @) is invisible
/// and stops the match. The plain-text part is left alone: it is what
/// gets copied.
export function safeText(value: string): string {
  return escapeHtml(value)
    .replace(/([A-Za-z0-9])\.([A-Za-z])/g, "$1.&#8203;$2")
    .replace(/@/g, "@&#8203;");
}

export function renderDigestEmail(d: Digest, name: string, now: Date = new Date()): { html: string; text: string } {
  const base = appBaseUrl();
  const all = rankDigest(d, now);
  const items = all.slice(0, RANKED_LINES);
  const hiddenWaits = Math.max(0, d.staleWaits - (d.waiting?.length ?? 0));
  const more = all.length - items.length;
  const lead = digestLead(d, all);
  const dayHref = `${base}/app/calendar?view=day`;

  const textLines: string[] = [`בוקר טוב ${name},`, "", lead, `היום שלך: ${dayHref}`, ""];
  const rows: string[] = [];

  items.forEach((item, i) => {
    const t = item.task;
    const href = `${base}${t.href ?? `/app/tasks/${t.id}`}`;
    const due = formatDue(t.dueDate);
    const meta = t.meta ?? [t.clientName, due ? `יעד ${due}` : ""].filter(Boolean).join(" · ");
    const notes = taskNotes(t);

    textLines.push(`${i + 1}. ${item.reason}`);
    textLines.push(`   ${t.title} · ${meta}`);
    if (item.hint) textLines.push(`   ${item.hint}`);
    for (const n of notes) textLines.push(`   ${n}`);
    textLines.push(`   ${item.action}: ${href}`, "");

    const notesHtml = notes
      .map(
        (n) =>
          `<div style="margin-top:4px;padding-inline-start:8px;border-inline-start:2px solid ${RULE};font-size:12.5px;line-height:1.55;color:#3B4A5E;">${safeText(
            n
          )}</div>`
      )
      .join("");
    const hintHtml = item.hint
      ? `<div style="margin-top:3px;font-size:12.5px;color:${INK};">${escapeHtml(item.hint)}</div>`
      : "";

    rows.push(`<tr>
  <td valign="top" style="padding:14px 0 14px 10px;border-top:1px solid ${RULE};width:24px;">
    <div style="width:22px;height:22px;line-height:22px;border-radius:11px;background:${INK};color:#FFFFFF;font-size:12px;font-weight:700;text-align:center;">${i + 1}</div>
  </td>
  <td valign="top" style="padding:14px 0;border-top:1px solid ${RULE};" dir="rtl" align="right">
    <div style="font-size:12px;font-weight:700;color:${TONE_COLOR[item.tone]};">${escapeHtml(item.reason)}</div>
    <a href="${href}" style="display:block;margin-top:2px;font-size:15px;font-weight:600;line-height:1.45;color:${INK};text-decoration:none;">${safeText(
      t.title
    )}</a>
    <div style="margin-top:2px;font-size:12.5px;color:${MUTED};">${safeText(meta)}</div>
    ${hintHtml}${notesHtml}
  </td>
  <td valign="top" style="padding:14px 10px 14px 0;border-top:1px solid ${RULE};width:1%;white-space:nowrap;" align="left">
    <a href="${href}" style="display:inline-block;padding:6px 12px;border:1px solid #C7CED8;border-radius:7px;font-size:13px;font-weight:600;color:${INK};text-decoration:none;">${escapeHtml(
      item.action
    )}</a>
  </td>
</tr>`);
  });

  const tailParts: string[] = [];
  if (more > 0) tailParts.push(more === 1 ? "ועוד משימה אחת ברשימה." : `ועוד ${more} משימות ברשימה.`);
  if (hiddenWaits > 0) {
    const also = items.length > 0 ? "ועוד " : "";
    tailParts.push(
      hiddenWaits === 1
        ? `${also}משימה אחת ממתינה למישהו יותר משבוע. אולי הגיע הזמן להזכיר.`
        : `${also}${hiddenWaits} משימות ממתינות למישהו יותר משבוע. אולי הגיע הזמן להזכיר.`
    );
  }
  const tasksHref = `${base}/app/tasks`;
  if (tailParts.length > 0) textLines.push(tailParts.join(" "), "");
  textLines.push(`כל המשימות: ${tasksHref}`);

  const tail = tailParts.length
    ? `<p style="margin:4px 0 0;padding-top:14px;border-top:1px solid ${RULE};font-size:13px;line-height:1.7;color:${MUTED};" dir="rtl" align="right">${escapeHtml(
        tailParts.join(" ")
      )} <a href="${tasksHref}" style="color:${INK};font-weight:600;">לכל המשימות</a></p>`
    : "";

  const html = `<!doctype html>
<html dir="rtl" lang="he">
  <body style="margin:0;padding:0;background:#EEF0F3;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F3;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #D9DEE5;border-radius:14px;font-family:Arial,Helvetica,sans-serif;">
            <tr>
              <td style="padding:22px 24px 8px;" dir="rtl" align="right">
                <div style="font-size:11px;font-weight:600;letter-spacing:.22em;color:#8A94A3;">ANKORA</div>
                <p style="margin:10px 0 4px;font-size:20px;font-weight:600;color:${INK};">בוקר טוב ${escapeHtml(name)}</p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3B4A5E;">${escapeHtml(lead)}</p>
                <a href="${dayHref}" style="display:inline-block;background:${INK};color:#FFFFFF;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;">פתח את היום שלי</a>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px 4px;" dir="rtl" align="right">
                <div style="font-size:12px;font-weight:600;letter-spacing:.06em;color:#8A94A3;margin-bottom:4px;">לפי סדר חשיבות</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl">${rows.join("")}</table>
                ${tail}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px 20px;font-size:12px;color:#8A94A3;" dir="rtl" align="right">
                <a href="${base}/app/profile" style="color:${MUTED};">הגדרות המייל</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { html, text: textLines.join("\n") };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/// Everyone on the team who has something to read, and nobody else.
///
/// Client users are excluded by role, not by a filter somebody has to
/// remember: this email is a view of internal work, and there is no
/// version of it a client should ever receive.
export async function sendDailyTaskDigest(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  if (!isWorkingDay(now)) return { sent: 0, skipped: 0 };

  const people = await prisma.user.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      dailyDigestByEmail: true,
      role: { in: ["SUPER_ADMIN", "ANKORA_ADMIN", "ANKORA_EMPLOYEE"] },
    },
    select: { id: true, name: true, email: true, dailyDigestAt: true },
  });

  let sent = 0;
  let skipped = 0;

  for (const person of people) {
    try {
      const digest = await buildDigest(person, now);
      if (isDigestEmpty(digest)) {
        skipped++;
        // The stamp moves anyway. Without this, a quiet Tuesday makes
        // Wednesday's "חדש אצלך" reach back two days and re-announce
        // work the person has already seen in the app.
        await prisma.user.update({ where: { id: person.id }, data: { dailyDigestAt: now } });
        continue;
      }

      const { html, text } = renderDigestEmail(digest, person.name, now);
      const result = await sendEmail({
        to: [person.email],
        subject: digestSubject(digest, now),
        text,
        html,
      });
      // Only on a send that left the building. A stamp moved after a
      // failure would swallow the day: tomorrow's email would treat
      // today's new work as already reported.
      if (result.ok) {
        await prisma.user.update({ where: { id: person.id }, data: { dailyDigestAt: now } });
        sent++;
      }
    } catch (err) {
      console.error("daily digest failed for a user:", err);
    }
  }

  return { sent, skipped };
}
