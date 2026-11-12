import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { SITE_URL } from "@/lib/site";
import { StatusBadge } from "@/components/app/StatusBadge";
import { CopyValue } from "@/components/app/CopyValue";
import { ClaudeGrantList, type GrantRow } from "@/components/app/ClaudeGrantList";
import type { ClaudeConnectionStatus, ClaudeOrgSummary } from "@/lib/app-domain/mcp-connections";

// The Claude (MCP) connection card, shown in two places on purpose:
//
//   /app/integrations - because it is an integration, and a SUPER_ADMIN
//     looking at that screen should see the one connector that is
//     actually live, not only the ClickUp placeholder.
//   /app/profile - because the connection is PERSONAL. Each employee
//     grants Claude access to their own account, with their own
//     permissions, and /app/integrations is SUPER_ADMIN-only. A card that
//     lived only there would mean the people who need to connect could
//     never find out how.
//
// The two views differ by exactly one thing (the org-wide adoption line),
// so they share this component rather than diverging into two cards that
// describe the same capability in slightly different words.

/// The connector URL a person pastes into Claude. Built from SITE_URL so
/// it can never drift from the canonical host (docs/adr/0002) - the
/// apex-to-www redirect would otherwise send someone down an OAuth flow
/// whose `resource` does not match what they typed.
export const MCP_CONNECTOR_URL = `${SITE_URL}/api/mcp`;

/// Where the how-to lives. Deliberately the shared in-app guide and not
/// copy inside this card: the guide is the one place every role can
/// reach, it is already the standing home for "how does this screen
/// work" (docs/adr/0001 section 10), and duplicating setup steps here
/// would create a second copy to keep in sync.
export const MCP_GUIDE_HREF = "/app/guide#mcp-claude";

type Format = ReturnType<typeof useFormatter>;

// ADR 0006: dates in the reader's locale and time zone (i18n/request.ts).
function toGrantRow(grant: ClaudeConnectionStatus["grants"][number], format: Format): GrantRow {
  return {
    id: grant.id,
    label: grant.label,
    expiresLabel: grant.expiresAt ? format.dateTime(grant.expiresAt, { dateStyle: "medium" }) : null,
    isBridge: grant.kind === "PAT",
  };
}

export function ClaudeConnectionCard({
  status,
  orgSummary,
}: {
  status: ClaudeConnectionStatus;
  orgSummary?: ClaudeOrgSummary | null;
}) {
  const t = useTranslations("claude");
  const format = useFormatter();
  const lastUsedLabel = status.lastUsedAt ? format.dateTime(status.lastUsedAt, { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className="rounded-2xl border border-app-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-app-text-primary">Claude</h2>
          <p className="mt-0.5 text-xs text-app-text-tertiary">Model Context Protocol</p>
        </div>
        <StatusBadge
          label={status.connected ? t("connected") : t("notConnected")}
          tone={status.connected ? "green" : "gray"}
        />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-app-text-secondary">
        {status.connected ? t("connectedIntro") : t("notConnectedIntro")}
      </p>

      {status.connected ? (
        <dl className="mt-4 space-y-2 border-t border-app-border pt-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-app-text-tertiary">{t("activeConnections")}</dt>
            <dd className="font-medium text-app-text-primary">{status.grants.length}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-app-text-tertiary">{t("lastActivity")}</dt>
            <dd className="font-medium text-app-text-primary">{lastUsedLabel ?? t("neverUsed")}</dd>
          </div>
          {/* Listed one by one because "two connections" with no way to
              tell them apart is not actionable - a person revoking an old
              laptop needs to know which is which, and now has a button to
              act on the answer. Dates are formatted here, on the server,
              so the client half never needs its own opinion about
              timezones. */}
          <div className="pt-1">
            <dt className="sr-only">{t("connectionList")}</dt>
            <dd>
              <ClaudeGrantList grants={status.grants.map((g) => toGrantRow(g, format))} />
            </dd>
          </div>
        </dl>
      ) : (
        <div className="mt-4 space-y-2 border-t border-app-border pt-4">
          <p className="text-xs font-medium text-app-text-tertiary">{t("connectorUrl")}</p>
          <CopyValue value={MCP_CONNECTOR_URL} label={t("copyConnectorUrl")} />
        </div>
      )}

      {orgSummary && (
        <p className="mt-4 rounded-lg bg-app-surface-sunken px-3 py-2 text-xs text-app-text-secondary">
          {t("orgSummary", { connected: orgSummary.connectedUsers, eligible: orgSummary.eligibleUsers })}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Link href={MCP_GUIDE_HREF} className="text-sm font-medium text-app-text-accent hover:underline">
          {t("howTo")}
        </Link>
        {/* The card now owns disconnection (the "ניתוק" button on each
            row above), so this line no longer has to stand in for a
            missing control - it just names the other paths that also end
            a grant, which people do still run into. */}
        {status.connected && (
          <span className="text-xs text-app-text-tertiary">
            {t("revokeNote")}
          </span>
        )}
      </div>
    </div>
  );
}
