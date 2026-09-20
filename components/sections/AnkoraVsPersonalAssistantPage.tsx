"use client";

import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { ComparisonTable } from "@/components/sections/ComparisonTable";
import { PageFAQ } from "@/components/sections/PageFAQ";
import { RelatedLinks } from "@/components/sections/RelatedLinks";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Button } from "@/components/ui/Button";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

// /he redesign: long-form SEO page (design_handoff_ankora_redesign/README.md, section
// "15. Ankora vs PA"). Gold summary box, 16-row comparison table, then two decision panels
// side by side -- grey glass with muted markers for "choose PA", gold panel with gold
// markers for "choose Ankora" -- so the decision reads at a glance, per spec.
function HeAnkoraVsPersonalAssistantPage({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const p = dict.pages.ankoraVsPersonalAssistant;

  return (
    <>
      <PageHero
        eyebrow={p.eyebrow}
        title={p.title}
        sub={p.sub}
        breadcrumb={
          <Breadcrumbs locale={locale} items={[{ label: dict.hero.eyebrow, href: "/" }, { label: p.eyebrow }]} />
        }
      />

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer className="max-w-[92ch]">
          <Reveal>
            <div className="border border-[rgba(176,141,87,0.35)] bg-[rgba(176,141,87,0.09)] p-[clamp(22px,3vw,40px)]">
              <p className="text-lg leading-relaxed text-cream">{p.directAnswer}</p>
            </div>
          </Reveal>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <ComparisonTable columnA={p.columnA} columnB={p.columnB} rows={p.table} locale="he" />
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))" }}>
            <Reveal>
              <GlassPanel className="h-full p-[clamp(22px,3vw,40px)]">
                <h2 className="text-lg font-medium text-cream">{p.choosePA.title}</h2>
                <RevealStagger className="mt-6 flex flex-col gap-3">
                  {p.choosePA.items.map((item) => (
                    <motion.div key={item} variants={staggerItem} className="flex items-start gap-3 text-sm leading-relaxed text-[#A9B8C9]">
                      <span className="mt-1.5 h-1 w-1 shrink-0 bg-[#7C8EA3]" />
                      {item}
                    </motion.div>
                  ))}
                </RevealStagger>
              </GlassPanel>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="h-full border border-[rgba(176,141,87,0.35)] bg-[rgba(176,141,87,0.09)] p-[clamp(22px,3vw,40px)]">
                <h2 className="text-lg font-medium text-gold">{p.chooseAnkora.title}</h2>
                <RevealStagger className="mt-6 flex flex-col gap-3">
                  {p.chooseAnkora.items.map((item) => (
                    <motion.div key={item} variants={staggerItem} className="flex items-start gap-3 text-sm leading-relaxed text-cream">
                      <span className="mt-1.5 h-1 w-1 shrink-0 bg-gold" />
                      {item}
                    </motion.div>
                  ))}
                </RevealStagger>
              </div>
            </Reveal>
          </div>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal>
            <h2 className="max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-cream">
              {p.whereAnkoraFits.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl font-assistant text-[#A9B8C9]">{p.whereAnkoraFits.body}</p>
          </Reveal>
        </WideContainer>
      </section>

      <PageFAQ label={p.eyebrow} title="FAQ" items={p.faq} locale="he" />

      <RelatedLinks
        locale={locale}
        label={dict.nav.relatedReading}
        items={[
          { label: dict.nav.personalOperationsManagement, href: "/personal-operations-management" },
          { label: dict.nav.personalAssistantForExecutives, href: "/personal-assistant-for-executives" },
        ]}
      />

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(44px,7vw,112px)]">
        <WideContainer className="max-w-2xl text-center">
          <Reveal>
            <h2 className="mx-auto text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-cream">
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

export function AnkoraVsPersonalAssistantPage({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  if (locale === "he") {
    return <HeAnkoraVsPersonalAssistantPage dict={dict} locale={locale} />;
  }

  const p = dict.pages.ankoraVsPersonalAssistant;

  return (
    <>
      <PageHero
        eyebrow={p.eyebrow}
        title={p.title}
        sub={p.sub}
        breadcrumb={
          <Breadcrumbs locale={locale}
            items={[
              { label: dict.hero.eyebrow, href: "/" },
              { label: p.eyebrow },
            ]}
          />
        }
      />

      <section className="bg-cream-warm py-16 md:py-20">
        <Container className="max-w-3xl">
          <Reveal>
            <p className="text-lg leading-relaxed text-appNavy md:text-xl">{p.directAnswer}</p>
          </Reveal>
        </Container>
      </section>

      <section className="bg-cream py-20 md:py-28">
        <Container>
          <ComparisonTable columnA={p.columnA} columnB={p.columnB} rows={p.table} />
        </Container>
      </section>

      <section className="bg-appNavy py-20 md:py-28">
        <Container className="grid gap-10 md:grid-cols-2">
          <div>
            <Reveal>
              <h2 className="text-xl font-medium text-cream">{p.choosePA.title}</h2>
            </Reveal>
            <RevealStagger className="mt-6 flex flex-col gap-3">
              {p.choosePA.items.map((item) => (
                <motion.div key={item} variants={staggerItem} className="rounded-xl border border-hairline px-5 py-4 text-sm leading-relaxed text-cream/60">
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
                <motion.div key={item} variants={staggerItem} className="rounded-xl border border-lineGold/40 bg-white/[0.02] px-5 py-4 text-sm leading-relaxed text-cream/75">
                  {item}
                </motion.div>
              ))}
            </RevealStagger>
          </div>
        </Container>
      </section>

      <section className="bg-cream-warm py-20 md:py-28">
        <Container>
          <Reveal>
            <h2 className="max-w-2xl text-[26px] font-medium leading-[1.2] tracking-tight text-appNavy md:text-[36px]">
              {p.whereAnkoraFits.title}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mt-4 max-w-2xl text-appNavy/60">{p.whereAnkoraFits.body}</p>
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

      <section className="relative overflow-hidden bg-navy py-28 md:py-40">
        <div className="absolute inset-0 bg-radial-glow" />
        <Container className="relative text-center">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-[32px] font-medium leading-[1.15] tracking-tight text-cream md:text-[48px]">
              {p.ctaTitle}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto mt-5 max-w-md text-cream/55">{p.ctaBody}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-10 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{p.cta}</Button>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
