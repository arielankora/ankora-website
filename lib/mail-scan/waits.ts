import "server-only";
import type { MailChannel, TaskBlocker, TaskMailWait, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { DomainError } from "@/lib/domain-error";
import { sendEmail as sendAppEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/email-templates";
import { outgoingOf } from "@/lib/i18n/recipients";
import { getTaskDetail, liftBlockOnReply, updateTask } from "@/lib/app-domain/tasks";
import { getEmail, sendEmail as sendMailboxEmail } from "@/lib/client-mailbox/unipile-mail";
import { prefixedSubject } from "@/lib/client-mailbox/shape";
import { SENT_KEEP_DAYS, defaultRemindAt, isReply, suggestCandidate, waitState, type WaitState } from "./wait-rules";
import { reportIssue } from "@/lib/system-issues";

// Stage 2 of "התיבות שלי" (27.11.2026, Ariel): a task, or a step, waits for a
// reply to an email someone on the team sent. The email is picked from what
// the person sent in the last 14 days from their scanned mailboxes (only
// they see that list), on the task screen or through the connector. When
// someone other than the sender writes in the thread, the task stops
// waiting and the person is told; if nobody has by the reminder, they are
// reminded and may send a reminder as a reply in the same thread.
//
// The thread's content is never kept. A reminder reads the subject of the
// email it answers from the mailbox at the moment it is sent.

export const MAIL_WAIT_REPLY_NOTIFICATION = "mail_wait_reply";
export const MAIL_WAIT_REMINDER_NOTIFICATION = "mail_wait_reminder";
const DAY_MS = 24 * 60 * 60 * 1000;

type Actor = User;

/// The task, for someone who may see it; refused in words otherwise.
async function loadTask(actor: Actor, taskId: string) {
  const detail = await getTaskDetail(actor, taskId);
  if (!detail) throw new DomainError("tasks.notFound", "Task not found.");
  return detail.task;
}

/// What the person sent and may follow: their own scanned mailboxes only.
export async function sentEmails(actor: Pick<User, "id">, opts: { now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const threads = await prisma.mailThread.findMany({
    where: {
      channel: { ownerUserId: actor.id, scanEnabled: true },
      held: false,
      lastSentAt: { gte: new Date(now.getTime() - SENT_KEEP_DAYS * DAY_MS) },
    },
    select: { id: true, lastSentAt: true, lastSentTo: true, clientIds: true, channel: { select: { address: true } } },
    orderBy: { lastSentAt: "desc" },
    take: opts.limit ?? 30,
  });
  return threads.map((t) => ({ threadId: t.id, mailbox: t.channel.address, sentTo: t.lastSentTo, sentAt: t.lastSentAt!, clientIds: t.clientIds }));
}

/// The list "ממתינים לתשובה למייל?" offers for one task, with the suggestion.
export async function waitCandidates(actor: Actor, taskId: string) {
  const task = await loadTask(actor, taskId);
  const rows = await sentEmails(actor);
  return { candidates: rows, suggested: suggestCandidate(rows, task.clientId) };
}

/// The thread an address was last written to, for the connector.
export async function threadSentTo(actor: Pick<User, "id">, recipient: string) {
  const address = recipient.trim().toLowerCase();
  const rows = await sentEmails(actor, { limit: 100 });
  return rows.find((r) => r.sentTo.includes(address)) ?? null;
}

async function openWait(taskId: string) {
  return prisma.taskMailWait.findFirst({ where: { taskId, endedAt: null }, orderBy: { createdAt: "desc" } });
}

/// Start following: the task (or step) waits on `waitingOn`, for a reply to
/// the thread. Another open wait on the task is replaced.
export async function followEmailReply(
  actor: Actor,
  input: { taskId: string; threadId: string; waitingOn: TaskBlocker; reason?: string | null; remindAt?: Date | null; via?: "MANUAL" | "CLAUDE" },
  now = new Date(),
) {
  const task = await loadTask(actor, input.taskId);
  if (task.status === "DONE" || task.status === "ARCHIVED") throw new DomainError("mailWaits.taskClosed", "משימה שהושלמה לא ממתינה לתשובה.");
  const thread = await prisma.mailThread.findUnique({ where: { id: input.threadId }, include: { channel: true } });
  if (!thread || thread.channel.ownerUserId !== actor.id || !thread.lastSentAt) {
    throw new DomainError("mailWaits.notYourEmail", "אפשר לעקוב רק אחרי מייל ששלחת מתיבה שלך שמחוברת לסריקה.");
  }
  const remindAt = input.remindAt === undefined ? defaultRemindAt(now) : input.remindAt;
  const previous = await openWait(task.id);
  if (previous) await prisma.taskMailWait.update({ where: { id: previous.id }, data: { endedAt: now, endedHow: "REPLACED" } });

  // The block itself goes through the ordinary task update: same rules, same
  // history line ("task.blocked"), same reason.
  await updateTask(actor, task.id, { block: { on: input.waitingOn, reason: input.reason ?? null } });

  const wait = await prisma.taskMailWait.create({
    data: {
      taskId: task.id,
      threadId: thread.id,
      channelId: thread.channelId,
      externalThreadId: thread.externalThreadId,
      sentTo: thread.lastSentTo,
      sentAt: thread.lastSentAt,
      lastEmailId: thread.lastEmailId,
      createdById: actor.id,
      via: input.via ?? "MANUAL",
      remindAt,
    },
  });
  // A followed thread is kept while it is followed.
  if (thread.keepUntil) await prisma.mailThread.update({ where: { id: thread.id }, data: { keepUntil: null } });
  await recordAudit({
    actorId: actor.id,
    action: "task.mail_wait_started",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: { via: wait.via, remindAt: remindAt?.toISOString() ?? null, recipients: wait.sentTo.length },
  });
  return wait;
}

/// The task's open wait, refused in words when there is none.
async function requireOpenWait(actor: Actor, taskId: string) {
  const task = await loadTask(actor, taskId);
  const wait = await openWait(task.id);
  if (!wait) throw new DomainError("mailWaits.notFollowing", "המשימה לא ממתינה לתשובה למייל.");
  return { task, wait };
}

/// "לא לעקוב אחרי המייל" keeps the task waiting; "כבר לא ממתינים" also lifts it.
export async function stopFollowing(actor: Actor, taskId: string, opts: { unblock: boolean }, now = new Date()) {
  const { task, wait } = await requireOpenWait(actor, taskId);
  await prisma.taskMailWait.update({ where: { id: wait.id }, data: { endedAt: now, endedHow: "STOPPED" } });
  if (opts.unblock && task.blockedOn) await updateTask(actor, task.id, { block: null });
  await recordAudit({ actorId: actor.id, action: "task.mail_wait_stopped", entityType: "Task", entityId: task.id, clientId: task.clientId, after: { unblock: opts.unblock } });
}

/// "לדחות" or "שינוי מועד": a new reminder time (null: no reminder).
export async function setReminder(actor: Actor, taskId: string, remindAt: Date | null) {
  const { task, wait } = await requireOpenWait(actor, taskId);
  await prisma.taskMailWait.update({ where: { id: wait.id }, data: { remindAt, remindedAt: null } });
  await recordAudit({
    actorId: actor.id,
    action: "task.mail_wait_rescheduled",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    before: { remindAt: wait.remindAt?.toISOString() ?? null },
    after: { remindAt: remindAt?.toISOString() ?? null },
  });
}

/// "שליחת תזכורת": a reply in the same thread, from the same mailbox, to the
/// people the followed email went to. Only whoever sent it may.
export async function sendWaitReminder(actor: Actor, taskId: string, input: { text: string; nextRemindAt?: Date | null }, now = new Date()) {
  const { task, wait } = await requireOpenWait(actor, taskId);
  const channel = await prisma.mailChannel.findUnique({ where: { id: wait.channelId } });
  if (!channel || channel.ownerUserId !== actor.id) throw new DomainError("mailWaits.notYourEmail", "אפשר לעקוב רק אחרי מייל ששלחת מתיבה שלך שמחוברת לסריקה.");
  const text = input.text.trim();
  if (!text) throw new DomainError("mailWaits.emptyReminder", "צריך לכתוב את נוסח התזכורת.");
  if (!wait.sentTo.length) throw new DomainError("mailWaits.noRecipients", "לא ידוע למי נשלח המייל, ולכן אי אפשר לשלוח תזכורת.");
  const original = await getEmail(channel.accountId, wait.lastEmailId);
  await sendMailboxEmail(channel.accountId, {
    to: wait.sentTo.map((email) => ({ email })),
    subject: prefixedSubject("Re", original.subject),
    plain_text: text,
    reply_to_provider_id: wait.lastEmailId,
  });
  const remindAt = input.nextRemindAt === undefined ? defaultRemindAt(now) : input.nextRemindAt;
  await prisma.taskMailWait.update({ where: { id: wait.id }, data: { remindAt, remindedAt: null } });
  await recordAudit({
    actorId: actor.id,
    action: "task.mail_reminder_sent",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: { recipients: wait.sentTo.length, nextRemindAt: remindAt?.toISOString() ?? null },
  });
}

// ---------------------------------------------------------------- the webhook

/// A new email in a scanned mailbox, before what to record of it is decided.
/// Returns whether a task follows the thread, so it is recorded whatever
/// else the rules say. A reply ends the wait, lifts the task's "ממתין" and
/// tells whoever followed it.
export async function onThreadEmail(
  channel: Pick<MailChannel, "id" | "address">,
  input: { externalThreadId: string; emailId: string; from: string | null; at: Date },
): Promise<boolean> {
  const waits = await prisma.taskMailWait.findMany({ where: { channelId: channel.id, externalThreadId: input.externalThreadId, endedAt: null } });
  if (!waits.length) return false;
  if (!isReply(input.from, channel.address)) {
    // The sender wrote again (a reminder, a correction): a later reminder
    // answers that email.
    await prisma.taskMailWait.updateMany({ where: { id: { in: waits.map((w) => w.id) } }, data: { lastEmailId: input.emailId } });
    return true;
  }
  for (const wait of waits) await replyArrived(wait, input.from!, input.at);
  return true;
}

async function replyArrived(wait: TaskMailWait, from: string, at: Date) {
  await prisma.taskMailWait.update({ where: { id: wait.id }, data: { replyAt: at, replyFrom: from, endedAt: new Date(), endedHow: "REPLY" } });
  const task = await prisma.task.findUnique({
    where: { id: wait.taskId },
    select: { id: true, title: true, clientId: true, blockedOn: true, assignedToId: true, parentId: true, client: { select: { name: true } }, parent: { select: { title: true, assignedToId: true } } },
  });
  if (!task) return;
  // Ariel, 27.11.2026: a reply lifts "ממתין" by itself.
  if (task.blockedOn && (await liftBlockOnReply(task.id))) {
    await recordAudit({ actorId: null, action: "task.unblocked_by_reply", entityType: "Task", entityId: task.id, clientId: task.clientId, after: { waitId: wait.id } });
  }
  // The step's assignee, or the task's when the step has none.
  const people = [...new Set([wait.createdById, task.assignedToId ?? task.parent?.assignedToId].filter((v): v is string => !!v))];
  await tell(people, MAIL_WAIT_REPLY_NOTIFICATION, task, (t, p) => ({
    title: t("mailWaitReply.title", { client: task.client.name }),
    body: t("mailWaitReply.body", { from, task: task.parent ? `${task.parent.title}: ${task.title}` : task.title, link: p.link }),
  }));
}

type TaskRef = { id: string; parentId: string | null };
type OutT = ReturnType<typeof outgoingOf>["t"];

/// Bell and email to each person, in their language, with the task's link.
async function tell(userIds: string[], type: string, task: TaskRef, render: (t: OutT, p: { link: string }) => { title: string; body: string }) {
  const link = `${appBaseUrl()}/app/tasks/${task.parentId ?? task.id}`;
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true, email: true, locale: true, timezone: true } });
  for (const u of users) {
    try {
      const { t } = outgoingOf(u);
      const { title, body } = render(t, { link });
      await prisma.notification.create({ data: { userId: u.id, type, title, body, entityType: "Task", entityId: task.parentId ?? task.id } });
      const sent = await sendAppEmail({ to: [u.email], subject: `Ankora - ${title}`, text: body });
      // A failed send is a system issue, reported by the email sender itself.
      void sent;
    } catch (err) {
      // The wait was already claimed, so this reminder is never retried.
      await reportIssue({ area: "comms", key: `mail-wait-notice:${type}`, title: "תזכורת או הודעה על תשובה למייל לא נמסרה", error: err, severity: "CRITICAL" });
    }
  }
}

