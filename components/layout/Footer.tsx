import Link from "next/link";
import Image from "next/image";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";

// /he redesign footer, per design_handoff_ankora_redesign/design-files/Site Footer.dc.html.
// Note the spec's "אודות" column and "Ankora" column omit a few links present in the
// current /en-shared footer (about page itself, personal-assistant-for-executives, blog,
// contact) — kept here exactly as specced and flagged to Ariel in the Stage 1 report as
// an IA change, not silently decided.
function HeFooter({ dict, locale, year }: { dict: Dictionary; locale: Locale; year: number }) {
  return (
    <footer
      dir="rtl"
      className="relative z-[1] border-t border-[rgba(243,234,219,0.12)] bg-[rgba(8,20,38,0.78)] font-assistant text-[#93A5B8] backdrop-blur-[16px]"
    >
      <div
        className="mx-auto grid max-w-wide gap-[clamp(24px,4vw,52px)] px-[clamp(18px,4vw,56px)] py-[clamp(36px,5vw,62px)]"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}
      >
        <div>
          <div className="mb-3 flex items-center">
            <Image src="/logo-cream.jpg" alt="Ankora" width={36} height={36} />
          </div>
          <p className="max-w-xs text-[0.98rem] font-light leading-relaxed text-[#8798AB]">{dict.footer.tagline}</p>
        </div>

        <div>
          <div className="mb-3.5 text-[13px] font-semibold tracking-[0.04em] text-gold">{dict.nav.solutions}</div>
          <div className="grid gap-2 text-[0.98rem] font-light">
            {dict.nav.solutionsMenu.map((item) => (
              <Link key={item.href} href={withLocale(locale, item.href)} className="text-[#93A5B8] transition-colors hover:text-gold">
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-3.5 text-[13px] font-semibold tracking-[0.04em] text-gold">{dict.nav.about}</div>
          <div className="grid gap-2 text-[0.98rem] font-light">
            <Link href={withLocale(locale, "/how-it-works")} className="text-[#93A5B8] transition-colors hover:text-gold">{dict.nav.howItWorks}</Link>
            <Link href={withLocale(locale, "/technology")} className="text-[#93A5B8] transition-colors hover:text-gold">{dict.nav.technology}</Link>
            <Link href={withLocale(locale, "/pricing")} className="text-[#93A5B8] transition-colors hover:text-gold">{dict.nav.pricing}</Link>
            <Link href={withLocale(locale, "/roi")} className="text-[#93A5B8] transition-colors hover:text-gold">{dict.nav.roi}</Link>
            <Link href={withLocale(locale, "/coverage")} className="text-[#93A5B8] transition-colors hover:text-gold">{dict.nav.coverage}</Link>
          </div>
        </div>

        <div>
          <div className="mb-3.5 text-[13px] font-semibold tracking-[0.04em] text-gold">Ankora</div>
          <div className="grid gap-2 text-[0.98rem] font-light">
            <Link href={withLocale(locale, "/personal-operations-management")} className="text-[#93A5B8] transition-colors hover:text-gold">{dict.nav.personalOperationsManagement}</Link>
            <Link href={withLocale(locale, "/ankora-vs-personal-assistant")} className="text-[#93A5B8] transition-colors hover:text-gold">{dict.nav.ankoraVsPersonalAssistant}</Link>
            <Link href={withLocale(locale, "/privacy")} className="text-[#93A5B8] transition-colors hover:text-gold">{dict.footer.privacy}</Link>
            <Link href={withLocale(locale, "/terms")} className="text-[#93A5B8] transition-colors hover:text-gold">{dict.footer.terms}</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-[rgba(243,234,219,0.1)]">
        <div className="mx-auto flex max-w-wide flex-wrap items-center justify-between gap-4 px-[clamp(18px,4vw,56px)] py-[18px] text-[12.5px] font-light text-[#8798AB]">
          <span>© {year} Ankora. {dict.footer.rights}.</span>
          <span>Tel Aviv, Israel</span>
        </div>
      </div>
    </footer>
  );
}

export function Footer({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const year = new Date().getFullYear();

  if (locale === "he") {
    return <HeFooter dict={dict} locale={locale} year={year} />;
  }

  return (
    <footer className="border-t border-line bg-ink">
      <Container className="grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center">
            <Image src="/logo-cream.jpg" alt="Ankora" width={56} height={56} />
          </div>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-paper/50">{dict.footer.tagline}</p>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/40">{dict.nav.solutions}</span>
          {dict.nav.solutionsMenu.map((item) => (
            <Link key={item.href} href={withLocale(locale, item.href)} className="text-sm text-paper/70 hover:text-gold-light">
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/40">{dict.nav.about}</span>
          <Link href={withLocale(locale, "/how-it-works")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.howItWorks}</Link>
          <Link href={withLocale(locale, "/technology")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.technology}</Link>
          <Link href={withLocale(locale, "/about")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.about}</Link>
          <Link href={withLocale(locale, "/pricing")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.pricing}</Link>
          <Link href={withLocale(locale, "/roi")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.roi}</Link>
          <Link href={withLocale(locale, "/coverage")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.coverage}</Link>
          <Link href={withLocale(locale, "/blog")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.blog}</Link>
          <Link href={withLocale(locale, "/contact")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.cta}</Link>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/40">Ankora</span>
          <Link href={withLocale(locale, "/personal-operations-management")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.personalOperationsManagement}</Link>
          <Link href={withLocale(locale, "/personal-assistant-for-executives")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.personalAssistantForExecutives}</Link>
          <Link href={withLocale(locale, "/ankora-vs-personal-assistant")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.ankoraVsPersonalAssistant}</Link>
          <Link href={withLocale(locale, "/privacy")} className="text-sm text-paper/70 hover:text-gold-light">{dict.footer.privacy}</Link>
          <Link href={withLocale(locale, "/terms")} className="text-sm text-paper/70 hover:text-gold-light">{dict.footer.terms}</Link>
        </div>
      </Container>
      <Container className="flex flex-col gap-2 border-t border-line py-6 text-xs text-paper/35 md:flex-row md:items-center md:justify-between">
        <span>© {year} Ankora. {dict.footer.rights}.</span>
        <span>Tel Aviv, Israel</span>
      </Container>
    </footer>
  );
}
