"use client";

import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { ComparisonTable } from "@/components/sections/ComparisonTable";
import { PageFAQ } from "@/components/sections/PageFAQ";
import { RelatedLinks } from "@/components/sections/RelatedLinks";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

export function PersonalOperationsManagementPage({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const p = dict.pages.personalOperationsManagement;

  return (
    <>
      <PageHero
        eyebrow={p.eyebrow}
        title={p.title}
        sub={p.sub}
        breadcrumb={
          <Breadcrumbs
            locale={locale}
            items={[
              { label: dict.hero.eyebrow, href: "/" },
              { label: p.eyebrow },
            ]}
          />
        }
      />

      {/* Direct answer, first, for humans and AI systems */}
      <section className="bg-cream py-16 md:py-20">
        <Container className="max-w-3xl">
          <Reveal>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">{p.directAnswerLabel}</span>
            <p className="mt-4 text-lg leading-relaxed text-navy md:text-xl">{p.directAnswer}</p>
          </Reveal>
        </Container>
      </section>

      {/* The problem */}
      <section className="bg-paper py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-navy md:text-[36px]">
              {p.problem.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-xl text-navy/60">{p.problem.intro}</p>
          </Reveal>
          <RevealStagger className="mt-8 grid gap-3 md:grid-cols-2">
            {p.problem.items.map((item) => (
              <motion.div
                key={item}
                variants={staggerItem}
                className="flex items-center gap-3 rounded-xl border border-lineDark bg-cream/50 px-5 py-3.5 text-sm text-navy/70"
              >
                <span className="h-1 w-1 shrink-0 rounded-full bg-gold" />
                {item}
              </motion.div>
            ))}
          </RevealStagger>
          <Reveal delay={0.16}>
            <p className="mt-8 max-w-2xl text-navy/60">{p.problem.closing}</p>
          </Reveal>
        </Container>
      </section>

      {/* What a Personal Operations Manager does */}
      <section className="bg-navy py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-paper md:text-[36px]">
              {p.whatManagerDoes.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl text-paper/55">{p.whatManagerDoes.body}</p>
          </Reveal>
          <RevealStagger className="mt-10 grid gap-4 md:grid-cols-3">
            {p.whatManagerDoes.examples.map((ex) => (
              <motion.div key={ex.title} variants={staggerItem} className="rounded-2xl border border-line p-7">
                <h3 className="font-medium text-paper">{ex.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-paper/50">{ex.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>

      {/* Comparison: PA vs Ops Manager */}
      <section className="bg-cream py-20 md:py-28">
        <Container>
          <Reveal><Badge tone="light">{p.comparisonPA.title}</Badge></Reveal>
          <Reveal delay={0.06}>
            <p className="mt-5 max-w-xl text-navy/60">{p.comparisonPA.intro}</p>
          </Reveal>
          <div className="mt-8">
            <ComparisonTable columnA={p.comparisonPA.columnA} columnB={p.comparisonPA.columnB} rows={p.comparisonPA.rows} />
          </div>
        </Container>
      </section>

      {/* Comparison: Concierge */}
      <section className="bg-paper py-20 md:py-28">
        <Container>
          <Reveal><Badge tone="light">{p.comparisonConcierge.title}</Badge></Reveal>
          <Reveal delay={0.06}>
            <p className="mt-5 max-w-xl text-navy/60">{p.comparisonConcierge.intro}</p>
          </Reveal>
          <div className="mt-8">
            <ComparisonTable columnA={p.comparisonConcierge.columnA} columnB={p.comparisonConcierge.columnB} rows={p.comparisonConcierge.rows} />
          </div>
        </Container>
      </section>

      {/* Human + AI */}
      <section className="bg-ink py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-paper md:text-[36px]">
              {p.humanAI.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl text-paper/55">{p.humanAI.body}</p>
          </Reveal>
          <RevealStagger className="mt-10 grid gap-4 md:grid-cols-2">
            {p.humanAI.points.map((pt) => (
              <motion.div key={pt.title} variants={staggerItem} className="rounded-2xl border border-line p-7">
                <h3 className="font-medium text-paper">{pt.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-paper/50">{pt.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>

      {/* Who is it for */}
      <section className="bg-cream py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-navy md:text-[36px]">
              {p.whoFor.title}
            </h2>
          </Reveal>
          <RevealStagger className="mt-8 flex flex-wrap gap-3">
            {p.whoFor.items.map((item) => (
              <motion.span
                key={item}
                variants={staggerItem}
                className="rounded-full border border-lineDark bg-paper px-5 py-2.5 text-sm text-navy/70"
              >
                {item}
              </motion.span>
            ))}
          </RevealStagger>
        </Container>
      </section>

      {/* Examples */}
      <section className="bg-paper py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-navy md:text-[36px]">
              {p.examples.title}
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {p.examples.items.map((ex, i) => (
              <Reveal key={ex.scenario} delay={i * 0.08}>
                <div className="h-full rounded-2xl border border-lineDark bg-cream/40 p-7">
                  <h3 className="text-sm font-medium text-navy">{ex.scenario}</h3>
                  <p className="mt-4 text-sm italic leading-relaxed text-navy/40">{ex.shallow}</p>
                  <div className="mt-4 h-px bg-lineDark" />
                  <p className="mt-4 text-sm leading-relaxed text-navy/70">{ex.deep}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* When it's not the right fit */}
      <section className="bg-navy py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-paper md:text-[36px]">
              {p.notRightFit.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl text-paper/55">{p.notRightFit.body}</p>
          </Reveal>
          <RevealStagger className="mt-8 grid gap-3 md:grid-cols-3">
            {p.notRightFit.items.map((item) => (
              <motion.div key={item} variants={staggerItem} className="rounded-xl border border-line px-5 py-4 text-sm text-paper/60">
                {item}
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>

      <PageFAQ label={p.eyebrow} title="FAQ" items={p.faq} tone="light" />

      <RelatedLinks
        locale={locale}
        label={dict.nav.relatedReading}
        items={[
          { label: dict.nav.personalAssistantForExecutives, href: "/personal-assistant-for-executives" },
          { label: dict.nav.ankoraVsPersonalAssistant, href: "/ankora-vs-personal-assistant" },
          { label: dict.nav.coverage, href: "/coverage" },
        ]}
      />

      <section className="relative overflow-hidden bg-ink py-28 md:py-40">
        <div className="absolute inset-0 bg-radial-glow" />
        <Container className="relative text-center">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-[32px] font-medium leading-[1.15] tracking-tight text-paper md:text-[48px]">
              {p.ctaTitle}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-md text-paper/55">{p.ctaBody}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{p.cta}</Button>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
