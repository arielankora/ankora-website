import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
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

/// The address the Google round trip comes back with, and the notice it
/// means (keys under clients.connections.notices).
const NOTICES = {
  "connected=1": { key: "connected", error: false },
  "error=not_configured": { key: "notConfigured", error: true },
  "error=denied": { key: "denied", error: true },
  "error=no_token": { key: "noToken", error: true },
  "error=failed": { key: "failed", error: true },
} as const;

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
  const t = await getTranslations("clients.connections");
  const found = Object.entries(sp)
    .map(([k, v]) => NOTICES[`${k}=${v}` as keyof typeof NOTICES])
    .find(Boolean);
  const notice = found ? { text: t(`notices.${found.key}`), error: found.error } : null;
  return (
    <div className="mx-auto w-full max-w-appContent px-4 py-6">
      <PageBack href={`/app/clients/${clientId}`} label={t("back")} />
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
