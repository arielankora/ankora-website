import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageBack } from "@/components/app/BackSlot";
import { requireUser } from "@/lib/app-auth/session";
import { ForbiddenError } from "@/lib/app-auth/permissions";
import { getClient } from "@/lib/app-domain/clients";
import { handoverReadiness } from "@/lib/app-domain/handover-readiness";
import { READINESS_CHECKS, readinessLineText, type ReadinessText } from "@/lib/handover-readiness";

// Spec 3.9 and section 11: is the client ready to be run by Ankora? Every
// process planned to move to us, the five things that must be true before
// the person who does it today can leave, and what is missing. Read here;
// fixed on the client screen.

export const metadata = { robots: { index: false, follow: false } };

export default async function HandoverPage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const user = await requireUser();
  let client;
  let r;
  try {
    r = await handoverReadiness(user, clientId);
    client = await getClient(clientId);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
  if (!client) notFound();
  const pct = r.total ? Math.round((r.ready / r.total) * 100) : 0;
  const t = await getTranslations("clients.handover");
  // Keys built at runtime (a check by its key, a sentence lib/handover-
  // readiness names), so looked up through a loose signature;
  // tests/unit/process-screen-text.test.ts holds them to the dictionary.
  const tx = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const text = (x: ReadinessText) => ("raw" in x ? x.raw : tx(x.key, x.values));

  return (
    <article className="mx-auto max-w-4xl space-y-6">
      <div>
        <PageBack href={`/app/clients/${clientId}`} label={client.name} />
        <h1 className="mt-3 text-xl font-medium text-app-text-primary">{t("title", { name: client.name })}</h1>
        <p className="mt-1 text-sm text-app-text-secondary" data-testid="readiness-line">
          {text(readinessLineText(r))}
        </p>
        {r.total > 0 && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-app-border" aria-label={t("pctAria", { pct })}>
            <div className="h-full rounded-full bg-app-accent" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {r.total > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-app-border bg-app-surface-card">
          <table className="w-full text-sm" data-testid="readiness-table">
            <thead>
              <tr className="border-b border-app-border text-xs text-app-text-secondary">
                <th className="px-4 py-2.5 text-start font-medium">{t("process")}</th>
                {READINESS_CHECKS.map((c) => (
                  <th key={c.key} className="px-2 py-2.5 text-center font-medium">
                    {tx(`checks.${c.key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.processes.map((p) => (
                <tr key={p.id} className="border-b border-app-border align-top last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/app/clients/${clientId}/processes/${p.id}`} className="font-medium text-app-text-primary hover:underline">
                      {p.code} {p.title}
                    </Link>
                    {p.executor && <p className="mt-0.5 text-xs text-app-text-secondary">{t("executorToday", { name: p.executor })}</p>}
                    {p.missing.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {p.missingText.map((m, i) => (
                          <li key={i} className="text-xs text-app-warning">
                            {text(m)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  {READINESS_CHECKS.map((c) => (
                    <td key={c.key} className="px-2 py-3 text-center">
                      <span className={p.checks[c.key] ? "text-app-success" : "text-app-text-tertiary"} aria-label={p.checks[c.key] ? t("has") : t("missingAria")}>
                        {p.checks[c.key] ? "✓" : "·"}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r.systemsWithoutAccess.length > 0 && (
        <section className="rounded-2xl border border-app-border bg-app-surface-card p-5">
          <h2 className="text-sm font-medium text-app-text-primary">{t("noAccessTitle")}</h2>
          <ul className="mt-2 space-y-1">
            {r.systemsWithoutAccess.map((s) => (
              <li key={s.id} className="text-sm text-app-text-primary">
                {s.name}
                <span className="text-app-text-secondary">
                  {" "}
                  · {["HAS_ACCESS", "PENDING", "NO_ACCESS", "NOT_NEEDED"].includes(s.accessStatus) ? tx(`accessStatus.${s.accessStatus}`) : s.accessStatus}
                  {s.permission ? ` · ${t("needs", { permission: s.permission })}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.notPlanned.length > 0 && <p className="text-xs text-app-text-secondary">{t("notPlanned", { list: r.notPlanned.join(", ") })}</p>}
    </article>
  );
}
