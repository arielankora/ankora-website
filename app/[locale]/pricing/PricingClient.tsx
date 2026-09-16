"use client";

import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";
import { motion } from "framer-motion";

// /he redesign: this page never received a dark-theme He variant during the original
// redesign project (it predates it -- separate build task) and kept rendering the
// pre-redesign light/mixed theme (bg-cream/bg-paper/bg-navy) under /he too. That's why
// its background looked different from every other /he page: those opaque section
// backgrounds were sitting on top of and completely hiding the shared PageGlow that
// already runs globally via PageShell -- not a missing glow layer. This HePricingClient
// brings the page in line with the same conventions used everywhere else on /he:
// PageHero/WideContainer/Eyebrow section rhythm, no section-level background color
// (the global dark body + PageGlow show through), HairlineGrid for the "three billing
// points" / "two hour-bank points" card rows (which also gets them the shared
// items-stretch + h-full fix), and the same two-list-comparison GlassPanel pattern
// already used by the home page's HumanAI section for the in-house-vs-Ankora
// comparison. Every string is unchanged; only the container/markup changed.
function HePricingClient({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const p = dict.pages.pricing;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} locale="he" />

      {/* Billing model */}
      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal><Eyebrow>{p.billing.label}</Eyebrow></Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
              {p.billing.title}
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p className="mt-6 max-w-2xl font-assistant text-[#A9B8C9]">{p.billing.body}</p>
          </Reveal>

          <RevealStagger className="mt-14">
            <HairlineGrid minCell={260}>
              {p.billing.points.map((pt) => (
                <motion.div key={pt.title} variants={staggerItem}>
                  <HairlineGridCell>
                    <h3 className="text-lg font-medium text-paper">{pt.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#A9B8C9]">{pt.body}</p>
                  </HairlineGridCell>
                </motion.div>
              ))}
            </HairlineGrid>
          </RevealStagger>
        </WideContainer>
      </section>

      {/* Cost comparison */}
      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal><Eyebrow>{p.costCompare.label}</Eyebrow></Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
              {p.costCompare.title}
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p className="mt-6 max-w-2xl font-assistant text-[#A9B8C9]">{p.costCompare.body}</p>
          </Reveal>

          <div
            className="mt-14 grid items-stretch gap-6"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}
          >
            <Reveal delay={0.1} className="h-full">
              <GlassPanel elevated className="h-full p-[clamp(22px,3vw,40px)]">
                <span className="border-b border-[rgba(243,234,219,0.16)] pb-3 text-[13px] font-semibold tracking-[0.04em] text-gold">
                  {p.costCompare.inHouseTitle}
                </span>
                <ul className="mt-5 space-y-3">
                  {p.costCompare.inHouseItems.map((item) => (
                    <li key={item} className="flex items-center gap-2.5 text-sm text-paper">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-[#7C8EA3]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </GlassPanel>
            </Reveal>
            <Reveal delay={0.18} className="h-full">
              <GlassPanel
                elevated
                className="h-full border-[rgba(176,141,87,0.35)] bg-[rgba(176,141,87,0.09)] p-[clamp(22px,3vw,40px)]"
              >
                <span className="border-b border-[rgba(176,141,87,0.35)] pb-3 text-[13px] font-semibold tracking-[0.04em] text-gold">
                  {p.costCompare.ankoraTitle}
                </span>
                <ul className="mt-5 space-y-3">
                  {p.costCompare.ankoraItems.map((item) => (
                    <li key={item} className="flex items-center gap-2.5 text-sm text-paper">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-gold" />
                      {item}
                    </li>
                  ))}
                </ul>
              </GlassPanel>
            </Reveal>
          </div>
        </WideContainer>
      </section>

      {/* Hour bank mechanic */}
      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal><Eyebrow>{p.hourBank.label}</Eyebrow></Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
              {p.hourBank.title}
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p className="mt-6 max-w-2xl font-assistant text-[#A9B8C9]">{p.hourBank.body}</p>
          </Reveal>

          {/* 3-month rollover bar chart + legend (design spec called for this; it had
              never actually been implemented -- Ariel: "without the legend the diagram
              isn't understandable"). Sample numbers, illustrative only. Colors ported to
              the dark palette (was navy-on-cream, now paper-on-dark, same two-tone
              used/rollover contrast). */}
          {p.hourBank.chart && (
            <Reveal delay={0.18} className="mt-12">
              <GlassPanel elevated className="p-[clamp(22px,3vw,40px)]">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2 text-xs text-[#A9B8C9]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#7C8EA3]" />
                    {p.hourBank.chart.usedLabel}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#A9B8C9]">
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
                        <div className="flex h-40 w-full max-w-[64px] flex-col-reverse overflow-hidden rounded-lg bg-[rgba(243,234,219,0.06)]">
                          <div className="w-full bg-[#7C8EA3]" style={{ height: `${usedPct}%` }} />
                          <div className="w-full bg-gold" style={{ height: `${rolloverPct}%` }} />
                        </div>
                        <span className="mt-3 text-xs text-[#7C8EA3]">{m.label}</span>
                      </div>
                    );
                  })}
                </div>
              </GlassPanel>
            </Reveal>
          )}

          <RevealStagger className="mt-14">
            <HairlineGrid minCell={280}>
              {p.hourBank.points.map((pt) => (
                <motion.div key={pt.title} variants={staggerItem}>
                  <HairlineGridCell>
                    <h3 className="text-lg font-medium text-paper">{pt.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#A9B8C9]">{pt.body}</p>
                  </HairlineGridCell>
                </motion.div>
              ))}
            </HairlineGrid>
          </RevealStagger>
        </WideContainer>
      </section>

      {/* Closing CTA -- same title/body/button scale as the shared HeFinalCTA component,
          plus the secondary ROI-calculator link, which HeFinalCTA doesn't support and
          which is specific to this page (Ariel asked for it alongside, not instead of,
          the contact CTA). */}
      <section className="relative overflow-hidden border-t border-[rgba(243,234,219,0.12)] py-[clamp(44px,7vw,112px)]">
        <WideContainer className="relative text-center">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-paper">
              {p.closing.title}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-md font-assistant text-[#A9B8C9]">{p.closing.body}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <Button href={withLocale(locale, "/contact")}>{p.closing.cta}</Button>
            {p.closing.secondaryCta && (
              <Button href={withLocale(locale, "/roi")} variant="ghost">
                {p.closing.secondaryCta}
              </Button>
            )}
          </Reveal>
        </WideContainer>
      </section>
    </>
  );
}

function EnPricingClient({ locale }: { locale: Locale }) {
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

export default function PricingClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;

  if (locale === "he") {
    return <HePricingClient locale={locale} />;
  }

  return <EnPricingClient locale={locale} />;
}
