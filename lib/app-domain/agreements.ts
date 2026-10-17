import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { ForbiddenError, assertCan } from "@/lib/app-auth/permissions";
import { sendEmail } from "@/lib/email";
import { appBaseUrl, renderDeletionDeclarationEmail } from "@/lib/email-templates";
import { employeeAgreementsFolder, uploadFileToDriveFolder } from "@/lib/google-drive";
import { renderAgreementPdf, renderBlankAgreementPdf } from "@/lib/agreement-pdf";
import { fileTicketExpiry, fileTicketUrl, generateFileTicket, hashFileTicket } from "@/lib/mcp/file-ticket";
import {
  CURRENT_AGREEMENTS,
  SIGN_LINK_TTL_MS,
  agreementCode,
  agreementFileName,
  contentHash,
  currentAgreement,
  findAgreement,
  findAgreementByVersionOrCode,
  hashSignToken,
  hashUploadCode,
  MIN_LEGACY_TOKEN_LENGTH,
  newUploadCode,
  lifecycleKindFor,
  linkStateFor,
  looksLikePdf,
  MAX_SIGNED_PDF_BYTES,
  textHasAgreementCode,
  loadAgreementText,
  namesMatch,
  newSignToken,
  signLinkState,
  type AgreementVersion,
} from "@/lib/agreements";
import type { AgreementChannel, AgreementKind, EmployeeAgreement, User, UserRole } from "@prisma/client";

// Employee agreements, the domain half. Rows in employee_agreements are
// only ever created here, never updated except to attach the Drive file
// id of the PDF made from them, and never deleted: a signature is
// evidence, and evidence that can be edited is not evidence.
//
// Every failure a signer can cause throws AgreementError with a Hebrew
// message meant for the screen. Anything else is a bug and is left to
// propagate.

export class AgreementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgreementError";
  }
}

/// Issuing links and recording a returned PDF are admin acts. Both admin
/// roles, because either may be the one handling someone's departure.
function assertAgreementAdmin(role: UserRole) {
  if (role !== "SUPER_ADMIN" && role !== "ANKORA_ADMIN") throw new ForbiddenError();
}

const KINDS: AgreementKind[] = ["CONFIDENTIALITY", "DELETION_DECLARATION"];

// --- Signing in the app ---------------------------------------------------

interface SignInput {
  /// What the signer typed in "שם מלא".
  signedName: string;
  /// The checkbox. Checked again here, not only in the browser.
  consent: boolean;
  /// The version the page showed. A text that changed between opening the
  /// page and pressing the button must not be signed under the new hash.
  version: string;
  ip: string | null;
  userAgent: string | null;
}

function validateSignInput(
  signer: Pick<User, "name">,
  agreement: AgreementVersion,
  input: SignInput
): string {
  if (input.version !== agreement.version) {
    throw new AgreementError("נוסח המסמך עודכן מאז שנפתח. יש לטעון את הדף מחדש ולקרוא את הנוסח הנוכחי.");
  }
  if (!input.consent) throw new AgreementError("יש לסמן שקראת את המסמך ושהוא מקובל עליך.");
  const typed = input.signedName.trim().replace(/\s+/g, " ");
  if (!typed) throw new AgreementError("יש להקליד שם מלא.");
  if (!namesMatch(typed, signer.name)) {
    throw new AgreementError(`השם שהוקלד אינו תואם לשם בחשבון (${signer.name}). יש להקליד את השם המלא כפי שהוא מופיע כאן.`);
  }
  return typed;
}

/// The PDF and its upload, after the signature is already saved. Never
/// throws and never blocks the signer: a missing folder or a Drive outage
/// leaves driveFileId null, logged, and the row is the record either way.
async function fileSignedPdf(row: EmployeeAgreement, agreement: AgreementVersion, text: string, email: string) {
  const folderId = employeeAgreementsFolder();
  if (!folderId) {
    console.warn(`[agreements] GOOGLE_DRIVE_FOLDER_EMPLOYEE_AGREEMENTS is not set; ${row.id} saved without a PDF`);
    return;
  }
  try {
    const pdf = await renderAgreementPdf({
      kind: row.kind,
      title: agreement.title,
      version: row.version,
      text,
      signedName: row.signedName,
      email,
      signedAt: row.signedAt,
      ip: row.ip,
      userAgent: row.userAgent,
      channel: row.channel,
      contentHash: row.contentHash,
    });
    const upload = await uploadFileToDriveFolder({
      name: agreementFileName(row.kind, row.version, row.signedName, row.signedAt),
      mimeType: "application/pdf",
      content: pdf,
      folderId,
    });
    if (!upload.ok || !upload.fileId) {
      console.error(`[agreements] Drive upload failed for ${row.id}: ${upload.error ?? "no file id"}`);
      return;
    }
    await prisma.employeeAgreement.update({ where: { id: row.id }, data: { driveFileId: upload.fileId } });
  } catch (err) {
    console.error(`[agreements] PDF for ${row.id} failed:`, err);
  }
}

