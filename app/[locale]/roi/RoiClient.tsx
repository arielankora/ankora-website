"use client";

import { useMemo, useState } from "react";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";
import { cn } from "@/lib/utils";

// Flat illustrative Ankora rate used for this calculator (kept distinct from the
// tiered example rates on /pricing, per the flat per-hour assumption requested).
// One rate, not one per locale: the English site sells the same Israeli service at
// the same price, and the previous $35 figure had drifted from ₪130 (Ariel's
// decision, C05 -- the spec's "currency formats as he-IL" applies to both locales).
const ANKORA_RATE = 130;
// Employer-overhead multiplier applied to the direct hourly cost entered by the visitor.
const EMPLOYER_OVERHEAD_MULTIPLIER = 1.33;

function formatCurrency(n: number) {
  return `₪${Math.round(n).toLocaleString("he-IL")}`;
}

// Number input with explicit tap targets for +/- (native number-input spinners
// aren't reliable across browsers, and are hidden entirely on most mobile
// browsers, which made these fields hard to adjust precisely on a phone).
function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  function clamp(v: number) {
    let n = Number.isFinite(v) ? v : min;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return Math.round(n * 100) / 100;
  }

  return (
    <div className={cn("flex h-10 items-stretch overflow-hidden rounded-lg border border-lineDark bg-cream", className)}>
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        aria-label="הפחת"
        className="flex w-9 shrink-0 items-center justify-center text-base text-navy/50 transition-colors hover:bg-navy/5 hover:text-navy active:bg-navy/10"
      >
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="w-full min-w-0 bg-transparent text-center text-navy outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        aria-label="הוסף"
        className="flex w-9 shrink-0 items-center justify-center text-base text-navy/50 transition-colors hover:bg-navy/5 hover:text-navy active:bg-navy/10"
      >
        +
      </button>
    </div>
  );
}

// /he redesign variant: sharp corners (radius 0), hairline border + translucent-cream
// fill instead of the /en rounded-lg + cream-solid fill, gold text on hover instead of
// navy. Same tap-target behaviour and clamp logic as the /en Stepper above.
function HeStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  function clamp(v: number) {
    let n = Number.isFinite(v) ? v : min;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return Math.round(n * 100) / 100;
  }

  return (
    <div className={cn("flex h-10 items-stretch overflow-hidden border border-[rgba(243,234,219,0.18)] bg-[rgba(243,234,219,0.04)]", className)}>
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        aria-label="הפחת"
        className="flex w-9 shrink-0 items-center justify-center text-base text-[#7C8EA3] transition-colors hover:bg-[rgba(176,141,87,0.08)] hover:text-gold"
      >
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="w-full min-w-0 bg-transparent text-center text-paper outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        aria-label="הוסף"
        className="flex w-9 shrink-0 items-center justify-center text-base text-[#7C8EA3] transition-colors hover:bg-[rgba(176,141,87,0.08)] hover:text-gold"
      >
        +
      </button>
    </div>
  );
}

