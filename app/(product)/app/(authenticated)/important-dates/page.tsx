import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listImportantDates } from "@/lib/app-domain/important-dates";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listUsers } from "@/lib/app-domain/users";
import { listCategories } from "@/lib/app-domain/categories";
import { Forbidden } from "@/components/app/Forbidden";
import { Drawer } from "@/components/app/Drawer";
import { ImportantDateForm } from "./ImportantDateForm";
import { ImportantDateRow, type DateRow } from "./ImportantDateRow";
import type { ImportantDateStatus, RecurrenceType } from "@prisma/client";

export const metadata = { robots: { index: false, follow: false } };

type Tab = "upcoming" | "all" | "done";

const TABS: { value: Tab; label: string }[] = [
  { value: "upcoming", label: "קרובים" },
  { value: "all", label: "הכל" },
  { value: "done", label: "טופלו" },
];

const RECURRENCE_LABEL: Record<RecurrenceType, string> = {
  ONCE: "חד פעמי",
  ANNUAL: "חוזר שנתי",
  MONTHLY: "חוזר חודשי",
  CUSTOM_INTERVAL: "חוזר במרווח קבוע",
};

const STATUS_TONE: Record<ImportantDateStatus, DateRow["tone"]> = {
  ACTIVE: "gray",
  NEEDS_ATTENTION: "red",
  IN_PROGRESS: "gold",
  HANDLED_CURRENT: "green",
  PAUSED: "gray",
  ARCHIVED: "gray",
};

const STATUS_LABEL: Record<ImportantDateStatus, string> = {
  ACTIVE: "פעיל",
  NEEDS_ATTENTION: "דחוף",
  IN_PROGRESS: "בטיפול",
  HANDLED_CURRENT: "טופל",
  PAUSED: "מושהה",
  ARCHIVED: "בארכיון",
};

function formatReminders(rules: { daysBefore: number }[]): string {
  if (rules.length === 0) return "ללא תזכורות";
  const days = [...new Set(rules.map((r) => r.daysBefore))].sort((a, b) => a - b);
  return `תזכורת: ${days.join(", ")} ימים מראש`;
}

// App redesign (handoff README, screen 7 "מועדים חשובים"): "מתג: קרובים /
// הכל / טופלו" - replaces the previous list/calendar toggle and the
// clientId/category/status filter bar with the prototype's single 3-way
// tab, matching its markup exactly (date-square row, no KPI cards, no
// filter form). Same scope-reduction call as tasks/page.tsx made in the
// daily-screens phase: listImportantDates() still accepts clientId/
// category/status filters server-side, and the calendar grouping this
// replaced is straightforward to bring back from history if ever
// requested - this pass follows the design spec's exact, deliberately
// simpler surface rather than preserving every prior filter control.
export default async function ImportantDatesPage({ searchParams }: { searchParams: { tab?: string } }) {
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const tab: Tab = searchParams.tab === "all" ? "all" : searchParams.tab === "done" ? "done" : "upcoming";

  const [dates, clients, users, allCategories] = await Promise.all([
    listImportantDates(user),
    listAccessibleClients(user),
    listUsers(),
    listCategories(),
  ]);

  const clientIds = new Set(clients.map((c) => c.id));
  const categoriesForAutoTask = allCategories.filter(
    (cat) => cat.active && (cat.visibility === "GLOBAL" || (cat.clientId && clientIds.has(cat.clientId)))
  );

  const visible = dates.filter((d) => {
    if (tab === "done") return d.status === "HANDLED_CURRENT";
    if (tab === "all") return true;
    return d.status !== "HANDLED_CURRENT" && d.status !== "ARCHIVED";
  });

  const rows: DateRow[] = visible.map((d) => {
    const occurrence = d.nextOccurrenceAt ?? d.createdAt;
    return {
      id: d.id,
      title: d.title,
      day: new Intl.DateTimeFormat("he-IL", { day: "2-digit", timeZone: "Asia/Jerusalem" }).format(occurrence),
      month: new Intl.DateTimeFormat("he-IL", { month: "short", timeZone: "Asia/Jerusalem" }).format(occurrence),
      meta: `${d.client.name} · ${RECURRENCE_LABEL[d.recurrence]}`,
      tag: STATUS_LABEL[d.status],
      tone: STATUS_TONE[d.status],
      remind: formatReminders(d.reminderRules),
      status: d.status,
      previousStatus: d.status === "HANDLED_CURRENT" ? "ACTIVE" : d.status,
    };
  });

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-navy">מועדים חשובים</h1>
            <p className="mt-1 text-sm text-navy/60">ימי הולדת, מסמכים, חידושים וחגים - לפי לקוח, עם תזכורות אוטומטיות.</p>
          </div>
          <Drawer triggerLabel="+ מועד חדש" title="מועד חשוב חדש">
            <ImportantDateForm clients={clients} users={users} categories={categoriesForAutoTask} />
          </Drawer>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-lineDark bg-white p-[3px]">
            {TABS.map((t) => (
              <a
                key={t.value}
                href={t.value === "upcoming" ? "/app/important-dates" : `/app/important-dates?tab=${t.value}`}
                className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                  tab === t.value ? "bg-navy text-paper font-medium" : "text-navy/60 hover:text-navy"
                }`}
              >
                {t.label}
              </a>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {rows.length === 0 ? (
            <p className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-navy/50">
              אין מועדים להצגה בתצוגה הזו.
            </p>
          ) : (
            rows.map((row) => <ImportantDateRow key={row.id} date={row} />)
          )}
        </div>

        <p className="text-xs text-navy/50">מועדים חוזרים מחושבים אוטומטית, כולל התאמה ללוח השנה העברי ולימי חג.</p>
      </div>
    </>
  );
}