// ---------------------------------------------------------------- the sweep

/// Reminders that are due, and sent threads past their 14 days. Runs from
/// the daily cron and, at most every few minutes, from the webhook.
export async function sweepMailWaits(now = new Date()): Promise<{ reminded: number; closed: number; dropped: number }> {
  // A wait on a task that closed meanwhile ends with it.
  const closed = await prisma.taskMailWait.updateMany({
    where: { endedAt: null, task: { OR: [{ status: { in: ["DONE", "ARCHIVED"] } }, { deletedAt: { not: null } }] } },
    data: { endedAt: now, endedHow: "REPLACED" },
  });
  const due = await prisma.taskMailWait.findMany({
    where: { endedAt: null, remindedAt: null, remindAt: { lte: now } },
    include: { task: { select: { id: true, title: true, parentId: true, client: { select: { name: true } }, parent: { select: { title: true } } } } },
    take: 200,
  });
  for (const wait of due) {
    // Claimed first, so two sweeps at once remind once.
    const claimed = await prisma.taskMailWait.updateMany({ where: { id: wait.id, remindedAt: null }, data: { remindedAt: now } });
    if (!claimed.count) continue;
    const sentDay = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" }).format(wait.sentAt);
    await tell([wait.createdById], MAIL_WAIT_REMINDER_NOTIFICATION, wait.task, (t, p) => ({
      title: t("mailWaitReminder.title", { client: wait.task.client.name }),
      body: t("mailWaitReminder.body", {
        to: wait.sentTo.join(", "),
        day: sentDay,
        task: wait.task.parent ? `${wait.task.parent.title}: ${wait.task.title}` : wait.task.title,
        link: p.link,
      }),
    }));
  }
  const dropped = await prisma.mailThread.deleteMany({ where: { keepUntil: { lt: now }, waits: { none: { endedAt: null } } } });
  return { reminded: due.length, closed: closed.count, dropped: dropped.count };
}