/// The signed-in person signs the current confidentiality undertaking.
/// Signing twice is harmless and returns the existing row, so a double
/// click does not produce two signatures.
export async function signConfidentiality(user: User, input: SignInput): Promise<EmployeeAgreement> {
  if (user.role === "CLIENT_USER") throw new ForbiddenError();
  const agreement = currentAgreement("CONFIDENTIALITY");
  const signedName = validateSignInput(user, agreement, input);

  const existing = await prisma.employeeAgreement.findFirst({
    where: { userId: user.id, kind: "CONFIDENTIALITY", version: agreement.version, channel: "APP" },
  });
  if (existing) return existing;

  const text = loadAgreementText(agreement);
  const row = await prisma.employeeAgreement.create({
    data: {
      userId: user.id,
      kind: "CONFIDENTIALITY",
      version: agreement.version,
      channel: "APP",
      signedAt: new Date(),
      signedName,
      ip: input.ip,
      userAgent: input.userAgent,
      contentHash: contentHash(text),
    },
  });

  await recordAudit({
    actorId: user.id,
    action: "agreement.sign",
    entityType: "EmployeeAgreement",
    entityId: row.id,
    after: { kind: row.kind, version: row.version, channel: row.channel, contentHash: row.contentHash },
  });

  await fileSignedPdf(row, agreement, text, user.email);
  // Employee lifecycle: the onboarding task's signature step. Never throws.
  const { onConfidentialitySigned } = await import("@/lib/app-domain/employee-lifecycle");
  await onConfidentialitySigned(user.id);
  return row;
}

// --- One-time link -----------------------------------------------------------

export interface SignLinkView {
  userName: string;
  agreement: AgreementVersion;
  text: string;
}

/// What the public sign page shows for a token, or null for any token
/// that cannot be used. The reason is not returned on purpose.
export async function viewSignLink(raw: string): Promise<SignLinkView | null> {
  if (!raw) return null;
  const link = await prisma.agreementSignLink.findUnique({
    where: { tokenHash: hashSignToken(raw) },
    include: { user: { select: { name: true, deletedAt: true } } },
  });
  if (linkStateFor(link, "APP_SIGN") !== "valid" || !link || link.user.deletedAt) return null;
  const agreement = findAgreement(link.kind, link.version);
  if (!agreement) return null;
  return { userName: link.user.name, agreement, text: loadAgreementText(agreement) };
}

