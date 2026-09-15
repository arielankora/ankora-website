"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { cn } from "@/lib/utils";

// Flat top-level links per design_handoff_ankora_redesign/design-files/Site Nav.dc.html —
// no Solutions dropdown in the redesigned /he nav (the 4 segment routes stay reachable via
// the footer's "עבור מי" column and in-page links). Flagged to Ariel in the Stage 1 report
// as an IA change, not a silent decision.
function heNavLinks(dict: Dictionary) {
  return [
    { href: "/how-it-works", label: dict.nav.howItWorks },
    { href: "/technology", label: dict.nav.technology },
    { href: "/about", label: dict.nav.about },
    { href: "/pricing", label: dict.nav.pricing },
    { href: "/roi", label: dict.nav.roi },
    { href: "/blog", label: dict.nav.blog },
  ];
}

export function Header({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const isHe = locale === "he";
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock background scroll while the mobile menu is open. Without this, the
  // page behind the fixed drawer can still scroll (notably on iOS Safari),
  // which leaves gaps where the underlying page shows through the menu.
  useEffect(() => {
    if (!mobileOpen) return;
    const scrollY = window.scrollY;
    const { style } = document.body;
    const prev = { position: style.position, top: style.top, left: style.left, right: style.right, width: style.width };
    style.position = "fixed";
    style.top = `-${scrollY}px`;
    style.left = "0";
    style.right = "0";
    style.width = "100%";
    return () => {
      style.position = prev.position;
      style.top = prev.top;
      style.left = prev.left;
      style.right = prev.right;
      style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [mobileOpen]);

  const mobileMenu = mounted &&
    createPortal(
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ y: -16 }}
            animate={{ y: 0 }}
            exit={{ y: -16 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[60] flex flex-col bg-ink px-6 py-6 lg:hidden"
            style={{ backgroundColor: "#0B1B33", opacity: 1 }}
          >
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-paper">ANKORA</span>
              <button aria-label="Close" onClick={() => setMobileOpen(false)} className="h-10 w-10">
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path d="M1 1L17 17M1 17L17 1" stroke="#F8F4EC" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
            <nav className="mt-12 flex flex-col gap-7">
              {(isHe
                ? heNavLinks(dict)
                : [
                    { label: dict.nav.solutions, href: "/solutions" },
                    { label: dict.nav.howItWorks, href: "/how-it-works" },
                    { label: dict.nav.technology, href: "/technology" },
                    { label: dict.nav.about, href: "/about" },
                    { label: dict.nav.pricing, href: "/pricing" },
                    { label: dict.nav.roi, href: "/roi" },
                    { label: dict.nav.blog, href: "/blog" },
                  ]
              ).map((item) => (
                <Link
                  key={item.href}
                  href={withLocale(locale, item.href)}
                  onClick={() => setMobileOpen(false)}
                  className="text-2xl font-medium text-paper"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-4">
              <Button href={withLocale(locale, "/contact")} className="w-full">
                {dict.nav.cta}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    );

  if (isHe) {
    return (
      <>
        <header
          className="sticky top-0 z-50 border-b border-[rgba(243,234,219,0.09)] bg-[rgba(11,27,51,0.62)] font-assistant backdrop-blur-[20px] [backdrop-filter:blur(20px)_saturate(1.2)]"
        >
          <div className="mx-auto flex max-w-wide items-center gap-[clamp(14px,3vw,44px)] px-[clamp(18px,4vw,56px)] py-[15px]">
            <Link href={withLocale(locale, "/")} className="flex shrink-0 items-center">
              <Image src="/logo-cream.jpg" alt="Ankora" width={40} height={40} />
            </Link>

            <nav className="hidden flex-1 flex-wrap items-center gap-[clamp(10px,1.8vw,26px)] text-[14.5px] lg:flex">
              {heNavLinks(dict).map((item) => (
                <Link
                  key={item.href}
                  href={withLocale(locale, item.href)}
                  className="text-[#B6C4D4] transition-colors hover:text-gold"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="hidden shrink-0 items-center gap-[14px] lg:flex">
              <Link
                href="/en"
                className="font-jbmono text-[12px] tracking-[0.1em] text-[#7C8EA3] transition-colors hover:text-gold"
              >
                EN
              </Link>
              <Link
                href={withLocale(locale, "/contact")}
                className="border border-[rgba(176,141,87,0.5)] bg-[rgba(176,141,87,0.08)] px-5 py-[11px] text-[14.5px] font-medium text-paper transition-colors duration-300 ease-out hover:border-gold hover:bg-gold hover:text-ink"
              >
                {dict.nav.cta}
              </Link>
            </div>

            <div className="flex items-center gap-3 lg:hidden">
              <button
                aria-label="Menu"
                className="flex h-10 w-10 items-center justify-center"
                onClick={() => setMobileOpen(true)}
              >
                <svg width="22" height="14" viewBox="0 0 22 14" fill="none">
                  <path d="M0 1H22M0 7H22M0 13H22" stroke="#F8F4EC" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
          </div>
        </header>
        {mobileMenu}
      </>
    );
  }

  return (
    <>
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled ? "bg-ink/90 backdrop-blur-md border-b border-line" : "bg-transparent"
      )}
    >
      <Container className="flex h-20 items-center justify-between">
        <Link href={withLocale(locale, "/")} className="flex items-center shrink-0">
          <Image src="/logo-cream.jpg" alt="Ankora" width={64} height={64} />
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          <div
            className="relative"
            onMouseEnter={() => setMenuOpen(true)}
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button className="flex items-center gap-1.5 text-[15px] text-paper/85 transition-colors hover:text-gold-light">
              {dict.nav.solutions}
              <svg width="10" height="6" viewBox="0 0 10 6" className={cn("transition-transform", menuOpen && "rotate-180")}>
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              </svg>
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18 }}
                  className="absolute top-full grid w-[560px] grid-cols-2 gap-1 rounded-2xl border border-line bg-navy/98 p-3 shadow-2xl backdrop-blur-xl start-1/2 -translate-x-1/2 rtl:translate-x-1/2"
                >
                  {dict.nav.solutionsMenu.map((item) => (
                    <Link
                      key={item.href}
                      href={withLocale(locale, item.href)}
                      className="rounded-xl p-4 transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="text-[15px] font-medium text-paper">{item.label}</div>
                      <div className="mt-1 text-sm text-paper/55">{item.blurb}</div>
                    </Link>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Link href={withLocale(locale, "/how-it-works")} className="text-[15px] text-paper/85 transition-colors hover:text-gold-light">
            {dict.nav.howItWorks}
          </Link>
          <Link href={withLocale(locale, "/technology")} className="text-[15px] text-paper/85 transition-colors hover:text-gold-light">
            {dict.nav.technology}
          </Link>
          <Link href={withLocale(locale, "/about")} className="text-[15px] text-paper/85 transition-colors hover:text-gold-light">
            {dict.nav.about}
          </Link>
          <Link href={withLocale(locale, "/pricing")} className="text-[15px] text-paper/85 transition-colors hover:text-gold-light">
            {dict.nav.pricing}
          </Link>
          <Link href={withLocale(locale, "/roi")} className="text-[15px] text-paper/85 transition-colors hover:text-gold-light">
            {dict.nav.roi}
          </Link>
          <Link href={withLocale(locale, "/blog")} className="text-[15px] text-paper/85 transition-colors hover:text-gold-light">
            {dict.nav.blog}
          </Link>
        </nav>

        <div className="hidden items-center gap-4 lg:flex">
          <LanguageToggle locale={locale} />
          <Button href={withLocale(locale, "/contact")} variant="primary" className="text-sm px-5 py-2.5">
            {dict.nav.cta}
          </Button>
        </div>

        <div className="flex items-center gap-3 lg:hidden">
          <LanguageToggle locale={locale} />
          <button
            aria-label="Menu"
            className="flex h-10 w-10 items-center justify-center"
            onClick={() => setMobileOpen(true)}
          >
            <svg width="22" height="14" viewBox="0 0 22 14" fill="none">
              <path d="M0 1H22M0 7H22M0 13H22" stroke="#F8F4EC" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
      </Container>

    </header>
      {mobileMenu}
    </>
  );
}
