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
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

export function AnkoraVsPersonalAssistantPage({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const p = dict.pages.ankoraVsPersonalAssistant;

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
          <ComparisonTable columnA={p.columnA} columnB={p.columnB} rows={p.table} />
        </Container>
      </section>

      <section className="bg-navy py-20 md:py-28">
        <Container className="grid gap-10 md:grid-cols-2">
          <div>
            <Reveal>
              <h2 className="text-xl font-medium text-paper">{p.choosePA.title}</h2>
            </Reveal>
            <RevealStagger className="mt-6 flex flex-col gap-3">
              {p.choosePA.items.map((item) => (
                <motion.div key={item} variants={staggerItem} className="rounded-xl border border-line px-5 py-4 text-sm leading-relaxed text-paper/60">
                  {item}
                </motion.div>
              ))}
            </RevealStagger>
          </div>
          <div>
            <Reveal delay={0.06}>
              <h2 className="text-xl font-medium text-gold-light">{p.chooseAnkora.title}</h2>
            </Reveal>
            <RevealStagger className="mt-6 flex flex-col gap-3">
              {p.chooseAnkora.items.map((item) => (
                <motion.div key={item} variants={staggerItem} className="rounded-xl border border-lineGold/40 bg-white/[0.02] px-5 py-4 text-sm leading-relaxed text-paper/75">
                  {item}
                </motion.div>
              ))}
            </RevealStagger>
          </div>
        </Container>
      </section>

      <section className="bg-cream py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-navy md:text-[36px]">
              {p.whereAnkoraFits.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl text-navy/60">{p.whereAnkoraFits.body}</p>
          </Reveal>
        </Container>
      </section>

      <PageFAQ label={p.eyebrow} title="FAQ" items={p.faq} tone="light" />

      <RelatedLinks
        locale={locale}
        label={dict.nav.relatedReading}
        items={[
          { label: dict.nav.personalOperationsManagement, href: "/personal-operations-management" },
          { label: dict.nav.personalAssistantForExecutives, href: "/personal-assistant-for-executives" },
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
