import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/app-auth/session";
import { resolveRequestLocale } from "@/lib/i18n/resolve";
import { GUIDE_GROUPS as GUIDE_HE } from "./content";
import { GUIDE_GROUPS as GUIDE_EN } from "./content.en";
import { GuideBrowser } from "./GuideBrowser";

export const metadata = { robots: { index: false, follow: false } };

export default async function GuidePage() {
  await requireUser();
  const t = await getTranslations("guide.page");
  // The guide is long prose, so it is two whole files rather than
  // dictionary keys (ADR 0006): content.ts in Hebrew, content.en.ts in
  // English, kept section for section by tests/unit/guide-content-parity.
  const { locale } = await resolveRequestLocale();
  const groups = locale === "en" ? GUIDE_EN : GUIDE_HE;

  return (
    <>
      <div className="space-y-10">
        <div>
          <h1 className="text-xl font-medium text-app-text-primary">{t("title")}</h1>
          <p className="mt-1 text-sm text-app-text-secondary">{t("subtitle")}</p>
        </div>

        {/* App redesign (handoff README, screen 18): dark intro card matching
            the redesign's visual language elsewhere (e.g. AuthShell's dark
            column). The prototype's own version of this card has fabricated
            "three rules" copy (start a timer / write a note / stop it) that
            doesn't match how this guide actually works - the real guide
            below is a full reference organized by role and topic, not a
            three-step onboarding flow - so the text here describes the real
            thing instead of reproducing an invented pitch. */}
        <div className="rounded-2xl bg-navy p-6 text-cream-warm sm:p-8">
          <p className="text-base font-medium text-white">{t("introTitle")}</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream-warm/70">{t("introBody")}</p>
        </div>

        <GuideBrowser groups={groups} />
      </div>
    </>
  );
}
