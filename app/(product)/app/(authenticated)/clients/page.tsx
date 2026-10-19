import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients, listArchivedClients } from "@/lib/app-domain/clients";
import { getCurrentHourBanksForClients } from "@/lib/app-domain/hour-banks";
import { Forbidden } from "@/components/app/Forbidden";
import { Drawer } from "@/components/app/Drawer";
import { CreateClientForm } from "./CreateClientForm";
import { ClientsGrid, type ClientCard } from "./ClientsGrid";
import { RestoreClientButton } from "./RestoreClientButton";

export const metadata = { robots: { index: false, follow: false } };

// App redesign (handoff README, screen 5 "לקוחות"): "כרטיס לכל לקוח: שם,
// תג סטטוס, מנהל תיק, אחוז ניצול (אדום מעל 100%), פס התקדמות". There is
// no "portfolio manager" field anywhere in the domain (Client has no
// single-owner relation - UserClientAccess is a plain many-to-many), so
// the prototype's invented "מנהל תיק: X" line is replaced with the real
// number of employees assigned to the client (the same _count the old
// table already showed as "משתמשים מוקצים") - a real, honest number
// instead of fabricating a manager designation the schema doesn't have.
export default async function ClientsPage(props: { searchParams: Promise<{ q?: string | string[] }> }) {
  const user = await requireUser();
  // The search lives in the address bar (19.10.2026), so a client opened
  // from a narrowed list comes back to the same list. See ClientsGrid.
  const rawQ = (await props.searchParams).q;
  const initialQuery = typeof rawQ === "string" ? rawQ.slice(0, 200) : "";

  if (!can(user.role, "client.manage")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const canManageBanks = can(user.role, "hour_bank.manage");
  const canViewReports = can(user.role, "report.internal.view");
  const [clients, archived] = await Promise.all([listClients(), listArchivedClients(user)]);

  // One batched lookup for the whole list.
  //
  // This was `await getCurrentHourBank(client.id)` inside the map, which
  // - because of the await - ran the per-client lookups one after
  // another rather than together. At six to nine round trips each, a
  // roster of a dozen clients meant the better part of a hundred
  // sequential queries before this screen rendered a single card.
  //
  // Archived clients are still skipped: their cycles are frozen and
  // irrelevant to a "current state" card, and leaving them out keeps the
  // query narrower.
  const snapshots = await getCurrentHourBanksForClients(
    clients.filter((c) => c.status !== "ARCHIVED").map((c) => c.id),
  );

  const cards: ClientCard[] = clients.map((client) => ({
    id: client.id,
    name: client.name,
    status: client.status,
    employeeCount: client._count.employeeAccess,
    utilizationPct: snapshots.get(client.id)?.utilization.utilizationPct ?? null,
  }));

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-app-text-primary">לקוחות</h1>
            <p className="mt-1 text-sm text-app-text-secondary">ניהול לקוחות Ankora, סטטוס וניצול בנק השעות.</p>
          </div>
          <Drawer triggerLabel="לקוח חדש" title="לקוח חדש">
            <CreateClientForm />
          </Drawer>
        </div>

        {/* Keyed on the roster, so a client restored below appears in the
            grid (which keeps its own copy of the list for the archive
            toast's undo) as soon as the screen refreshes. */}
        <ClientsGrid
          key={cards.map((c) => c.id).join(",")}
          cards={cards}
          initialQuery={initialQuery}
          canManageBanks={canManageBanks}
          canViewReports={canViewReports}
        />

        {archived.length > 0 && (
          <details className="rounded-2xl border border-app-border bg-white p-5">
            <summary className="cursor-pointer text-sm font-medium text-app-text-primary">
              בארכיון ({archived.length})
            </summary>
            <ul className="mt-3 divide-y divide-app-border">
              {archived.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="text-sm text-app-text-primary">{c.name}</span>
                  <RestoreClientButton clientId={c.id} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}
