import Link from "next/link";
import { SITE_URL } from "@/lib/site";
import { StatusBadge } from "@/components/app/StatusBadge";
import { CopyValue } from "@/components/app/CopyValue";
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

function formatDateTime(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem",
  }).format(date);
}

function formatDate(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
}

export function ClaudeConnectionCard({
  status,
  orgSummary,
}: {
  status: ClaudeConnectionStatus;
  orgSummary?: ClaudeOrgSummary | null;
}) {
  const lastUsedLabel = formatDateTime(status.lastUsedAt);

  return (
    <div className="rounded-2xl border border-lineDark bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-appNavy">Claude</h2>
          <p className="mt-0.5 text-xs text-appNavy/50">Model Context Protocol</p>
        </div>
        <StatusBadge
          label={status.connected ? "מחובר" : "לא מחובר"}
          tone={status.connected ? "green" : "gray"}
        />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-appNavy/60">
        {status.connected
          ? "Claude מחובר לחשבון שלכם ויכול להפעיל טיימר, לדווח זמן ולקרוא את הדיווחים שלכם - תמיד בהרשאות שלכם בלבד."
          : "אפשר לחבר את Claude לחשבון שלכם ולנהל דיווחי זמן בשיחה - להפעיל טיימר, לסגור אותו ולדווח שעות, בלי לפתוח את המערכת."}
      </p>

      {status.connected ? (
        <dl className="mt-4 space-y-2 border-t border-lineDark pt-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-appNavy/50">חיבורים פעילים</dt>
            <dd className="font-medium text-appNavy">{status.grants.length}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-appNavy/50">פעילות אחרונה</dt>
            <dd className="font-medium text-appNavy">{lastUsedLabel ?? "טרם היה שימוש"}</dd>
          </div>
          {/* Listed one by one because "two connections" with no way to
              tell them apart is not actionable - a person revoking an old
              laptop needs to know which is which. */}
          <div className="pt-1">
            <dt className="sr-only">רשימת החיבורים</dt>
            <dd>
              <ul className="space-y-1.5">
                {status.grants.map((grant, i) => {
                  const expires = formatDate(grant.expiresAt);
                  return (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-xs text-appNavy/60">
                      <span className="font-medium text-appNavy/80">
                        {grant.label}
                        {grant.kind === "PAT" ? " (גשר מקומי)" : ""}
                      </span>
                      {expires && <span>בתוקף עד {expires}</span>}
                    </li>
                  );
                })}
              </ul>
            </dd>
          </div>
        </dl>
      ) : (
        <div className="mt-4 space-y-2 border-t border-lineDark pt-4">
          <p className="text-xs font-medium text-appNavy/50">כתובת החיבור</p>
          <CopyValue value={MCP_CONNECTOR_URL} label="העתקת כתובת החיבור" />
        </div>
      )}

      {orgSummary && (
        <p className="mt-4 rounded-lg bg-appNavy/[0.03] px-3 py-2 text-xs text-appNavy/60">
          {orgSummary.connectedUsers} מתוך {orgSummary.eligibleUsers} משתמשי Ankora חיברו את Claude לחשבון שלהם.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Link href={MCP_GUIDE_HREF} className="text-sm font-medium text-gold-dim hover:underline">
          איך מחברים את Claude →
        </Link>
        {/* Deliberately precise about what actually revokes a grant
            today: there is no self-service "disconnect" button in this
            app yet, and implying one would send people looking for a
            control that does not exist. Changing your own password bumps
            tokenVersion (lib/app-domain/profile.ts) and so does kill the
            grant - that IS the self-service path, it is just not named
            like one. */}
        {status.connected && (
          <span className="text-xs text-appNavy/50">
            לניתוק - הסירו את המחבר ב-Claude. גם שינוי סיסמה מבטל את החיבור מיידית.
          </span>
        )}
      </div>
    </div>
  );
}
