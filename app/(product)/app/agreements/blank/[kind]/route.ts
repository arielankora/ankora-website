import { requireUserOrThrow, UnauthorizedError } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { attachmentDisposition } from "@/lib/http-headers";
import { blankAgreementPdf } from "@/lib/app-domain/agreements";
import { kindFromParam } from "@/lib/agreements";

// Employee agreements: the blank form of the current version, as a file,
// for a person sending it by hand ("הורדת טופס לחתימה" on a user's page).
// The MCP tool get_blank_agreement_pdf hands an agent the same file.
//
// Managers and admins only: the same gate as everything else that is
// about a colleague's agreements.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const user = await requireUserOrThrow();
    if (!can(user.role, "time_entry.edit_others")) return Response.json({ error: "Forbidden" }, { status: 403 });

    const kind = kindFromParam((await params).kind);
    if (!kind) return Response.json({ error: "Unknown agreement" }, { status: 404 });

    const { pdf, code, fileName } = await blankAgreementPdf(kind);
    await recordAudit({
      actorId: user.id,
      action: "agreement.blank_issued",
      entityType: "User",
      entityId: user.id,
      after: { kind, code, via: "app" },
    });
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": attachmentDisposition(fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[agreements] blank form failed", err);
    return Response.json({ error: "Could not produce the form" }, { status: 500 });
  }
}
