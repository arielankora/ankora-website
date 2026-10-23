import { NextResponse } from "next/server";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { clientProcedurePack, recordProcedureExport } from "@/lib/app-domain/procedure-documents";
import { renderProcedurePackPdf } from "@/lib/procedure-pdf";
import { renderProcedurePackDocx } from "@/lib/procedure-docx";
import { attachmentDisposition } from "@/lib/http-headers";

// Every procedure of a client in force, in one file, for an auditor
// (23.10.2026): `?format=pdf|docx&lang=he|en`. A cover with the contents,
// then each approved procedure from a new page.
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const user = await requireUser();
  const { clientId } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "docx" ? "docx" : "pdf";
  const lang = url.searchParams.get("lang") === "en" ? "en" : "he";
  let pack;
  try {
    pack = await clientProcedurePack(user, clientId, lang);
  } catch (err) {
    if (err instanceof ForbiddenError) return new NextResponse("Not found", { status: 404 });
    throw err;
  }
  if (pack.docs.length === 0) {
    const msg = lang === "en" ? "No approved procedure has an approved English translation yet." : "ללקוח הזה אין עדיין נוהל מאושר.";
    return new NextResponse(msg, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const generatedAt = new Date();
  const input = { ...pack, lang, generatedAt } as const;
  const file = format === "docx" ? await renderProcedurePackDocx(input) : await renderProcedurePackPdf(input);
  await recordProcedureExport(user, { clientId, lang, format, count: pack.docs.length });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(generatedAt);
  const name = `${pack.clientName} ${lang === "en" ? "Procedures" : "נהלים"} ${date}.${format}`;
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": format === "docx" ? DOCX_TYPE : "application/pdf",
      "Content-Disposition": attachmentDisposition(name),
      "Cache-Control": "no-store",
    },
  });
}
