"use client";

import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { PageFAQ } from "@/components/sections/PageFAQ";
import { RelatedLinks } from "@/components/sections/RelatedLinks";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

// /he redesign: long-form SEO page (design_handoff_ankora_redesign/README.md, section
// "14. PA for executives"). Marker colour carries meaning per spec: gold dash markers on
// wherePAFalls (Ankora's argument), muted #7C8EA3 dash markers on whenFullTimePA (the
// honest counter-case) -- kept that distinction exactly.
function HePersonalAssistantForExecutivesPage({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const p = dict.pages.personalAssistantForExecutives;

  return (
    <>
      <PageHero
        eyebrow={p.eyebrow}
        title={p.title}
        sub={p.sub}
        locale="he"
        breadcrumb={
          <Breadcrumbs locale={locale} items={[{ label: dict.hero.eyebrow, href: "/" }, { label: p.eyebrow }]} />
        }
      />

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer className="max-w-[92ch]">
          <Reveal>
            <div className="border border-[rgba(176,141,87,0.35)] bg-[rgba(176,141,87,0.09)] p-[clamp(22px,3vw,40px)]">
              <p className="text-lg leading-relaxed text-paper">{p.directAnswer}</p>
            </div>
          </Reveal>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal>
            <h2 className="max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
              {p.expectations.title}
            </h2>
          </Reveal>
          <RevealStagger className="mt-8 flex flex-wrap gap-3">
            {p.expectations.items.map((item) => (
              <motion.span
                key={item}
                variants={staggerItem}
                className="border border-[rgba(243,234,219,0.18)] bg-[rgba(243,234,219,0.04)] px-5 py-2.5 text-sm text-[#C3CEDA]"
              >
                {item}
              </motion.span>
            ))}
          </RevealStagger>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal><Eyebrow>{p.eyebrow}</Eyebrow></Reveal>
          <Reveal delay={0.06}>
            <h2 className="mt-6 max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
              {p.whenPARight.title}
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-4 max-w-2xl font-assistant text-[#A9B8C9]">{p.whenPARight.body}</p>
          </Reveal>
        </WideContainer>
      </section>

      {/* Gold dash markers: this is Ankora's argument */}
      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal>
            <h2 className="max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
              {p.wherePAFalls.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl font-assistant text-[#A9B8C9]">{p.wherePAFalls.body}</p>
          </Reveal>
          <RevealStagger className="mt-8">
            <HairlineGrid minCell={320}>
              {p.wherePAFalls.items.map((item) => (
                <motion.div key={item} variants={staggerItem}>
                  <HairlineGridCell className="flex items-start gap-3 text-sm leading-relaxed text-[#C3CEDA]">
                    <span className="mt-1.5 h-1 w-1 shrink-0 bg-gold" />
                    {item}
                  </HairlineGridCell>
                </motion.div>
              ))}
            </HairlineGrid>
          </RevealStagger>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal>
            <h2 className="max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
              {p.ankoraModel.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl font-assistant text-[#A9B8C9]">{p.ankoraModel.body}</p>
          </Reveal>
          <RevealStagger className="mt-10">
            <HairlineGrid minCell={280}>
              {p.ankoraModel.points.map((pt) => (
                <motion.div key={pt.title} variants={staggerItem}>
                  <HairlineGridCell>
                    <h3 className="font-medium text-paper">{pt.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#A9B8C9]">{pt.body}</p>
                  </HairlineGridCell>
                </motion.div>
              ))}
            </HairlineGrid>
          </RevealStagger>
        </WideContainer>
      </section>

      {/* Muted dash markers: the honest counter-case */}
      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal>
            <h2 className="max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
              {p.whenFullTimePA.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl font-assistant text-[#A9B8C9]">{p.whenFullTimePA.body}</p>
          </Reveal>
          <RevealStagger className="mt-8">
            <HairlineGrid minCell={320}>
              {p.whenFullTimePA.items.map((item) => (
                <motion.div key={item} variants={staggerItem}>
                  <HairlineGridCell className="flex items-start gap-3 text-sm leading-relaxed text-[#7C8EA3]">
                    <span className="mt-1.5 h-1 w-1 shrink-0 bg-[#7C8EA3]" />
                    {item}
                  </HairlineGridCell>
                </motion.div>
              ))}
            </HairlineGrid>
          </RevealStagger>
        </WideContainer>
      </section>

      <PageFAQ label={p.eyebrow} title="FAQ" items={p.faq} locale="he" />

      <RelatedLinks
        locale={locale}
        label={dict.nav.relatedReading}
        items={[
          { label: dict.nav.personalOperationsManagement, href: "/personal-operations-management" },
          { label: dict.nav.ankoraVsPersonalAssistant, href: "/ankora-vs-personal-assistant" },
        ]}
      />

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(44px,7vw,112px)]">
        <WideContainer className="max-w-2xl text-center">
          <Reveal>
            <h2 className="mx-auto text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-paper">
              {p.ctaTitle}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-md font-assistant text-[#A9B8C9]">{p.ctaBody}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{p.cta}</Button>
          </Reveal>
        </WideContainer>
      </section>
    </>
  );
}

export function PersonalAssistantForExecutivesPage({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  if (locale === "he") {
    return <HePersonalAssistantForExecutivesPage dict={dict} locale={locale} />;
  }

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
