import Link from "next/link";
import Image from "next/image";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";

export function Footer({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line bg-ink">
      <Container className="grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Ankora" width={40} height={40} className="rounded-full" />
            <span className="text-lg font-semibold text-paper">ANKORA</span>
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
          <Link href={withLocale(locale, "/contact")} className="text-sm text-paper/70 hover:text-gold-light">{dict.nav.cta}</Link>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/40">Ankora</span>
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
