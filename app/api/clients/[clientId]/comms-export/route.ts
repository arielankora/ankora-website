import { NextResponse } from "next/server";
import { requireUser } from "@/lib/app-auth/session";
import { canManageClients } from "@/lib/app-auth/permissions";
import { recordAudit } from "@/lib/app-auth/audit";
import { attachmentDisposition } from "@/lib/http-headers";
import { gatherCommsExport } from "@/lib/comms/export";
import { renderCommsExport } from "@/lib/comms/export-render";

// The communications export of one client (2.11.2026): every WhatsApp
// conversation and recorded call kept for its people, as one Markdown
// file, to hand to the client in the 30 days after the engagement ends
// (then the nightly run deletes it all). Managers only: the file holds
// conversations of every Ankora number that spoke with them. The audit
// row records who exported which client, and how much, not the content.
export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const user = await requireUser();
  if (!canManageClients(user.role)) return new NextResponse("Not found", { status: 404 });
  const { clientId } = await params;
  if (clientId.length > 100) return new NextResponse("Not found", { status: 404 });

  const data = await gatherCommsExport(user, clientId);
  if (!data) return new NextResponse("Not found", { status: 404 });

  await recordAudit({
    actorId: user.id,
    action: "comms_export.downloaded",
    entityType: "Client",
    entityId: clientId,
    after: { conversations: data.conversations.length, calls: data.calls.length },
  });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(data.generatedAt);
  return new NextResponse(renderCommsExport(data), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": attachmentDisposition(`שיחות והקלטות ${data.clientName} ${date}.md`),
      "Cache-Control": "no-store",
    },
  });
}
