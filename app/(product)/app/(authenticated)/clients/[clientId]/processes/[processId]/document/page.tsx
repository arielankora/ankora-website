import Link from "next/link";
import { notFound } from "next/navigation";
import { PageBack } from "@/components/app/BackSlot";
import { requireUser } from "@/lib/app-auth/session";
import { canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { procedureDocument, type ProcedureDocumentView } from "@/lib/app-domain/procedure-documents";
import { dateText, type DocBlock, type ProcedureDoc } from "@/lib/procedure-document";
import { parsePageNumber } from "@/lib/url-numbers";
import { ApproveTranslation, TranslateWithClaude } from "./TranslationActions";

// A procedure as a document (23.10.2026): the read view of what the PDF
// and the Word file carry, with the version, the language, and the
// English translation's state. The process is edited on the client
// screen; this is where it is read the way a client or an auditor will.

export const metadata = { robots: { index: false, follow: false } };

const TRANSLATION_STATE = { NONE: "", DRAFT: "טיוטת תרגום", APPROVED: "תרגום מאושר" } as const;

function Blocks({ blocks }: { blocks: DocBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "heading")
          return b.level === 1 ? (
            <h2 key={i} className="mt-7 border-b border-app-border pb-1.5 text-[15px] font-medium text-app-text-primary">
              {b.text}
            </h2>
          ) : (
            <h3 key={i} className="mt-4 text-[13.5px] font-medium text-app-text-primary">
              {b.text}
            </h3>
          );
        if (b.kind === "para")
          return (
            <p key={i} className={`mt-2 text-sm leading-relaxed ${b.muted ? "text-app-text-tertiary" : "text-app-text-primary"}`}>
              {b.text}
            </p>
          );
        if (b.kind === "bullets")
          return (
            <ul key={i} className="mt-2 list-disc space-y-1 ps-5 text-sm leading-relaxed text-app-text-primary">
              {b.items.map((it, n) => (
                <li key={n}>{it}</li>
              ))}
            </ul>
          );
        const sum = (b.weights ?? []).reduce((a, x) => a + x, 0);
        return (
          <table key={i} className="mt-2 w-full table-fixed border-collapse text-[13px]">
            {sum > 0 && (
              <colgroup>
                {b.weights!.map((w, n) => (
                  <col key={n} style={{ width: `${(w / sum) * 100}%` }} />
                ))}
              </colgroup>
            )}
            {b.header.length > 0 && (
              <thead>
                <tr>
                  {b.header.map((h, n) => (
                    <th key={n} className="border border-app-border bg-app-surface-sunken px-2.5 py-1.5 text-start font-medium text-app-text-secondary">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {b.rows.map((r, n) => (
                <tr key={n}>
                  {r.map((c, k) => (
                    <td key={k} className={`border border-app-border px-2.5 py-1.5 align-top ${k === 0 && !b.header.length ? "text-app-text-secondary" : "text-app-text-primary"}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </>
  );
}

function Paper({ doc, fingerprint }: { doc: ProcedureDoc; fingerprint: string }) {
  const meta = doc.meta.filter(([, v]) => v);
  return (
    <div dir={doc.dir} lang={doc.lang} className="rounded-2xl border border-app-border bg-white px-6 py-8 shadow-sm sm:px-10" data-testid="procedure-paper">
      <p className="text-xs text-app-text-tertiary">{doc.clientName}</p>
      <h1 className="mt-1 text-2xl font-medium leading-snug text-app-text-primary">{doc.title}</h1>
      <p className="mt-1 font-jbmono text-xs text-app-text-tertiary">
        {doc.docId} · v{doc.version}
      </p>
      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2 rounded-xl border border-app-border p-4 text-[13px] sm:grid-cols-2">
        {meta.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-28 shrink-0 text-app-text-tertiary">{k}</dt>
            <dd className="text-app-text-primary">{v}</dd>
          </div>
        ))}
      </dl>
      {doc.liveNote && <p className="mt-3 text-xs text-app-text-tertiary">{doc.liveNote}</p>}
      <Blocks blocks={doc.blocks} />
      <p className="mt-6 break-all font-jbmono text-[11px] text-app-text-tertiary" dir="ltr">
        SHA-256 {fingerprint}
      </p>
    </div>
  );
}

function translationPrompt(view: ProcedureDocumentView, clientName: string, version: number): string {
  return [
    `תתרגם לאנגלית את הנוהל ${view.code} של ${clientName}, גרסה ${version}, למסמך שיוצא ללקוח או למבקר SOC 2.`,
    `1. קרא אותו עם get_procedure_for_translation (client: "${clientName}", process: "${view.code}"), ופעל לפי ה-guide שחוזר.`,
    "2. תראה לי את התרגום המלא לפני שמירה.",
    `3. אחרי אישור שלי, שמור עם save_procedure_translation (version: ${version}). אם חוזרים gaps, תשלים ותשמור שוב עד שאין.`,
    "4. בסוף תן לי את הקישור, ותזכיר שמנהל צריך לאשר את התרגום במסך.",
  ].join("\n");
}

export default async function ProcedureDocumentPage(props: {
  params: Promise<{ clientId: string; processId: string }>;
  searchParams: Promise<{ version?: string; lang?: string }>;
}) {
  const { clientId, processId } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser();
  const isManager = canManageClients(user.role);
  const lang = sp.lang === "en" ? "en" : "he";
  // A version number from the URL, through the one helper that cannot
  // hand Prisma a NaN (lib/url-numbers.ts).
  const version = sp.version ? parsePageNumber(sp.version, 100_000) : undefined;

  let view: ProcedureDocumentView;
  let heView: ProcedureDocumentView;
  try {
    heView = await procedureDocument(user, processId, { version, lang: "he" });
    // A manager reviews a draft translation here before approving it.
    view = lang === "en" && heView.translation && (heView.translation.state === "APPROVED" || isManager)
      ? await procedureDocument(user, processId, { version, lang: "en", draftTranslation: isManager })
      : heView;
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    if (err instanceof Error && /לא נמצא|אין עדיין נוהל|לא נמצאה/.test(err.message)) notFound();
    throw err;
  }
  if (view.clientId !== clientId) notFound();
  const doc = view.doc;
  const shownLang = doc.lang;
  const tr = heView.translation;
  const base = `/app/clients/${clientId}/processes/${processId}/document`;
  const q = (o: { version?: number; lang?: string }) => {
    const p = new URLSearchParams();
    const vv = o.version ?? version;
    if (vv) p.set("version", String(vv));
    if ((o.lang ?? shownLang) === "en") p.set("lang", "en");
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const exportHref = (format: "pdf" | "docx") => `/api/clients/${clientId}/processes/${processId}/document?format=${format}&lang=${shownLang}&version=${doc.version}`;
  const englishDraftShown = shownLang === "en" && tr?.state === "DRAFT";

  return (
    <article className="mx-auto max-w-4xl space-y-5">
      <div>
        <PageBack href={`/app/clients/${clientId}#item-${processId}`} label={doc.clientName} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-app-text-tertiary">גרסה:</span>
            {heView.versions.map((x) => (
              <Link
                key={x.version}
                href={`${base}${q({ version: x.version, lang: x.translation === "APPROVED" || isManager ? shownLang : "he" })}`}
                className={`rounded-full px-2.5 py-0.5 ${x.version === doc.version ? "bg-app-surface-nav text-cream" : "border border-app-border text-app-text-secondary hover:border-gold"}`}
                aria-current={x.version === doc.version ? "page" : undefined}
              >
                {x.version}
                {x.status === "APPROVED" ? " · בתוקף" : x.status === "DRAFT" ? " · טיוטה" : ""}
              </Link>
            ))}
            <span className="ms-3 text-app-text-tertiary">שפה:</span>
            <Link href={`${base}${q({ lang: "he" })}`} className={shownLang === "he" ? "font-medium text-app-text-primary" : "text-app-text-accent hover:underline"}>
              עברית
            </Link>
            {tr && (tr.state === "APPROVED" || isManager) ? (
              <Link href={`${base}${q({ lang: "en" })}`} className={shownLang === "en" ? "font-medium text-app-text-primary" : "text-app-text-accent hover:underline"}>
                English
              </Link>
            ) : (
              <span className="text-app-text-tertiary" title="אין עדיין תרגום מאושר">English</span>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm">
            {englishDraftShown ? (
              <span className="text-xs text-app-text-tertiary">ייצוא באנגלית אחרי אישור התרגום</span>
            ) : (
              <>
                <a href={exportHref("pdf")} className="text-app-text-accent hover:underline" data-testid="export-pdf">
                  הורדה כ-PDF
                </a>
                <a href={exportHref("docx")} className="text-app-text-accent hover:underline" data-testid="export-docx">
                  הורדה כ-Word
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {heView.doc.gaps.length > 0 && (
        <div className="rounded-xl bg-app-warning-soft px-4 py-3 text-xs text-app-text-primary" data-testid="procedure-gaps">
          <span className="font-medium">חסר במסמך: </span>
          {heView.doc.gaps.join(", ")}. בקבצים שמייצאים סעיף ריק לא מופיע.{" "}
          <Link href={`/app/clients/${clientId}#item-${processId}`} className="font-medium text-app-text-accent hover:underline">
            להשלים בתהליך
          </Link>
        </div>
      )}

      {heView.versions.find((x) => x.version === doc.version)?.status === "APPROVED" && (
        <div className="rounded-xl border border-app-border bg-white px-4 py-3 text-xs" data-testid="translation-panel">
          {!tr && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-app-text-secondary">אין עדיין גרסה באנגלית. קלוד מתרגם, ומנהל מאשר לפני שאפשר לייצא.</p>
              <TranslateWithClaude prompt={translationPrompt(view, doc.clientName, doc.version)} label="תרגום לאנגלית עם קלוד" />
            </div>
          )}
          {tr?.state === "DRAFT" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-app-text-primary">
                  <span className="font-medium">{TRANSLATION_STATE.DRAFT}</span>
                  {tr.by ? ` מאת ${tr.by}` : ""}
                  {tr.at ? `, ${dateText(tr.at, "he")}` : ""}. ממתין לאישור מנהל.
                </p>
                <div className="flex items-center gap-3">
                  {shownLang !== "en" && isManager && (
                    <Link href={`${base}${q({ lang: "en" })}`} className="font-medium text-app-text-accent hover:underline">
                      לקריאת התרגום
                    </Link>
                  )}
                  {isManager && <ApproveTranslation processId={processId} version={doc.version} clientId={clientId} disabled={tr.gaps.length > 0} />}
                </div>
              </div>
              {tr.gaps.length > 0 && <p className="text-app-warning">התרגום לא שלם: {tr.gaps.join(", ")}. צריך להשלים לפני אישור.</p>}
              <TranslateWithClaude prompt={translationPrompt(view, doc.clientName, doc.version)} label="תרגום מחדש עם קלוד" />
            </div>
          )}
          {tr?.state === "APPROVED" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-app-text-secondary">
                <span className="font-medium text-app-text-primary">{TRANSLATION_STATE.APPROVED}</span>
                {tr.approvedBy ? ` על ידי ${tr.approvedBy}` : ""}
                {tr.approvedAt ? `, ${dateText(tr.approvedAt, "he")}` : ""}.
              </p>
              <TranslateWithClaude prompt={translationPrompt(view, doc.clientName, doc.version)} label="תרגום מחדש עם קלוד" />
            </div>
          )}
        </div>
      )}

      <Paper doc={doc} fingerprint={view.fingerprint} />
    </article>
  );
}
