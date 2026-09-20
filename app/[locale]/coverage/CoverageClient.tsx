"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { HairlineGrid } from "@/components/ui/HairlineGrid";
import { Button } from "@/components/ui/Button";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";
import { withLocale } from "@/lib/nav";
import { cn } from "@/lib/utils";

// The /en card background is light (bg-paper), so a translucent gold mark with dark-navy
// text reads clearly there. The /he redesign card background is dark, where that same
// translucent overlay on dark navy composites to a dark tone and text-navy on it fails
// contrast -- so /he passes a solid (not translucent) gold mark with dark-ink text instead,
// which measures ~5.6:1 against the card background (WCAG AA requires 4.5:1 for this size).
function highlight(text: string, query: string, markClassName = "bg-gold/30 text-navy"): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className={cn("rounded-sm px-0.5", markClassName)}>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/**
 * /he redesign coverage page (design_handoff_ankora_redesign/README.md, "10. Coverage":
 * 17 domain cards in a `minmax(min(100%, 320px), 1fr)` grid, title+description left,
 * gold-mono service count with `border-inline-start` on the right).
 *
 * Per Ariel's explicit instruction this is NOT a pure visual reskin of the /en accordion:
 * every category is a native <details>/<summary> element, and all service name/description
 * pairs are rendered unconditionally inside each <details>, at all times, even when closed --
 * stricter than /en, which only renders services once expanded. Disclosure is controlled
 * exclusively by the native `open` attribute, never by React state or aria-hidden, so the
 * full 141-service catalogue is always present in the server-rendered HTML for crawlers.
 * The closed <summary> is styled to match the spec's card look; opening it reveals the
 * services list below using the same rotating-45deg "+" glyph already established in the
 * FAQ component (see FAQ.tsx / PageFAQ.tsx), via Tailwind's `group-open:` variant.
 */
