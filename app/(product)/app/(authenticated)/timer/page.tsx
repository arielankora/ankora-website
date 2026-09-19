import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getActiveTimer, listRecentCombinations, listMyTimeEntries } from "@/lib/app-domain/time-entries";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { localDateKey, localDateTimeToUtc, TIMEZONE } from "@/lib/timezone";
import { Forbidden } from "@/components/app/Forbidden";
import { TimerWidget, type TodayEntry } from "./TimerWidget";

export const metadata = { robots: { index: false, follow: false } };

// App redesign (handoff README, screen 2 "טיימר"): "היום — שלוש שורות עם
// סכום" - today's already-closed entries plus their total, alongside the
// timer itself. Same Asia/Jerusalem day-boundary convention as the
// Overview trend chart (lib/app-domain/overview-trend.ts).
async function loadTodayEntries(userId: string): Promise<TodayEntry[]> {
  const todayKey = localDateKey(new Date());
  const tomorrowKey = localDateKey(new Date(Date.now() + 24 * 3600_000));
  const from = localDateTimeToUtc(todayKey, "00:00", TIMEZONE);
  const to = localDateTimeToUtc(tomorrowKey, "00:00", TIMEZONE);

  const entries = await listMyTimeEntries(userId, { from, to });
  return entries
    .filter((e) => e.actualSeconds !== null) // still-running entry has its own hero-card display
    .map((e) => ({
      id: e.id,
      clientName: e.client.name,
      categoryName: e.category.name,
      actualSeconds: e.actualSeconds as number,
    }));
}

// Spec 11.1 "Today / Timer" + 6.2 "Quick Timer" - the single most
// important screen on mobile (spec 6.2: "במובייל זהו המסך החשוב ביותר").
export default async function TimerPage() {
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const [activeTimer, clients, allCategories, recent, todayEntries] = await Promise.all([
    getActiveTimer(user.id),
    listAccessibleClients(user),
    listCategories(),
    // Spec 6.2 quick-start bullet: exactly three one-click combos.
    listRecentCombinations(user.id, 3),
    loadTodayEntries(user.id),
  ]);

  const clientIds = new Set(clients.map((c) => c.id));
  // Spec 6.1: categories visible are either GLOBAL or scoped to a client
  // the user can actually pick.
  const categories = allCategories.filter(
    (cat) => cat.active && (cat.visibility === "GLOBAL" || (cat.clientId && clientIds.has(cat.clientId)))
  );

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">טיימר</h1>
          <p className="mt-1 text-sm text-navy/60">טיימר פעיל, לקוח וקטגוריה, שילובים אחרונים.</p>
        </div>

        <TimerWidget
          activeTimer={
            activeTimer
              ? {
                  id: activeTimer.id,
                  startAt: activeTimer.startAt.toISOString(),
                  clientId: activeTimer.clientId,
                  categoryId: activeTimer.categoryId,
                  note: activeTimer.note,
                }
              : null
          }
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          categories={categories.map((cat) => ({
            id: cat.id,
            name: cat.name,
            clientId: cat.clientId,
          }))}
          recent={recent.map((r) => ({
            clientId: r.clientId,
            clientName: r.client.name,
            categoryId: r.categoryId,
            categoryName: r.category.name,
            lastUsedAt: r.startAt.toISOString(),
          }))}
          todayEntries={todayEntries}
        />
      </div>
    </>
  );
}
