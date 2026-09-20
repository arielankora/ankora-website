import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listClients } from "@/lib/app-domain/clients";
import { getCurrentHourBank } from "@/lib/app-domain/hour-banks";
import { Forbidden } from "@/components/app/Forbidden";
import { Drawer } from "@/components/app/Drawer";
import { CreateClientForm } from "./CreateClientForm";
import { ClientsGrid, type ClientCard } from "./ClientsGrid";

export const metadata = { robots: { index: false, follow: false } };

// App redesign (handoff README, screen 5 "לקוחות"): "כרטיס לכל לקוח: שם,
// תג סטטוס, מנהל תיק, אחוז ניצול (אדום מעל 100%), פס התקדמות". There is
// no "portfolio manager" field anywhere in the domain (Client has no
// single-owner relation - UserClientAccess is a plain many-to-many), so
// the prototype's invented "מנהל תיק: X" line is replaced with the real
// number of employees assigned to the client (the same _count the old
// table already showed as "משתמשים מוקצים") - a real, honest number
// instead of fabricating a manager designation the schema doesn't have.
export default async function ClientsPage() {
  const user = await requireUser();

  if (!can(user.role, "client.manage")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const canManageBanks = can(user.role, "hour_bank.manage");
  const canViewReports = can(user.role, "report.internal.view");
  const clients = await listClients();

  const cards: ClientCard[] = await Promise.all(
    clients.map(async (client) => {
      // getCurrentHourBank does a couple of live queries per client - fine
      // at this screen's scale (Ankora's own client roster, not a
      // paginated public list). Archived clients skip the lookup: their
      // cycles are frozen and irrelevant to this "current state" card.
      const snapshot =
        client.status !== "ARCHIVED" ? await getCurrentHourBank(client.id) : null;
      return {
        id: client.id,
        name: client.name,
        status: client.status,
        employeeCount: client._count.employeeAccess,
        utilizationPct: snapshot?.utilization.utilizationPct ?? null,
      };
    })
  );

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium text-appNavy">לקוחות</h1>
            <p className="mt-1 text-sm text-appNavy/60">ניהול לקוחות Ankora, סטטוס וניצול בנק השעות.</p>
          </div>
          <Drawer triggerLabel="+ לקוח חדש" title="לקוח חדש">
            <CreateClientForm />
          </Drawer>
        </div>

        <ClientsGrid cards={cards} canManageBanks={canManageBanks} canViewReports={canViewReports} />
      </div>
    </>
  );
}
