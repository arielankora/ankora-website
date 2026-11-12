import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { SubprocessorRecipient, SubprocessorRecipients } from "@/lib/app-domain/subprocessor-recipients";

// P8 step 8 (3.11.2026): who is told about a new sub-processor, and how.
// Collapsed by default: it matters a few times a year, on the day a
// sub-processor is added, and the clients screen is for every other day.

function Group({
  title,
  hint,
  clients,
  tone,
}: {
  title: string;
  hint: string;
  clients: SubprocessorRecipient[];
  tone: "email" | "warn" | "site";
}) {
  const t = useTranslations("clients.subprocessors");
  const format = useFormatter();
  const toneClass = tone === "warn" ? "border-app-warning/35 bg-app-warning-soft" : "border-app-border bg-white";
  return (
    <section className={`rounded-xl border p-4 ${toneClass}`}>
      <h3 className="text-sm font-medium text-app-text-primary">
        {title} ({clients.length})
      </h3>
      <p className="mt-1 text-[11px] text-app-text-tertiary">{hint}</p>
      {clients.length === 0 ? (
        <p className="mt-3 text-xs text-app-text-secondary">{t("emptyGroup")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-app-border">
            {clients.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <Link href={`/app/clients/${c.id}`} className="inline-flex min-h-11 items-center text-sm text-app-text-accent hover:underline">
                  {c.name}
                  {c.status === "PAUSED" ? t("paused") : ""}
                </Link>
                {c.source ? (
                  <span className="text-[11px] text-app-text-tertiary">
                    {c.source}
                    {c.checkedAt ? t("checkedAt", { date: format.dateTime(c.checkedAt, { day: "numeric", month: "numeric", year: "numeric" }) }) : ""}
                  </span>
                ) : null}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

export function SubprocessorRecipientsPanel({ groups }: { groups: SubprocessorRecipients }) {
  const t = useTranslations("clients.subprocessors");
  return (
    <details className="rounded-2xl border border-app-border bg-white p-5">
      <summary className="cursor-pointer text-sm font-medium text-app-text-primary">
        {t("title")}
      </summary>
      <p className="mt-2 text-xs text-app-text-secondary">
        {t("intro")}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Group title={t("committed.title")} hint={t("committed.hint")} clients={groups.committed} tone="email" />
        <Group
          title={t("unchecked.title")}
          hint={t("unchecked.hint")}
          clients={groups.unchecked}
          tone="warn"
        />
        <Group title={t("notCommitted.title")} hint={t("notCommitted.hint")} clients={groups.notCommitted} tone="site" />
      </div>
    </details>
  );
}
