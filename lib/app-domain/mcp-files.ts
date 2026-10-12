import "server-only";
import type { ClientDocumentKind, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { ForbiddenError, assertCan } from "@/lib/app-auth/permissions";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { DriveNotConfiguredError, MAX_DOCUMENT_BYTES, addClientDocument } from "@/lib/app-domain/client-documents";
import { clientDocumentsFolder, downloadFileFromDrive } from "@/lib/google-drive";
import { extractDocumentText, type ExtractedText } from "@/lib/document-text";
import { cleanFileName, fileTicketExpiry, generateFileTicket, hashFileTicket, looksLikeFileTicket, mimeTypeFor } from "@/lib/mcp/file-ticket";

// MCP document files (12.10.2026): the server half of upload_document,
// start_document_upload, list_documents and read_document. See
// lib/mcp/file-ticket.ts for the two upload paths and why both exist.
//
// Nothing here has its own idea of who may do what. Filing goes through
// addClientDocument, the function behind the client screen's upload form;
// reading checks the same client access as listClientDocuments. A ticket
// is a way to deliver bytes, never a way around those checks: each one is
// re-checked when the ticket is used, against the person who asked for it.

export { MAX_DOCUMENT_BYTES };

/// Images read inline as an image block. Above this a photo is a download.
export const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024;

async function accessibleClientIds(actor: User): Promise<Set<string>> {
  return new Set((await listAccessibleClients(actor)).map((c) => c.id));
}

/// The checks addClientDocument makes, made up front so a refused upload is
/// refused before anyone converts or sends a file.
async function assertCanFile(actor: User, clientId: string, taskId: string | null) {
  assertCan(actor.role, "time_entry.create_self");
  if (!(await accessibleClientIds(actor)).has(clientId)) throw new ForbiddenError("You are not assigned to this client.");
  if (!clientDocumentsFolder()) throw new DriveNotConfiguredError();
  if (taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, clientId, deletedAt: null }, select: { id: true } });
    if (!task) throw new Error("The task is not on this client.");
  }
}

export interface FileDocumentInput {
  clientId: string;
  taskId: string | null;
  title: string;
  kind: ClientDocumentKind;
  fileName: string;
  mimeType?: string | null;
  clientVisible: boolean;
}

/// upload_document: the bytes arrived inside the tool call.
export async function fileDocumentFromMcp(actor: User, input: FileDocumentInput, content: Buffer) {
  const fileName = cleanFileName(input.fileName) || "document";
  return addClientDocument(actor, {
    clientId: input.clientId,
    taskId: input.taskId,
    title: input.title,
    kind: input.kind,
    fileName,
    mimeType: mimeTypeFor(fileName, input.mimeType),
    content,
    clientVisible: input.clientVisible,
  });
}

/// start_document_upload: everything about the document except its bytes.
export async function issueUploadTicket(actor: User, input: FileDocumentInput, now = new Date()) {
  await assertCanFile(actor, input.clientId, input.taskId);
  const ticket = generateFileTicket();
  const expiresAt = fileTicketExpiry(now);
  await prisma.mcpFileTicket.create({
    data: {
      tokenHash: hashFileTicket(ticket),
      purpose: "upload",
      userId: actor.id,
      tokenVersion: actor.tokenVersion,
      clientId: input.clientId,
      taskId: input.taskId,
      title: input.title.trim(),
      kind: input.kind,
      fileName: cleanFileName(input.fileName) || "document",
      mimeType: input.mimeType ?? null,
      clientVisible: input.clientVisible,
      expiresAt,
    },
  });
  return { ticket, expiresAt };
}

/// What the files route answers. Status and a sentence a model can act on.
export type TicketOutcome =
  | { ok: true; status: number; json: Record<string, unknown> }
  | { ok: true; status: 200; body: ArrayBuffer; mimeType: string; fileName: string }
  | { ok: false; status: number; error: string };

const GONE: TicketOutcome = {
  ok: false,
  status: 410,
  error: "This address is unknown, already used or expired. Ask Ankora for a new one (start_document_upload or read_document).",
};

