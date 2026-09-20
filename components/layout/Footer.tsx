import Link from "next/link";
import Image from "next/image";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";

/**
 * Site footer, shared by both locales: the wordmark and tagline, three link columns,
 * then a bottom bar with the copyright and the city.
 *
 * The previous Hebrew variant hardcoded `dir="rtl"` on the element. That was harmless
 * while it only ever rendered on /he; with one footer for both languages it would have
 * forced the English footer right-to-left. Direction comes from <html> and nothing
 * here overrides it.
 *
 * The "about" column deliberately omits a link to /about itself and the "Ankora"
 * column omits /personal-assistant-for-executives, /blog and /contact, following the
 * design's own column lists. That was raised as an IA change rather than decided
 * quietly, and it stands.
 */
const LINK = "text-[0.98rem] font-light text-[#93A5B8] transition-colors duration-200 hover:text-gold";
const COLUMN_HEAD = "mb-3.5 font-assistant text-[13px] font-semibold tracking-[0.04em] text-gold rtl:tracking-normal";

export function Footer({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const year = new Date().getFullYear();

  return (
    <footer className="relative z-[1] border-t border-[rgba(243,234,219,0.12)] bg-inkDeep font-assistant text-[#93A5B8]">
      <div
        className="mx-auto grid max-w-wide gap-[clamp(24px,4vw,52px)] px-[clamp(18px,4vw,32px)] py-[clamp(36px,5vw,62px)]"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}
      >
        <div>
          {/* py/-my pair: the mark is 22px and the row came out 23px tall, a pixel
            under the minimum, without changing where the wordmark sits. */}
          <Link
            href={withLocale(locale, "/")}
            className="mb-4 flex items-center gap-2.5 py-[3px] -my-[3px]"
            aria-label="Ankora"
          >
            <Image
              src="/logo-mark-gold.png"
              alt=""
              width={22}
              height={22}
              className="block h-[22px] w-[22px] object-contain"
            />
            <span className="text-[15px] font-light tracking-[0.3em] text-cream ps-[0.3em]">ANKORA</span>
          </Link>
          <p className="max-w-xs text-[0.98rem] font-light leading-relaxed text-[#8798AB]">
            {dict.footer.tagline}
          </p>
        </div>

        <div>
          <div className={COLUMN_HEAD}>{dict.nav.solutions}</div>
          <div className="grid gap-2">
            {dict.nav.solutionsMenu.map((item) => (
              <Link key={item.href} href={withLocale(locale, item.href)} className={LINK}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <div className={COLUMN_HEAD}>{dict.nav.about}</div>
          <div className="grid gap-2">
            <Link href={withLocale(locale, "/how-it-works")} className={LINK}>{dict.nav.howItWorks}</Link>
            <Link href={withLocale(locale, "/technology")} className={LINK}>{dict.nav.technology}</Link>
            <Link href={withLocale(locale, "/pricing")} className={LINK}>{dict.nav.pricing}</Link>
            <Link href={withLocale(locale, "/roi")} className={LINK}>{dict.nav.roi}</Link>
            <Link href={withLocale(locale, "/coverage")} className={LINK}>{dict.nav.coverage}</Link>
          </div>
        </div>

        <div>
          <div className={COLUMN_HEAD}>Ankora</div>
          <div className="grid gap-2">
            <Link href={withLocale(locale, "/personal-operations-management")} className={LINK}>
              {dict.nav.personalOperationsManagement}
            </Link>
            <Link href={withLocale(locale, "/ankora-vs-personal-assistant")} className={LINK}>
              {dict.nav.ankoraVsPersonalAssistant}
            </Link>
            <Link href={withLocale(locale, "/privacy")} className={LINK}>{dict.footer.privacy}</Link>
            <Link href={withLocale(locale, "/terms")} className={LINK}>{dict.footer.terms}</Link>
          </div>
        </div>
      </div>

      <div className="border-t border-[rgba(243,234,219,0.1)]">
        <div className="mx-auto flex max-w-wide flex-wrap items-center justify-between gap-4 px-[clamp(18px,4vw,32px)] py-[18px] text-[12.5px] font-light text-[#8798AB]">
          <span>© {year} Ankora. {dict.footer.rights}.</span>
          <span>Tel Aviv, Israel</span>
        </div>
      </div>
    </footer>
  );
}
