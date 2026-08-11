"use client";

import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export default function PricingPage({ params }: { params: { locale: string } }) {
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

      {/* Tiers - dark with elevated light cards */}
      <section className="bg-ink py-24 md:py-36">
        <Container>
          <Reveal><Badge>{p.tiers.label}</Badge></Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
              {p.tiers.title}
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p className="mt-4 max-w-xl text-paper/55">{p.tiers.sub}</p>
          </Reveal>

          <RevealStagger className="mt-16 grid gap-6 md:grid-cols-3">
            {p.tiers.items.map((tier) => (
              <motion.div
                key={tier.name}
                variants={staggerItem}
                className={cn(
                  "flex flex-col rounded-2xl border p-8",
                  tier.highlighted
                    ? "border-gold bg-paper shadow-[0_0_0_1px_rgba(176,141,87,0.3)]"
                    : "border-lineDark bg-paper/95"
                )}
              >
                {tier.highlighted && (
                  <span className="mb-4 inline-flex w-fit items-center rounded-full bg-gold-gradient px-3 py-1 text-xs font-semibold text-ink">
                    {locale === "he" ? "הכי נפוץ" : "Most popular"}
                  </span>
                )}
                <h3 className="text-lg font-medium text-navy">{tier.name}</h3>
                <p className="mt-1 text-2xl font-medium text-navy">{tier.hours}</p>
                <p className="mt-1 text-gold">{tier.rate}</p>
                <p className="mt-4 text-sm leading-relaxed text-navy/55">{tier.blurb}</p>
              </motion.div>
            ))}
          </RevealStagger>

          <Reveal delay={0.2}>
            <p className="mt-8 text-xs leading-relaxed text-paper/40">{p.tiers.footnote}</p>
          </Reveal>
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
          <Reveal delay={0.2} className="mt-10 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{p.closing.cta}</Button>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