/// The person a ticket was issued to, if they may still act.
async function ticketOwner(row: { userId: string; tokenVersion: number }): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || user.status !== "ACTIVE" || user.role === "CLIENT_USER") return null;
  if (user.tokenVersion !== row.tokenVersion) return null;
  return user;
}

/// PUT /api/mcp/files/<ticket>.
///
/// The ticket is claimed atomically before anything is stored, so two
/// requests racing on one address file one document, not two. If storing
/// fails the claim is released, because a dropped connection is not a
/// reason to make the person ask Claude for a new address.
export async function redeemUploadTicket(raw: string, content: Buffer, contentType: string | null, now = new Date()): Promise<TicketOutcome> {
  if (!looksLikeFileTicket(raw)) return GONE;
  const tokenHash = hashFileTicket(raw);

  const row = await prisma.mcpFileTicket.findUnique({ where: { tokenHash } });
  if (!row || row.purpose !== "upload" || row.usedAt || row.expiresAt <= now) return GONE;

  if (content.byteLength === 0) {
    return { ok: false, status: 400, error: "The request body is empty. Send the file's bytes as the body, for example: curl -T file.pdf <url>" };
  }
  if (content.byteLength > MAX_DOCUMENT_BYTES) {
    return { ok: false, status: 413, error: "The file is over 4MB. Compress it, or scan again at a lower resolution, and send it to the same address." };
  }

  const claimed = await prisma.mcpFileTicket.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return GONE;

  const actor = await ticketOwner(row);
  if (!actor) return GONE;

  const fileName = row.fileName ?? "document";
  try {
    const doc = await addClientDocument(actor, {
      clientId: row.clientId,
      taskId: row.taskId,
      title: row.title ?? fileName,
      kind: row.kind ?? "OTHER",
      fileName,
      mimeType: mimeTypeFor(fileName, row.mimeType ?? contentType),
      content,
      clientVisible: row.clientVisible,
    });
    await prisma.mcpFileTicket.update({ where: { id: row.id }, data: { documentId: doc.id } });
    return {
      ok: true,
      status: 201,
      json: { filed: true, documentId: doc.id, title: doc.title, sizeBytes: doc.sizeBytes, clientVisible: doc.clientVisible },
    };
  } catch (err) {
    await prisma.mcpFileTicket.update({ where: { id: row.id }, data: { usedAt: null } });
    if (err instanceof ForbiddenError) return { ok: false, status: 403, error: "The person who asked for this address no longer has access to this client." };
    if (err instanceof DriveNotConfiguredError) return { ok: false, status: 503, error: "Document storage is not connected yet." };
    console.error("[mcp-files] upload failed", err);
    return { ok: false, status: 502, error: "Ankora could not store the file. The address still works: try once more, then tell the user." };
  }
}

// ------------------------------------------------------------------ reading

export type McpDocument = {
  id: string;
  title: string;
  kind: ClientDocumentKind;
  mimeType: string;
  sizeBytes: number | null;
  clientVisible: boolean;
  clientId: string;
  driveFileId: string;
  taskId: string | null;
  createdAt: Date;
  task: { id: string; title: string } | null;
  uploadedBy: { name: string } | null;
  client: { name: string };
};

const DOC_SELECT = {
  id: true,
  title: true,
  kind: true,
  mimeType: true,
  sizeBytes: true,
  clientVisible: true,
  clientId: true,
  driveFileId: true,
  taskId: true,
  createdAt: true,
  task: { select: { id: true, title: true } },
  uploadedBy: { select: { name: true } },
  client: { select: { name: true } },
} as const;

