"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { WideContainer } from "@/components/ui/WideContainer";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { HairlineGrid } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";

/**
 * Wraps the matched substring in a gold mark. Solid gold with ink text, not a
 * translucent overlay: on the navy card background a translucent gold composites to a
 * muddy dark tone and the text on it fails contrast. Solid measures about 5.6:1.
 */
function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-gold px-0.5 text-navy">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

/**
 * Coverage: free-text search across 17 categories and 141 services.
 *
 * Two things here are deliberate and should survive future edits.
 *
 * Every service name and description is rendered unconditionally inside its
 * `<details>`, at all times, even when the category is closed. Disclosure is the
 * native `open` attribute only — never React state, never `aria-hidden` — so the full
 * catalogue is in the server-rendered HTML for crawlers that do not click.
 *
 * A category matching by title or description shows all of its services; one matching
 * only by service shows just the matching services. Either way it is forced open while
 * a search is active, and `openNames` remembers what the visitor opened by hand so
 * their own choices come back when the query is cleared.
 */
export default function CoverageClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.coverage;

  const [query, setQuery] = useState("");
  const [openNames, setOpenNames] = useState<Set<string>>(new Set());

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const filteredCategories = useMemo(() => {
    if (!isSearching) return p.categories;
    return p.categories
      .map((cat) => {
        const catMatches =
          cat.name.toLowerCase().includes(normalizedQuery) ||
          cat.description.toLowerCase().includes(normalizedQuery);
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

  const matchedServiceCount = filteredCategories.reduce((sum, c) => sum + c.services.length, 0);
  const noResults = filteredCategories.length === 0;

  return (
    <>
      <PageHero
        eyebrow={p.eyebrow}
        title={p.title}
        sub={p.sub}
        breadcrumb={
          <Breadcrumbs
            locale={locale}
            items={[{ label: dict.nav.home, href: "/" }, { label: p.eyebrow }]}
          />
        }
      />

      <section className="pb-[clamp(40px,6vw,88px)]">
        <WideContainer>
          <Reveal>
            <p className="max-w-[86ch] border-t border-[rgba(243,234,219,0.12)] pt-[clamp(20px,2.6vw,30px)] font-assistant text-base font-light leading-[1.85] text-muted">
              {p.intro}
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <GlassPanel
              elevated
              className="mt-[clamp(18px,2.4vw,28px)] flex flex-wrap items-center justify-between gap-[clamp(14px,2vw,28px)] px-[clamp(18px,2.4vw,26px)] py-[clamp(16px,2vw,22px)]"
            >
              <div className="flex min-w-0 flex-1 basis-[260px] items-center gap-3">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 15 15"
                  fill="none"
                  aria-hidden="true"
                  className="shrink-0 text-muted"
                >
                  <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <label htmlFor="coverage-search" className="sr-only">
                  {p.searchPlaceholder}
                </label>
                <input
                  id="coverage-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={p.searchPlaceholder}
                  className="min-h-[44px] min-w-0 flex-1 border-0 border-b border-[rgba(243,234,219,0.22)] bg-transparent py-2 text-[15.5px] font-light text-cream outline-none transition-colors duration-[250ms] placeholder:text-muted focus:border-gold [&::-webkit-search-cancel-button]:appearance-none"
                />
                {isSearching && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label={p.clearSearch}
                    className="flex h-11 w-11 shrink-0 items-center justify-center text-muted transition-colors hover:text-gold"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                      <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
              {/* The counter is the search's running answer, so it is announced. */}
              <div aria-live="polite" className="flex items-baseline gap-[clamp(16px,2.4vw,30px)]">
                {noResults ? (
                  <span className="font-assistant text-sm font-light text-gold">{p.noResultsLabel}</span>
                ) : (
                  <>
                    <span className="font-assistant text-sm font-light text-muted">
                      <span className="font-jbmono tabular-nums text-cream">{filteredCategories.length}</span>{" "}
                      {p.areaCountLabel}
                    </span>
                    <span className="font-assistant text-sm font-light text-muted">
                      <span className="font-jbmono tabular-nums text-cream">{matchedServiceCount}</span>{" "}
                      {p.serviceCountLabel}
                    </span>
                  </>
                )}
              </div>
            </GlassPanel>
          </Reveal>

          {noResults ? (
            <Reveal delay={0.1}>
              <div className="mt-[clamp(18px,2.4vw,28px)] border border-[rgba(243,234,219,0.12)] p-[clamp(24px,3.4vw,40px)] text-center">
                <h2 className="text-[clamp(1.2rem,2vw,1.6rem)] font-light text-cream">
                  {p.emptyStateTitle.replace("{query}", query.trim())}
                </h2>
                <p className="mx-auto mt-4 max-w-[52ch] font-assistant text-[1.02rem] font-light leading-[1.7] text-muted">
                  {p.emptyStateBody}
                </p>
                <Link
                  href={withLocale(locale, "/contact")}
                  className="mt-6 inline-flex min-h-[44px] items-center border border-[rgba(176,141,87,0.5)] bg-[rgba(176,141,87,0.1)] px-[26px] py-[13px] font-assistant text-[15px] font-semibold text-cream transition-colors duration-300 hover:bg-gold hover:text-navy"
                >
                  {p.emptyStateCta}
                </Link>
              </div>
            </Reveal>
          ) : (
            <RevealStagger className="mt-[clamp(18px,2.4vw,28px)]">
              <HairlineGrid minCell={320}>
                {filteredCategories.map((cat) => (
                  <motion.details
                    key={cat.name}
                    variants={staggerItem}
                    open={isSearching || openNames.has(cat.name)}
                    onToggle={(e) => {
                      // Search forces categories open; ignore the toggle events that
                      // generates so the visitor's own state is not overwritten.
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
                        <h2 className="text-[clamp(1.16rem,1.5vw,1.38rem)] font-normal text-cream">
                          {highlight(cat.name, normalizedQuery)}
                        </h2>
                        <p className="mt-2.5 font-assistant text-[1.02rem] font-light leading-[1.65] text-muted">
                          {cat.description}
                        </p>
                      </div>
                      <div className="shrink-0 border-s border-[rgba(243,234,219,0.12)] ps-4 text-center">
                        <div className="font-jbmono text-[1.3rem] tabular-nums leading-none text-gold">
                          {cat.services.length}
                        </div>
                        <div className="mt-1.5 font-assistant text-[11px] font-light text-muted">
                          {p.serviceCountLabel}
                        </div>
                      </div>
                      <span
                        aria-hidden="true"
                        className="ms-1 shrink-0 font-jbmono text-xl leading-none text-gold transition-transform duration-[250ms] ease-out group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>

                    <div className="border-t border-[rgba(243,234,219,0.12)] px-[clamp(22px,2.8vw,32px)] pb-[clamp(22px,2.8vw,32px)] pt-1">
                      <div className="divide-y divide-[rgba(243,234,219,0.12)]">
                        {cat.services.map((service) => (
                          <div key={service.name} className="py-3.5">
                            <div className="text-sm font-medium text-cream">
                              {highlight(service.name, normalizedQuery)}
                            </div>
                            <div className="mt-1 font-assistant text-xs font-light leading-relaxed text-muted">
                              {highlight(service.description, normalizedQuery)}
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

      <InnerCTA dict={dict} locale={locale} />
    </>
  );
}
