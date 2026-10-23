import Link from "next/link";
import { notFound } from "next/navigation";
import { PageBack } from "@/components/app/BackSlot";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { prisma } from "@/lib/prisma";
import { listProcesses } from "@/lib/app-domain/processes";
import { dateText } from "@/lib/procedure-document";

// A client's procedures as documents (23.10.2026): every process with a
// procedure, which version is in force, whether it has an approved
// English version, and one file with all of them for an auditor.

export const metadata = { robots: { index: false, follow: false } };

export default async function ProceduresPage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const user = await requireUser();
  let processes;
  try {
    processes = await listProcesses(user, clientId);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  if (!client) notFound();
  const withProcedure = processes.filter((p) => p.latestVersion > 0);
  const inForce = withProcedure.filter((p) => p.current && (p.status === "ACTIVE" || p.status === "PAUSED"));
  const english = inForce.filter((p) => p.current?.translationEnApprovedAt).length;
  const pack = (format: "pdf" | "docx", lang: "he" | "en") => `/api/clients/${clientId}/procedures?format=${format}&lang=${lang}`;

  return (
    <article className="mx-auto max-w-4xl space-y-5">
      <div>
        <PageBack href={`/app/clients/${clientId}#processes`} label={client.name} />
        <h1 className="mt-3 text-xl font-medium text-app-text-primary">נהלים: {client.name}</h1>
        <p className="mt-1 text-xs leading-relaxed text-app-text-secondary">
          כל נוהל כמסמך, עם גרסה, בעלים, תאריך תוקף והיסטוריית אישורים. המסמך נבנה מהתהליך, ונעול לכל גרסה מאושרת. כל הורדה נרשמת ביומן.
        </p>
      </div>

      {inForce.length > 0 && (
        <div className="rounded-2xl border border-app-border bg-white p-5" data-testid="procedures-pack">
          <h2 className="text-sm font-medium text-app-text-primary">כל הנהלים בקובץ אחד</h2>
          <p className="mt-1 text-xs text-app-text-secondary">
            {inForce.length} נהלים בתוקף, עמוד שער עם תוכן, וכל נוהל מעמוד חדש. מתאים לשליחה למבקר.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span className="text-app-text-tertiary">עברית:</span>
            <a href={pack("pdf", "he")} className="text-app-text-accent hover:underline">PDF</a>
            <a href={pack("docx", "he")} className="text-app-text-accent hover:underline">Word</a>
            <span className="ms-4 text-app-text-tertiary">English ({english} מתוך {inForce.length}):</span>
            {english > 0 ? (
              <>
                <a href={pack("pdf", "en")} className="text-app-text-accent hover:underline">PDF</a>
                <a href={pack("docx", "en")} className="text-app-text-accent hover:underline">Word</a>
              </>
            ) : (
              <span className="text-xs text-app-text-tertiary">אין עדיין תרגום מאושר</span>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-app-border bg-white p-5">
        {withProcedure.length === 0 ? (
          <p className="text-sm text-app-text-tertiary">לאף תהליך של הלקוח אין עדיין נוהל.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-start text-xs text-app-text-tertiary">
                <th className="py-2 text-start font-normal">מזהה</th>
                <th className="py-2 text-start font-normal">נוהל</th>
                <th className="py-2 text-start font-normal">גרסה בתוקף</th>
                <th className="py-2 text-start font-normal">בתוקף מ-</th>
                <th className="py-2 text-start font-normal">אנגלית</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {withProcedure.map((p) => (
                <tr key={p.id} data-testid="procedure-row">
                  <td className="py-2.5 font-jbmono text-xs text-app-text-tertiary">{p.code}</td>
                  <td className="py-2.5">
                    <Link href={`/app/clients/${clientId}/processes/${p.id}/document`} className="text-app-text-primary hover:text-app-text-accent hover:underline">
                      {p.title}
                    </Link>
                    {p.draft && <span className="ms-2 text-[11px] text-app-warning">טיוטה {p.draft.version} ממתינה</span>}
                  </td>
                  <td className="py-2.5 text-app-text-secondary">{p.current ? p.current.version : "אין"}</td>
                  <td className="py-2.5 text-app-text-secondary">{p.current?.approvedAt ? dateText(p.current.approvedAt, "he") : ""}</td>
                  <td className="py-2.5 text-xs">
                    {p.current?.translationEnApprovedAt ? (
                      <span className="text-app-success">מאושר</span>
                    ) : p.current?.translationEn ? (
                      <span className="text-app-warning">ממתין לאישור</span>
                    ) : (
                      <span className="text-app-text-tertiary">אין</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </article>
  );
}
