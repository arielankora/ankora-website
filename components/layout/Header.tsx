"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { cn } from "@/lib/utils";

export function Header({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled ? "bg-ink/90 backdrop-blur-md border-b border-line" : "bg-transparent"
      )}
    >
      <Container className="flex h-20 items-center justify-between">
        <Link href={withLocale(locale, "/")} className="flex items-center gap-2.5 shrink-0">
          <Image src="/logo.png" alt="Ankora" width={48} height={48} className="rounded-full" />
          <span className="text-lg font-semibold tracking-tight text-paper">ANKORA</span>
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
        </nav>

        <div className="hidden items-center gap-4 lg:flex">
          <LanguageToggle locale={locale} />
          <Button href={withLocale(locale, "/contact")} variant="primary" className="text-sm px-5 py-2.5">
            {dict.nav.cta}
          </Button>
        </div>

        <button
          aria-label="Menu"
          className="flex h-10 w-10 items-center justify-center lg:hidden"
          onClick={() => setMobileOpen(true)}
        >
          <svg width="22" height="14" viewBox="0 0 22 14" fill="none">
            <path d="M0 1H22M0 7H22M0 13H22" stroke="#F7F5F0" strokeWidth="1.4" />
          </svg>
        </button>
      </Container>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col bg-ink px-6 py-6 lg:hidden"
          >
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-paper">ANKORA</span>
              <button aria-label="Close" onClick={() => setMobileOpen(false)} className="h-10 w-10">
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path d="M1 1L17 17M1 17L17 1" stroke="#F7F5F0" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
            <nav className="mt-12 flex flex-col gap-7">
              {[
                { label: dict.nav.solutions, href: "/solutions" },
                { label: dict.nav.howItWorks, href: "/how-it-works" },
                { label: dict.nav.technology, href: "/technology" },
                { label: dict.nav.about, href: "/about" },
              ].map((item) => (
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
              <LanguageToggle locale={locale} />
              <Button href={withLocale(locale, "/contact")} className="w-full">
                {dict.nav.cta}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