function HeRoiClient({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const p = dict.pages.roi;

  const [personaIndex, setPersonaIndex] = useState(0);
  const persona = p.personas[personaIndex];

  const [hourValues, setHourValues] = useState<number[]>(persona.hourQuestions.map((q) => q.default));
  const [rate, setRate] = useState(persona.rateDefault);
  const [nonProductivePct, setNonProductivePct] = useState(p.nonProductiveDefault);

  function selectPersona(i: number) {
    setPersonaIndex(i);
    setHourValues(p.personas[i].hourQuestions.map((q) => q.default));
    setRate(p.personas[i].rateDefault);
  }

  function updateHour(i: number, value: number) {
    setHourValues((prev) => prev.map((v, idx) => (idx === i ? value : v)));
  }

  const totalHoursPerWeek = useMemo(() => hourValues.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0), [hourValues]);

  const results = useMemo(() => {
    const hoursPerMonth = Math.max(0, totalHoursPerWeek) * 4.33;
    const nonProductiveFraction = Math.min(0.9, Math.max(0, nonProductivePct / 100));
    const fullyLoadedRate = (Math.max(0, rate) * EMPLOYER_OVERHEAD_MULTIPLIER) / (1 - nonProductiveFraction);
    const valueFreed = hoursPerMonth * fullyLoadedRate;
    const cost = hoursPerMonth * ANKORA_RATE;
    const netValue = valueFreed - cost;
    const multiple = cost > 0 ? valueFreed / cost : 0;
    return { hoursPerMonth, valueFreed, cost, netValue, multiple };
  }, [totalHoursPerWeek, rate, nonProductivePct]);

  const personaLabels = p.personas.map((pr) => dict.pages.segments[pr.key].eyebrow);

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} locale="he" />

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal><Eyebrow>{p.personaPrompt}</Eyebrow></Reveal>

          <Reveal delay={0.06}>
            <div className="mt-6 flex flex-wrap gap-3">
              {personaLabels.map((label, i) => (
                <button
                  key={label}
                  onClick={() => selectPersona(i)}
                  className={cn(
                    "border px-5 py-2.5 text-sm font-medium transition-colors",
                    i === personaIndex
                      ? "border-gold bg-gold text-ink"
                      : "border-[rgba(243,234,219,0.18)] bg-[rgba(243,234,219,0.04)] text-[#C3CEDA] hover:border-gold/50"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Reveal>

          <div className="mt-12 grid gap-8" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))" }}>
            <Reveal delay={0.1}>
              <GlassPanel elevated className="p-[clamp(22px,3vw,40px)]">
                <div className="space-y-5">
                  {persona.hourQuestions.map((q, i) => (
                    <div key={q.label} className="flex items-center justify-between gap-4 border-b border-[rgba(243,234,219,0.14)] pb-4 last:border-b-0 last:pb-0">
                      <div className="min-w-0">
                        <label className="block text-sm font-medium text-paper">{q.label}</label>
                        <p className="mt-0.5 text-xs text-[#7C8EA3]">{q.hint}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <HeStepper value={hourValues[i]} onChange={(v) => updateHour(i, v)} step={0.5} min={0} className="w-28" />
                        <span className="text-xs text-[#7C8EA3]">{p.hoursUnitLabel}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex items-center justify-between border border-[rgba(176,141,87,0.35)] bg-[rgba(176,141,87,0.09)] px-4 py-3">
                  <span className="text-sm font-medium text-paper">{p.hoursTotalLabel}</span>
                  {/* p.hoursTotalLabel ("סה\"כ שעות בשבוע") already states the unit, so the
                      value itself is unitless here -- avoids "8 שעות בשבוע" repeating the
                      unit that's already in the label right next to it. */}
                  <span className="text-lg font-semibold text-gold">{totalHoursPerWeek}</span>
                </div>

                <div className="mt-8">
                  <label className="block text-sm font-medium text-paper">{persona.rateLabel}</label>
                  <p className="mt-1 text-xs text-[#7C8EA3]">{persona.rateHint}</p>
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
                    <HeStepper value={rate} onChange={setRate} step={10} min={0} className="w-32 shrink-0" />
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-[#7C8EA3]">{p.rateNote}</p>
                </div>

                <div className="mt-8">
                  <label className="block text-sm font-medium text-paper">{p.nonProductiveLabel}</label>
                  <p className="mt-1 text-xs text-[#7C8EA3]">{p.nonProductiveHint}</p>
                  <div className="mt-4 flex items-center gap-4">
                    <input
                      type="range"
                      min={0}
                      max={60}
                      step={1}
                      value={nonProductivePct}
                      onChange={(e) => setNonProductivePct(Number(e.target.value))}
                      className="w-full accent-[#B08D57]"
                    />
                    <div className="flex shrink-0 items-center gap-2">
                      <HeStepper value={nonProductivePct} onChange={setNonProductivePct} step={1} min={0} max={90} className="w-28" />
                      <span className="text-sm text-[#7C8EA3]">%</span>
                    </div>
                  </div>
                </div>
              </GlassPanel>
            </Reveal>

            <Reveal delay={0.16}>
              <div className="border border-[rgba(176,141,87,0.35)] bg-[rgba(176,141,87,0.09)] p-[clamp(22px,3vw,40px)] lg:sticky lg:top-[86px]">
                <span className="font-jbmono text-[12px] tracking-[0.15em] text-gold">{p.results.title}</span>

                <div className="mt-6 space-y-5">
                  <div className="flex items-baseline justify-between border-b border-[rgba(243,234,219,0.16)] pb-4">
                    <span className="text-sm text-[#D8CAB5]">{p.results.hoursFreedLabel}</span>
                    <span className="text-lg font-medium text-paper">{Math.round(results.hoursPerMonth)}</span>
                  </div>
                  <div className="border-b border-[rgba(243,234,219,0.16)] pb-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-[#D8CAB5]">{p.results.valueFreedLabel}</span>
                      <span className="text-lg font-medium text-paper">{formatCurrency(results.valueFreed)}</span>
                    </div>
                    <p className="mt-1 text-xs text-[#D8CAB5]/70">{p.results.valueFreedHint}</p>
                  </div>
                  <div className="border-b border-[rgba(243,234,219,0.16)] pb-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-[#D8CAB5]">{p.results.costLabel}</span>
                      <span className="text-lg font-medium text-paper">{formatCurrency(results.cost)}</span>
                    </div>
                    <p className="mt-1 text-xs text-[#D8CAB5]/70">{p.results.costHint}</p>
                  </div>
                  <div className="flex items-baseline justify-between border-b border-[rgba(243,234,219,0.16)] pb-4">
                    <span className="text-sm text-[#D8CAB5]">{p.results.netValueLabel}</span>
                    <span className="text-lg font-medium text-gold">{formatCurrency(results.netValue)}</span>
                  </div>
                  <div className="flex items-baseline justify-between pt-1">
                    <span className="text-sm text-[#D8CAB5]">{p.results.multipleLabel}</span>
                    <span className="text-2xl font-semibold text-gold">{results.multiple.toFixed(1)}x</span>
                  </div>
                  <p className="text-xs text-[#D8CAB5]/60">{p.results.multipleSuffix}</p>
                </div>

                <p className="mt-8 text-sm leading-relaxed text-[#D8CAB5]">{p.results.ctaBody}</p>
                <Button href={withLocale(locale, "/contact")} className="mt-5 w-full">
                  {p.results.cta}
                </Button>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.2}>
            <p className="mt-8 max-w-2xl text-xs leading-relaxed text-[#7C8EA3]">{p.results.footnote}</p>
          </Reveal>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal><Eyebrow>{p.hiddenCost.label}</Eyebrow></Reveal>
          <Reveal delay={0.06}>
            <h2 className="mt-4 max-w-xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
              {p.hiddenCost.title}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-4 max-w-xl font-assistant text-[#A9B8C9]">{p.hiddenCost.body}</p>
          </Reveal>

          <div className="mt-12">
            <HairlineGrid minCell={280}>
              {p.hiddenCost.items.map((item) => (
                <HairlineGridCell key={item.title}>
                  <h3 className="text-sm font-medium text-gold">{item.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#A9B8C9]">{item.body}</p>
                </HairlineGridCell>
              ))}
            </HairlineGrid>
          </div>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(44px,7vw,112px)]">
        <WideContainer className="max-w-2xl text-center">
          <Reveal>
            <h2 className="mx-auto text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-paper">
              {dict.finalCta.title}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-md font-assistant text-[#A9B8C9]">{dict.finalCta.body}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{dict.finalCta.cta}</Button>
          </Reveal>
        </WideContainer>
      </section>
    </>
  );
}

function EnRoiClient({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const p = dict.pages.roi;

  const [personaIndex, setPersonaIndex] = useState(0);
  const persona = p.personas[personaIndex];

  const [hourValues, setHourValues] = useState<number[]>(persona.hourQuestions.map((q) => q.default));
  const [rate, setRate] = useState(persona.rateDefault);
  const [nonProductivePct, setNonProductivePct] = useState(p.nonProductiveDefault);

  function selectPersona(i: number) {
    setPersonaIndex(i);
    setHourValues(p.personas[i].hourQuestions.map((q) => q.default));
    setRate(p.personas[i].rateDefault);
  }

  function updateHour(i: number, value: number) {
    setHourValues((prev) => prev.map((v, idx) => (idx === i ? value : v)));
  }

  const totalHoursPerWeek = useMemo(() => hourValues.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0), [hourValues]);

  const results = useMemo(() => {
    const hoursPerMonth = Math.max(0, totalHoursPerWeek) * 4.33;
    // Direct rate -> fully-loaded rate: employer overhead (33%), then grossed up for
    // paid-but-non-productive time (sick days, vacation, lunch, idle time) — time the
    // client pays for today but won't pay Ankora for.
    const nonProductiveFraction = Math.min(0.9, Math.max(0, nonProductivePct / 100));
    const fullyLoadedRate = (Math.max(0, rate) * EMPLOYER_OVERHEAD_MULTIPLIER) / (1 - nonProductiveFraction);
    const valueFreed = hoursPerMonth * fullyLoadedRate;
    const cost = hoursPerMonth * ANKORA_RATE;
    const netValue = valueFreed - cost;
    const multiple = cost > 0 ? valueFreed / cost : 0;
    return { hoursPerMonth, valueFreed, cost, netValue, multiple };
  }, [totalHoursPerWeek, rate, nonProductivePct]);

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
                <div className="space-y-5">
                  {persona.hourQuestions.map((q, i) => (
                    <div key={q.label} className="flex items-center justify-between gap-4 border-b border-lineDark pb-4 last:border-b-0 last:pb-0">
                      <div className="min-w-0">
                        <label className="block text-sm font-medium text-navy">{q.label}</label>
                        <p className="mt-0.5 text-xs text-navy/45">{q.hint}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Stepper
                          value={hourValues[i]}
                          onChange={(v) => updateHour(i, v)}
                          step={0.5}
                          min={0}
                          className="w-28"
                        />
                        <span className="text-xs text-navy/40">{p.hoursUnitLabel}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex items-center justify-between rounded-xl bg-cream px-4 py-3">
                  <span className="text-sm font-medium text-navy">{p.hoursTotalLabel}</span>
                  <span className="text-lg font-semibold text-gold">
                    {totalHoursPerWeek} <span className="text-xs font-normal text-navy/40">{p.hoursUnitLabel}</span>
                  </span>
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
                    <Stepper value={rate} onChange={setRate} step={10} min={0} className="w-32 shrink-0" />
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-navy/40">{p.rateNote}</p>
                </div>

                <div className="mt-8">
                  <label className="block text-sm font-medium text-navy">{p.nonProductiveLabel}</label>
                  <p className="mt-1 text-xs text-navy/45">{p.nonProductiveHint}</p>
                  <div className="mt-4 flex items-center gap-4">
                    <input
                      type="range"
                      min={0}
                      max={60}
                      step={1}
                      value={nonProductivePct}
                      onChange={(e) => setNonProductivePct(Number(e.target.value))}
                      className="w-full accent-[#B08D57]"
                    />
                    <div className="flex shrink-0 items-center gap-2">
                      <Stepper value={nonProductivePct} onChange={setNonProductivePct} step={1} min={0} max={90} className="w-28" />
                      <span className="text-sm text-navy/50">%</span>
                    </div>
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
                  <div className="border-b border-line pb-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-paper/60">{p.results.valueFreedLabel}</span>
                      <span className="text-lg font-medium text-paper">{formatCurrency(results.valueFreed)}</span>
                    </div>
                    <p className="mt-1 text-xs text-paper/35">{p.results.valueFreedHint}</p>
                  </div>
                  <div className="border-b border-line pb-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-paper/60">{p.results.costLabel}</span>
                      <span className="text-lg font-medium text-paper">{formatCurrency(results.cost)}</span>
                    </div>
                    <p className="mt-1 text-xs text-paper/35">{p.results.costHint}</p>
                  </div>
                  <div className="flex items-baseline justify-between border-b border-line pb-4">
                    <span className="text-sm text-paper/60">{p.results.netValueLabel}</span>
                    <span className="text-lg font-medium text-gold-light">{formatCurrency(results.netValue)}</span>
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

      <section className="bg-navy py-20 md:py-28">
        <Container>
          <Reveal>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-light">{p.hiddenCost.label}</span>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="mt-4 max-w-xl text-[26px] font-medium leading-[1.2] tracking-tight text-paper md:text-[36px]">
              {p.hiddenCost.title}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-paper/55 md:text-base">{p.hiddenCost.body}</p>
          </Reveal>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {p.hiddenCost.items.map((item, i) => (
              <Reveal key={item.title} delay={0.14 + i * 0.06}>
                <div className="h-full rounded-2xl border border-paper/10 bg-paper/[0.03] p-7">
                  <h3 className="text-sm font-medium text-gold-light">{item.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-paper/55">{item.body}</p>
                </div>
              </Reveal>
            ))}
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

export default function RoiClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  if (locale === "he") {
    return <HeRoiClient locale={locale} />;
  }
  return <EnRoiClient locale={locale} />;
}
