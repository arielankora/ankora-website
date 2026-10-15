import "server-only";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/app-auth/audit";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { sendEmail } from "@/lib/email";
import { appBaseUrl, renderDeletionDeclarationEmail } from "@/lib/email-templates";
import { employeeAgreementsFolder, uploadFileToDriveFolder } from "@/lib/google-drive";
import { renderAgreementPdf } from "@/lib/agreement-pdf";
import {
  CURRENT_AGREEMENTS,
  SIGN_LINK_TTL_MS,
  agreementFileName,
  contentHash,
  currentAgreement,
  findAgreement,
  hashSignToken,
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
  if (signLinkState(link) !== "valid" || !link || link.user.deletedAt) return null;
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
  if (!link || signLinkState(link) !== "valid" || link.user.deletedAt) throw invalid;

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
  // Employee lifecycle: a note on the open offboarding task. Never throws.
  if (row.kind === "DELETION_DECLARATION") {
    const { onDeletionDeclarationSigned } = await import("@/lib/app-domain/employee-lifecycle");
    await onDeletionDeclarationSigned(link.userId, row.id);
  }
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
      where: { userId: target.id, kind: "DELETION_DECLARATION", usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.agreementSignLink.create({
      data: {
        userId: target.id,
        kind: "DELETION_DECLARATION",
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

export interface AgreementStatus {
  kind: AgreementKind;
  currentVersion: string;
  app: boolean;
  emailPdf: boolean;
}

/// For each kind: the current version, and whether it is signed in each
/// channel. Older versions do not count; a new version asks again.
export async function getAgreementStatus(userId: string): Promise<AgreementStatus[]> {
  const rows = await prisma.employeeAgreement.findMany({
    where: { userId },
    select: { kind: true, version: true, channel: true },
  });
  const signed = (kind: AgreementKind, channel: AgreementChannel) =>
    rows.some((r) => r.kind === kind && r.version === CURRENT_AGREEMENTS[kind] && r.channel === channel);
  return KINDS.map((kind) => ({
    kind,
    currentVersion: CURRENT_AGREEMENTS[kind],
    app: signed(kind, "APP"),
    emailPdf: signed(kind, "EMAIL_PDF"),
  }));
}

export async function listAgreementsForUser(userId: string) {
  return prisma.employeeAgreement.findMany({
    where: { userId },
    orderBy: { signedAt: "desc" },
    select: { id: true, kind: true, version: true, channel: true, signedAt: true, driveFileId: true },
  });
}
