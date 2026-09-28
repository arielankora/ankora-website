import { requireUser } from "@/lib/app-auth/session";
import { can } from "@/lib/app-auth/permissions";
import { getMyClaudeConnection, getClaudeOrgSummary } from "@/lib/app-domain/mcp-connections";
import { Forbidden } from "@/components/app/Forbidden";
import { ClaudeConnectionCard } from "@/components/app/ClaudeConnectionCard";

export const metadata = { robots: { index: false, follow: false } };

// Spec 12's admin screens table: "Integrations - placeholder + ClickUp
// connection config when developed." Spec 17.3: "אפשר כבר ליצור מסך
// Integrations עם Card 'ClickUp - Coming/Not connected'. לא לבקש OAuth
// scopes עד שהאינטגרציה ממומשת" - so this screen deliberately has no
// "Connect" button that does anything: it shows the current
// IntegrationConnection status per provider and nothing more, per
// integration.manage (SUPER_ADMIN-only, permissions.ts's Phase 8 comment).
//
// Since then one integration stopped being hypothetical: the MCP server
// (docs/adr/0005) is live, employees connect Claude to it over OAuth, and
// none of that appeared anywhere in the product. So this screen now has
// two halves, and the order is the point - the connector that really
// works comes first, the placeholder second. The old copy ("אין עדיין
// חיבור פעיל לאף מערכת") was true when it was written and is not any
// more.
//
// 26.9.2026: the "בפיתוח" half is gone. Ariel: "אפשר למחוק את clickup -
// לא נשתמש בו כבר". It was the only card there, a placeholder that could
// never be connected, on a screen whose job is to show what is. The
// provider interface in lib/app-domain/integrations.ts is kept: it is the
// shape the next real integration plugs into, and nothing renders it.
export default async function IntegrationsPage() {
  const user = await requireUser();

  if (!can(user.role, "integration.manage")) {
    return (
      <>
        <Forbidden />
      </>
    );
  }

  const [claude, claudeOrg] = await Promise.all([
    getMyClaudeConnection(user),
    getClaudeOrgSummary(user),
  ]);

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-medium text-appNavy">אינטגרציות</h1>
          <p className="mt-1 text-sm text-appNavy/60">
            חיבור מערכות חיצוניות לאפליקציית ניהול הזמן.
          </p>
        </div>

        <ClaudeConnectionCard status={claude} orgSummary={claudeOrg} />

      </div>
    </>
  );
}
