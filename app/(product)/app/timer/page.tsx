import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getActiveTimer, listRecentCombinations } from "@/lib/app-domain/time-entries";
import { listAccessibleClients } from "@/lib/app-domain/clients";
import { listCategories } from "@/lib/app-domain/categories";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { TimerWidget } from "./TimerWidget";

export const metadata = { robots: { index: false, follow: false } };

// Spec 11.1 "Today / Timer" + 6.2 "Quick Timer" - the single most
// important screen on mobile (spec 6.2: "במובייל זהו המסך החשוב ביותר").
export default async function TimerPage() {
  const user = await requireUser();

  if (!can(user.role, "time_entry.create_self")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const [activeTimer, clients, allCategories, recent] = await Promise.all([
    getActiveTimer(user.id),
    listAccessibleClients(user),
    listCategories(),
    listRecentCombinations(user.id),
  ]);

  const clientIds = new Set(clients.map((c) => c.id));
  // Spec 6.1: categories visible are either GLOBAL or scoped to a client
  // the user can actually pick.
  const categories = allCategories.filter(
    (cat) => cat.active && (cat.visibility === "GLOBAL" || (cat.clientId && clientIds.has(cat.clientId)))
  );

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">היום שלי</h1>
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
          }))}
        />
      </div>
    </AppShell>
  );
}
