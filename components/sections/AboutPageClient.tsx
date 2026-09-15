"use client";

import type { Dictionary, Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

// /he redesign: About page (design_handoff_ankora_redesign/README.md, "About"). The
// existing `sub` copy ("לא הזמן. הקשב.") IS the spec's separate gold hook line -- no new
// copy needed, just a distinct visual treatment from the generic PageHero sub-paragraph.
function HeAboutPageClient({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const p = dict.pages.about;

  return (
    <>
      <section className="relative overflow-hidden pb-16 pt-40 md:pb-20 md:pt-48">
        <WideContainer className="relative z-[1]">
          <div className="mb-8">
            <Breadcrumbs locale={locale} items={[{ label: dict.hero.eyebrow, href: "/" }, { label: p.eyebrow }]} />
          </div>
          <Reveal><Eyebrow>{p.eyebrow}</Eyebrow></Reveal>
          <Reveal delay={0.08}>
            <h1 className="mt-6 max-w-3xl text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-paper">
              {p.title}
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mt-6 text-[clamp(1.5rem,3vw,2.6rem)] font-light leading-[1.2] tracking-[-0.02em] text-gold">
              {p.sub}
            </p>
          </Reveal>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal>
            <p className="max-w-[88ch] font-assistant text-lg leading-relaxed text-[#C3CEDA]">{p.entityDefinition}</p>
          </Reveal>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}
          >
            {p.blocks.map((b, i) => (
              <Reveal key={b.title} delay={i * 0.08}>
                <GlassPanel elevated className="h-full p-[clamp(22px,3vw,40px)]">
                  <h3 className="text-[13px] font-semibold tracking-[0.04em] text-gold">{b.title}</h3>
                  <p className="mt-4 font-assistant leading-relaxed text-[#A9B8C9]">{b.body}</p>
                </GlassPanel>
              </Reveal>
            ))}
          </div>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal><Eyebrow>{p.principlesLabel}</Eyebrow></Reveal>
          <RevealStagger className="mt-8">
            <HairlineGrid minCell={280}>
              {p.principles.map((pr) => (
                <motion.div key={pr.title} variants={staggerItem}>
                  <HairlineGridCell>
                    <h4 className="font-medium text-paper">{pr.title}</h4>
                    <p className="mt-2 text-sm leading-relaxed text-[#A9B8C9]">{pr.body}</p>
                  </HairlineGridCell>
                </motion.div>
              ))}
            </HairlineGrid>
          </RevealStagger>
        </WideContainer>
      </section>
    </>
  );
}

export function AboutPageClient({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  if (locale === "he") {
    return <HeAboutPageClient dict={dict} locale={locale} />;
  }

  const p = dict.pages.about;

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

      {/* Factual entity definition, first, ahead of the brand story below */}
      <section className="bg-cream py-16 md:py-20">
        <Container className="max-w-3xl">
          <Reveal>
            <p className="text-lg leading-relaxed text-navy md:text-xl">{p.entityDefinition}</p>
          </Reveal>
        </Container>
      </section>

      <section className="bg-paper py-20 md:py-28">
        <Container className="grid gap-8 md:grid-cols-2">
          {p.blocks.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.08}>
              <h3 className="text-xl font-medium text-navy">{b.title}</h3>
              <p className="mt-3 leading-relaxed text-navy/60">{b.body}</p>
            </Reveal>
          ))}
        </Container>
      </section>
      <section className="bg-ink py-20 md:py-28">
        <Container>
          <Reveal><span className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/40">{p.principlesLabel}</span></Reveal>
          <RevealStagger className="mt-8 grid gap-4 md:grid-cols-2">
            {p.principles.map((pr) => (
              <motion.div key={pr.title} variants={staggerItem} className="rounded-2xl border border-line p-7">
                <h4 className="font-medium text-paper">{pr.title}</h4>
                <p className="mt-2 text-sm leading-relaxed text-paper/50">{pr.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>
    </>
  );
}
