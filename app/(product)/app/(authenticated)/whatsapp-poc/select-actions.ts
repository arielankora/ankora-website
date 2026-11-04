"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/app-auth/session";
import { recordAudit } from "@/lib/app-auth/audit";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { commsAccess } from "@/lib/comms/access";
import { accountForChatFile } from "@/lib/comms/route-access";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { MAX_COMMENT_LENGTH, addTaskComment, createTask, listTasks } from "@/lib/app-domain/tasks";
import { addClientDocument, DriveNotConfiguredError } from "@/lib/app-domain/client-documents";
import { addTaskPortalNote } from "@/lib/app-domain/task-portal-notes";
import { checkPortalNote } from "@/lib/task-portal-note-text";
import { fetchMessageAttachment } from "@/lib/whatsapp-poc/voice-notes";
import {
  MAX_FILED_IMAGES,
  formatSelectedMessages,
  isImageFile,
  parseSelectedMessages,
  proposeSelectedTitle,
} from "@/lib/whatsapp-poc/selected-messages";
import { prisma } from "@/lib/prisma";

// "סמן הודעות" (4.11.2026). Several messages chosen on the communications
// screen go into one task: a new one, or one already open on the client.
// Design: option A on Claude Design, chosen by Ariel.
//
// What is saved, and nothing else: one internal comment with the messages
// (or the new task's description), each chosen image filed on the task as
// a document hidden from the client, and, only when the person wrote one
// and the task is visible to the client, one line for the portal. The
// text of the messages never reaches the client.

export type AttachTaskOption = { id: string; title: string; status: string; clientVisible: boolean };

/// The open tasks of one client the dialog offers, newest first, with an
/// optional search. Same access as the tasks screen (listTasks).
export async function listTasksForMessagesAction(input: { clientId: string; q?: string }): Promise<AttachTaskOption[]> {
  const user = await requireUser();
  const access = await commsAccess(user);
  if (!access.allowed || !input.clientId) return [];
  const tasks = await listTasks(user, {
    clientId: input.clientId,
    statusIn: ["OPEN", "IN_PROGRESS"],
    q: input.q?.slice(0, 80),
  });
  return tasks
    .slice()
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 20)
    .map((t) => ({ id: t.id, title: t.title, status: t.status, clientVisible: t.clientVisible }));
}

export type AttachState = {
  error?: string;
  done?: { taskId: string; title: string; created: boolean; images: number; portalLine: boolean };
  /// What did not go through while the rest did (an image Drive refused,
  /// a portal line on a task that is not visible).
  warnings?: string[];
};

