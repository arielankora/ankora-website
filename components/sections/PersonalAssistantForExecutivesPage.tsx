"use client";

import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { PageFAQ } from "@/components/sections/PageFAQ";
import { RelatedLinks } from "@/components/sections/RelatedLinks";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

export function PersonalAssistantForExecutivesPage({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const p = dict.pages.personalAssistantForExecutives;

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

      <section className="bg-cream py-16 md:py-20">
        <Container className="max-w-3xl">
          <Reveal>
            <p className="text-lg leading-relaxed text-navy md:text-xl">{p.directAnswer}</p>
          </Reveal>
        </Container>
      </section>

      <section className="bg-paper py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-navy md:text-[36px]">
              {p.expectations.title}
            </h2>
          </Reveal>
          <RevealStagger className="mt-8 flex flex-wrap gap-3">
            {p.expectations.items.map((item) => (
              <motion.span key={item} variants={staggerItem} className="rounded-full border border-lineDark bg-cream px-5 py-2.5 text-sm text-navy/70">
                {item}
              </motion.span>
            ))}
          </RevealStagger>
        </Container>
      </section>

      <section className="bg-navy py-20 md:py-28">
        <Container>
          <Reveal><Badge tone="dark">{p.eyebrow}</Badge></Reveal>
          <Reveal delay={0.06}>
            <h2 className="mt-6 max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-paper md:text-[36px]">
              {p.whenPARight.title}
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-4 max-w-2xl text-paper/55">{p.whenPARight.body}</p>
          </Reveal>
        </Container>
      </section>

      <section className="bg-cream py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-navy md:text-[36px]">
              {p.wherePAFalls.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl text-navy/60">{p.wherePAFalls.body}</p>
          </Reveal>
          <RevealStagger className="mt-8 grid gap-3 md:grid-cols-2">
            {p.wherePAFalls.items.map((item) => (
              <motion.div key={item} variants={staggerItem} className="flex items-start gap-3 rounded-xl border border-lineDark bg-paper px-5 py-4 text-sm leading-relaxed text-navy/70">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold" />
                {item}
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>

      <section className="bg-ink py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-paper md:text-[36px]">
              {p.ankoraModel.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl text-paper/55">{p.ankoraModel.body}</p>
          </Reveal>
          <RevealStagger className="mt-10 grid gap-4 md:grid-cols-3">
            {p.ankoraModel.points.map((pt) => (
              <motion.div key={pt.title} variants={staggerItem} className="rounded-2xl border border-line p-7">
                <h3 className="font-medium text-paper">{pt.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-paper/50">{pt.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>

      <section className="bg-paper py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-navy md:text-[36px]">
              {p.whenFullTimePA.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl text-navy/60">{p.whenFullTimePA.body}</p>
          </Reveal>
          <RevealStagger className="mt-8 grid gap-3 md:grid-cols-2">
            {p.whenFullTimePA.items.map((item) => (
              <motion.div key={item} variants={staggerItem} className="rounded-xl border border-lineDark bg-cream/50 px-5 py-4 text-sm text-navy/70">
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
          { label: dict.nav.personalOperationsManagement, href: "/personal-operations-management" },
          { label: dict.nav.ankoraVsPersonalAssistant, href: "/ankora-vs-personal-assistant" },
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
