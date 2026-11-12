import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/app/AuthShell";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// App redesign (handoff README, screen 17 "כניסה ושחזור סיסמה"): now built
// on the shared AuthShell (dark logo/positioning column + light form
// column). The privacy/terms links (Phase 8 addendum, spec 24's
// pre-production checklist) aren't in the prototype's own demo login
// screen, but they're a real compliance requirement this app already
// shipped - kept, just moved under the form instead of dropped.
export default async function LoginPage(props: {
  searchParams: Promise<{ passwordChanged?: string; callbackUrl?: string }>;
}) {
  const searchParams = await props.searchParams;
  const t = await getTranslations("auth.login");
  // The legal pages live on the marketing site, in both languages.
  const legal = await getLocale();
  return (
    <AuthShell>
      <p className="text-[22px] font-medium text-app-text-primary">{t("title")}</p>
      <p className="mb-6 mt-2 text-[13.5px] text-app-text-secondary">{t("subtitle")}</p>

      {searchParams.passwordChanged === "1" && (
        // Phase 9 gap-fix: app/(product)/app/profile's self-service
        // password change redirects here (it invalidates every session,
        // including the current one - see lib/app-domain/profile.ts).
        <p className="mb-5 rounded-[10px] border border-app-success/30 bg-app-success-soft px-3 py-2.5 text-center text-[12.5px] text-app-success">
          {t("passwordChanged")}
        </p>
      )}

      <LoginForm callbackUrl={searchParams.callbackUrl} />

      <p className="mt-8 text-center text-[11px] text-app-text-tertiary">
        <Link href={`/${legal}/privacy`} className="inline-block py-2 hover:text-app-text-secondary">
          {t("privacy")}
        </Link>
        {" · "}
        <Link href={`/${legal}/terms`} className="inline-block py-2 hover:text-app-text-secondary">
          {t("terms")}
        </Link>
      </p>
    </AuthShell>
  );
}
