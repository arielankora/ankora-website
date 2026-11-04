import { notFound } from "next/navigation";
import { PageBack } from "@/components/app/BackSlot";
import { requireUser } from "@/lib/app-auth/session";
import { canManageClients, ForbiddenError } from "@/lib/app-auth/permissions";
import { getClient } from "@/lib/app-domain/clients";
import { listConnections, type ConnectionView } from "@/lib/app-domain/connections";
import { googleOAuthConfig } from "@/lib/google-oauth";
import { ConnectionsScreen } from "./ConnectionsScreen";

// The client's connections (ADR 0001 section 24, task
// cmvtivumj000pjs08q9qj4t67, design https://claude.ai/artifact/CjzpzkxiB8xRvpaZNBWkAr):
// what the client's procedures read from and write to, who approved it,
// and a disconnect that revokes at Google.

export const metadata = { robots: { index: false, follow: false } };

const NOTICES: Record<string, string> = {
  "connected=1": "החיבור נוסף.",
  "error=not_configured": "החיבור ל-Google עוד לא מוגדר בסביבה הזו (חסרים פרטי לקוח OAuth).",
  "error=denied": "החיבור בוטל במסך של Google.",
  "error=no_token": "Google לא החזיר הרשאה קבועה. מנתקים את האפליקציה בהגדרות החשבון ב-Google ומנסים שוב.",
  "error=failed": "החיבור נכשל. נסו שוב.",
};

export default async function ConnectionsPage(props: { params: Promise<{ clientId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { clientId } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser();
  const client = await getClient(clientId);
  if (!client) notFound();
  let rows: ConnectionView[];
  try {
    rows = await listConnections(user, clientId);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }
  const notice = Object.entries(sp).map(([k, v]) => NOTICES[`${k}=${v}`]).find(Boolean) ?? null;
  return (
    <div className="mx-auto w-full max-w-appContent px-4 py-6">
      <PageBack href={`/app/clients/${clientId}`} label="חזרה לתיק הלקוח" />
      <ConnectionsScreen
        clientId={clientId}
        clientName={client.name}
        aiExcluded={!!client.aiExcluded}
        connections={rows.map((r) => ({ ...r, connectedAt: r.connectedAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null }))}
        mayManage={canManageClients(user.role) || client.accountManagerId === user.id}
        googleReady={!!googleOAuthConfig()}
        userId={user.id}
        notice={notice}
      />
    </div>
  );
}
