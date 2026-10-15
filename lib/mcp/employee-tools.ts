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
import { AgreementError, recordPdfSignatureFromDocument } from "@/lib/app-domain/agreements";

// Employee lifecycle, for Claude (15.10.2026). The onboarding, weekly and
// offboarding agents work only through this server, so these are their
// eyes and their one hand:
//
//   get_employee_status     one person's agreements, passkeys, last
//                           sign-in and open onboarding/offboarding tasks
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
    "get_employee_status",
    {
      title: "Get an employee's onboarding or offboarding status",
      description: [
        "One Ankora staff member's lifecycle state, for running their onboarding or offboarding. Managers and admins only.",
        "Returns: role, status (INVITED, ACTIVE, SUSPENDED), lastLoginAt and daysSinceLogin (Israel calendar days, null if never), personalEmailOnFile (true or false only; the address is never shown), passkeyCount, and for each agreement kind (CONFIDENTIALITY, DELETION_DECLARATION) its currentVersion, whether the current version is signed in the app (appSignedCurrent) and as a returned PDF (emailPdfSignedCurrent), and the latest signature per channel with its version and signedAt.",
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
        "First file the PDF in the client file of \"Ankora פנימי\" with upload_document or start_document_upload, then pass its documentId here. A document on any other client is refused.",
        "Record ONLY after opening the PDF and checking two things yourself: the version printed on it equals the current version (get_employee_status gives it; a different version is refused), and a signature is visibly there. If either is unclear, do not record: add a comment on the task asking a person to check, and stop.",
        "signedAt is the date on the signature, YYYY-MM-DD or YYYY-MM-DD HH:MM in Israel time. signedName is the name as written on the PDF.",
        "Safe to repeat: if this PDF channel is already recorded for the same person, kind and version, the existing record comes back with alreadyRecorded: true and nothing new is written.",
        "When the confidentiality undertaking is now signed both in the app and as a PDF, the onboarding task's PDF step closes by itself; for a deletion declaration a note is added to the offboarding task.",
      ].join(" "),
      inputSchema: z.object({
        ...PERSON_ARGS,
        kind: z.enum(["CONFIDENTIALITY", "DELETION_DECLARATION"]),
        version: z.string().describe("The version printed on the PDF, e.g. \"סודיות-1.0\". Must equal the current version."),
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
