import { NextResponse } from "next/server";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { resolveStaffDocument } from "@/lib/app-domain/client-documents";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { attachmentDisposition } from "@/lib/http-headers";
import { downloadFileName } from "@/lib/mcp/file-ticket";

// 5.11.2026: a document's bytes, for a staff member on the task screen.
//
// The staff twin of /api/portal/documents/[documentId]. Same shape for the
// same reason: the browser holds a document id, never a Drive link, and
// whether the person signed in right now may have the file is decided on
// every request (resolveStaffDocument), so access that ended stops working
// the moment it ends.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await requireUser();
  const { documentId } = await params;

  let doc;
  try {
    doc = await resolveStaffDocument(user, documentId);
  } catch (err) {
    if (err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }

  const file = await downloadFileFromDrive(doc.driveFileId);
  if (!file.ok || !file.body) {
    console.error("[documents] Drive download failed", file.error);
    return NextResponse.json({ error: "המסמך לא זמין כרגע. נסו שוב בעוד רגע." }, { status: 502 });
  }

  return new NextResponse(file.body, {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": attachmentDisposition(downloadFileName(doc.title, doc.mimeType)),
      "Cache-Control": "private, no-store",
    },
  });
}
