import { NextResponse } from "next/server";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { toMarkdown } from "@/lib/client-file-document";
import { renderClientFilePdf } from "@/lib/client-file-pdf";
import { attachmentDisposition } from "@/lib/http-headers";

// Org brain, phase 2: the client file as a Markdown download (spec 6.1),
// or as a PDF with `?format=pdf`.
// The same document the read view draws, through the same access rules:
// a person who cannot reach the client gets a 404, not a hint that the
// client exists.
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const user = await requireUser();
  const { clientId } = await params;
  let doc;
  try {
    doc = await buildClientFile(user, clientId, { audience: "staff" });
  } catch (err) {
    if (err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(doc.generatedAt);
  if (new URL(request.url).searchParams.get("format") === "pdf") {
    const pdf = await renderClientFilePdf(doc);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": attachmentDisposition(`תיק לקוח ${doc.clientName} ${date}.pdf`),
        "Cache-Control": "no-store",
      },
    });
  }
  return new NextResponse(toMarkdown(doc), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": attachmentDisposition(`תיק לקוח ${doc.clientName} ${date}.md`),
      "Cache-Control": "no-store",
    },
  });
}
