import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getActiveTimers, listRecentCombinations, listMyTimeEntries } from "@/lib/app-domain/time-entries";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { listOpenPromises } from "@/lib/app-domain/tasks";
import { localDateKey, localDateTimeToUtc, TIMEZONE } from "@/lib/timezone";
import { Forbidden } from "@/components/app/Forbidden";
import { TimerWidget, type TodayEntry } from "./TimerWidget";
import { ViewTabs } from "@/components/app/ViewTabs";
import { MyTimeView } from "../my-time/MyTimeView";

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
      startAt: e.startAt.toISOString(),
      endAt: (e.endAt as Date).toISOString(),
    }));
}

// Spec 11.1 "Today / Timer" + 6.2 "Quick Timer" - the single most
// important screen on mobile (spec 6.2: "במובייל זהו המסך החשוב ביותר").
// 19.10.2026: one screen for the clock and the week it fills, with
// "הזמן שלי" as its second tab (canvas "Ankora App UI Round").
const TIME_TABS = [
  { key: "timer", label: "טיימר", href: "/app/timer" },
  { key: "mine", label: "הזמן שלי", href: "/app/timer?tab=mine" },
];

export default async function TimerPage(props: { searchParams: Promise<{ tab?: string; week?: string }> }) {
  const sp = await props.searchParams;
  if (sp.tab === "mine") {
    return (
      <div className="space-y-5">
        <ViewTabs tabs={TIME_TABS} active="mine" label="טיימר והזמן שלי" />
        <MyTimeView searchParams={{ week: sp.week }} />
      </div>
    );
  }
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const [activeTimers, clients, allCategories, recent, todayEntries, openPromises] = await Promise.all([
    getActiveTimers(user.id),
    listAccessibleClients(user),
    listCategories(),
    // Spec 6.2 quick-start bullet: exactly three one-click combos.
    listRecentCombinations(user.id, 3),
    loadTodayEntries(user.id),
    // Team adoption: what the stop can ask about. Loaded here rather
    // than fetched when the toast appears, because a question that
    // arrives a moment after the toast does is a question nobody sees.
    listOpenPromises(user),
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
        <ViewTabs tabs={TIME_TABS} active="timer" label="טיימר והזמן שלי" />
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">טיימר</h1>
          <p className="mt-1 text-sm text-app-text-secondary">טיימרים פעילים, לקוח וקטגוריה, שילובים אחרונים.</p>
        </div>

        <TimerWidget
          activeTimers={activeTimers.map((t) => ({
            id: t.id,
            startAt: t.startAt.toISOString(),
            clientId: t.clientId,
            categoryId: t.categoryId,
            note: t.note,
            taskId: t.taskId,
          }))}
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
          openPromises={openPromises.map((t) => ({
            id: t.id,
            clientId: t.clientId,
            // What the client calls it, when Ankora wrote them a title.
            // The person stopping the timer is about to tell that client
            // something, so the words in front of them should be the
            // ones the client already sees.
            label: t.clientTitle?.trim() || t.title,
          }))}
        />
      </div>
    </>
  );
}