const SWEEP_KEY = "mailWaits.lastSweepAt";
const SWEEP_EVERY_MS = 10 * 60 * 1000;

/// From the webhook: the sweep, if the last one was more than ten minutes
/// ago. The cron on this plan runs once a day, and emails arrive all day,
/// so reminders go out close to their time on a working day.
export async function sweepIfDue(now = new Date()) {
  const last = await prisma.appSetting.findUnique({ where: { key: SWEEP_KEY } });
  const lastAt = last && typeof last.value === "string" ? Date.parse(last.value) : 0;
  if (now.getTime() - lastAt < SWEEP_EVERY_MS) return null;
  await prisma.appSetting.upsert({ where: { key: SWEEP_KEY }, create: { key: SWEEP_KEY, value: now.toISOString() }, update: { value: now.toISOString() } });
  return sweepMailWaits(now);
}

// ---------------------------------------------------------------- what the screens and the connector show

export type WaitView = {
  state: WaitState;
  sentTo: string[];
  sentAt: string;
  mailbox: string | null;
  remindAt: string | null;
  replyAt: string | null;
  replyFrom: string | null;
  via: "MANUAL" | "CLAUDE";
  mine: boolean;
};

/// The wait to show on each task: the open one, or the last reply within a
/// week (so "הגיעה תשובה" is seen), never a stopped one.
export async function waitViews(taskIds: string[], viewerId: string, now = new Date()): Promise<Map<string, WaitView>> {
  const out = new Map<string, WaitView>();
  if (!taskIds.length) return out;
  const rows = await prisma.taskMailWait.findMany({
    where: { taskId: { in: taskIds }, OR: [{ endedAt: null }, { endedHow: "REPLY", replyAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } }] },
    orderBy: { createdAt: "desc" },
    include: { thread: { select: { channel: { select: { address: true } } } } },
  });
  for (const w of rows) {
    if (out.has(w.taskId)) continue;
    out.set(w.taskId, {
      state: waitState(w, now),
      sentTo: w.sentTo,
      sentAt: w.sentAt.toISOString(),
      mailbox: w.thread?.channel.address ?? null,
      remindAt: w.remindAt?.toISOString() ?? null,
      replyAt: w.replyAt?.toISOString() ?? null,
      replyFrom: w.replyFrom,
      via: w.via,
      mine: w.createdById === viewerId,
    });
  }
  return out;
}

/// "על מה אני מחכה": the person's open waits, overdue first, for the connector.
export async function myOpenWaits(actor: Pick<User, "id">, now = new Date()) {
  const rows = await prisma.taskMailWait.findMany({
    where: { createdById: actor.id, endedAt: null, task: { deletedAt: null, client: { aiExcluded: false }, aiExcluded: false } },
    include: { task: { select: { id: true, title: true, parentId: true, client: { select: { name: true } }, parent: { select: { title: true } } } } },
    orderBy: { remindAt: "asc" },
    take: 100,
  });
  return rows
    .map((w) => ({
      task: w.task.parent ? `${w.task.parent.title}: ${w.task.title}` : w.task.title,
      taskId: w.task.id,
      client: w.task.client.name,
      state: waitState(w, now),
      sentTo: w.sentTo,
      sentAt: w.sentAt.toISOString(),
      remindAt: w.remindAt?.toISOString() ?? null,
      url: `${appBaseUrl()}/app/tasks/${w.task.parentId ?? w.task.id}`,
    }))
    .sort((a, b) => Number(b.state === "overdue") - Number(a.state === "overdue"));
}
