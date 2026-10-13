import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { buildClientFile } from "@/lib/app-domain/client-file-view";
import { HOW_TO_READ, type DocItem } from "@/lib/client-file-document";
import { KNOWLEDGE_STATUS_LABELS } from "@/lib/knowledge";

// Org brain, phase 2: the client file to read, top to bottom, in the order
// of Hadas's file (claude/org-brain-spec-2026-10-12.md, 6.1). The client
// screen is where the file is edited; this is where it is read, by anyone
// assigned to the client, and downloaded as Markdown.

export const metadata = { robots: { index: false, follow: false } };

function Item({ item }: { item: DocItem }) {
  const details = (item.details ?? []).filter((d): d is string => !!d && !!d.trim());
  const weak = item.status === "UNCERTAIN" || item.status === "MISSING";
  return (
    <li className="py-1.5 text-sm leading-relaxed text-appNavy">
      {item.text}
      {details.length > 0 && <span className="text-appNavy/60"> ({details.join(" · ")})</span>}
      {weak && (
        <span className={`ms-1.5 text-xs font-medium ${item.status === "MISSING" ? "text-error" : "text-warning"}`}>
          {KNOWLEDGE_STATUS_LABELS[item.status!]}
          {item.toResolve ? `: ${item.toResolve}` : ""}
        </span>
      )}
      {item.doNotDisclose && <span className="ms-1.5 text-xs font-medium text-red-700">לא לספר: {item.doNotDisclose}</span>}
      {item.sources && item.sources.length > 0 && (
        <span className="ms-1.5 text-[11px] text-appNavy/45" dir="ltr">
          [{item.sources.join(", ")}]
        </span>
      )}
    </li>
  );
}

export default async function ClientFilePage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const user = await requireUser();
  let doc;
  try {
    doc = await buildClientFile(user, clientId, { audience: "staff" });
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/app/clients/${clientId}`} className="text-xs text-appNavy/50 hover:text-gold-dim">
          ← חזרה ללקוח
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-medium text-appNavy">תיק לקוח: {doc.clientName}</h1>
          <a href={`/api/clients/${clientId}/client-file`} className="text-sm text-gold-dim hover:underline">
            הורדה כ-Markdown
          </a>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-appNavy/60">{HOW_TO_READ}</p>
      </div>

      {doc.sections.map((s) => {
        const ungrouped = s.items.filter((i) => !i.group);
        const groups = [...new Set(s.items.filter((i) => i.group).map((i) => i.group!))];
        return (
          <section key={`${s.number}-${s.title}`} className="rounded-2xl border border-lineDark bg-white p-6">
            <h2 className="text-sm font-medium text-appNavy">
              {s.number && <span className="me-2 font-mono text-gold-dim">{s.number}</span>}
              {s.title}
            </h2>
            {s.items.length === 0 ? (
              <p className="mt-2 text-sm text-appNavy/45">{s.empty}</p>
            ) : (
              <>
                {ungrouped.length > 0 && (
                  <ul className="mt-2 list-disc ps-5">
                    {ungrouped.map((i, n) => (
                      <Item key={n} item={i} />
                    ))}
                  </ul>
                )}
                {groups.map((g) => (
                  <div key={g} className="mt-3">
                    <h3 className="text-xs font-medium text-appNavy/60">{g}</h3>
                    <ul className="mt-1 list-disc ps-5">
                      {s.items
                        .filter((i) => i.group === g)
                        .map((i, n) => (
                          <Item key={n} item={i} />
                        ))}
                    </ul>
                  </div>
                ))}
              </>
            )}
          </section>
        );
      })}

      <section className="rounded-2xl border border-lineDark bg-white p-6">
        <h2 className="text-sm font-medium text-appNavy">מקרא מקורות</h2>
        {doc.legend.length === 0 ? (
          <p className="mt-2 text-sm text-appNavy/45">אין עדיין מקורות במרשם.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {doc.legend.map((l) => (
              <li key={l.code} className="text-sm text-appNavy">
                <span className="me-2 font-mono text-gold-dim" dir="ltr">
                  {l.code}
                </span>
                {l.title}
                {l.details && <span className="text-appNavy/60"> ({l.details})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
