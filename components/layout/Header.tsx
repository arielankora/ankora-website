"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { LanguageToggle } from "@/components/layout/LanguageToggle";

/**
 * Site header: sticky, translucent navy over a 14px blur, one hairline along the
 * bottom.
 *
 * One header for both languages. The English side used to carry a "Who it's for"
 * dropdown that Hebrew had already dropped, which meant the two locales had different
 * internal link graphs — the four segment routes stay reachable from the footer's
 * "who it's for" column and from the home page's own cards, in both languages.
 *
 * The nav is a flat list of six, collapsing to a 44x44 burger below lg.
 */
function navLinks(dict: Dictionary) {
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock background scroll while the drawer is open. Without this the page behind
  // the fixed drawer still scrolls (notably on iOS Safari), leaving gaps where the
  // underlying page shows through the menu.
  useEffect(() => {
    if (!mobileOpen) return;
    const scrollY = window.scrollY;
    const { style } = document.body;
    const prev = {
      position: style.position,
      top: style.top,
      left: style.left,
      right: style.right,
      width: style.width,
    };
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

  // Escape closes the drawer — it is a modal surface and should behave like one.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const links = navLinks(dict);

  const mobileMenu =
    mounted &&
    createPortal(
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ y: -16 }}
            animate={{ y: 0 }}
            exit={{ y: -16 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[60] flex flex-col bg-ink px-6 py-6 lg:hidden"
            style={{ backgroundColor: "#0B1B33", opacity: 1 }}
          >
            <div className="flex items-center justify-between">
              <span className="font-assistant text-base font-light tracking-[0.3em] text-cream">
                ANKORA
              </span>
              <button
                aria-label="Close"
                onClick={() => setMobileOpen(false)}
                className="flex h-11 w-11 items-center justify-center"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M1 1L17 17M1 17L17 1" stroke="#F8F4EC" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
            <nav className="mt-12 flex flex-col gap-7">
              {links.map((item) => (
                <Link
                  key={item.href}
                  href={withLocale(locale, item.href)}
                  onClick={() => setMobileOpen(false)}
                  className="text-2xl font-light text-paper"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-5">
              <LanguageToggle locale={locale} />
              <Link
                href={withLocale(locale, "/contact")}
                onClick={() => setMobileOpen(false)}
                className="flex min-h-[44px] items-center justify-center border border-gold bg-gold px-6 py-3 font-assistant text-[15px] font-medium text-ink"
              >
                {dict.nav.cta}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    );

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-[rgba(243,234,219,0.1)] bg-[rgba(11,27,51,0.72)] font-assistant backdrop-blur-[14px]">
        <div className="mx-auto flex max-w-wide items-center gap-8 px-[clamp(18px,4vw,32px)] py-[18px]">
          <Link
            href={withLocale(locale, "/")}
            className="flex flex-none items-center gap-[11px]"
            aria-label="Ankora"
          >
            <Image
              src="/logo-mark-gold.png"
              alt=""
              width={30}
              height={30}
              priority
              className="block h-[30px] w-[30px] object-contain"
            />
            {/* Latin wordmark, so the .3em tracking stays in both locales. The matching
                padding-inline-start balances the trailing letter-space the tracking
                adds after the final A. */}
            <span className="font-light text-base tracking-[0.3em] text-cream ps-[0.3em]">
              ANKORA
            </span>
          </Link>

          <nav className="hidden flex-1 flex-nowrap items-center gap-[clamp(10px,1.8vw,26px)] whitespace-nowrap text-[14.5px] font-light text-tone-muted lg:flex">
            {links.map((item) => (
              <Link
                key={item.href}
                href={withLocale(locale, item.href)}
                // px/-mx pair: the shortest Hebrew item ("בלוג") is 23px wide, a
                // pixel under the 24x24 minimum. The negative margin keeps the nav's
                // own spacing exactly as designed.
                className="border-b border-transparent px-[5px] pb-[3px] -mx-[5px] transition-colors duration-[250ms] hover:border-gold hover:text-paper"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ms-auto hidden items-center gap-[18px] lg:flex">
            <LanguageToggle locale={locale} />
            <Link
              href={withLocale(locale, "/contact")}
              className="whitespace-nowrap border border-[rgba(176,141,87,0.5)] bg-[rgba(176,141,87,0.08)] px-[22px] py-[11px] text-[14.5px] font-medium text-paper transition-colors duration-300 hover:border-gold hover:bg-gold hover:text-ink"
            >
              {dict.nav.cta}
            </Link>
          </div>

          <button
            aria-label="Menu"
            aria-expanded={mobileOpen}
            className="ms-auto flex h-11 w-11 items-center justify-center lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <svg width="22" height="14" viewBox="0 0 22 14" fill="none" aria-hidden="true">
              <path d="M0 1H22M0 7H22M0 13H22" stroke="#F8F4EC" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
      </header>
      {mobileMenu}
    </>
  );
}
