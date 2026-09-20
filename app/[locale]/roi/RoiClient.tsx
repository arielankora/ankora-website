"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { getDictionary, type CapabilityId, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Button } from "@/components/ui/Button";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * ROI calculator.
 *
 * One flat illustrative Ankora rate in both locales — the English site sells the same
 * Israeli service at the same price, and the previous $35 had drifted away from ₪130
 * (Ariel's decision, C05).
 */
const ANKORA_RATE = 130;
const EMPLOYER_OVERHEAD_MULTIPLIER = 1.33;
/** 52 weeks over 12 months. The previous 4.33 was a rounded stand-in for this. */
const WEEKS_PER_MONTH = 52 / 12;

/** The spec's clamps: hours 0-20 by 1, rate 50-2000 by 25, non-productive 0-60% by 5. */
const HOURS = { min: 0, max: 20, step: 1 };
const RATE = { min: 50, max: 2000, step: 25 };
const NONPROD = { min: 0, max: 60, step: 5 };

function formatCurrency(n: number) {
  return `₪${Math.round(n).toLocaleString("he-IL")}`;
}

/**
 * A minus/plus pair around a read-only value.
 *
 * Both buttons are 44x44, the spec's minimum target. The control they replace was a
 * 36px button beside a native number input, whose own spinners most mobile browsers
 * hide entirely — which made the rows genuinely hard to adjust on a phone. The value
 * is announced through `aria-live`, and each button's label names the row it belongs
 * to, so a screen reader hears "more, business operations" rather than a bare plus.
 */
function Stepper({
  value,
  display,
  onChange,
  min,
  max,
  step,
  decLabel,
  incLabel,
  valueLabel,
}: {
  value: number;
  display?: string;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  decLabel: string;
  incLabel: string;
  valueLabel: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const button =
    "flex h-11 w-11 flex-none items-center justify-center border border-[rgba(243,234,219,0.2)] text-[17px] leading-none text-paper transition-colors duration-200 hover:border-gold hover:text-gold disabled:opacity-40 disabled:hover:border-[rgba(243,234,219,0.2)] disabled:hover:text-paper";

  return (
    <div className="flex flex-none items-center gap-0.5">
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        aria-label={decLabel}
        className={button}
      >
        −
      </button>
      <span
        aria-live="polite"
        aria-label={`${valueLabel}: ${display ?? value}`}
        className="min-w-[52px] text-center font-jbmono text-sm tabular-nums text-gold"
      >
        {display ?? value}
      </span>
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        aria-label={incLabel}
        className={button}
      >
        +
      </button>
    </div>
  );
}

export default function RoiClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.roi;

  const [personaIndex, setPersonaIndex] = useState(0);
  const persona = p.personas[personaIndex];

  const [hours, setHours] = useState<Record<CapabilityId, number>>(persona.hours);
  const [rate, setRate] = useState(persona.rateDefault);
  const [nonProductivePct, setNonProductivePct] = useState(p.nonProductiveDefault);

  function selectPersona(i: number) {
    setPersonaIndex(i);
    setHours(p.personas[i].hours);
    setRate(p.personas[i].rateDefault);
  }

  // The rows ARE the capabilities, in capability order, taking their labels from that
  // list rather than repeating them. The calculator can therefore never measure a
  // different set of domains than the home page advertises.
  const rows = dict.capabilities.items.map((item) => ({
    id: item.id,
    label: item.title,
    note: p.hourNotes[item.id],
  }));

  const weeklyHours = rows.reduce((total, row) => total + (hours[row.id] ?? 0), 0);

  const results = useMemo(() => {
    const monthlyHours = Math.max(0, weeklyHours) * WEEKS_PER_MONTH;
    // The spec's floor. Without it a non-productive share approaching 100% sends the
    // implied cost to infinity, which is not a number to put in front of anyone.
    const productive = Math.max(0.2, 1 - nonProductivePct / 100);
    const currentCost =
      (monthlyHours * Math.max(0, rate) * EMPLOYER_OVERHEAD_MULTIPLIER) / productive;
    const ankoraCost = monthlyHours * ANKORA_RATE;
    return {
      monthlyHours,
      currentCost,
      ankoraCost,
      saving: currentCost - ankoraCost,
      multiple: ankoraCost > 0 ? currentCost / ankoraCost : 0,
    };
  }, [weeklyHours, rate, nonProductivePct]);

  const more = locale === "he" ? "יותר" : "More";
  const less = locale === "he" ? "פחות" : "Less";

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

      <SectionShell>
        <div
          className="grid items-start gap-px"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}
        >
          <div className="bg-[rgba(11,27,51,0.5)] p-[clamp(24px,3vw,40px)] outline outline-1 outline-[rgba(243,234,219,0.11)] backdrop-blur-[12px]">
            <MonoLabel tracking="0.15em" className="text-tone-muted">
              {p.personaPrompt}
            </MonoLabel>

            {/* A 2x2 grid, not a wrapping flex row: a wrapped flex item with
                `flex: 1 1 auto` stretches to fill its row, so the fourth persona
                would render at twice the width of the others. */}
            <div className="mb-[34px] mt-4 grid grid-cols-2 gap-px border border-[rgba(243,234,219,0.16)] bg-[rgba(243,234,219,0.16)]">
              {p.personas.map((item, i) => {
                const active = i === personaIndex;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => selectPersona(i)}
                    aria-pressed={active}
                    className={cn(
                      "min-h-12 px-3.5 py-3 font-assistant text-[13.5px] font-semibold transition-colors duration-[250ms]",
                      active ? "bg-gold text-ink" : "bg-ink text-tone-muted hover:text-gold"
                    )}
                  >
                    {dict.pages.segments[item.key].eyebrow}
                  </button>
                );
              })}
            </div>

            <MonoLabel tracking="0.15em" className="text-tone-muted">
              {p.hoursPrompt}
            </MonoLabel>
            <div className="mt-5 flex flex-col">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-4 border-b border-[rgba(243,234,219,0.1)] py-4 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-normal leading-[1.35] text-paper">{row.label}</div>
                    <div className="mt-1 font-assistant text-[12.5px] font-light text-tone-muted">{row.note}</div>
                  </div>
                  <Stepper
                    value={hours[row.id]}
                    onChange={(v) => setHours((prev) => ({ ...prev, [row.id]: v }))}
                    {...HOURS}
                    valueLabel={`${row.label} — ${p.hoursUnitLabel}`}
                    decLabel={`${less}: ${row.label}`}
                    incLabel={`${more}: ${row.label}`}
                  />
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-baseline justify-between gap-3">
              <span className="font-assistant text-sm font-semibold text-paper">{p.hoursTotalLabel}</span>
              <span className="font-jbmono text-base tabular-nums text-gold">{weeklyHours}</span>
            </div>

            <div className="mt-[34px] border-t border-[rgba(243,234,219,0.12)] pt-[26px]">
              <div className="text-[14.5px] font-normal text-paper">{persona.rateLabel}</div>
              <p className="mb-3.5 mt-1.5 font-assistant text-[12.5px] font-light leading-[1.65] text-tone-muted">
                {persona.rateHint}. {p.rateNote}
              </p>
              <Stepper
                value={rate}
                display={formatCurrency(rate)}
                onChange={setRate}
                {...RATE}
                valueLabel={persona.rateLabel}
                decLabel={less}
                incLabel={more}
              />
            </div>

            <div className="mt-7 border-t border-[rgba(243,234,219,0.12)] pt-[26px]">
              <div className="text-[14.5px] font-normal text-paper">{p.nonProductiveLabel}</div>
              <p className="mb-3.5 mt-1.5 font-assistant text-[12.5px] font-light leading-[1.65] text-tone-muted">
                {p.nonProductiveHint}
              </p>
              <Stepper
                value={nonProductivePct}
                display={`${nonProductivePct}%`}
                onChange={setNonProductivePct}
                {...NONPROD}
                valueLabel={p.nonProductiveLabel}
                decLabel={less}
                incLabel={more}
              />
            </div>
          </div>

          <div className="bg-[rgba(176,141,87,0.09)] p-[clamp(24px,3vw,40px)] outline outline-1 outline-[rgba(176,141,87,0.35)] lg:sticky lg:top-[92px]">
            <MonoLabel tracking="0.15em" className="text-gold">
              {p.results.title}
            </MonoLabel>

            <dl className="mt-6 space-y-5">
              <div className="flex items-baseline justify-between gap-4 border-b border-[rgba(243,234,219,0.16)] pb-4">
                <dt className="font-assistant text-sm text-tone-body">{p.results.hoursFreedLabel}</dt>
                <dd className="text-lg font-medium tabular-nums text-paper">
                  {Math.round(results.monthlyHours)}
                </dd>
              </div>
              <div className="border-b border-[rgba(243,234,219,0.16)] pb-4">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="font-assistant text-sm text-tone-body">{p.results.valueFreedLabel}</dt>
                  <dd className="text-lg font-medium tabular-nums text-paper">
                    {formatCurrency(results.currentCost)}
                  </dd>
                </div>
                <p className="mt-1 font-assistant text-xs text-tone-muted">{p.results.valueFreedHint}</p>
              </div>
              <div className="border-b border-[rgba(243,234,219,0.16)] pb-4">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="font-assistant text-sm text-tone-body">{p.results.costLabel}</dt>
                  <dd className="text-lg font-medium tabular-nums text-paper">
                    {formatCurrency(results.ankoraCost)}
                  </dd>
                </div>
                <p className="mt-1 font-assistant text-xs text-tone-muted">{p.results.costHint}</p>
              </div>
            </dl>

            {/* The saving and the return are the answer the page exists to give, so
                they get their own outlined block instead of being the last two rows
                of the same list as the inputs' echo. */}
            <div className="mt-6 border border-gold/60 p-5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-assistant text-sm text-tone-body">{p.results.netValueLabel}</span>
                <span className="text-[1.6rem] font-light tabular-nums text-gold">
                  {formatCurrency(results.saving)}
                </span>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-gold/25 pt-3">
                <span className="font-assistant text-sm text-tone-body">{p.results.multipleLabel}</span>
                <span className="font-jbmono text-xl tabular-nums text-gold">
                  {results.multiple.toFixed(1)}x
                </span>
              </div>
              <p className="mt-2 font-assistant text-xs text-tone-muted">{p.results.multipleSuffix}</p>
            </div>

            <p className="mt-7 font-assistant text-sm leading-relaxed text-tone-body">{p.results.ctaBody}</p>
            <Button href={withLocale(locale, "/contact")} className="mt-5 w-full">
              {p.results.cta}
            </Button>
            <p className="mt-5 font-assistant text-xs font-light leading-[1.7] text-tone-muted">
              {p.results.footnote}
            </p>
          </div>
        </div>
      </SectionShell>

      <SectionShell>
        <Reveal>
          <Eyebrow>{p.hiddenCost.label}</Eyebrow>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-[24ch] text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-paper">
            {p.hiddenCost.title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 max-w-[60ch] font-assistant font-light leading-[1.8] text-tone-muted">
            {p.hiddenCost.body}
          </p>
        </Reveal>
        <RevealStagger className="mt-12">
          <HairlineGrid minCell={260}>
            {p.hiddenCost.items.map((item) => (
              <motion.div key={item.title} variants={staggerItem} className="h-full">
                <HairlineGridCell>
                  <h3 className="text-[1.12rem] font-normal text-paper">{item.title}</h3>
                  <p className="mt-2 font-assistant text-sm font-light leading-[1.7] text-tone-muted">
                    {item.body}
                  </p>
                </HairlineGridCell>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
      </SectionShell>

      <InnerCTA dict={dict} locale={locale} />
    </>
  );
}
