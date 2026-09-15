"use client";

import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";
import { motion } from "framer-motion";

export default function PricingClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.pricing;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />

      {/* Billing model - light */}
      <section className="bg-cream py-24 md:py-36">
        <Container>
          <Reveal><Badge tone="light">{p.billing.label}</Badge></Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-navy md:text-[42px]">
              {p.billing.title}
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p className="mt-4 max-w-xl text-navy/60">{p.billing.body}</p>
          </Reveal>

          <RevealStagger className="mt-16 grid gap-4 md:grid-cols-3">
            {p.billing.points.map((pt) => (
              <motion.div
                key={pt.title}
                variants={staggerItem}
                className="rounded-2xl border border-lineDark bg-paper p-7"
              >
                <h3 className="text-lg font-medium text-gold">{pt.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy/55">{pt.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>

      {/* Cost comparison - dark */}
      <section className="bg-navy py-24 md:py-36">
        <Container>
          <Reveal><Badge>{p.costCompare.label}</Badge></Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
              {p.costCompare.title}
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p className="mt-4 max-w-2xl text-paper/55">{p.costCompare.body}</p>
          </Reveal>

          <div className="mt-16 grid gap-6 md:grid-cols-2">
            <Reveal delay={0.1} className="rounded-2xl border border-line p-10">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/40">{p.costCompare.inHouseTitle}</span>
              <ul className="mt-6 flex flex-col gap-3">
                {p.costCompare.inHouseItems.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-paper/70">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-paper/40" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={0.18} className="rounded-2xl border border-lineGold/40 bg-white/[0.02] p-10">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-light">{p.costCompare.ankoraTitle}</span>
              <ul className="mt-6 flex flex-col gap-3">
                {p.costCompare.ankoraItems.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-paper/90">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold-light" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Hour bank mechanic - light */}
      <section className="bg-paper py-24 md:py-36">
        <Container>
          <Reveal><Badge tone="light">{p.hourBank.label}</Badge></Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-navy md:text-[42px]">
              {p.hourBank.title}
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p className="mt-4 max-w-xl text-navy/60">{p.hourBank.body}</p>
          </Reveal>

          {/* /he only: 3-month rollover bar chart + legend (design spec called for this;
              it had never actually been implemented -- Ariel: "without the legend the
              diagram isn't understandable"). Sample numbers, illustrative only. */}
          {locale === "he" && p.hourBank.chart && (
            <Reveal delay={0.18} className="mt-12">
              <div className="rounded-2xl border border-lineDark bg-cream/40 p-7 md:p-10">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2 text-xs text-navy/60">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-navy/70" />
                    {p.hourBank.chart.usedLabel}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-navy/60">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-gold" />
                    {p.hourBank.chart.rolloverLabel}
                  </div>
                </div>
                <div className="mt-8 grid grid-cols-3 gap-6">
                  {p.hourBank.chart.months.map((m) => {
                    const max = Math.max(...p.hourBank.chart!.months.map((mm) => mm.used + mm.rollover));
                    const usedPct = max > 0 ? (m.used / max) * 100 : 0;
                    const rolloverPct = max > 0 ? (m.rollover / max) * 100 : 0;
                    return (
                      <div key={m.label} className="flex flex-col items-center">
                        <div className="flex h-40 w-full max-w-[64px] flex-col-reverse overflow-hidden rounded-lg bg-navy/5">
                          <div className="w-full bg-navy/70" style={{ height: `${usedPct}%` }} />
                          <div className="w-full bg-gold" style={{ height: `${rolloverPct}%` }} />
                        </div>
                        <span className="mt-3 text-xs text-navy/50">{m.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Reveal>
          )}

          <RevealStagger className="mt-16 grid gap-4 md:grid-cols-2">
            {p.hourBank.points.map((pt) => (
              <motion.div
                key={pt.title}
                variants={staggerItem}
                className="rounded-2xl border border-lineDark bg-cream/60 p-7"
              >
                <h3 className="text-lg font-medium text-navy">{pt.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy/55">{pt.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>

      {/* Closing CTA - dark bookend */}
      <section className="relative overflow-hidden bg-ink py-28 md:py-40">
        <div className="absolute inset-0 bg-radial-glow" />
        <Container className="relative text-center">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-[32px] font-medium leading-[1.15] tracking-tight text-paper md:text-[52px]">
              {p.closing.title}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-md text-paper/55">{p.closing.body}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <Button href={withLocale(locale, "/contact")}>{p.closing.cta}</Button>
            {/* /he only: secondary link to the ROI calculator, which directly answers this
                section's own question ("how much time does this actually save?"). Ariel
                asked for this alongside the existing contact CTA, not replacing it. */}
            {locale === "he" && p.closing.secondaryCta && (
              <Button href={withLocale(locale, "/roi")} variant="ghost">
                {p.closing.secondaryCta}
              </Button>
            )}
          </Reveal>
        </Container>
      </section>
    </>
  );
}
