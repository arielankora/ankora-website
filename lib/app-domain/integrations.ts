import "server-only";
import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/app-auth/permissions";
import type { User, IntegrationConnection } from "@prisma/client";

// Phase 8 domain service: spec section 23 ("Integration foundation
// validation + production rollout") and section 17 ("תשתית עתידית
// ל-ClickUp"). Two things live here, deliberately kept separate:
//
// 1. `IntegrationProvider` (17.1's own interface list verbatim: connect,
//    disconnect, pullTasks, pushTimeEntry, handleWebhook, healthCheck) -
//    the shape any future real provider (ClickUp first) must implement.
//    No concrete provider is built in this phase - 17.3 is explicit that
//    Ankora should NOT request OAuth scopes "עד שהאינטגרציה ממומשת" (until
//    the integration is actually implemented). `clickUpPlaceholder` is a
//    stub that satisfies the interface for the admin screen to call
//    healthCheck() against, and every other method rejects clearly rather
//    than silently no-op-ing, so a future real implementation is a drop-in
//    replacement, not a rewrite of anything that calls this module.
// 2. CRUD-lite functions over the IntegrationConnection/ExternalMapping
//    tables (spec section 5) - "lite" because this phase never writes a
//    real credential (there is nothing to connect to yet); `ensureRow`
//    exists so the /app/integrations screen always has a NOT_CONNECTED
//    row to show per provider, matching 17.3's "Card 'ClickUp - Coming/
//    Not connected'" requirement, without a separate seed script.

export interface IntegrationProvider {
  readonly name: string;
  connect(config: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
  disconnect(): Promise<{ ok: boolean; error?: string }>;
  pullTasks(): Promise<{ ok: boolean; error?: string }>;
  pushTimeEntry(): Promise<{ ok: boolean; error?: string }>;
  handleWebhook(payload: unknown): Promise<{ ok: boolean; error?: string }>;
  healthCheck(): Promise<{ ok: boolean; status: "not_connected" | "connected" | "error"; error?: string }>;
}

/// Spec 17.3: no OAuth scope is requested until the integration is really
/// built, so every mutating method here rejects with the same explicit
/// "not implemented" reason - this is not a bug, it is the correct
/// behavior for a placeholder provider. `healthCheck` alone succeeds
/// (returning `not_connected`, not an error) since the admin screen calls
/// it just to render the connection card's current status.
export const clickUpPlaceholder: IntegrationProvider = {
  name: "clickup",
  async connect() {
    return { ok: false, error: "ClickUp integration is not implemented yet (spec 17.3 - no OAuth scope requested until it is)." };
  },
  async disconnect() {
    return { ok: false, error: "Not connected." };
  },
  async pullTasks() {
    return { ok: false, error: "ClickUp integration is not implemented yet." };
  },
  async pushTimeEntry() {
    return { ok: false, error: "ClickUp integration is not implemented yet." };
  },
  async handleWebhook() {
    return { ok: false, error: "ClickUp integration is not implemented yet." };
  },
  async healthCheck() {
    return { ok: true, status: "not_connected" };
  },
};

/// Every provider spec 2.2/17 currently names. Adding a real second
/// provider later means adding one entry here, not touching any caller.
const PROVIDERS: Record<string, IntegrationProvider> = {
  clickup: clickUpPlaceholder,
};

export function getProvider(name: string): IntegrationProvider | undefined {
  return PROVIDERS[name];
}

/// Spec 12's admin screens table: "Integrations - placeholder + ClickUp
/// connection config when developed." SUPER_ADMIN-only per this phase's
/// RBAC addition (see lib/app-auth/permissions.ts comment on
/// integration.manage).
export async function listIntegrationConnections(actor: User): Promise<IntegrationConnection[]> {
  assertCan(actor.role, "integration.manage");
  await ensureKnownProviderRows();
  return prisma.integrationConnection.findMany({ orderBy: { provider: "asc" } });
}

/// Idempotently makes sure every provider named in `PROVIDERS` has a row
/// (defaulting to NOT_CONNECTED) so the admin screen always has something
/// to render, without a separate seed step that could drift from
/// `PROVIDERS` itself.
async function ensureKnownProviderRows(): Promise<void> {
  for (const provider of Object.keys(PROVIDERS)) {
    await prisma.integrationConnection.upsert({
      where: { provider },
      update: {},
      create: { provider },
    });
  }
}
