import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/email-templates";
import { deliver } from "@/lib/notify/channels";
import { policyFromEnv, type OutboundMessage, type Recipient } from "@/lib/notify/policy";
import type { TaskPriority } from "@prisma/client";

// Urgent work reaches the person the same day.
//
// Ariel and Hadas, 7.10.2026. Hadas opened a task on Ariel and expected
// him to know that day. The morning digest tells people about work at
// eight the next morning, which is right for almost everything and wrong
// for the one thing that cannot wait. "דחופה" is the sender saying which
// one this is, so that is the trigger.
//
// Two moments send, and nothing else:
//
//   1. Urgent work lands on somebody: opened urgent on them, raised to
//      urgent while theirs, or an urgent task handed to them.
//   2. Somebody else writes on an urgent task of theirs, at most once an
//      hour per task, so a conversation is not a stream of alerts.
//
// Never the person who did it. The bell and the digest carry on as
// before; this is in addition to them, not instead.
//
// The channel is not decided here. See lib/notify/channels.ts: email
// today, WhatsApp the day it is connected, by environment variable.

export const TASK_URGENT_COMMENT_NOTIFICATION_TYPE = "task_urgent_comment";
export const URGENT_COMMENT_COOLDOWN_MINUTES = 60;

/// The longest quote a message carries.
export const DETAIL_MAX_CHARS = 280;

type UrgentSnapshot = { assignedToId: string | null; priority: TaskPriority };

/// Who, if anybody, urgent work just landed on.
///
/// Pure. `before` is null at creation, when everything on the task is
/// new. A task that was already urgent and already theirs returns null:
/// renaming it must not alert again.
export function urgentLanding(actorId: string, before: UrgentSnapshot | null, after: UrgentSnapshot): string | null {
  if (after.priority !== "URGENT") return null;
  if (!after.assignedToId || after.assignedToId === actorId) return null;
  if (!before) return after.assignedToId;
  if (before.priority !== "URGENT") return after.assignedToId;
  if (before.assignedToId !== after.assignedToId) return after.assignedToId;
  return null;
}

/// Whether a comment on this task should alert its assignee.
///
/// Pure. Closed work does not alert: a note on a finished task is a
/// note for the record.
export function shouldAlertOnComment(
  actorId: string,
  task: { priority: TaskPriority; assignedToId: string | null; status: string },
  lastAlertAt: Date | null,
  now: Date
): boolean {
  if (task.priority !== "URGENT") return false;
  if (!task.assignedToId || task.assignedToId === actorId) return false;
  if (task.status === "DONE" || task.status === "ARCHIVED") return false;
  if (lastAlertAt && now.getTime() - lastAlertAt.getTime() < URGENT_COMMENT_COOLDOWN_MINUTES * 60_000) return false;
  return true;
}

