import "server-only";
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { AgreementKind, User } from "@prisma/client";
import { toolFailure, toolJson, toolText } from "@/lib/mcp/errors";
import { lookupStaffMember } from "@/lib/mcp/lookup";
import { actorOf } from "@/lib/mcp/task-extra-tools";
import { TOOL_ANNOTATIONS } from "@/lib/mcp/annotations";
import { assertCan } from "@/lib/app-auth/permissions";
import { localDateTimeToUtc } from "@/lib/timezone";
import { EmployeeNotFoundError, getEmployeeStatus } from "@/lib/app-domain/employee-status";
import {
  AgreementError,
  dismissPdfUpload,
  issueAgreementUploadCode,
  issueBlankAgreementTicket,
  recordPdfSignatureFromDocument,
} from "@/lib/app-domain/agreements";

// Employee lifecycle, for Claude (15.10.2026). The onboarding, weekly and
// offboarding agents work only through this server, so these are their
// eyes and their one hand:
//
//   get_employee_status     one person's agreements, passkeys, last
//                           sign-in and open onboarding/offboarding tasks
//   get_blank_agreement_pdf the blank form to email for a PDF signature
//   issue_agreement_upload_code
//                           a short code the employee types on /upload to
//                           send back the signed PDF (an agent cannot take
//                           an attachment out of an email reply, and Gmail
//                           rewrites links in a draft)
//   dismiss_pdf_upload      an uploaded PDF that will not be recorded
//   record_pdf_signature    a signed PDF came back and was filed: record it
//
// Both are for managers and admins only, behind the same permission as the
// team tools (`time_entry.edit_others`), asserted before anything is read.
//
// `userId` is accepted beside `person`, against this server's rule of
// never taking a raw id, because these agents run on a schedule for days
// and are given the id once, in the task's own prompt; matching a name
// again every morning is where a second "נועה" would slip in. An id that
// is not a staff member is refused, so an invented one finds nothing.

const PERSON_ARGS = {
  person: z.string().optional().describe("The staff member's name or work email, as the user said it."),
  userId: z.string().optional().describe("The staff member's exact id (from list_team_members or the task's prompt). Preferred when known."),
};

async function resolvePerson(actor: User, args: { person?: string; userId?: string }): Promise<{ ok: true; id: string } | { ok: false; text: string }> {
  // The gate first, so a refused caller learns nothing, not even "no such person".
  assertCan(actor.role, "time_entry.edit_others");
  if (args.userId?.trim()) return { ok: true, id: args.userId.trim() };
  if (args.person?.trim()) {
    const found = await lookupStaffMember(actor, args.person);
    return found.ok ? { ok: true, id: found.value.id } : { ok: false, text: found.message };
  }
  return { ok: false, text: "Say who: pass `person` (name or email) or `userId`." };
}

