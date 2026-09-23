import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { resolvePortalClient, assertPortalWritable } from "@/lib/app-domain/client-portal";
import { sendEmail } from "@/lib/email";
import { appBaseUrl, renderActionEmail } from "@/lib/email-templates";
import type { Client, ClientDocumentKind, PortalDigest, SupplierExperience, User } from "@prisma/client";

// Portal phase 3, screen 5: "התיק שלי".
//
// The spec calls this the screen that is hardest to copy, and the reason
// is not the code. It is that everything on it is a by-product of work
// already done: who we used and how they were, what paperwork exists,
// what the client told us at intake, what comes round every year. A
// competitor can build these four lists in a week and will still have
// them empty.
//
// So none of it is a second data-entry screen. Suppliers come off the
// task that used them, documents off the work that produced them, dates
// off the reminder model that already runs, and preferences off the
// intake call. The only thing this file adds is the discipline of showing
// them back.
//
// Isolation, as everywhere in the portal: no function here takes a client
// id from its caller. resolvePortalClient is the only way in.

export interface PortalSupplier {
  taskId: string;
  /// The supplier's name as the person closing the task typed it.
  name: string;
  experience: SupplierExperience;
  /// What they did, in the client's words - the task's client-facing
  /// title, falling back to the internal one exactly as the promise list
  /// does.
  what: string;
  when: Date;
}

export interface PortalDocument {
  id: string;
  title: string;
  kind: ClientDocumentKind;
  mimeType: string;
  sizeBytes: number | null;
  addedAt: Date;
}

export interface PortalRecurringDate {
  id: string;
  title: string;
  /// The next time it comes round. Null only for a date whose recurrence
  /// could not be resolved, which the screen simply does not list.
  nextAt: Date | null;
}

export interface PortalFile {
  client: Client;
  isStaffPreview: boolean;
  /// A Client Viewer reads this screen and changes nothing, same rule as
  /// the decisions screen. So does a staff preview.
  canEdit: boolean;
  preferences: { contact: string | null; matters: string | null; never: string | null; updatedAt: Date | null };
  digest: PortalDigest;
  suppliers: PortalSupplier[];
  documents: PortalDocument[];
  dates: PortalRecurringDate[];
}

const SUPPLIER_TAKE = 30;
const DOCUMENT_TAKE = 60;
const DATE_TAKE = 30;

export const DIGEST_LABELS: Record<PortalDigest, string> = {
  EVERY_DECISION: "כל החלטה, ברגע שהיא נפתחת",
  WEEKLY: "סיכום שבועי",
  MONTHLY: "רק הסיכום החודשי",
};

export const DOCUMENT_KIND_LABELS: Record<ClientDocumentKind, string> = {
  POLICY: "פוליסה",
  CERTIFICATE: "אישור",
  CONTRACT: "חוזה",
  INVOICE: "חשבונית",
  OTHER: "מסמך",
};

export const SUPPLIER_EXPERIENCE_LABELS: Record<SupplierExperience, string> = {
  GOOD: "מומלץ",
  OK: "בסדר",
  AVOID: "לא נשתמש שוב",
};

/// The whole screen in one call.
///
/// Four reads rather than four screens: this is a reference page, the
/// client opens it rarely, and the parts are small enough that paging any
/// of them would cost more in navigation than it saves in bytes.
export async function getPortalFile(actor: User): Promise<PortalFile> {
  const { client, clientUserRole, isStaffPreview } = await resolvePortalClient(actor);

  const [supplierTasks, documents, dates] = await Promise.all([
    // Suppliers are derived, and derived only from promises the client
    // was told about. A supplier line on a task the client never saw
    // would announce work nobody chose to show them - the same opt-in
    // that governs the promise governs the supplier that came out of it.
    prisma.task.findMany({
      where: {
        clientId: client.id,
        deletedAt: null,
        clientVisible: true,
        supplierName: { not: null },
        supplierRecordedAt: { not: null },
      },
      orderBy: { supplierRecordedAt: "desc" },
      take: SUPPLIER_TAKE,
      select: {
        id: true,
        title: true,
        clientTitle: true,
        supplierName: true,
        supplierExperience: true,
        supplierRecordedAt: true,
      },
    }),
    prisma.clientDocument.findMany({
      where: { clientId: client.id, deletedAt: null, clientVisible: true },
      orderBy: { createdAt: "desc" },
      take: DOCUMENT_TAKE,
      select: { id: true, title: true, kind: true, mimeType: true, sizeBytes: true, createdAt: true },
    }),
    // Two gates, not one. `clientVisible` is the opt-in someone ticked;
    // SENSITIVE is the rule that overrides them. A date marked sensitive
    // is visible internally to its owner and to managers only, and the
    // portal is neither - so it is excluded in the query rather than
    // trusted to whoever was ticking boxes.
    prisma.importantDate.findMany({
      where: {
        clientId: client.id,
        deletedAt: null,
        archivedAt: null,
        clientVisible: true,
        sensitivity: "NORMAL",
        status: { notIn: ["ARCHIVED", "PAUSED"] },
      },
      orderBy: { nextOccurrenceAt: "asc" },
      take: DATE_TAKE,
      select: { id: true, title: true, nextOccurrenceAt: true },
    }),
  ]);

  return {
    client,
    isStaffPreview,
    canEdit: !isStaffPreview && clientUserRole === "ADMIN",
    preferences: {
      contact: client.preferenceContact,
      matters: client.preferenceMatters,
      never: client.preferenceNever,
      updatedAt: client.preferencesUpdatedAt,
    },
    digest: client.portalDigest,
    suppliers: supplierTasks.map((t) => ({
      taskId: t.id,
      name: t.supplierName as string,
      experience: t.supplierExperience ?? "OK",
      what: t.clientTitle?.trim() || t.title,
      when: t.supplierRecordedAt as Date,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      kind: d.kind,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      addedAt: d.createdAt,
    })),
    dates: dates.map((d) => ({ id: d.id, title: d.title, nextAt: d.nextOccurrenceAt })),
  };
}

