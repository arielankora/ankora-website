import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { listIntegrationConnections, getProvider } from "@/lib/app-domain/integrations";
import { AppShell } from "@/components/app/AppShell";
import { Forbidden } from "@/components/app/Forbidden";
import { StatusBadge } from "@/components/app/StatusBadge";

export const metadata = { robots: { index: false, follow: false } };

const PROVIDER_LABEL: Record<string, string> = {
  clickup: "ClickUp",
};

const STATUS_LABEL: Record<string, string> = {
  NOT_CONNECTED: "לא מחובר",
  CONNECTED: "מחובר",
  ERROR: "שגיאה",
};

// Spec 12's admin screens table: "Integrations - placeholder + ClickUp
// connection config when developed." Spec 17.3: "אפשר כבר ליצור מסך
// Integrations עם Card 'ClickUp - Coming/Not connected'. לא לבקש OAuth
// scopes עד שהאינטגרציה ממומשת" - so this screen deliberately has no
// "Connect" button that does anything: it shows the current
// IntegrationConnection status per provider and nothing more, per
// integration.manage (SUPER_ADMIN-only, permissions.ts's Phase 8 comment).
export default async function IntegrationsPage() {
  const user = await requireUser();

  if (!can(user.role, "integration.manage")) {
    return (
      <AppShell user={user}>
        <Forbidden />
      </AppShell>
    );
  }

  const connections = await listIntegrationConnections(user);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-navy">אינטגרציות</h1>
          <p className="mt-1 text-sm text-navy/60">
            חיבור מערכות חיצוניות. בשלב זה מוצג רק סטטוס - אין עדיין חיבור פעיל לאף מערכת.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {connections.map((connection) => {
            const provider = getProvider(connection.provider);
            const label = PROVIDER_LABEL[connection.provider] ?? connection.provider;
            return (
              <div key={connection.id} className="rounded-2xl border border-lineDark bg-white p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-medium text-navy">{label}</h2>
                  <StatusBadge label={STATUS_LABEL[connection.status] ?? connection.status} tone={connection.status === "CONNECTED" ? "green" : connection.status === "ERROR" ? "red" : "gray"} />
                </div>
                <p className="mt-2 text-sm text-navy/60">
                  {provider ? "בקרוב - טרם פותח חיבור אמיתי." : "ספק לא ידוע."}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