function HeCoverageClient({ locale, dict }: { locale: Locale; dict: ReturnType<typeof getDictionary> }) {
  const p = dict.pages.coverage;
  const [query, setQuery] = useState("");
  // Tracks which categories the visitor opened by hand. Search always forces every
  // matching category open (see `open={isSearching || openNames.has(cat.name)}` below);
  // this set only matters once the query is cleared again, so the visitor's own choices
  // aren't lost when a search ends.
  const [openNames, setOpenNames] = useState<Set<string>>(new Set());

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  // Same matching logic as /en: search category name/description first, then fall back to
  // searching each service's name/description, keeping only the services that matched when
  // the category itself didn't. A category with any matching service stays in the results.
  const filteredCategories = useMemo(() => {
    if (!isSearching) return p.categories;
    return p.categories
      .map((cat) => {
        const catMatches =
          cat.name.toLowerCase().includes(normalizedQuery) || cat.description.toLowerCase().includes(normalizedQuery);
        const services = cat.services.filter(
          (s) =>
            catMatches ||
            s.name.toLowerCase().includes(normalizedQuery) ||
            s.description.toLowerCase().includes(normalizedQuery)
        );
        return { ...cat, services };
      })
      .filter((cat) => cat.services.length > 0);
  }, [p.categories, normalizedQuery, isSearching]);

  const matchServiceCount = useMemo(
    () => filteredCategories.reduce((sum, c) => sum + c.services.length, 0),
    [filteredCategories]
  );

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />

      <section className="pb-[clamp(40px,6vw,88px)]">
        <WideContainer>
          <Reveal>
            <p className="max-w-[86ch] border-t border-[rgba(243,234,219,0.12)] pt-[clamp(20px,2.6vw,30px)] text-[1rem] font-light leading-[1.85] text-[#93A5B8]">
              {p.intro}
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <GlassPanel
              elevated
              className="mt-[clamp(18px,2.4vw,28px)] flex flex-wrap items-center justify-between gap-[clamp(14px,2vw,28px)] px-[clamp(18px,2.4vw,26px)] py-[clamp(16px,2vw,22px)]"
            >
              <div className="flex min-w-0 flex-1 basis-[260px] items-center gap-3">
                <span className="h-1.5 w-1.5 shrink-0 bg-gold" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={p.searchPlaceholder}
                  className="min-w-0 flex-1 border-0 border-b border-[rgba(243,234,219,0.22)] bg-transparent py-2 text-[15.5px] font-light text-paper outline-none transition-colors duration-[250ms] placeholder:text-[#7C8EA3] focus:border-gold"
                />
                {isSearching && (
                  <button
                    onClick={() => setQuery("")}
                    aria-label="נקה חיפוש"
                    className="shrink-0 text-[#7C8EA3] transition-colors hover:text-gold"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14">
                      <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="flex items-baseline gap-[clamp(16px,2.4vw,30px)]">
                <span className="text-sm font-light text-[#93A5B8]">
                  <span className="font-jbmono text-paper">{filteredCategories.length}</span> {p.areaCountLabel}
                </span>
                <span className="text-sm font-light text-[#93A5B8]">
                  <span className="font-jbmono text-paper">{matchServiceCount}</span> {p.serviceCountLabel}
                </span>
              </div>
            </GlassPanel>
          </Reveal>

          {filteredCategories.length === 0 ? (
            <Reveal delay={0.1}>
              <div className="border border-[rgba(243,234,219,0.12)] px-[clamp(24px,3.4vw,40px)] py-[clamp(24px,3.4vw,40px)] text-center">
                <p className="mx-auto max-w-md text-[1.06rem] font-light leading-[1.7] text-[#A9B8C9]">
                  {p.searchNoResults}
                </p>
                {p.emptyStateCta && (
                  <Link
                    href={withLocale(locale, "/contact")}
                    className="mt-5 inline-block border border-[rgba(176,141,87,0.5)] bg-[rgba(176,141,87,0.1)] px-[26px] py-[13px] text-[15px] font-semibold text-paper transition-colors duration-300 hover:bg-gold hover:text-ink"
                  >
                    {p.emptyStateCta}
                  </Link>
                )}
              </div>
            </Reveal>
          ) : (
            <RevealStagger>
              <HairlineGrid minCell={320}>
                {filteredCategories.map((cat) => (
                  <motion.details
                    key={cat.name}
                    variants={staggerItem}
                    open={isSearching || openNames.has(cat.name)}
                    onToggle={(e) => {
                      // Search forces categories open (see `open` above); ignore the toggle
                      // events that generates so we don't overwrite the visitor's own state.
                      if (isSearching) return;
                      const isOpen = (e.target as HTMLDetailsElement).open;
                      setOpenNames((prev) => {
                        const next = new Set(prev);
                        if (isOpen) next.add(cat.name);
                        else next.delete(cat.name);
                        return next;
                      });
                    }}
                    className="group bg-[rgba(11,27,51,0.5)] backdrop-blur-[12px] [&_summary::-webkit-details-marker]:hidden [&_summary::marker]:content-none"
                  >
                    <summary className="flex cursor-pointer list-none items-start gap-[18px] p-[clamp(22px,2.8vw,32px)] transition-colors duration-[350ms] ease-out hover:bg-[rgba(176,141,87,0.08)]">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[clamp(1.16rem,1.5vw,1.38rem)] font-normal text-paper">
                          {highlight(cat.name, normalizedQuery, "bg-gold text-ink")}
                        </h3>
                        <p className="mt-2.5 text-[1.02rem] font-light leading-[1.65] text-[#A9B8C9]">
                          {cat.description}
                        </p>
                      </div>
                      <div className="shrink-0 border-s border-[rgba(243,234,219,0.12)] ps-4 text-center">
                        <div className="font-jbmono text-[1.3rem] leading-none text-gold">{cat.services.length}</div>
                        <div className="mt-1.5 text-[11px] font-light text-[#7C8EA3]">{p.serviceCountLabel}</div>
                      </div>
                      <span className="ms-1 shrink-0 text-xl leading-none text-gold transition-transform duration-[250ms] ease-out group-open:rotate-45">
                        +
                      </span>
                    </summary>

                    {/* Services stay unconditionally rendered in the DOM here -- only the
                        native `open` attribute controls visual disclosure, so all 141
                        service name/description pairs are crawlable even when closed. */}
                    <div className="border-t border-[rgba(243,234,219,0.12)] px-[clamp(22px,2.8vw,32px)] pb-[clamp(22px,2.8vw,32px)] pt-1">
                      <div className="divide-y divide-[rgba(243,234,219,0.12)]">
                        {cat.services.map((s) => (
                          <div key={s.name} className="py-3.5">
                            <div className="text-sm font-medium text-paper">
                              {highlight(s.name, normalizedQuery, "bg-gold text-ink")}
                            </div>
                            <div className="mt-1 text-xs leading-relaxed text-[#7C8EA3]">
                              {highlight(s.description, normalizedQuery, "bg-gold text-ink")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.details>
                ))}
              </HairlineGrid>
            </RevealStagger>
          )}
        </WideContainer>
      </section>

      <section className="relative overflow-hidden border-t border-[rgba(243,234,219,0.12)] py-[clamp(44px,7vw,112px)]">
        <div className="absolute inset-0 bg-radial-glow opacity-60" />
        <WideContainer className="relative text-center">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-[clamp(2rem,4.6vw,4.2rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-paper">
              {dict.finalCta.title}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-[18px] max-w-md text-[#A9B8C9]">{dict.finalCta.body}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{dict.finalCta.cta}</Button>
          </Reveal>
        </WideContainer>
      </section>
    </>
  );
}

function EnCoverageClient({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const p = dict.pages.coverage;

  const [query, setQuery] = useState("");
  const [openNames, setOpenNames] = useState<Set<string>>(new Set());

  function toggleCategory(name: string) {
    setOpenNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const filteredCategories = useMemo(() => {
    if (!isSearching) return p.categories;
    return p.categories
      .map((cat) => {
        const catMatches =
          cat.name.toLowerCase().includes(normalizedQuery) || cat.description.toLowerCase().includes(normalizedQuery);
        const services = cat.services.filter(
          (s) =>
            catMatches ||
            s.name.toLowerCase().includes(normalizedQuery) ||
            s.description.toLowerCase().includes(normalizedQuery)
        );
        return { ...cat, services };
      })
      .filter((cat) => cat.services.length > 0);
  }, [p.categories, normalizedQuery, isSearching]);

  const totalCount = useMemo(() => p.categories.reduce((sum, c) => sum + c.services.length, 0), [p.categories]);
  const matchCount = useMemo(
    () => filteredCategories.reduce((sum, c) => sum + c.services.length, 0),
    [filteredCategories]
  );

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />

      <section className="bg-cream py-20 md:py-28">
        <Container>
          <Reveal>
            <p className="max-w-2xl text-sm leading-relaxed text-navy/55 md:text-base">{p.intro}</p>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="mt-8 flex items-center gap-3 rounded-full border border-lineDark bg-paper px-5 py-3.5 focus-within:border-gold/60">
              <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-navy/35">
                <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
                <path d="M11 11L15 15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={p.searchPlaceholder}
                className="w-full bg-transparent text-sm text-navy outline-none placeholder:text-navy/35 md:text-base"
              />
              {isSearching && (
                <button
                  onClick={() => setQuery("")}
                  aria-label="Clear"
                  className="shrink-0 text-navy/35 hover:text-navy/60"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14">
                    <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </Reveal>

          {isSearching && (
            <Reveal delay={0.1}>
              <p className="mt-4 text-xs text-navy/40">
                {matchCount} / {totalCount}
              </p>
            </Reveal>
          )}

          <div className="mt-10 space-y-3">
            {filteredCategories.length === 0 && (
              <Reveal>
                <p className="rounded-2xl border border-lineDark bg-paper px-6 py-8 text-center text-sm text-navy/50">
                  {p.searchNoResults}
                </p>
              </Reveal>
            )}

            {filteredCategories.map((cat, i) => {
              const expanded = isSearching || openNames.has(cat.name);
              return (
                <Reveal key={cat.name} delay={Math.min(i * 0.02, 0.3)}>
                  <div className="overflow-hidden rounded-2xl border border-lineDark bg-paper">
                    <button
                      onClick={() => toggleCategory(cat.name)}
                      className="flex w-full items-center justify-between gap-4 px-6 py-5 text-start"
                    >
                      <div className="min-w-0">
                        <div className="text-[15px] font-medium text-navy md:text-base">
                          {highlight(cat.name, normalizedQuery)}
                        </div>
                        <div className="mt-1 text-xs text-navy/45 md:text-sm">{cat.description}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-xs text-navy/35">{cat.services.length}</span>
                        <svg
                          width="12"
                          height="8"
                          viewBox="0 0 12 8"
                          className={cn("shrink-0 text-gold transition-transform", expanded && "rotate-180")}
                        >
                          <path d="M1 1L6 6.5L11 1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                        </svg>
                      </div>
                    </button>

                    {expanded && (
                      <div className="border-t border-lineDark px-6 pb-5 pt-1">
                        <div className="divide-y divide-lineDark">
                          {cat.services.map((s) => (
                            <div key={s.name} className="py-3.5">
                              <div className="text-sm font-medium text-navy">{highlight(s.name, normalizedQuery)}</div>
                              <div className="mt-1 text-xs leading-relaxed text-navy/50 md:text-[13px]">
                                {highlight(s.description, normalizedQuery)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Reveal>
              );
            })}
          </div>
        </Container>
      </section>

      <section className="relative overflow-hidden bg-ink py-28 md:py-40">
        <div className="absolute inset-0 bg-radial-glow" />
        <Container className="relative text-center">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-[32px] font-medium leading-[1.15] tracking-tight text-paper md:text-[52px]">
              {dict.finalCta.title}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-md text-paper/55">{dict.finalCta.body}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{dict.finalCta.cta}</Button>
          </Reveal>
        </Container>
      </section>
    </>
  );
}

export default function CoverageClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;

  if (locale === "he") {
    const dict = getDictionary(locale);
    return <HeCoverageClient locale={locale} dict={dict} />;
  }

  return <EnCoverageClient locale={locale} />;
}
