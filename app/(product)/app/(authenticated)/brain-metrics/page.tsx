import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { canManageClients } from "@/lib/app-auth/permissions";
import { StatusBadge } from "@/components/app/StatusBadge";
import { brainMetrics } from "@/lib/app-domain/brain-metrics";
import { getTranslations } from "next-intl/server";
import { BATCH_WINDOW_DAYS, COVERAGE_WINDOW_DAYS, RUNS_WINDOW_DAYS, UNCERTAIN_STALE_DAYS, type Measure } from "@/lib/brain-metrics";

// Spec section 11: how we know the org brain works. One line of measures
// for all clients, each beside its first target, and the same per client.
// For managers: the screen that says whether the file is getting better.

export const metadata = { robots: { index: false, follow: false } };

const TONE: Record<Measure["state"], "green" | "amber" | "gray"> = { ok: "green", off: "amber", none: "gray" };

// ADR 0006: the measure's label, about, target and display in lib/
// brain-metrics.ts stay Hebrew, because the weekly email
// (lib/brain-metrics-email.ts) writes them out as they are. The screen
// words each measure from `brainMetrics.measures.<key>` instead, and
// builds the display from the value, so it reads in the reader's
// language. `days` fills the measures whose sentence names a window.
type MeasureKey = "running" | "completeness" | "coverage" | "staleUncertain" | "noAccess" | "withAnkora" | "batchMinutes" | "oldestProposal" | "onTime";
const UNIT: Record<MeasureKey, "percent" | "count" | "minutes" | "days"> = {
  running: "percent",
  completeness: "percent",
  coverage: "percent",
  staleUncertain: "count",
  noAccess: "count",
  withAnkora: "percent",
  batchMinutes: "minutes",
  oldestProposal: "days",
  onTime: "percent",
};
const WINDOW_DAYS: Partial<Record<MeasureKey, number>> = {
  coverage: COVERAGE_WINDOW_DAYS,
  staleUncertain: UNCERTAIN_STALE_DAYS,
  batchMinutes: BATCH_WINDOW_DAYS,
  onTime: RUNS_WINDOW_DAYS,
};

export default async function BrainMetricsPage() {
  const user = await requireUser();
  if (!canManageClients(user.role)) notFound();
  const report = await brainMetrics(user);
  const t = await getTranslations("brainMetrics");
  const days = (m: Measure) => ({ days: String(WINDOW_DAYS[m.key as MeasureKey] ?? "") });
  const label = (m: Measure) => t(`measures.${m.key as MeasureKey}.label`, days(m));
  const about = (m: Measure) => t(`measures.${m.key as MeasureKey}.about`, days(m));
  const target = (m: Measure) => t(`measures.${m.key as MeasureKey}.target`);
  const display = (m: Measure) => {
    if (m.value === null) return t("display.none");
    switch (UNIT[m.key as MeasureKey]) {
      case "percent":
        return t("display.percent", { value: String(m.value) });
      case "minutes":
        return t("display.minutes", { value: String(m.value) });
      case "days":
        return t("display.days", { value: m.value });
      default:
        return String(m.value);
    }
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
        <p className="mt-1 text-sm text-app-text-secondary">
          {t("intro")}
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="metrics-all">
        {report.all.map((m) => (
          <div key={m.key} className="rounded-2xl border border-app-border bg-white p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-app-text-primary">{label(m)}</p>
              <StatusBadge label={t(`states.${m.state}`)} tone={TONE[m.state]} />
            </div>
            <p className="mt-2 font-jbmono text-2xl text-app-text-primary">{display(m)}</p>
            <p className="mt-1 text-xs text-app-text-secondary">{t("target", { target: target(m) })}</p>
            <p className="mt-2 text-xs text-app-text-secondary">{about(m)}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-app-border bg-white p-5">
        <h2 className="text-sm font-medium text-app-text-primary">{t("byClient")}</h2>
        {report.clients.length === 0 ? (
          <p className="mt-3 text-sm text-app-text-tertiary">{t("noClients")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" data-testid="metrics-clients">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-secondary">
                  <th className="py-2 pe-3 text-start font-medium">{t("clientColumn")}</th>
                  {report.all.map((m) => (
                    <th key={m.key} className="px-2 py-2 text-start font-medium" title={about(m)}>
                      {label(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {report.clients.map((c) => (
                  <tr key={c.clientId}>
                    <td className="py-2 pe-3">
                      <Link dir="auto" href={`/app/clients/${c.clientId}?tab=file`} className="text-app-text-primary hover:text-app-text-accent">
                        {c.clientName}
                      </Link>
                    </td>
                    {c.measures.map((m) => (
                      <td key={m.key} className={`px-2 py-2 font-jbmono text-[13px] ${m.state === "off" ? "text-app-warning" : m.state === "none" ? "text-app-text-tertiary" : "text-app-text-primary"}`}>
                        {m.state === "none" ? "·" : display(m)}
                        {m.state === "off" && <span className="sr-only"> {t("offTarget")}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-app-text-tertiary">{t("legend")}</p>
      </section>
    </div>
  );
}
