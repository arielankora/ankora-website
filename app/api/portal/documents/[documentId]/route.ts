import { NextResponse } from "next/server";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { resolvePortalDocument } from "@/lib/app-domain/client-file";
import { downloadFileFromDrive } from "@/lib/google-drive";
import { attachmentDisposition } from "@/lib/http-headers";

// Portal phase 3: the only way a document reaches a client.
//
// Section 14's third rule, as a route. The browser never holds a link to
// the file itself - it holds a document id, which is a request and not an
// authorisation. resolvePortalDocument decides whether the person signed
// in right now may have that document, from their own memberships, and
// only then does this fetch the bytes with the service account's
// credentials and hand them on.
//
// The difference matters most for the case nobody tests: a client whose
// access ended. A Drive link they saved keeps working forever. This stops
// working the moment their membership does.
export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await requireUser();
  const { documentId } = await params;

  let doc;
  try {
    doc = await resolvePortalDocument(user, documentId);
  } catch (err) {
    if (err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }

  const file = await downloadFileFromDrive(doc.driveFileId);
  if (!file.ok || !file.body) {
    return NextResponse.json({ error: "המסמך לא זמין כרגע. אפשר לבקש אותו מאיתנו בוואטסאפ." }, { status: 502 });
  }

  return new NextResponse(file.body, {
    headers: {
      "Content-Type": doc.mimeType,
      // RFC 6266 via the shared helper. This route already did the right
      // thing by hand; the helper adds the ASCII fallback and makes the
      // rule enforceable (qa/checks/static.mjs).
      "Content-Disposition": attachmentDisposition(doc.title),
      "Cache-Control": "private, no-store",
    },
  });
}
