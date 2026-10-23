import { NextResponse } from "next/server";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { procedureDocument, recordProcedureExport } from "@/lib/app-domain/procedure-documents";
import { procedureFileName } from "@/lib/procedure-document";
import { renderProcedurePdf } from "@/lib/procedure-pdf";
import { renderProcedureDocx } from "@/lib/procedure-docx";
import { attachmentDisposition } from "@/lib/http-headers";
import { parsePageNumber } from "@/lib/url-numbers";

// One procedure as a document (23.10.2026): `?format=pdf|docx`,
// `&lang=he|en`, `&version=N` (default: the approved one). English only
// from an approved translation. Every download is recorded, because a
// procedure that left the product is something SOC 2 asks about.
// A person who cannot reach the client or the process gets a 404.
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string; processId: string }> }) {
  const user = await requireUser();
  const { clientId, processId } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "docx" ? "docx" : "pdf";
  const lang = url.searchParams.get("lang") === "en" ? "en" : "he";
  const raw = url.searchParams.get("version");
  const version = raw ? parsePageNumber(raw, 100_000) : undefined;
  let view;
  try {
    view = await procedureDocument(user, processId, { lang, version, omitEmpty: true });
  } catch (err) {
    if (err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    if (err instanceof Error) return new NextResponse(err.message, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    throw err;
  }
  if (view.clientId !== clientId) return new NextResponse("Not found", { status: 404 });
  const file = format === "docx" ? await renderProcedureDocx(view.doc, view.fingerprint) : await renderProcedurePdf(view.doc, view.fingerprint);
  await recordProcedureExport(user, { clientId, processId, version: view.doc.version, lang, format, fingerprint: view.fingerprint });
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": format === "docx" ? DOCX_TYPE : "application/pdf",
      "Content-Disposition": attachmentDisposition(procedureFileName(view.doc, format)),
      "Cache-Control": "no-store",
    },
  });
}
