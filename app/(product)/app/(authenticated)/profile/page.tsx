import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { PASSWORD_MIN_LENGTH } from "@/lib/app-auth/password";
import { getLastPasswordChangeAt } from "@/lib/app-domain/profile";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { TimezoneForm } from "./TimezoneForm";
import { LanguageForm } from "./LanguageForm";
import { NameForm } from "./NameForm";
import { WhatsappForm } from "./WhatsappForm";
import { DailyDigestPreferenceForm, NotificationPreferenceForm } from "./NotificationPreferenceForm";
import { getMyClaudeConnection } from "@/lib/app-domain/mcp-connections";
import { ClaudeConnectionCard } from "@/components/app/ClaudeConnectionCard";
import { listMyPasskeys } from "@/lib/app-auth/passkeys";
import { passwordStepUpAllowed } from "@/lib/app-auth/step-up";
import { PasskeysCard } from "./PasskeysCard";
import { secondFactorRequired } from "@/lib/app-auth/second-factor";

export const metadata = { robots: { index: false, follow: false } };

// Same initials() shape as users/page.tsx (two characters, no attempt at
// first+last-name splitting - matches how that screen already renders an
// avatar circle for every user in the Users list).
function initials(name: string): string {
  return name.trim().slice(0, 2);
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

  // Passkeys are everyone's since two-step sign-in (16.10.2026): the
  // second step of signing in for staff, an opt-in for clients, and the
  // vault's identity check on top of that for staff.
  const showPasskeys = true;

  const [lastPasswordChangeAt, claude, passkeys] = await Promise.all([
    getLastPasswordChangeAt(user),
    showClaudeCard ? getMyClaudeConnection(user) : Promise.resolve(null),
    showPasskeys ? listMyPasskeys(user) : Promise.resolve([]),
  ]);
  // ADR 0006: dates in the person's locale and time zone (i18n/request.ts).
  const t = await getTranslations("profile");
  const format = await getFormatter();
  const formatDate = (date: Date) => format.dateTime(date, { dateStyle: "medium" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
        <p className="mt-1 text-sm text-app-text-secondary">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-2xl border border-app-border bg-white p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-gold/16 text-base font-medium text-app-text-accent">
                {initials(user.name)}
              </span>
              <div className="min-w-0">
                <p dir="auto" className="truncate text-base font-medium text-app-text-primary">{user.name}</p>
                <p dir="ltr" className="truncate text-page-start text-xs text-app-text-tertiary">
                  {user.email}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-5 border-t border-app-border pt-5">
              <NameForm name={user.name} />
              <TimezoneForm timezone={user.timezone} />
              {/* ADR 0006: everyone, client users included, since the
                  portal is translated (12.11.2026). The interface comes from
                  the dictionary, not from AI, so a client marked "No AI" may
                  choose English too. */}
              <LanguageForm locale={user.locale} />
              {/* Staff only: it is what a colleague's "שיתוף" on a task
                  reaches. A client's number lives on the client. */}
              {user.role !== "CLIENT_USER" && <WhatsappForm whatsappNumber={user.whatsappNumber} />}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-app-border bg-white p-6">
            <h2 className="mb-3 text-sm font-medium text-app-text-primary">{t("notificationsTitle")}</h2>
            <div className="divide-y divide-app-border">
              <DailyDigestPreferenceForm enabled={user.dailyDigestByEmail} />
              <div className="pt-3">
                <NotificationPreferenceForm enabled={user.notifyLongRunningTimerByEmail} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-app-border bg-white p-6">
            <h2 className="mb-3 text-sm font-medium text-app-text-primary">{t("password.title")}</h2>
            <ChangePasswordForm
              minLength={PASSWORD_MIN_LENGTH}
              lastChangedLabel={
                lastPasswordChangeAt ? t("password.lastChanged", { date: formatDate(lastPasswordChangeAt) }) : null
              }
            />
          </div>

          {showPasskeys && (
            <PasskeysCard
              audience={user.role === "CLIENT_USER" ? "client" : "staff"}
              loginRequired={user.role === "CLIENT_USER" ? user.loginPasskeyRequired : secondFactorRequired(user)}
              required={!passwordStepUpAllowed()}
              passkeys={passkeys.map((p) => ({
                id: p.id,
                name: p.name,
                createdAt: formatDate(p.createdAt),
                lastUsedAt: p.lastUsedAt ? formatDate(p.lastUsedAt) : null,
                backedUp: p.backedUp,
              }))}
            />
          )}

          {claude && <ClaudeConnectionCard status={claude} />}
        </div>
      </div>
    </div>
  );
}