/// "2026-10-15", "2026-10-15 14:30", "2026-10-15T14:30" are Israel time;
/// anything carrying its own offset or Z is taken as given. Null when it
/// is none of these.
export function parseIsraelDateTime(value: string): Date | null {
  const v = value.trim();
  const local = v.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?$/);
  if (local) {
    const d = localDateTimeToUtc(local[1], local[2] ?? "00:00", "Asia/Jerusalem");
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function registerEmployeeTools(server: McpServer): void {
  server.registerTool(
    "get_blank_agreement_pdf",
    {
      title: "Get a blank agreement form to send for signature",
      description: [
        "A download address for the blank form of the current version of an agreement: the confidentiality undertaking (CONFIDENTIALITY) for a new employee, or the deletion declaration (DELETION_DECLARATION) for someone leaving. Managers and admins only.",
        "Fetch it with `curl -o <fileName> <downloadUrl>` within 15 minutes and attach that file to the email to the employee. Never forward the address itself; it is a credential.",
        "Every page carries a code in its footer (returned as `code`, e.g. ANKORA-CONF-1.0). That code is how a returned, signed PDF is checked before record_pdf_signature.",
      ].join(" "),
      inputSchema: z.object({
        kind: z.enum(["CONFIDENTIALITY", "DELETION_DECLARATION"]),
      }),
      annotations: TOOL_ANNOTATIONS.get_blank_agreement_pdf,
    },
    async (args: { kind: AgreementKind }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        assertCan(actor.role, "time_entry.edit_others");
        const t = await issueBlankAgreementTicket(actor, args.kind);
        return toolJson({
          kind: args.kind,
          version: t.version,
          code: t.code,
          fileName: t.fileName,
          downloadUrl: t.url,
          expiresAt: t.expiresAt.toISOString(),
        });
      } catch (err) {
        if (err instanceof AgreementError) return toolText(err.message);
        console.error("[mcp] get_blank_agreement_pdf failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "issue_agreement_upload_code",
    {
      title: "Issue an upload code for a signed agreement PDF",
      description: [
        "Creates a short personal code (like K7QM-3XRB) with which a staff member uploads the signed PDF of an agreement (CONFIDENTIALITY or DELETION_DECLARATION) on Ankora's fixed upload page. Valid 7 days; a new code replaces any earlier unused one. Managers and admins only.",
        "Put the page address (uploadPageUrl) and the code as plain text in the email to that employee only, next to the blank form from get_blank_agreement_pdf, with the line 'כדי להעלות, נכנסים לכתובת הבאה ומקלידים את הקוד:' and the address alone on the next line, as https://www.ankora.co.il/upload. Never attach a Hebrew letter to the address (for example ל-www...): mail clients turn the whole word into a broken link. The address carries no secret, so it does not matter if the mail client wraps it. The code must not be a link, and must never go anywhere else: not in a task, a comment, a chat or any other message. It is a credential.",
        "Ask the employee to upload the signed PDF there rather than replying with it. Once uploaded, the document appears in get_employee_status under pendingPdfUploads; check it, then record_pdf_signature or dismiss_pdf_upload.",
      ].join(" "),
      inputSchema: z.object({
        ...PERSON_ARGS,
        kind: z.enum(["CONFIDENTIALITY", "DELETION_DECLARATION"]),
      }),
      annotations: TOOL_ANNOTATIONS.issue_agreement_upload_code,
    },
    async (args: { person?: string; userId?: string; kind: AgreementKind }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const who = await resolvePerson(actor, args);
        if (!who.ok) return toolText(who.text);
        const issued = await issueAgreementUploadCode(actor, who.id, args.kind);
        return toolJson({
          kind: args.kind,
          uploadCode: issued.uploadCode,
          uploadPageUrl: issued.uploadPageUrl,
          expiresAt: issued.expiresAt.toISOString(),
          version: issued.version,
          agreementCode: issued.agreementCode,
        });
      } catch (err) {
        if (err instanceof AgreementError) return toolText(err.message);
        console.error("[mcp] issue_agreement_upload_code failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "dismiss_pdf_upload",
    {
      title: "Dismiss an uploaded agreement PDF",
      description: [
        "Marks a signed PDF from pendingPdfUploads as reviewed without recording it, when it cannot be recorded: the footer code is missing or wrong, there is no visible signature, it is the wrong file. Managers and admins only.",
        "Give the reason in a sentence; it goes on the onboarding or offboarding task as a comment so a person can follow up, usually with a new upload code. The document stays in the file. Use it only after looking at the document; when you are unsure, leave it pending and comment on the task instead.",
      ].join(" "),
      inputSchema: z.object({
        documentId: z.string().describe("The documentId from pendingPdfUploads."),
        reason: z.string().describe("Why it is not recorded, in a sentence."),
      }),
      annotations: TOOL_ANNOTATIONS.dismiss_pdf_upload,
    },
    async (args: { documentId: string; reason: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        assertCan(actor.role, "time_entry.edit_others");
        const out = await dismissPdfUpload(actor, args.documentId, args.reason);
        return toolJson({ dismissed: true, documentId: out.documentId, kind: out.kind });
      } catch (err) {
        if (err instanceof AgreementError) return toolText(err.message);
        console.error("[mcp] dismiss_pdf_upload failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "get_employee_status",
    {
      title: "Get an employee's onboarding or offboarding status",
      description: [
        "One Ankora staff member's lifecycle state, for running their onboarding or offboarding. Managers and admins only.",
        "Returns: role, status (INVITED, ACTIVE, SUSPENDED), lastSeenAt and daysSinceSeen (last use of Ankora in the app or through Claude, Israel calendar days, null if never: the signal for whether someone has stopped working), lastLoginAt and daysSinceLogin (last sign-in only, kept for compatibility), personalEmailOnFile (true or false only; the address is never shown), passkeyCount, and for each agreement kind (CONFIDENTIALITY, DELETION_DECLARATION) its currentVersion, whether the current version is signed in the app (appSignedCurrent) and as a returned PDF (emailPdfSignedCurrent), and the latest signature per channel with its version and signedAt, and pendingPdfUploads: signed PDFs the employee uploaded (with an upload code) that nobody has dealt with yet ({documentId, uploadedAt}); check each with read_document, then record_pdf_signature or dismiss_pdf_upload.",
        "Also the open onboarding/offboarding tasks about this person (taskId, kind, url, due date, stepsDone of stepsTotal, and the titles of open steps), and adminPageUrl, the person's page in Ankora.",
        "Identify the person by `userId` when you have it, else by `person`.",
      ].join(" "),
      inputSchema: z.object(PERSON_ARGS),
      annotations: TOOL_ANNOTATIONS.get_employee_status,
    },
    async (args: { person?: string; userId?: string }, ctx: ServerContext) => {
      try {
        const actor = actorOf(ctx);
        const who = await resolvePerson(actor, args);
        if (!who.ok) return toolText(who.text);
        return toolJson(await getEmployeeStatus(actor, who.id));
      } catch (err) {
        if (err instanceof EmployeeNotFoundError) return toolText("No Ankora staff member with that id. Call list_team_members with includeInactive: true to find them.");
        console.error("[mcp] get_employee_status failed", err);
        return toolFailure(err);
      }
    }
  );

  server.registerTool(
    "record_pdf_signature",
    {
      title: "Record a signed agreement PDF",
      description: [
        "Records that a staff member returned a signed agreement as a PDF: the confidentiality undertaking (CONFIDENTIALITY) or the deletion declaration (DELETION_DECLARATION). Managers and admins only.",
        "The documentId is usually one from pendingPdfUploads (get_employee_status): the employee uploaded it with their upload code and it is already filed on \"Ankora פנימי\". Otherwise file it there first with upload_document or start_document_upload. A document on any other client is refused.",
        "Record ONLY after checking two things yourself. First, the code in the footer of every page: read the document's text with read_document and find the Latin code, e.g. ANKORA-CONF-1.0 or ANKORA-DEL-1.0, which must match the current version (get_employee_status gives the version; get_blank_agreement_pdf gives the code). Use the code, not the Hebrew version line, because Hebrew comes out of a PDF's text reversed. Second, that a signature is visibly there (open the file itself when the text cannot show it). If either is unclear, do not record: add a comment on the task asking a person to check, and stop.",
        "signedAt is the date on the signature, YYYY-MM-DD or YYYY-MM-DD HH:MM in Israel time. signedName is the name as written on the PDF.",
        "Safe to repeat: if this PDF channel is already recorded for the same person, kind and version, the existing record comes back with alreadyRecorded: true and nothing new is written. Either way the uploaded document leaves pendingPdfUploads.",
        "When the confidentiality undertaking is now signed both in the app and as a PDF, the onboarding task's PDF step closes by itself; for a deletion declaration a note is added to the offboarding task.",
      ].join(" "),
      inputSchema: z.object({
        ...PERSON_ARGS,
        kind: z.enum(["CONFIDENTIALITY", "DELETION_DECLARATION"]),
        version: z.string().describe("The code in the PDF's footer, e.g. \"ANKORA-CONF-1.0\", or the Hebrew version, e.g. \"סודיות-1.0\". Must be the current version."),
        signedName: z.string().describe("The signer's name as written on the PDF."),
        signedAt: z.string().describe("Date of signature: YYYY-MM-DD or YYYY-MM-DD HH:MM, Israel time."),
        documentId: z.string().describe("The documentId of the signed PDF, already filed on the client \"Ankora פנימי\"."),
      }),
      annotations: TOOL_ANNOTATIONS.record_pdf_signature,
    },
    async (
      args: { person?: string; userId?: string; kind: AgreementKind; version: string; signedName: string; signedAt: string; documentId: string },
      ctx: ServerContext
    ) => {
      try {
        const actor = actorOf(ctx);
        const who = await resolvePerson(actor, args);
        if (!who.ok) return toolText(who.text);
        const signedAt = parseIsraelDateTime(args.signedAt);
        if (!signedAt) return toolText("signedAt must be YYYY-MM-DD or YYYY-MM-DD HH:MM (Israel time). Nothing was recorded.");

        const { row, alreadyRecorded } = await recordPdfSignatureFromDocument(actor, {
          userId: who.id,
          kind: args.kind,
          version: args.version,
          signedName: args.signedName,
          signedAt,
          documentId: args.documentId,
        });
        return toolJson({
          alreadyRecorded,
          signature: {
            id: row.id,
            kind: row.kind,
            version: row.version,
            channel: row.channel,
            signedName: row.signedName,
            signedAt: row.signedAt.toISOString(),
            filed: !!row.driveFileId,
          },
        });
      } catch (err) {
        if (err instanceof AgreementError) return toolText(`${err.message} Nothing was recorded.`);
        console.error("[mcp] record_pdf_signature failed", err);
        return toolFailure(err);
      }
    }
  );
}
