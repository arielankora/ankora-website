import Link from "next/link";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { Forbidden } from "@/components/app/Forbidden";
import { listAgents } from "@/lib/app-domain/agents";
import { NewAgent } from "./AgentForms";
import { KIND_LABEL, SURFACE_LABEL } from "./labels";

// Agents, phase 1 (22.11.2026): "סוכנים". Every agent is written here once;
// whoever runs it installs it, and its updates come from here.

export const metadata = { robots: { index: false, follow: false } };

function Pill({ tone, children }: { tone: "ok" | "warn" | "accent"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "bg-app-success-soft text-app-success" : tone === "warn" ? "bg-app-warning-soft text-app-warning" : "bg-app-accent-soft text-app-text-accent";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export default async function AgentsPage() {
  const user = await requireUser();
  if (!can(user.role, "time_entry.create_self")) return <Forbidden />;
  const agents = await listAgents(user);
  const pendingDrafts = agents.filter((a) => a.draft?.state === "PENDING").length;
  const updates = agents.reduce((n, a) => n + a.updatesWaiting, 0);
  const installs = agents.reduce((n, a) => n + a.installations, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">סוכנים</h1>
          <p className="mt-1 max-w-2xl text-sm text-app-text-secondary">כל סוכן נכתב כאן פעם אחת. כל מנהל תפעול מתקין אותו אצלו, והעדכונים מגיעים אליו מכאן.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/app/agents/library" className="tap-area rounded-full border border-app-border bg-white px-4 py-2 text-[13px] text-app-text-primary">ספריית קטעים</Link>
          <NewAgent />
        </div>
      </header>

      <section aria-label="מה דורש תשומת לב" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-app-border bg-white px-4 py-3">
          <div className="text-xs text-app-text-secondary">סוכנים</div>
          <div className="mt-1 text-2xl font-light text-app-text-primary">{agents.length}</div>
        </div>
        <div className="rounded-xl border border-app-border bg-white px-4 py-3">
          <div className="text-xs text-app-text-secondary">התקנות אצל הצוות</div>
          <div className="mt-1 text-2xl font-light text-app-text-primary">{installs}</div>
        </div>
        <div className="rounded-xl border border-app-border bg-app-warning-soft px-4 py-3 text-app-warning">
          <div className="text-xs">עדכונים ממתינים בהתקנות</div>
          <div className="mt-1 text-2xl font-light">{updates}</div>
        </div>
        <Link href="/app/approvals?tab=agent" className="rounded-xl border border-app-border bg-app-accent-soft px-4 py-3 text-app-text-accent">
          <div className="text-xs">טיוטות שמחכות לאישור</div>
          <div className="mt-1 text-2xl font-light">{pendingDrafts}</div>
        </Link>
      </section>

      {agents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-app-border bg-white p-8 text-center text-sm text-app-text-secondary">עוד אין סוכנים. אפשר ליצור סוכן חדש, או לבקש מ-Claude לייבא פרומפט קיים עם save_agent_draft.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-app-border bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-app-border text-start text-xs text-app-text-secondary">
                <th className="px-5 py-3 text-start font-normal">סוכן</th>
                <th className="px-4 py-3 text-start font-normal">איפה רץ</th>
                <th className="px-4 py-3 text-start font-normal">אחראי</th>
                <th className="px-4 py-3 text-start font-normal">גרסה</th>
                <th className="px-4 py-3 text-start font-normal">התקנות</th>
                <th className="px-4 py-3 text-start font-normal">מצב</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} className="border-b border-app-border last:border-0 hover:bg-app-surface-page">
                  <td className="px-5 py-4">
                    <a href={`/app/agents/${a.slug}`} className="font-medium text-app-text-primary hover:underline">{a.name}</a>
                    <div className="mt-0.5 text-[13px] text-app-text-secondary">{a.purpose}</div>
                  </td>
                  <td className="px-4 py-4 text-[13px]">{a.surfaces.length ? a.surfaces.map((s) => SURFACE_LABEL[s]).join(", ") : KIND_LABEL[a.kind]}</td>
                  <td className="px-4 py-4 text-[13px]">{a.ownerName ?? ""}</td>
                  <td className="px-4 py-4 text-[13px]">{a.version ? `גרסה ${a.version}` : "אין מאושרת"}</td>
                  <td className="px-4 py-4 text-[13px]">
                    {a.installations}
                    {a.installedBy.length > 0 && <div className="text-xs text-app-text-tertiary">{a.installedBy.join(", ")}</div>}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {a.updatesWaiting > 0 && <Pill tone="warn">{a.updatesWaiting === 1 ? "עדכון ממתין" : `${a.updatesWaiting} עדכונים ממתינים`}</Pill>}
                      {a.draft?.state === "PENDING" && <Pill tone="accent">גרסה {a.draft.version} לאישור</Pill>}
                      {a.draft?.state === "DRAFT" && <Pill tone="accent">טיוטה לגרסה {a.draft.version}</Pill>}
                      {a.lastRunFailed && <Pill tone="warn">הריצה האחרונה נכשלה</Pill>}
                      {!a.draft && a.updatesWaiting === 0 && !a.lastRunFailed && a.version && <Pill tone="ok">תקין</Pill>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
