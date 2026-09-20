import { requireUser } from "@/lib/app-auth/session";
import { getLastPasswordChangeAt } from "@/lib/app-domain/profile";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { TimezoneForm } from "./TimezoneForm";
import { NameForm } from "./NameForm";
import { NotificationPreferenceForm } from "./NotificationPreferenceForm";
import { getMyClaudeConnection } from "@/lib/app-domain/mcp-connections";
import { ClaudeConnectionCard } from "@/components/app/ClaudeConnectionCard";

export const metadata = { robots: { index: false, follow: false } };

// Same initials() shape as users/page.tsx (two characters, no attempt at
// first+last-name splitting - matches how that screen already renders an
// avatar circle for every user in the Users list).
function initials(name: string): string {
  return name.trim().slice(0, 2);
}

function formatPasswordChangedLabel(date: Date | null): string | null {
  if (!date) return null;
  const formatted = new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeZone: "Asia/Jerusalem" }).format(date);
  return `הסיסמה עודכנה לאחרונה ב-${formatted}`;
}

// App redesign (handoff README, screen 18 "פרופיל ומדריך שימוש"): two-
// column card layout - avatar/name/timezone on the right (RTL "start"),
// notifications/password on the left - replacing the old plain-text
// header + stacked bordered forms. No permission gate: every role,
// including CLIENT_USER, may reach this screen and edit only their own
// row (see lib/app-domain/profile.ts).
//
// Not reproduced from the prototype: a full list of notification-
// preference toggle rows (only one real preference exists behind this
// screen today - see NotificationPreferenceForm.tsx) and the prototype's
// fabricated "עודכנה לפני 3 חודשים" text (replaced with a real value
// computed from the audit trail, or omitted when there's no real change
// on record).
export default async function ProfilePage() {
  const user = await requireUser();

  // The Claude (MCP) grant is personal - it is this user's own
  // credential, with this user's own permissions - so this screen, not
  // the SUPER_ADMIN-only /app/integrations, is where most people will
  // ever see it. Both screens render the same card.
  //
  // Hidden from CLIENT_USER on purpose: none of the ten MCP tools
  // (lib/mcp/tools.ts) are reachable with that role, so offering the
  // connection to a client would be an invitation to a dead end.
  const showClaudeCard = user.role !== "CLIENT_USER";

  const [lastPasswordChangeAt, claude] = await Promise.all([
    getLastPasswordChangeAt(user),
    showClaudeCard ? getMyClaudeConnection(user) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-appNavy">הפרופיל שלי</h1>
        <p className="mt-1 text-sm text-appNavy/60">פרטים אישיים, אזור זמן, התראות וחיבורים.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-2xl border border-lineDark bg-white p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-gold/16 text-base font-medium text-gold-dim">
                {initials(user.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-medium text-appNavy">{user.name}</p>
                <p dir="ltr" className="truncate text-end text-xs text-appNavy/50">
                  {user.email}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-5 border-t border-lineDark pt-5">
              <NameForm name={user.name} />
              <TimezoneForm timezone={user.timezone} />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-lineDark bg-white p-6">
            <h2 className="mb-3 text-sm font-medium text-appNavy">התראות אישיות</h2>
            <NotificationPreferenceForm enabled={user.notifyLongRunningTimerByEmail} />
          </div>

          <div className="rounded-2xl border border-lineDark bg-white p-6">
            <h2 className="mb-3 text-sm font-medium text-appNavy">סיסמה</h2>
            <ChangePasswordForm lastChangedLabel={formatPasswordChangedLabel(lastPasswordChangeAt)} />
          </div>

          {claude && <ClaudeConnectionCard status={claude} />}
        </div>
      </div>
    </div>
  );
}
