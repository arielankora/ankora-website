import Link from "next/link";
import { CalendarHeart, AlertTriangle, CalendarClock } from "lucide-react";
import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listImportantDates, IMPORTANT_DATE_STATUS_LABELS } from "@/lib/app-domain/important-dates";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listUsers } from "@/lib/app-domain/users";
import { listCategories } from "@/lib/app-domain/categories";
import { IMPORTANT_DATE_CATEGORY_LABELS } from "@/lib/app-domain/important-dates-reminders";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";
import { KpiCard } from "@/components/app/KpiCard";
import { Drawer } from "@/components/app/Drawer";
import { ImportantDateForm } from "./ImportantDateForm";
import { ImportantDateStatusSelect } from "./ImportantDateStatusSelect";
import type { ImportantDateCategory, ImportantDateStatus } from "@prisma/client";

export const metadata = { robots: { index: false, follow: false } };

const STATUS_TONE: Record<ImportantDateStatus, "green" | "amber" | "gray" | "red"> = {
  ACTIVE: "green",
  NEEDS_ATTENTION: "red",
  IN_PROGRESS: "amber",
  HANDLED_CURRENT: "gray",
  PAUSED: "gray",
  ARCHIVED: "gray",
};

function formatDate(date: Date | null): string {
  if (!date) return "-";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

function monthKey(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
}

// Phase 10 ("מועדים חשובים"): the main list+calendar screen. Gated the
// same as Tasks (time_entry.create_self - see lib/app-domain/tasks.ts's
// precedent, reused verbatim by lib/app-domain/important-dates.ts): every
// role that tracks time for a client sees that client's important dates;
// CLIENT_USER never reaches this route (separate nav array in AppShell,
// spec 13's portal-isolation rule - client-portal editing of dates is
// explicitly out of this MVP's scope).
//
// Scope note on "list + calendar": the brief asked for a list+calendar
// screen. The list half is fully built (KPI cards, filters, columns,
// side-panel create/edit, inline status change - mirroring
// app/(product)/app/(authenticated)/tasks exactly). The calendar half
// here is a lightweight "grouped by month" view (?view=calendar), not a
// full drag-and-drop day-grid calendar component - a full calendar widget
// is a meaningfully larger, separate build (month navigation, day cells,
// multi-event-per-day layout) that wasn't justified for this MVP given
// everything else in scope. This is a deliberate, documented scope
// reduction, not an oversight - see the final report's "what's simplified"
// section.
export default async function ImportantDatesPage({
  searchParams,
}: {
  searchParams: { clientId?: string; category?: string; status?: string; view?: string };
}) {
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const category = (Object.keys(IMPORTANT_DATE_CATEGORY_LABELS) as ImportantDateCategory[]).includes(
    searchParams.category as ImportantDateCategory
  )
    ? (searchParams.category as ImportantDateCategory)
    : undefined;
  const status = (Object.keys(IMPORTANT_DATE_STATUS_LABELS) as ImportantDateStatus[]).includes(
    searchParams.status as ImportantDateStatus
  )
    ? (searchParams.status as ImportantDateStatus)
    : undefined;
  const isCalendarView = searchParams.view === "calendar";

  const [dates, clients, users, allCategories] = await Promise.all([
    listImportantDates(user, { clientId: searchParams.clientId, category, status }),
    listAccessibleClients(user),
    listUsers(),
    listCategories(),
  ]);

  const clientIds = new Set(clients.map((c) => c.id));
  const categoriesForAutoTask = allCategories.filter(
    (cat) => cat.active && (cat.visibility === "GLOBAL" || (cat.clientId && clientIds.has(cat.clientId)))
  );

  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 86_400_000);
  const upcoming30 = dates.filter((d) => d.nextOccurrenceAt && d.nextOccurrenceAt >= now && d.nextOccurrenceAt <= in30Days).length;
  const needsAttention = dates.filter((d) => d.status === "NEEDS_ATTENTION").length;
  const thisMonth = dates.filter(
    (d) => d.nextOccurrenceAt && d.nextOccurrenceAt.getUTCMonth() === now.getUTCMonth() && d.nextOccurrenceAt.getUTCFullYear() === now.getUTCFullYear()
  ).length;

  const groupedByMonth = new Map<string, typeof dates>();
  for (const d of dates) {
    if (!d.nextOccurrenceAt) continue;
    const key = monthKey(d.nextOccurrenceAt);
    if (!groupedByMonth.has(key)) groupedByMonth.set(key, []);
    groupedByMonth.get(key)!.push(d);
  }

  // Plain string hrefs (not next/link's UrlObject form, which has no
  // existing precedent elsewhere in this codebase) so the list/calendar
  // toggle preserves every other active filter.
  function viewHref(view: "list" | "calendar"): string {
    const params = new URLSearchParams();
    if (searchParams.clientId) params.set("clientId", searchParams.clientId);
    if (searchParams.category) params.set("category", searchParams.category);
    if (searchParams.status) params.set("status", searchParams.status);
    if (view === "calendar") params.set("view", "calendar");
    const qs = params.toString();
    return qs ? `/app/important-dates?${qs}` : "/app/important-dates";
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-navy">מועדים חשובים</h1>
            <p className="mt-1 text-sm text-navy/60">ימי הולדת, מסמכים, חידושים וחגים - לפי לקוח, עם תזכורות אוטומטיות.</p>
          </div>
          <Drawer triggerLabel="הוספת מועד" title="מועד חשוב חדש">
            <ImportantDateForm clients={clients} users={users} categories={categoriesForAutoTask} />
          </Drawer>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard icon={CalendarClock} label="מועדים ב-30 הימים הקרובים" value={upcoming30} />
          <KpiCard icon={AlertTriangle} label="דורשים טיפול" value={needsAttention} />
          <KpiCard icon={CalendarHeart} label="החודש" value={thisMonth} />
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href={viewHref("list")}
            className={`rounded-full border px-4 py-1.5 ${!isCalendarView ? "border-gold text-navy" : "border-lineDark text-navy/60"}`}
          >
            רשימה
          </Link>
          <Link
            href={viewHref("calendar")}
            className={`rounded-full border px-4 py-1.5 ${isCalendarView ? "border-gold text-navy" : "border-lineDark text-navy/60"}`}
          >
            לוח שנה
          </Link>
        </div>

        <form className="flex flex-wrap items-end gap-4 rounded-2xl border border-lineDark bg-white p-4">
          <input type="hidden" name="view" value={searchParams.view ?? ""} />
          <div>
            <label className="block text-xs font-medium text-navy/60">לקוח</label>
            <select
              name="clientId"
              defaultValue={searchParams.clientId ?? ""}
              className="mt-1.5 rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            >
              <option value="">כל הלקוחות</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-navy/60">קטגוריה</label>
            <select
              name="category"
              defaultValue={searchParams.category ?? ""}
              className="mt-1.5 rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            >
              <option value="">כל הקטגוריות</option>
              {Object.entries(IMPORTANT_DATE_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-navy/60">סטטוס</label>
            <select
              name="status"
              defaultValue={searchParams.status ?? ""}
              className="mt-1.5 rounded-lg border border-lineDark bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            >
              <option value="">כל הסטטוסים</option>
              {Object.entries(IMPORTANT_DATE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-full border border-lineDark px-4 py-2 text-sm text-navy hover:border-gold">
            סינון
          </button>
        </form>

        {isCalendarView ? (
          <div className="space-y-6">
            {groupedByMonth.size === 0 && (
              <div className="rounded-2xl border border-lineDark bg-white p-8 text-center text-sm text-navy/50">אין מועדים קרובים להצגה.</div>
            )}
            {Array.from(groupedByMonth.entries()).map(([month, monthDates]) => (
              <div key={month}>
                <h2 className="text-sm font-medium text-navy/70">{month}</h2>
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {monthDates.map((d) => (
                    <Link
                      key={d.id}
                      href={`/app/important-dates/${d.id}`}
                      className="rounded-2xl border border-lineDark bg-white p-4 transition-colors hover:border-gold"
                    >
                      <p className="text-xs text-navy/50">{formatDate(d.nextOccurrenceAt)}</p>
                      <p className="mt-1 font-medium text-navy">{d.title}</p>
                      <p className="mt-1 text-xs text-navy/60">{d.client.name}</p>
                      <div className="mt-2">
                        <StatusBadge label={IMPORTANT_DATE_STATUS_LABELS[d.status]} tone={STATUS_TONE[d.status]} />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-lineDark bg-white">
            <table className="w-full min-w-[820px] text-start text-sm">
              <thead>
                <tr className="border-b border-lineDark text-xs text-navy/50">
                  <th className="px-5 py-3 font-medium">מועד</th>
                  <th className="px-5 py-3 font-medium">לקוח</th>
                  <th className="px-5 py-3 font-medium">קטגוריה</th>
                  <th className="px-5 py-3 font-medium">מופע הבא</th>
                  <th className="px-5 py-3 font-medium">אחראי</th>
                  <th className="px-5 py-3 font-medium">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {dates.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-navy/50">
                      אין עדיין מועדים חשובים. הוסיפו מועד ראשון למעלה.
                    </td>
                  </tr>
                )}
                {dates.map((d) => (
                  <tr key={d.id} className="border-b border-lineDark last:border-0">
                    <td className="px-5 py-3 font-medium text-navy">
                      <Link href={`/app/important-dates/${d.id}`} className="hover:text-gold-dim">
                        {d.title}
                      </Link>
                      <p className="text-xs text-navy/40">{d.type}</p>
                    </td>
                    <td className="px-5 py-3 text-navy/70">{d.client.name}</td>
                    <td className="px-5 py-3 text-navy/70">{IMPORTANT_DATE_CATEGORY_LABELS[d.category]}</td>
                    <td className="px-5 py-3 text-navy/70">{formatDate(d.nextOccurrenceAt)}</td>
                    <td className="px-5 py-3 text-navy/70">{d.responsibleUser.name}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <StatusBadge label={IMPORTANT_DATE_STATUS_LABELS[d.status]} tone={STATUS_TONE[d.status]} />
                        <ImportantDateStatusSelect importantDateId={d.id} status={d.status} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
