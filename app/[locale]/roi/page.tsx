"use client";

import { useMemo, useState } from "react";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";
import { cn } from "@/lib/utils";

// Illustrative blended rates, matching the example tiers shown on /pricing.
// Keep these in sync with content/*.ts pages.pricing.tiers if those numbers change.
function ankoraRateForMonthlyHours(hours: number): number {
  if (hours <= 10) return 180;
  if (hours <= 20) return 160;
  return 140;
}

function formatCurrency(n: number, locale: Locale) {
  const rounded = Math.round(n);
  return locale === "he" ? `₪${rounded.toLocaleString("he-IL")}` : `$${rounded.toLocaleString("en-US")}`;
}

export default function RoiPage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.roi;

  const [personaIndex, setPersonaIndex] = useState(0);
  const persona = p.personas[personaIndex];

  const [hours, setHours] = useState(persona.hoursDefault);
  const [rate, setRate] = useState(persona.rateDefault);

  function selectPersona(i: number) {
    setPersonaIndex(i);
    setHours(p.personas[i].hoursDefault);
    setRate(p.personas[i].rateDefault);
  }

  const results = useMemo(() => {
    const hoursPerMonth = Math.max(0, hours) * 4.33;
    const ankoraRate = ankoraRateForMonthlyHours(hoursPerMonth);
    const cost = hoursPerMonth * ankoraRate;
    const valueFreed = hoursPerMonth * Math.max(0, rate);
    const netValue = valueFreed - cost;
    const multiple = cost > 0 ? valueFreed / cost : 0;
    return { hoursPerMonth, cost, valueFreed, netValue, multiple };
  }, [hours, rate]);

  const personaLabels = p.personas.map((pr) => dict.pages.segments[pr.key].eyebrow);

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />

      <section className="bg-cream py-20 md:py-28">
        <Container>
          <Reveal>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-navy/45">{p.personaPrompt}</span>
          </Reveal>

          <Reveal delay={0.06}>
            <div className="mt-5 flex flex-wrap gap-3">
              {personaLabels.map((label, i) => (
                <button
                  key={label}
                  onClick={() => selectPersona(i)}
                  className={cn(
                    "rounded-full border px-5 py-2.5 text-sm font-medium transition-colors",
                    i === personaIndex
                      ? "border-gold bg-gold-gradient text-ink"
                      : "border-lineDark bg-paper text-navy/70 hover:border-gold/50"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Reveal>

          <div className="mt-12 grid gap-8 lg:grid-cols-2 lg:items-start">
            <Reveal delay={0.1}>
              <div className="rounded-2xl border border-lineDark bg-paper p-8">
                <div>
                  <label className="block text-sm font-medium text-navy">{persona.hoursLabel}</label>
                  <p className="mt-1 text-xs text-navy/45">{persona.hoursHint}</p>
                  <div className="mt-4 flex items-center gap-4">
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={1}
                      value={hours}
                      onChange={(e) => setHours(Number(e.target.value))}
                      className="w-full accent-[#B08D57]"
                    />
                    <input
                      type="number"
                      min={0}
                      value={hours}
                      onChange={(e) => setHours(Number(e.target.value))}
                      className="w-20 shrink-0 rounded-lg border border-lineDark bg-cream px-3 py-2 text-center text-navy outline-none focus:border-gold/60"
                    />
                  </div>
                </div>

                <div className="mt-8">
                  <label className="block text-sm font-medium text-navy">{persona.rateLabel}</label>
                  <p className="mt-1 text-xs text-navy/45">{persona.rateHint}</p>
                  <div className="mt-4 flex items-center gap-4">
                    <input
                      type="range"
                      min={50}
                      max={1000}
                      step={10}
                      value={rate}
                      onChange={(e) => setRate(Number(e.target.value))}
                      className="w-full accent-[#B08D57]"
                    />
                    <input
                      type="number"
                      min={0}
                      value={rate}
                      onChange={(e) => setRate(Number(e.target.value))}
                      className="w-24 shrink-0 rounded-lg border border-lineDark bg-cream px-3 py-2 text-center text-navy outline-none focus:border-gold/60"
                    />
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.16}>
              <div className="rounded-2xl border border-gold/40 bg-ink p-8">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-light">{p.results.title}</span>

                <div className="mt-6 space-y-5">
                  <div className="flex items-baseline justify-between border-b border-line pb-4">
                    <span className="text-sm text-paper/60">{p.results.hoursFreedLabel}</span>
                    <span className="text-lg font-medium text-paper">{Math.round(results.hoursPerMonth)}</span>
                  </div>
                  <div className="flex items-baseline justify-between border-b border-line pb-4">
                    <span className="text-sm text-paper/60">{p.results.valueFreedLabel}</span>
                    <span className="text-lg font-medium text-paper">{formatCurrency(results.valueFreed, locale)}</span>
                  </div>
                  <div className="flex items-baseline justify-between border-b border-line pb-4">
                    <span className="text-sm text-paper/60">{p.results.costLabel}</span>
                    <span className="text-lg font-medium text-paper">{formatCurrency(results.cost, locale)}</span>
                  </div>
                  <div className="flex items-baseline justify-between border-b border-line pb-4">
                    <span className="text-sm text-paper/60">{p.results.netValueLabel}</span>
                    <span className="text-lg font-medium text-gold-light">{formatCurrency(results.netValue, locale)}</span>
                  </div>
                  <div className="flex items-baseline justify-between pt-1">
                    <span className="text-sm text-paper/60">{p.results.multipleLabel}</span>
                    <span className="text-2xl font-semibold text-gold-light">
                      {results.multiple.toFixed(1)}x
                    </span>
                  </div>
                  <p className="text-xs text-paper/40">{p.results.multipleSuffix}</p>
                </div>

                <p className="mt-8 text-sm leading-relaxed text-paper/60">{p.results.ctaBody}</p>
                <Button href={withLocale(locale, "/contact")} className="mt-5 w-full">
                  {p.results.cta}
                </Button>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.2}>
            <p className="mt-8 max-w-2xl text-xs leading-relaxed text-navy/40">{p.results.footnote}</p>
          </Reveal>
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