export interface PortalPreferencesInput {
  contact?: string | null;
  matters?: string | null;
  never?: string | null;
}

function clean(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const PREFERENCE_MAX = 2000;

/// The client rewriting their own preferences.
///
/// Absent keys leave a field alone, same patch contract as everywhere
/// else in this codebase, so the form can post one field or three.
export async function updatePortalPreferences(actor: User, input: PortalPreferencesInput) {
  const ctx = await resolvePortalClient(actor);
  assertPortalWritable(ctx);
  if (ctx.clientUserRole !== "ADMIN") {
    throw new ForbiddenError("Only a client admin may change preferences");
  }

  for (const value of [input.contact, input.matters, input.never]) {
    if (typeof value === "string" && value.length > PREFERENCE_MAX) {
      throw new Error("הטקסט ארוך מדי. אפשר לקצר, או לספר לנו את השאר בוואטסאפ.");
    }
  }

  const client = await prisma.client.update({
    where: { id: ctx.client.id },
    data: {
      preferenceContact: clean(input.contact),
      preferenceMatters: clean(input.matters),
      preferenceNever: clean(input.never),
      preferencesUpdatedAt: new Date(),
      preferencesUpdatedById: actor.id,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "portal.preferences.update",
    entityType: "Client",
    entityId: client.id,
    clientId: client.id,
  });

  // The spec's own wording for this row: "שינוי של הלקוח מתריע למנהל
  // התיק". A client who writes "אל תתקשרו לפני תשע" into a form and
  // then gets a call at eight has been given a worse experience than if
  // the field had never existed.
  await notifyManagerOfPreferenceChange(client, actor);

  return client;
}

/// How often this client wants to hear from us. Theirs alone: Ankora can
/// see it, and has no reason to set it.
export async function updatePortalDigest(actor: User, digest: PortalDigest) {
  const ctx = await resolvePortalClient(actor);
  assertPortalWritable(ctx);
  if (ctx.clientUserRole !== "ADMIN") {
    throw new ForbiddenError("Only a client admin may change the digest");
  }

  const client = await prisma.client.update({ where: { id: ctx.client.id }, data: { portalDigest: digest } });

  await recordAudit({
    actorId: actor.id,
    action: "portal.digest.update",
    entityType: "Client",
    entityId: client.id,
    clientId: client.id,
  });

  return client;
}

/// Resolve a document the signed-in portal user is allowed to download.
///
/// Takes a document id and NOT a client id, and then checks that the
/// document belongs to the client this session resolves to. That order
/// matters: the id in the URL is a request, the membership is the
/// authorisation, and a document id that belongs to someone else fails
/// closed rather than reading across.
///
/// Returns the Drive file id for the server to stream. It never leaves
/// this process - section 14's third rule is that a document is reachable
/// through this server only, because a link that works on its own
/// outlives whatever permission granted it.
export async function resolvePortalDocument(actor: User, documentId: string) {
  const { client } = await resolvePortalClient(actor);

  const doc = await prisma.clientDocument.findFirst({
    where: { id: documentId, clientId: client.id, deletedAt: null, clientVisible: true },
    select: { id: true, title: true, mimeType: true, driveFileId: true },
  });
  if (!doc) throw new ForbiddenError("No such document for this client");

  return doc;
}

async function notifyManagerOfPreferenceChange(client: Client, actor: User) {
  if (!client.accountManagerId) return;

  const manager = await prisma.user.findFirst({
    where: { id: client.accountManagerId, deletedAt: null, status: "ACTIVE" },
    select: { email: true },
  });
  if (!manager) return;

  const { html, text } = renderActionEmail({
    title: `${client.name} עדכן העדפות שירות`,
    body: [
      `${actor.name} שינה את ההעדפות של ${client.name} בפורטל.`,
      "שווה לקרוא לפני הפנייה הבאה: זה בדיוק המקום שבו לקוח אומר לנו מה חשוב לו ומה אסור שיקרה.",
    ],
    buttonLabel: "לכרטיס הלקוח",
    url: `${appBaseUrl()}/app/clients/${client.id}`,
  });

  await sendEmail({
    to: [manager.email],
    subject: `${client.name}: העדפות שירות עודכנו`,
    html,
    text,
  }).catch(() => {
    // A notification that fails must never undo a preference the client
    // successfully saved. The row is the record; the email is a courtesy
    // on top of it.
  });
}
