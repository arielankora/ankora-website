"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";
import { cn } from "@/lib/utils";

function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-gold/30 px-0.5 text-navy">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function CoveragePage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
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
