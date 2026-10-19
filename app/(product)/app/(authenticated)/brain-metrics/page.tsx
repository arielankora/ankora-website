import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/app-auth/session";
import { canManageClients } from "@/lib/app-auth/permissions";
import { StatusBadge } from "@/components/app/StatusBadge";
import { brainMetrics } from "@/lib/app-domain/brain-metrics";
import type { Measure } from "@/lib/brain-metrics";

// Spec section 11: how we know the org brain works. One line of measures
// for all clients, each beside its first target, and the same per client.
// For managers: the screen that says whether the file is getting better.

export const metadata = { robots: { index: false, follow: false } };

const STATE: Record<Measure["state"], { label: string; tone: "green" | "amber" | "gray" }> = {
  ok: { label: "עומד ביעד", tone: "green" },
  off: { label: "עוד לא", tone: "amber" },
  none: { label: "אין נתונים", tone: "gray" },
};

export default async function BrainMetricsPage() {
  const user = await requireUser();
  if (!canManageClients(user.role)) notFound();
  const report = await brainMetrics(user);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">מדדי התיק</h1>
        <p className="mt-1 text-sm text-app-text-secondary">
          איך נדע שהתיק עובד: כל מדד ליד היעד הראשון שלו, לכל הלקוחות יחד ולכל לקוח. הכול נקרא ממה שכבר קורה במערכת, בלי הזנה.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="metrics-all">
        {report.all.map((m) => (
          <div key={m.key} className="rounded-2xl border border-app-border bg-white p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-app-text-primary">{m.label}</p>
              <StatusBadge label={STATE[m.state].label} tone={STATE[m.state].tone} />
            </div>
            <p className="mt-2 font-jbmono text-2xl text-app-text-primary">{m.display}</p>
            <p className="mt-1 text-xs text-app-text-secondary">יעד: {m.target}</p>
            <p className="mt-2 text-xs text-app-text-secondary">{m.about}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-app-border bg-white p-5">
        <h2 className="text-sm font-medium text-app-text-primary">לפי לקוח</h2>
        {report.clients.length === 0 ? (
          <p className="mt-3 text-sm text-app-text-tertiary">אין לקוחות פעילים.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" data-testid="metrics-clients">
              <thead>
                <tr className="border-b border-app-border text-xs text-app-text-secondary">
                  <th className="py-2 pe-3 text-start font-medium">לקוח</th>
                  {report.all.map((m) => (
                    <th key={m.key} className="px-2 py-2 text-start font-medium" title={m.about}>
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {report.clients.map((c) => (
                  <tr key={c.clientId}>
                    <td className="py-2 pe-3">
                      <Link href={`/app/clients/${c.clientId}?tab=file`} className="text-app-text-primary hover:text-app-text-accent">
                        {c.clientName}
                      </Link>
                    </td>
                    {c.measures.map((m) => (
                      <td key={m.key} className={`px-2 py-2 font-jbmono text-[13px] ${m.state === "off" ? "text-app-warning" : m.state === "none" ? "text-app-text-tertiary" : "text-app-text-primary"}`}>
                        {m.state === "none" ? "·" : m.display}
                        {m.state === "off" && <span className="sr-only"> (לא עומד ביעד)</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-app-text-tertiary">בכתום: עוד לא ביעד. נקודה: אין עדיין מה למדוד.</p>
      </section>
    </div>
  );
}