/// The documents on a client, or on one task, that this person may see:
/// the client's file screen and the task's thread, as a list.
export async function listDocumentsForMcp(actor: User, where: { clientId?: string; taskId?: string }): Promise<McpDocument[]> {
  assertCan(actor.role, "time_entry.create_self");
  const ids = await accessibleClientIds(actor);
  if (where.clientId && !ids.has(where.clientId)) throw new ForbiddenError("You are not assigned to this client.");
  return prisma.clientDocument.findMany({
    where: {
      deletedAt: null,
      clientId: where.clientId ?? { in: [...ids] },
      ...(where.taskId ? { taskId: where.taskId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: DOC_SELECT,
  });
}

/// One document, by id, if this person may see it. Null otherwise, with no
/// difference between "does not exist" and "not yours".
export async function findDocumentForMcp(actor: User, documentId: string): Promise<McpDocument | null> {
  assertCan(actor.role, "time_entry.create_self");
  const id = documentId.trim();
  if (!id) return null;
  const doc = await prisma.clientDocument.findFirst({ where: { id, deletedAt: null }, select: DOC_SELECT });
  if (!doc) return null;
  if (!(await accessibleClientIds(actor)).has(doc.clientId)) return null;
  return doc;
}

/// The extension a document's Drive name ends with, for text extraction of
/// files filed as application/octet-stream.
function nameHint(doc: McpDocument): string {
  return `${doc.title}.${doc.mimeType.split("/").pop() ?? ""}`;
}

export type DocumentContent =
  | { ok: true; extracted: ExtractedText; bytes: Buffer }
  | { ok: false; message: string };

/// The document's bytes, fetched with the service account, and what can be
/// read out of them. Recorded in the audit log: a person reading a client's
/// contract through Claude is the same act as opening it on the screen,
/// and should leave the same trace.
export async function readDocumentForMcp(actor: User, doc: McpDocument): Promise<DocumentContent> {
  const file = await downloadFileFromDrive(doc.driveFileId);
  if (!file.ok || !file.body) {
    console.error("[mcp-files] Drive download failed", file.error);
    return { ok: false, message: "Ankora could not fetch this document from storage right now. Do not retry in a loop; tell the user." };
  }
  const bytes = Buffer.from(file.body);
  const extracted = await extractDocumentText(bytes, doc.mimeType, nameHint(doc));

  await recordAudit({
    actorId: actor.id,
    action: "client_document.read",
    entityType: "ClientDocument",
    entityId: doc.id,
    clientId: doc.clientId,
    after: { via: "mcp", extracted: extracted.kind },
  });

  return { ok: true, extracted, bytes };
}

/// read_document's download address, for a Claude that opens the file
/// itself. Valid for 15 minutes; may be fetched more than once in that time,
/// because a read that is retried changes nothing.
export async function issueDownloadTicket(actor: User, doc: McpDocument, now = new Date()) {
  const ticket = generateFileTicket();
  const expiresAt = fileTicketExpiry(now);
  await prisma.mcpFileTicket.create({
    data: {
      tokenHash: hashFileTicket(ticket),
      purpose: "download",
      userId: actor.id,
      tokenVersion: actor.tokenVersion,
      clientId: doc.clientId,
      documentId: doc.id,
      expiresAt,
    },
  });
  return { ticket, expiresAt };
}

/// GET /api/mcp/files/<ticket>.
export async function redeemDownloadTicket(raw: string, now = new Date()): Promise<TicketOutcome> {
  if (!looksLikeFileTicket(raw)) return GONE;
  const row = await prisma.mcpFileTicket.findUnique({ where: { tokenHash: hashFileTicket(raw) } });
  if (!row || row.purpose !== "download" || !row.documentId || row.expiresAt <= now) return GONE;

  const actor = await ticketOwner(row);
  if (!actor) return GONE;
  const doc = await findDocumentForMcp(actor, row.documentId);
  if (!doc) return GONE;

  const file = await downloadFileFromDrive(doc.driveFileId);
  if (!file.ok || !file.body) {
    console.error("[mcp-files] Drive download failed", file.error);
    return { ok: false, status: 502, error: "Ankora could not fetch this document from storage right now." };
  }

  if (!row.usedAt) {
    await prisma.mcpFileTicket.update({ where: { id: row.id }, data: { usedAt: now } });
    await recordAudit({
      actorId: actor.id,
      action: "client_document.read",
      entityType: "ClientDocument",
      entityId: doc.id,
      clientId: doc.clientId,
      after: { via: "mcp-download" },
    });
  }

  return { ok: true, status: 200, body: file.body, mimeType: doc.mimeType, fileName: doc.title };
}