/// One line, at most DETAIL_MAX_CHARS, with Markdown marks removed so a
/// mail client does not show asterisks.
export function quoteFor(text: string | null | undefined): string | null {
  if (!text) return null;
  const flat = text
    .replace(/[*_`>#]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return null;
  return flat.length > DETAIL_MAX_CHARS ? `${flat.slice(0, DETAIL_MAX_CHARS - 1).trimEnd()}…` : flat;
}

/// The message. Pure, and the place the wording lives.
///
/// The subject carries the whole answer, because on a phone it is often
/// the only part read: what, for which client, from whom.
export function urgentMessage(input: {
  kind: "landed" | "comment";
  taskId: string;
  taskTitle: string;
  clientName: string;
  actorName: string;
  detail: string | null;
  baseUrl: string;
}): OutboundMessage {
  const url = `${input.baseUrl}/app/tasks/${input.taskId}`;
  if (input.kind === "landed") {
    return {
      template: "task_urgent",
      subject: `משימה דחופה אצלך: ${input.taskTitle} · ${input.clientName}`,
      title: "משימה דחופה אצלך",
      lines: [`${input.taskTitle} · ${input.clientName}`, `מאת ${input.actorName}`],
      detail: input.detail,
      url,
      buttonLabel: "פתיחת המשימה",
    };
  }
  return {
    template: "task_urgent_comment",
    subject: `עדכון במשימה דחופה: ${input.taskTitle} · ${input.clientName}`,
    title: "עדכון במשימה דחופה שלך",
    lines: [`${input.taskTitle} · ${input.clientName}`, `${input.actorName} כתב/ה תגובה`],
    detail: input.detail,
    url,
    buttonLabel: "פתיחת המשימה",
  };
}

/// Runs `fn` after the response, so saving a task never waits on a mail
/// provider. Outside a request (a test, a script) there is no response
/// to wait for, and it runs now.
function afterResponse(fn: () => Promise<void>): Promise<void> {
  const guarded = async () => {
    try {
      await fn();
    } catch (err) {
      console.error("urgent task alert failed:", err);
    }
  };
  try {
    after(guarded);
    return Promise.resolve();
  } catch {
    return guarded();
  }
}

async function recipientFor(userId: string): Promise<Recipient | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true, email: true },
  });
  if (!user) return null;
  return { userId: user.id, name: user.name, email: user.email, phone: null };
}

function policy() {
  return policyFromEnv(process.env.URGENT_TASK_CHANNELS, process.env.URGENT_TASK_DELIVERY);
}

/// Called by createTask and updateTask after the write and its audit row.
/// Never throws into the caller: an alert that fails must not undo the
/// task it was announcing.
export async function alertIfUrgentLanded(
  actor: { id: string; name: string },
  task: { id: string; title: string; description: string | null; assignedToId: string | null; priority: TaskPriority },
  clientName: string,
  before: UrgentSnapshot | null
): Promise<void> {
  const target = urgentLanding(actor.id, before, task);
  if (!target) return;
  await afterResponse(async () => {
    const recipient = await recipientFor(target);
    if (!recipient) return;
    // What the person needs to start: the description if there is one,
    // otherwise whatever was already written on the task.
    let detail = quoteFor(task.description);
    if (!detail) {
      const first = await prisma.taskComment.findFirst({
        where: { taskId: task.id, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { body: true },
      });
      detail = quoteFor(first?.body);
    }
    await deliver(
      recipient,
      urgentMessage({
        kind: "landed",
        taskId: task.id,
        taskTitle: task.title,
        clientName,
        actorName: actor.name,
        detail,
        baseUrl: appBaseUrl(),
      }),
      policy()
    );
  });
}

/// Called by addTaskComment after the comment and its audit row.
export async function alertIfUrgentComment(
  actor: { id: string; name: string },
  taskId: string,
  commentBody: string
): Promise<void> {
  try {
    const task = await prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        assignedToId: true,
        client: { select: { name: true } },
      },
    });
    if (!task || !task.assignedToId) return;

    const last = await prisma.notification.findFirst({
      where: { userId: task.assignedToId, type: TASK_URGENT_COMMENT_NOTIFICATION_TYPE, entityId: task.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!shouldAlertOnComment(actor.id, task, last?.createdAt ?? null, new Date())) return;

    // The bell row first, synchronously. It is the record the cooldown
    // reads, so two comments a second apart cannot both slip past it.
    await prisma.notification.create({
      data: {
        userId: task.assignedToId,
        type: TASK_URGENT_COMMENT_NOTIFICATION_TYPE,
        title: "עדכון במשימה דחופה",
        body: `${task.title} · ${task.client.name} · ${actor.name}`,
        entityType: "Task",
        entityId: task.id,
      },
    });

    const assigneeId = task.assignedToId;
    await afterResponse(async () => {
      const recipient = await recipientFor(assigneeId);
      if (!recipient) return;
      await deliver(
        recipient,
        urgentMessage({
          kind: "comment",
          taskId: task.id,
          taskTitle: task.title,
          clientName: task.client.name,
          actorName: actor.name,
          detail: quoteFor(commentBody),
          baseUrl: appBaseUrl(),
        }),
        policy()
      );
    });
  } catch (err) {
    console.error("urgent comment alert failed:", err);
  }
}
