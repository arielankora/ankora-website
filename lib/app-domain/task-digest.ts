import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/email-templates";
import { localDateKey, localDateTimeToUtc, TIMEZONE } from "@/lib/timezone";
import { OPEN_STATUSES } from "@/lib/app-domain/tasks";
import { TASK_ASSIGNED_NOTIFICATION_TYPE } from "@/lib/app-domain/notifications";

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

/// At most this many lines per group, and then a count.
export const LINES_PER_GROUP = 5;

export type DigestTask = {
  id: string;
  title: string;
  clientName: string;
  dueDate: Date | null;
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
  /// Somebody else's work, stopped on this person's signature. In the
  /// digest because that is where work dies quietly.
  awaitingMySignature: DigestTask[];
  /// Not a list. One sentence, because the action is a reminder rather
  /// than an afternoon of work.
  staleWaits: number;
};

export function isDigestEmpty(d: Digest): boolean {
  return (
    d.overdue.length === 0 &&
    d.today.length === 0 &&
    d.fresh.length === 0 &&
    d.awaitingMySignature.length === 0 &&
    d.staleWaits === 0
  );
}

/// The subject line, and the most important twelve words in the email.
///
/// Leads with whatever is most urgent, because on a phone this is often
/// the whole message. "3 משימות עליך" and "3 משימות עליך, אחת באיחור"
/// ask for two completely different mornings.
export function digestSubject(d: Digest): string {
  const mine = d.overdue.length + d.today.length + d.fresh.length;
  const parts: string[] = [];

  if (mine > 0) parts.push(mine === 1 ? "משימה אחת עליך" : `${mine} משימות עליך`);
  if (d.overdue.length > 0) {
    parts.push(d.overdue.length === 1 ? "אחת באיחור" : `${d.overdue.length} באיחור`);
  }
  if (mine === 0 && d.awaitingMySignature.length > 0) {
    parts.push(
      d.awaitingMySignature.length === 1 ? "משימה אחת מחכה לחתימה שלך" : `${d.awaitingMySignature.length} מחכות לחתימה שלך`
    );
  }
  if (parts.length === 0 && d.staleWaits > 0) parts.push("יש מה להזכיר ללקוחות");

  return parts.join(", ") || "הבוקר שלך";
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
  client: { name: string };
}): DigestTask {
  return { id: t.id, title: t.title, clientName: t.client.name, dueDate: t.dueDate };
}

const TASK_SELECT = {
  id: true,
  title: true,
  dueDate: true,
  client: { select: { name: true } },
} as const;

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

  const [overdue, today, freshNotifications, awaiting, staleWaits] = await Promise.all([
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
      select: TASK_SELECT,
    }),
    prisma.task.count({
      where: {
        assignedToId: user.id,
        deletedAt: null,
        status: { in: OPEN_STATUSES },
        blockedSince: { lt: staleCutoff },
      },
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

  return {
    overdue: overdue.map(toDigestTask),
    today: today.map(toDigestTask),
    // Something both new and already late is late. Saying it twice in
    // one email is how a short email stops being short.
    fresh: fresh.filter((t) => !overdueIds.has(t.id) && !todayIds.has(t.id)).map(toDigestTask),
    awaitingMySignature: awaiting.map(toDigestTask),
    staleWaits,
  };
}

function formatDue(date: Date | null): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", timeZone: TIMEZONE }).format(date);
}

export type DigestGroup = { heading: string; tasks: DigestTask[]; more: number };

/// The groups, in the order somebody at eight in the morning asks them.
export function digestGroups(d: Digest): DigestGroup[] {
  const groups: [string, DigestTask[]][] = [
    ["באיחור", d.overdue],
    ["להיום", d.today],
    ["חדש אצלך", d.fresh],
    ["מחכה לחתימה שלך", d.awaitingMySignature],
  ];
  return groups
    .filter(([, tasks]) => tasks.length > 0)
    .map(([heading, tasks]) => ({
      heading,
      tasks: tasks.slice(0, LINES_PER_GROUP),
      more: Math.max(0, tasks.length - LINES_PER_GROUP),
    }));
}

export function renderDigestEmail(d: Digest, name: string): { html: string; text: string } {
  const base = appBaseUrl();
  const groups = digestGroups(d);

  const textLines: string[] = [`בוקר טוב ${name},`, ""];
  const htmlGroups: string[] = [];

  for (const group of groups) {
    textLines.push(`${group.heading}:`);
    const rows = group.tasks
      .map((t) => {
        const due = formatDue(t.dueDate);
        textLines.push(`  ${t.title} · ${t.clientName}${due ? ` · ${due}` : ""}  ${base}/app/tasks/${t.id}`);
        return `<tr><td style="padding:6px 0;font-size:14px;line-height:1.6;color:#1B2A3D;" dir="rtl" align="right"><a href="${base}/app/tasks/${escapeHtml(
          t.id
        )}" style="color:#1B2A3D;text-decoration:none;border-bottom:1px solid rgba(27,42,61,.25);">${escapeHtml(
          t.title
        )}</a> <span style="color:rgba(27,42,61,.55);">· ${escapeHtml(t.clientName)}${
          due ? ` · ${escapeHtml(due)}` : ""
        }</span></td></tr>`;
      })
      .join("");
    const more = group.more > 0 ? `<tr><td style="padding:4px 0;font-size:13px;color:rgba(27,42,61,.55);" dir="rtl" align="right">ועוד ${group.more}</td></tr>` : "";
    if (group.more > 0) textLines.push(`  ועוד ${group.more}`);
    textLines.push("");
    htmlGroups.push(
      `<p style="margin:22px 0 6px;font-size:13px;font-weight:600;letter-spacing:.04em;color:#B08D57;" dir="rtl" align="right">${escapeHtml(
        group.heading
      )}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${more}</table>`
    );
  }

  let tail = "";
  if (d.staleWaits > 0) {
    const sentence =
      d.staleWaits === 1
        ? `משימה אחת שלך ממתינה למישהו יותר משבוע. אולי הגיע הזמן להזכיר.`
        : `${d.staleWaits} משימות שלך ממתינות למישהו יותר משבוע. אולי הגיע הזמן להזכיר.`;
    textLines.push(sentence, "");
    tail = `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid rgba(27,42,61,.12);font-size:13.5px;line-height:1.7;color:rgba(27,42,61,.7);" dir="rtl" align="right">${escapeHtml(
      sentence
    )}</p>`;
  }

  textLines.push(`${base}/app/tasks`);

  const html = `<!doctype html>
<html dir="rtl" lang="he">
  <body style="margin:0;padding:0;background:#F8F4EC;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F4EC;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid rgba(27,42,61,.12);border-radius:18px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
            <tr>
              <td style="background:#1B2A3D;padding:18px 24px;">
                <span style="font-size:14px;font-weight:600;letter-spacing:.18em;color:#F3EADB;">ANKORA</span>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 24px 28px;" dir="rtl" align="right">
                <p style="margin:0;font-size:19px;font-weight:500;color:#0B1B33;">בוקר טוב ${escapeHtml(name)}</p>
                ${htmlGroups.join("")}
                ${tail}
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

      const { html, text } = renderDigestEmail(digest, person.name);
      const result = await sendEmail({
        to: [person.email],
        subject: digestSubject(digest),
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
