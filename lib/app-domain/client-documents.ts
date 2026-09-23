import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { ForbiddenError, assertCan } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { clientDocumentsFolder, uploadFileToDriveFolder } from "@/lib/google-drive";
import type { ClientDocumentKind, User } from "@prisma/client";

// Portal phase 3, the staff half of "מסמכים".
//
// Documents are filed by Ankora and downloaded by the client, and the row
// is the authority on who may have them - never the storage. The bytes
// live in the Shared drive this app already writes nightly backups to;
// what the portal hands out is decided per request from the signed-in
// user (lib/app-domain/client-file.ts, resolvePortalDocument), and the
// Drive file id never leaves the server.

/// 20 MB. A policy, a confirmation or a signed contract is a few hundred
/// kilobytes; anything an order of magnitude past that is a video someone
/// filed by accident, and the honest answer is to say so rather than to
/// spend a minute uploading it.
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export class DriveNotConfiguredError extends Error {
  constructor() {
    super("אחסון המסמכים עדיין לא חובר. אפשר לצרף כאן ברגע שהתיקייה תיפתח.");
    this.name = "DriveNotConfiguredError";
  }
}

async function assertClientAccess(actor: User, clientId: string) {
  const accessible = await listAccessibleClients(actor);
  if (!accessible.some((c) => c.id === clientId)) {
    throw new ForbiddenError("You are not assigned to this client.");
  }
}

export async function listClientDocuments(actor: User, clientId: string) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, clientId);

  return prisma.clientDocument.findMany({
    where: { clientId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      uploadedBy: { select: { name: true } },
      task: { select: { id: true, title: true, clientTitle: true } },
    },
  });
}

export interface AddClientDocumentInput {
  clientId: string;
  title: string;
  kind: ClientDocumentKind;
  /// Optional: the task this came out of, when it came out of one.
  taskId?: string | null;
  fileName: string;
  mimeType: string;
  content: Buffer;
  clientVisible?: boolean;
}

/// File a document against a client.
///
/// The upload happens first and the row second, on purpose: a row that
/// points at bytes which were never stored is a document the client can
/// see and cannot open, which is worse than no document at all. The other
/// order fails safely - an upload with no row is an orphan file in a
/// Drive folder, invisible to the product and harmless.
export async function addClientDocument(actor: User, input: AddClientDocumentInput) {
  assertCan(actor.role, "time_entry.create_self");
  await assertClientAccess(actor, input.clientId);

  const title = input.title.trim();
  if (!title) throw new Error("יש להזין שם למסמך.");
  if (input.content.byteLength === 0) throw new Error("הקובץ ריק.");
  if (input.content.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("הקובץ גדול מ-20MB. אפשר לשלוח אותו במייל ולקשר אליו במקום.");
  }

  const folderId = clientDocumentsFolder();
  if (!folderId) throw new DriveNotConfiguredError();

  if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, clientId: input.clientId, deletedAt: null },
      select: { id: true },
    });
    if (!task) throw new Error("המשימה לא נמצאה אצל הלקוח הזה.");
  }

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: input.clientId },
    select: { name: true },
  });

  // The Drive name is for whoever opens that folder in a browser, which
  // is a person and not this app. It carries the client's name because a
  // flat folder of "חוזה.pdf" is a folder nobody can use.
  const uploaded = await uploadFileToDriveFolder({
    name: `${client.name} - ${title} - ${input.fileName}`,
    mimeType: input.mimeType,
    content: input.content,
    folderId,
  });
  if (!uploaded.ok || !uploaded.fileId) {
    throw new Error(`העלאת הקובץ נכשלה: ${uploaded.error ?? "שגיאה לא ידועה"}`);
  }

  const doc = await prisma.clientDocument.create({
    data: {
      clientId: input.clientId,
      taskId: input.taskId || null,
      title,
      kind: input.kind,
      driveFileId: uploaded.fileId,
      mimeType: input.mimeType,
      sizeBytes: input.content.byteLength,
      clientVisible: input.clientVisible ?? true,
      uploadedById: actor.id,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "client_document.add",
    entityType: "ClientDocument",
    entityId: doc.id,
    clientId: input.clientId,
    after: doc,
  });

  return doc;
}

export async function setClientDocumentVisibility(actor: User, documentId: string, clientVisible: boolean) {
  assertCan(actor.role, "time_entry.create_self");

  const existing = await prisma.clientDocument.findFirst({ where: { id: documentId, deletedAt: null } });
  if (!existing) throw new Error("המסמך לא נמצא.");
  await assertClientAccess(actor, existing.clientId);

  const doc = await prisma.clientDocument.update({ where: { id: documentId }, data: { clientVisible } });

  await recordAudit({
    actorId: actor.id,
    action: "client_document.visibility",
    entityType: "ClientDocument",
    entityId: doc.id,
    clientId: doc.clientId,
    before: existing,
    after: doc,
  });

  return doc;
}

/// Soft delete, like everything else here. The bytes stay in Drive: this
/// removes the document from the product, and removing it from storage is
/// a retention decision with a DPA attached to it, not a click.
export async function removeClientDocument(actor: User, documentId: string) {
  assertCan(actor.role, "time_entry.create_self");

  const existing = await prisma.clientDocument.findFirst({ where: { id: documentId, deletedAt: null } });
  if (!existing) throw new Error("המסמך לא נמצא.");
  await assertClientAccess(actor, existing.clientId);

  const doc = await prisma.clientDocument.update({ where: { id: documentId }, data: { deletedAt: new Date() } });

  await recordAudit({
    actorId: actor.id,
    action: "client_document.remove",
    entityType: "ClientDocument",
    entityId: doc.id,
    clientId: doc.clientId,
    before: existing,
  });

  return doc;
}