function fileExtension(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

export async function attachSelectedMessagesAction(_prev: AttachState | undefined, formData: FormData): Promise<AttachState> {
  const user = await requireUser();
  const access = await commsAccess(user);
  if (!access.allowed) return { error: "אין הרשאה." };

  const messages = parseSelectedMessages(formData.get("messages"));
  if (messages.length === 0) return { error: "לא נבחרו הודעות." };

  const chatId = String(formData.get("chatId") || "");
  const numberKey = String(formData.get("numberKey") || "") || null;
  const contactName = String(formData.get("contactName") || "").slice(0, 120);
  const phone = String(formData.get("phone") || "").slice(0, 30) || null;
  const mode = formData.get("mode") === "new" ? "new" : "existing";
  const wantPortalLine = formData.get("portalLineOn") === "on";
  const portalLine = wantPortalLine ? checkPortalNote(formData.get("portalLine")) : null;
  if (portalLine && !portalLine.ok) return { error: portalLine.error };

  // The task: checked against the person's own clients before anything is
  // written, so a hand-edited form cannot reach another client's task.
  let task: { id: string; clientId: string; title: string; clientVisible: boolean };
  let created = false;
  const accessible = await listAccessibleClients(user);
  try {
    if (mode === "new") {
      const clientId = String(formData.get("clientId") || "");
      if (!accessible.some((c) => c.id === clientId)) return { error: "יש לבחור לקוח." };
      const title = String(formData.get("title") || "").trim().slice(0, 200) || proposeSelectedTitle(contactName, phone);
      const t = await createTask(user, {
        clientId,
        title,
        clientVisible: formData.get("clientVisible") === "on",
        description: null,
      });
      task = { id: t.id, clientId: t.clientId, title: t.title, clientVisible: t.clientVisible };
      created = true;
    } else {
      const taskId = String(formData.get("taskId") || "");
      if (!taskId) return { error: "יש לבחור משימה." };
      const t = await prisma.task.findFirst({
        where: { id: taskId, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS"] } },
        select: { id: true, clientId: true, title: true, clientVisible: true },
      });
      if (!t || !accessible.some((c) => c.id === t.clientId)) return { error: "המשימה לא נמצאה או שאינה פתוחה." };
      task = t;
    }
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "אין הרשאה ללקוח הזה." };
    return { error: err instanceof Error ? err.message : "שמירת המשימה נכשלה." };
  }

  const warnings: string[] = [];

  // Images first, so the comment can say which ones are on the task.
  // Fetched from Unipile on the server with the same check as the media
  // route: the chat's own number, which the person must be allowed to read.
  const filed = new Set<string>();
  const images = messages.flatMap((m) => m.files.filter(isImageFile).map((f) => ({ m, f })));
  if (images.length > MAX_FILED_IMAGES) {
    warnings.push(`תויקו רק ${MAX_FILED_IMAGES} התמונות הראשונות מתוך ${images.length}.`);
  }
  if (images.length > 0) {
    const config = chatId ? await accountForChatFile(user, numberKey, chatId) : null;
    if (!config) {
      warnings.push("התמונות לא תויקו: אין גישה לקבצים של השיחה הזו.");
    } else {
      for (const { m, f } of images.slice(0, MAX_FILED_IMAGES)) {
        try {
          const file = await fetchMessageAttachment(config, chatId, m.id, f.id);
          if (!file || !file.contentType.startsWith("image/")) {
            warnings.push("תמונה אחת לא נמצאה ב-WhatsApp ולא תויקה.");
            continue;
          }
          const when = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }).format(new Date(m.at));
          await addClientDocument(user, {
            clientId: task.clientId,
            taskId: task.id,
            title: `תמונה מוואטסאפ: ${contactName || phone || "איש קשר"}, ${when}`,
            kind: "OTHER",
            fileName: `whatsapp-${m.id.slice(-8)}.${fileExtension(file.contentType)}`,
            mimeType: file.contentType,
            content: Buffer.from(file.bytes),
            // Hidden from the client: Ariel's decision, 4.11.2026.
            clientVisible: false,
          });
          filed.add(`${m.id}:${f.id}`);
        } catch (err) {
          warnings.push(
            err instanceof DriveNotConfiguredError
              ? "התמונות לא תויקו: תיקיית המסמכים לא מוגדרת בסביבה הזו."
              : `תמונה אחת לא תויקה: ${err instanceof Error ? err.message : "שגיאה"}`,
          );
          if (err instanceof DriveNotConfiguredError) break;
        }
      }
    }
  }

  const body = formatSelectedMessages({ contactName, phone, messages, filedImages: filed, maxLength: MAX_COMMENT_LENGTH });
  try {
    await addTaskComment(user, task.id, body);
  } catch (err) {
    return { error: `ההערה לא נשמרה: ${err instanceof Error ? err.message : "שגיאה"}` };
  }

  let portalAdded = false;
  if (portalLine?.ok) {
    if (!task.clientVisible) {
      warnings.push("השורה ללקוח לא נוספה: המשימה לא מוצגת ללקוח בפורטל.");
    } else {
      try {
        await addTaskPortalNote(user, task.id, portalLine.text);
        portalAdded = true;
      } catch (err) {
        warnings.push(`השורה ללקוח לא נוספה: ${err instanceof Error ? err.message : "שגיאה"}`);
      }
    }
  }

  // Counts, not content: the audit log is not a second copy of the
  // conversation.
  await recordAudit({
    actorId: user.id,
    action: "whatsapp_poc.messages_to_task",
    entityType: "Task",
    entityId: task.id,
    clientId: task.clientId,
    after: { messages: messages.length, images: filed.size, created, portalLine: portalAdded },
  });

  revalidatePath(`/app/tasks/${task.id}`);
  return {
    done: { taskId: task.id, title: task.title, created, images: filed.size, portalLine: portalAdded },
    warnings: warnings.length ? [...new Set(warnings)] : undefined,
  };
}