/// Signs through a one-time link. The link is burned in the same
/// transaction that writes the signature, and burned conditionally
/// (unused and unexpired at that instant), so two submissions of the same
/// link cannot both produce a row.
export async function signWithLink(raw: string, input: SignInput): Promise<EmployeeAgreement> {
  const invalid = new AgreementError("הקישור אינו זמין עוד. אפשר לפנות לאנקורה ולבקש קישור חדש.");
  if (!raw) throw invalid;

  const link = await prisma.agreementSignLink.findUnique({
    where: { tokenHash: hashSignToken(raw) },
    include: { user: true },
  });
  if (!link || linkStateFor(link, "APP_SIGN") !== "valid" || link.user.deletedAt) throw invalid;

  const agreement = findAgreement(link.kind, link.version);
  if (!agreement) throw invalid;
  const signedName = validateSignInput(link.user, agreement, input);
  const text = loadAgreementText(agreement);
  const now = new Date();

  const row = await prisma.$transaction(async (tx) => {
    const burned = await tx.agreementSignLink.updateMany({
      where: { id: link.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (burned.count !== 1) throw invalid;
    return tx.employeeAgreement.create({
      data: {
        userId: link.userId,
        kind: link.kind,
        version: link.version,
        channel: "APP",
        signedAt: now,
        signedName,
        ip: input.ip,
        userAgent: input.userAgent,
        contentHash: contentHash(text),
      },
    });
  });

  // The signer has no session here; the token identified them, so the
  // row is attributed to them, as a sign-in link's success is.
  await recordAudit({
    actorId: link.userId,
    action: "agreement.sign",
    entityType: "EmployeeAgreement",
    entityId: row.id,
    after: { kind: row.kind, version: row.version, channel: row.channel, contentHash: row.contentHash, viaLink: link.id },
  });

  await fileSignedPdf(row, agreement, text, link.user.email);
  // Employee lifecycle. Never throws. A deletion declaration is noted on
  // the offboarding task; a confidentiality undertaking signed through a
  // link is an in-app signature like any other, so it gets the same hook
  // as signConfidentiality (including closing the PDF step when the PDF
  // was recorded first).
  const lifecycle = await import("@/lib/app-domain/employee-lifecycle");
  if (row.kind === "DELETION_DECLARATION") await lifecycle.onDeletionDeclarationSigned(link.userId, row.id);
  else await lifecycle.onConfidentialitySigned(link.userId);
  return row;
}

/// Sends the deletion declaration to someone who is leaving, as a one-time
/// link to their private address. Earlier unused links for the same
/// declaration are burned first, so "send again" replaces rather than
/// multiplies live links.
///
/// Meant for someone already suspended or archived. For an account that is
/// still active it needs `confirmActive`, so the declaration is never sent
/// to a working colleague by a misclick.
export async function issueDeletionDeclarationLink(
  actor: User,
  userId: string,
  opts: { confirmActive?: boolean } = {}
) {
  assertAgreementAdmin(actor.role);

  const target = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!target) throw new AgreementError("משתמש לא נמצא.");
  if (target.role === "CLIENT_USER") throw new AgreementError("הצהרת מחיקה נשלחת רק לאנשי אנקורה.");
  if ((target.status === "ACTIVE" || target.status === "INVITED") && !opts.confirmActive) {
    throw new AgreementError("המשתמש עדיין פעיל. יש לאשר שהשליחה מכוונת.");
  }
  if (!target.personalEmail) {
    throw new AgreementError("לא הוגדר מייל פרטי למשתמש. יש להוסיף אותו בעמוד המשתמש לפני השליחה.");
  }

  const agreement = currentAgreement("DELETION_DECLARATION");
  const { raw, tokenHash } = newSignToken();

  const [revoked, link] = await prisma.$transaction([
    prisma.agreementSignLink.updateMany({
      // Sign links only: a live upload link for the PDF channel is a
      // different thing the person may still need.
      where: { userId: target.id, kind: "DELETION_DECLARATION", purpose: "APP_SIGN", usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.agreementSignLink.create({
      data: {
        userId: target.id,
        kind: "DELETION_DECLARATION",
        purpose: "APP_SIGN",
        version: agreement.version,
        tokenHash,
        expiresAt: new Date(Date.now() + SIGN_LINK_TTL_MS),
        createdById: actor.id,
      },
    }),
  ]);

  const url = `${appBaseUrl()}/agreements/sign/${raw}`;
  const { html, text } = renderDeletionDeclarationEmail({ name: target.name, url });
  const mail = await sendEmail({
    to: [target.personalEmail],
    subject: "הצהרת מחיקה בסיום העבודה עם Ankora",
    text,
    html,
    replyTo: "ops@ankora.co.il",
  });

  await recordAudit({
    actorId: actor.id,
    action: "agreement.link_issued",
    entityType: "AgreementSignLink",
    entityId: link.id,
    after: {
      userId: target.id,
      kind: link.kind,
      version: link.version,
      to: target.personalEmail,
      emailSent: mail.ok,
      revokedLinks: revoked.count,
    },
  });

  return { url, emailSent: mail.ok, emailError: mail.ok ? undefined : mail.error };
}

// --- The PDF channel (exposed later, over MCP) ------------------------------

/// Records a signature that came back as a signed PDF by email. The
/// PDF itself is already in Drive; this row is what makes it count.
export async function recordPdfSignature(
  actor: User,
  input: {
    userId: string;
    kind: AgreementKind;
    version: string;
    signedName: string;
    signedAt: Date;
    driveFileId: string | null;
  }
): Promise<EmployeeAgreement> {
  assertAgreementAdmin(actor.role);

  const target = await prisma.user.findFirst({ where: { id: input.userId, deletedAt: null } });
  if (!target) throw new AgreementError("משתמש לא נמצא.");
  if (target.role === "CLIENT_USER") throw new AgreementError("מסמכים אלה נחתמים רק על ידי אנשי אנקורה.");

  const agreement = findAgreement(input.kind, input.version);
  if (!agreement) throw new AgreementError(`הגרסה ${input.version} אינה קיימת למסמך הזה.`);

  const signedName = input.signedName.trim().replace(/\s+/g, " ");
  if (!signedName) throw new AgreementError("יש לציין את השם שנחתם.");
  if (Number.isNaN(input.signedAt.getTime()) || input.signedAt.getTime() > Date.now() + 60_000) {
    throw new AgreementError("תאריך החתימה אינו תקין.");
  }

  const row = await prisma.employeeAgreement.create({
    data: {
      userId: target.id,
      kind: input.kind,
      version: agreement.version,
      channel: "EMAIL_PDF",
      signedAt: input.signedAt,
      signedName,
      ip: null,
      userAgent: null,
      contentHash: contentHash(loadAgreementText(agreement)),
      driveFileId: input.driveFileId || null,
      recordedById: actor.id,
    },
  });

  await recordAudit({
    actorId: actor.id,
    action: "agreement.pdf_recorded",
    entityType: "EmployeeAgreement",
    entityId: row.id,
    after: { userId: target.id, kind: row.kind, version: row.version, driveFileId: row.driveFileId },
  });

  return row;
}

/// The latest signature in one channel, of any version.
export interface SignatureRef {
  version: string;
  signedAt: Date;
}

export interface AgreementStatus {
  kind: AgreementKind;
  currentVersion: string;
  /// Signed on the current version, per channel.
  app: boolean;
  emailPdf: boolean;
  /// The most recent signature per channel, whatever its version, so an
  /// agent can tell "signed an older version" from "never signed".
  appLatest: SignatureRef | null;
  emailPdfLatest: SignatureRef | null;
}

/// For each kind: the current version, whether it is signed in each
/// channel, and the latest signature per channel. Older versions do not
/// count as signed; a new version asks again.
export async function getAgreementStatus(userId: string): Promise<AgreementStatus[]> {
  const rows = await prisma.employeeAgreement.findMany({
    where: { userId },
    orderBy: { signedAt: "desc" },
    select: { kind: true, version: true, channel: true, signedAt: true },
  });
  const signed = (kind: AgreementKind, channel: AgreementChannel) =>
    rows.some((r) => r.kind === kind && r.version === CURRENT_AGREEMENTS[kind] && r.channel === channel);
  const latest = (kind: AgreementKind, channel: AgreementChannel): SignatureRef | null => {
    const r = rows.find((x) => x.kind === kind && x.channel === channel);
    return r ? { version: r.version, signedAt: r.signedAt } : null;
  };
  return KINDS.map((kind) => ({
    kind,
    currentVersion: CURRENT_AGREEMENTS[kind],
    app: signed(kind, "APP"),
    emailPdf: signed(kind, "EMAIL_PDF"),
    appLatest: latest(kind, "APP"),
    emailPdfLatest: latest(kind, "EMAIL_PDF"),
  }));
}

/// The PDF channel, as the MCP tool record_pdf_signature calls it: the
/// signed PDF has already been filed as a document on the internal client,
/// and this records that it counts.
///
/// Stricter than recordPdfSignature on purpose, because the caller is an
/// agent: only the CURRENT version may be recorded (the agent compares
/// the version printed on the PDF with this one, and an older one means
/// the person signed an outdated text), the document must be on the
/// internal client (so a client's file is never the evidence), and a
/// second call for the same person, kind and version returns the row
/// already there instead of a duplicate.
export async function recordPdfSignatureFromDocument(
  actor: User,
  input: {
    userId: string;
    kind: AgreementKind;
    version: string;
    signedName: string;
    signedAt: Date;
    documentId: string;
  }
): Promise<{ row: EmployeeAgreement; alreadyRecorded: boolean }> {
  assertAgreementAdmin(actor.role);

  // The version as printed in Hebrew, or the Latin code from the footer
  // (which is what survives text extraction from a returned PDF).
  const expected = CURRENT_AGREEMENTS[input.kind];
  const expectedCode = agreementCode(input.kind, expected);
  const given = findAgreementByVersionOrCode(input.kind, input.version);
  if (!given || given.version !== expected) {
    throw new AgreementError(
      `The current version of ${input.kind} is "${expected}" (code ${expectedCode}), not "${input.version}". Record only a PDF whose footer code is ${expectedCode}; a different version needs a person to decide.`
    );
  }

  const { resolveInternalClient } = await import("@/lib/app-domain/employee-lifecycle");
  const internal = await resolveInternalClient();
  if (!internal) throw new AgreementError("The internal client (Ankora פנימי) was not found, so the PDF cannot be verified as filed there.");

  const doc = await prisma.clientDocument.findFirst({
    where: { id: input.documentId.trim(), deletedAt: null },
    select: { id: true, clientId: true, driveFileId: true },
  });
  if (!doc) throw new AgreementError(`No document with id "${input.documentId}". File the signed PDF first, then pass its documentId.`);
  if (doc.clientId !== internal.id) {
    throw new AgreementError(`That document is not in the file of ${internal.name}. Signed agreements are filed there, never on a client.`);
  }

  const existing = await prisma.employeeAgreement.findFirst({
    where: { userId: input.userId, kind: input.kind, version: expected, channel: "EMAIL_PDF" },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    // The upload is dealt with either way: without this, a PDF uploaded
    // after the version was already recorded would wait in
    // pendingPdfUploads forever (found in the dry run, 16.10.2026).
    await markUploadReviewed(input.userId, doc.id, actor.id);
    return { row: existing, alreadyRecorded: true };
  }

  const row = await recordPdfSignature(actor, {
    userId: input.userId,
    kind: input.kind,
    version: expected,
    signedName: input.signedName,
    signedAt: input.signedAt,
    driveFileId: doc.driveFileId,
  });

  // The lifecycle task hears about it. Never throws.
  const { onPdfSignatureRecorded } = await import("@/lib/app-domain/employee-lifecycle");
  await onPdfSignatureRecorded(input.userId, input.kind, row.id);

  await markUploadReviewed(input.userId, doc.id, actor.id);
  return { row, alreadyRecorded: false };
}

export async function listAgreementsForUser(userId: string) {
  return prisma.employeeAgreement.findMany({
    where: { userId },
    orderBy: { signedAt: "desc" },
    select: { id: true, kind: true, version: true, channel: true, signedAt: true, driveFileId: true },
  });
}

// --- The blank form, for the PDF channel -----------------------------------

/// The blank form of the current version of one kind, ready to send for
/// a signature on paper or in a PDF editor. Who may have it is the
/// caller's question: the route and the MCP tool both ask it first.
export async function blankAgreementPdf(kind: AgreementKind): Promise<{ pdf: Buffer; code: string; fileName: string }> {
  const agreement = currentAgreement(kind);
  const code = agreementCode(kind, agreement.version);
  const pdf = await renderBlankAgreementPdf({
    kind,
    title: agreement.title,
    version: agreement.version,
    text: loadAgreementText(agreement),
  });
  return { pdf, code, fileName: `${code}.pdf` };
}

/// McpFileTicket.purpose for a blank form. The ticket carries the form's
/// file name, which names kind and version through the code; nothing else
/// about it needs storing.
export const BLANK_AGREEMENT_TICKET = "agreement-blank";

/// A short-lived download address for the blank form, the same kind of
/// address read_document hands out (lib/mcp/file-ticket.ts): 15 minutes,
/// stored only as a hash, tied to the person who asked and their sessions.
/// The ticket table needs a client, and the form belongs to the internal
/// one, where the signed copy will be filed.
export async function issueBlankAgreementTicket(actor: User, kind: AgreementKind, now = new Date()) {
  assertCan(actor.role, "time_entry.edit_others");
  const { resolveInternalClient } = await import("@/lib/app-domain/employee-lifecycle");
  const internal = await resolveInternalClient();
  if (!internal) throw new AgreementError("The internal client (Ankora פנימי) was not found, so no download address can be issued.");

  const agreement = currentAgreement(kind);
  const code = agreementCode(kind, agreement.version);
  const ticket = generateFileTicket();
  const expiresAt = fileTicketExpiry(now);
  await prisma.mcpFileTicket.create({
    data: {
      tokenHash: hashFileTicket(ticket),
      purpose: BLANK_AGREEMENT_TICKET,
      userId: actor.id,
      tokenVersion: actor.tokenVersion,
      clientId: internal.id,
      fileName: `${code}.pdf`,
      expiresAt,
    },
  });
  await recordAudit({
    actorId: actor.id,
    action: "agreement.blank_issued",
    entityType: "User",
    entityId: actor.id,
    after: { kind, version: agreement.version, code, via: "mcp" },
  });
  return { url: fileTicketUrl(appBaseUrl(), ticket), expiresAt, code, version: agreement.version, fileName: `${code}.pdf` };
}

/// The kind a blank-form ticket was issued for, from its file name.
export function kindFromBlankFileName(fileName: string | null): AgreementKind | null {
  if (!fileName) return null;
  const kind = (["CONFIDENTIALITY", "DELETION_DECLARATION"] as const).find(
    (k) => fileName === `${agreementCode(k, CURRENT_AGREEMENTS[k])}.pdf`
  );
  return kind ?? null;
}

// --- The personal upload link, for the PDF channel --------------------------
//
// 16.10.2026, approved by Ariel. A dry run showed the agent cannot take an
// attachment out of an email reply (the Gmail connector does not download
// attachments), so a signed PDF sent back by email could never be filed.
// Instead the email carries a personal link; the person uploads the signed
// PDF on a public page; the server files it on the internal client; the
// agent then checks it (code in the footer, a visible signature) and calls
// record_pdf_signature as before. Uploading never records a signature by
// itself: a person or an agent still looks at the document.

/// A short upload code for the signed PDF of one agreement, typed by the
/// employee on /upload (see the code notes in lib/agreements.ts). Seven
/// days; a new code replaces any earlier unused one for the same person
/// and document, links issued before the code included.
export async function issueAgreementUploadCode(actor: User, userId: string, kind: AgreementKind) {
  assertAgreementAdmin(actor.role);
  const target = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!target || target.role === "CLIENT_USER") throw new AgreementError("No Ankora staff member with that id.");

  const agreement = currentAgreement(kind);
  const uploadCode = newUploadCode();
  const tokenHash = hashUploadCode(uploadCode)!;
  const expiresAt = new Date(Date.now() + SIGN_LINK_TTL_MS);

  const [revoked, link] = await prisma.$transaction([
    prisma.agreementSignLink.updateMany({
      where: { userId: target.id, kind, purpose: "PDF_UPLOAD", usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.agreementSignLink.create({
      data: {
        userId: target.id,
        kind,
        version: agreement.version,
        purpose: "PDF_UPLOAD",
        tokenHash,
        expiresAt,
        createdById: actor.id,
      },
    }),
  ]);

  await recordAudit({
    actorId: actor.id,
    action: "agreement.upload_code_issued",
    entityType: "AgreementSignLink",
    entityId: link.id,
    after: { userId: target.id, kind, version: agreement.version, revokedLinks: revoked.count },
  });

  return {
    uploadCode,
    uploadPageUrl: `${appBaseUrl()}/upload`,
    expiresAt,
    version: agreement.version,
    agreementCode: agreementCode(kind, agreement.version),
  };
}

type UploadLinkRow = NonNullable<Awaited<ReturnType<typeof findUploadLink>>>;

async function findUploadLink(tokenHash: string) {
  const link = await prisma.agreementSignLink.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, name: true, deletedAt: true } } },
  });
  if (!link || linkStateFor(link, "PDF_UPLOAD") !== "valid" || link.user.deletedAt) return null;
  if (!findAgreement(link.kind, link.version)) return null;
  return link;
}

/// The legacy token, only in its own long shape (see MIN_LEGACY_TOKEN_LENGTH).
function legacyTokenHash(raw: string): string | null {
  return raw && raw.length >= MIN_LEGACY_TOKEN_LENGTH ? hashSignToken(raw) : null;
}

export interface UploadLinkView {
  userName: string;
  title: string;
  version: string;
  code: string;
  expiresAt: Date;
}

/// What the legacy upload page shows for a token, or null for any token
/// that cannot be used. As with signing, the reason is not returned.
export async function viewUploadLink(raw: string): Promise<UploadLinkView | null> {
  const hash = legacyTokenHash(raw);
  const link = hash ? await findUploadLink(hash) : null;
  if (!link) return null;
  const agreement = findAgreement(link.kind, link.version)!;
  return {
    userName: link.user.name,
    title: agreement.title,
    version: agreement.version,
    code: agreementCode(link.kind, agreement.version),
    expiresAt: link.expiresAt,
  };
}

/// What /upload shows once a code checks out: the document, and the first
/// name only, enough for the person to see it is theirs and no more.
export async function viewUploadCode(code: string): Promise<{ title: string; firstName: string; version: string; agreementCode: string } | null> {
  const hash = hashUploadCode(code);
  const link = hash ? await findUploadLink(hash) : null;
  if (!link) return null;
  const agreement = findAgreement(link.kind, link.version)!;
  return {
    title: agreement.title,
    firstName: link.user.name.trim().split(/\s+/)[0] ?? "",
    version: agreement.version,
    agreementCode: agreementCode(link.kind, agreement.version),
  };
}

const INVALID_LINK_MESSAGE = "הקישור אינו זמין עוד. אפשר לפנות לאנקורה ולבקש קישור חדש.";
/// One message for every code that cannot be used, never saying whether
/// it exists, expired or was used.
export const INVALID_UPLOAD_CODE_MESSAGE = "הקוד אינו תקף. אפשר לבדוק את הקוד במייל, או לפנות ל-ops@ankora.co.il ולבקש קוד חדש.";

/// The legacy path: a signed PDF through an upload link issued before codes.
export async function uploadSignedPdfWithLink(
  raw: string,
  file: { content: Buffer; fileName: string }
): Promise<{ documentId: string; codeFound: boolean }> {
  const hash = legacyTokenHash(raw);
  const link = hash ? await findUploadLink(hash) : null;
  if (!link) throw new AgreementError(INVALID_LINK_MESSAGE);
  return uploadSignedPdf(link, file, { invalid: INVALID_LINK_MESSAGE, retry: "הקישור עדיין בתוקף" });
}

/// The signed PDF, through the code typed on /upload. The code is checked
/// again here, not trusted from the page's first step.
export async function uploadSignedPdfWithCode(
  code: string,
  file: { content: Buffer; fileName: string }
): Promise<{ documentId: string; codeFound: boolean }> {
  const hash = hashUploadCode(code);
  const link = hash ? await findUploadLink(hash) : null;
  if (!link) throw new AgreementError(INVALID_UPLOAD_CODE_MESSAGE);
  return uploadSignedPdf(link, file, { invalid: INVALID_UPLOAD_CODE_MESSAGE, retry: "הקוד עדיין בתוקף" });
}

/// Files the signed PDF that came through an upload link.
///
/// The link is claimed before anything is stored (conditionally, so two
/// uploads racing on one link file one document) and released again if
/// filing fails, so a storage hiccup does not cost the person their link.
/// The document goes on the internal client, hidden from the client, on
/// the person's open lifecycle task when there is one. A copy goes to the
/// employee agreements folder, best effort, as signed PDFs do.
async function uploadSignedPdf(
  link: UploadLinkRow,
  file: { content: Buffer; fileName: string },
  messages: { invalid: string; retry: string }
): Promise<{ documentId: string; codeFound: boolean }> {
  const invalid = new AgreementError(messages.invalid);
  const agreement = findAgreement(link.kind, link.version)!;

  if (file.content.byteLength === 0) throw new AgreementError("הקובץ ריק. יש לבחור את קובץ ה-PDF החתום.");
  if (file.content.byteLength > MAX_SIGNED_PDF_BYTES) {
    throw new AgreementError("הקובץ גדול מ-4MB. אפשר לסרוק שוב באיכות נמוכה יותר ולנסות שוב.");
  }
  if (!looksLikePdf(file.content)) throw new AgreementError("הקובץ אינו PDF. יש להעלות את הטופס החתום כקובץ PDF.");

  const { resolveInternalClient, openLifecycleTaskId, onSignedPdfUploaded } = await import(
    "@/lib/app-domain/employee-lifecycle"
  );
  const internal = await resolveInternalClient();
  if (!internal) {
    console.error("[agreements] upload link used but the internal client was not found");
    throw new AgreementError(`לא הצלחנו לשמור את הקובץ כרגע. אפשר לנסות שוב מאוחר יותר, ${messages.retry}.`);
  }

  const now = new Date();
  const claimed = await prisma.agreementSignLink.updateMany({
    where: { id: link.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) throw invalid;

  const code = agreementCode(link.kind, link.version);
  const taskId = await openLifecycleTaskId(link.userId, lifecycleKindFor(link.kind));
  let documentId: string;
  try {
    const { addClientDocumentForLink } = await import("@/lib/app-domain/client-documents");
    const doc = await addClientDocumentForLink(
      {
        clientId: internal.id,
        taskId,
        title: `${agreement.title} חתום (PDF) - ${link.user.name}`,
        kind: "CONTRACT",
        fileName: `${code}-${link.user.name}.pdf`,
        mimeType: "application/pdf",
        content: file.content,
        clientVisible: false,
      },
      link.userId
    );
    documentId = doc.id;
  } catch (err) {
    console.error("[agreements] filing an uploaded PDF failed", err);
    await prisma.agreementSignLink.updateMany({ where: { id: link.id, documentId: null }, data: { usedAt: null } });
    throw new AgreementError(`לא הצלחנו לשמור את הקובץ כרגע. אפשר לנסות שוב מאוחר יותר, ${messages.retry}.`);
  }

  await prisma.agreementSignLink.update({ where: { id: link.id }, data: { documentId } });

  // The code check is a hint for whoever verifies, not a gate: a scan has
  // no text layer at all, and the person should not be refused for that.
  let codeFound = false;
  try {
    const { extractDocumentText } = await import("@/lib/document-text");
    const extracted = await extractDocumentText(file.content, "application/pdf", file.fileName);
    codeFound = extracted.kind === "text" && textHasAgreementCode(extracted.text, code);
  } catch (err) {
    console.error("[agreements] text extraction of an uploaded PDF failed", err);
  }

  // A copy beside the in-app signed PDFs, best effort, exactly as those.
  const folderId = employeeAgreementsFolder();
  if (folderId) {
    const copy = await uploadFileToDriveFolder({
      name: agreementFileName(link.kind, link.version, link.user.name, now).replace(/\.pdf$/, "-uploaded.pdf"),
      mimeType: "application/pdf",
      content: file.content,
      folderId,
    });
    if (!copy.ok) console.error(`[agreements] copy of uploaded PDF to the agreements folder failed: ${copy.error ?? "no file id"}`);
  }

  await recordAudit({
    actorId: link.userId,
    action: "agreement.pdf_uploaded",
    entityType: "AgreementSignLink",
    entityId: link.id,
    after: { kind: link.kind, version: link.version, documentId, codeFound },
  });

  await onSignedPdfUploaded(link.userId, link.kind, documentId, codeFound);
  return { documentId, codeFound };
}

/// Signed PDFs uploaded through a link or a code and not yet dealt with:
/// not reviewed (recorded or dismissed), and, as a backstop for uploads
/// recorded before reviewedAt existed, no EMAIL_PDF signature carrying
/// that document's Drive file. Per kind, for get_employee_status.
export async function pendingPdfUploads(userId: string): Promise<Record<AgreementKind, { documentId: string; uploadedAt: Date }[]>> {
  const links = await prisma.agreementSignLink.findMany({
    where: { userId, purpose: "PDF_UPLOAD", documentId: { not: null }, reviewedAt: null },
    orderBy: { usedAt: "asc" },
    select: { kind: true, documentId: true, usedAt: true },
  });
  const out: Record<AgreementKind, { documentId: string; uploadedAt: Date }[]> = { CONFIDENTIALITY: [], DELETION_DECLARATION: [] };
  if (links.length === 0) return out;

  const docs = await prisma.clientDocument.findMany({
    where: { id: { in: links.map((l) => l.documentId!) }, deletedAt: null },
    select: { id: true, driveFileId: true, createdAt: true },
  });
  const recorded = await prisma.employeeAgreement.findMany({
    where: { userId, channel: "EMAIL_PDF", driveFileId: { in: docs.map((d) => d.driveFileId) } },
    select: { driveFileId: true },
  });
  const recordedFiles = new Set(recorded.map((r) => r.driveFileId));
  for (const link of links) {
    const doc = docs.find((d) => d.id === link.documentId);
    if (!doc || recordedFiles.has(doc.driveFileId)) continue;
    out[link.kind].push({ documentId: doc.id, uploadedAt: link.usedAt ?? doc.createdAt });
  }
  return out;
}

/// The upload behind a document, marked as dealt with. Only an upload of
/// this person, and only once: the first review stands.
async function markUploadReviewed(userId: string, documentId: string, reviewerId: string) {
  return prisma.agreementSignLink.updateMany({
    where: { userId, documentId, purpose: "PDF_UPLOAD", reviewedAt: null },
    data: { reviewedAt: new Date(), reviewedById: reviewerId },
  });
}

/// An uploaded PDF that will not be recorded: the wrong file, an old
/// version, no visible signature. Marked reviewed with the reason, and the
/// reason goes on the lifecycle task so a person can follow up (usually a
/// new code for the employee). The document stays in the file.
export async function dismissPdfUpload(actor: User, documentId: string, reason: string) {
  assertAgreementAdmin(actor.role);
  const why = reason.trim();
  if (!why) throw new AgreementError("Say why the upload is dismissed (`reason`).");

  const link = await prisma.agreementSignLink.findFirst({
    where: { documentId: documentId.trim(), purpose: "PDF_UPLOAD" },
    select: { id: true, userId: true, kind: true, reviewedAt: true },
  });
  if (!link) throw new AgreementError(`No uploaded agreement PDF with documentId "${documentId}". Use one from pendingPdfUploads.`);
  if (link.reviewedAt) throw new AgreementError("This upload was already reviewed. Nothing was changed.");

  const marked = await markUploadReviewed(link.userId, documentId.trim(), actor.id);
  if (marked.count !== 1) throw new AgreementError("This upload was already reviewed. Nothing was changed.");

  await recordAudit({
    actorId: actor.id,
    action: "agreement.pdf_upload_dismissed",
    entityType: "AgreementSignLink",
    entityId: link.id,
    after: { userId: link.userId, kind: link.kind, documentId, reason: why },
  });

  const { onPdfUploadDismissed } = await import("@/lib/app-domain/employee-lifecycle");
  await onPdfUploadDismissed(link.userId, link.kind, documentId, why);
  return { documentId, kind: link.kind, userId: link.userId };
}
