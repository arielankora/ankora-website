"use client";

import { motion } from "framer-motion";
import type { Dictionary, Locale } from "@/content";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { SectionShell } from "@/components/ui/SectionShell";
import { WideContainer } from "@/components/ui/WideContainer";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";

/**
 * About: intro paragraph, vision and mission as two glass panels, then the four
 * principle cards.
 *
 * This page writes its own hero rather than using PageHero, because its `sub`
 * ("Not time. Attention.") is a gold hook line at heading scale, not a lead
 * paragraph — the whole page turns on that one sentence.
 */
export function AboutPageClient({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const p = dict.pages.about;

  return (
    <>
      <section className="relative overflow-hidden pb-16 pt-40 md:pb-20 md:pt-48">
        <WideContainer className="relative z-[1]">
          <div className="mb-8">
            <Breadcrumbs
              locale={locale}
              items={[{ label: dict.nav.home, href: "/" }, { label: p.eyebrow }]}
            />
          </div>
          <Reveal>
            <Eyebrow>{p.eyebrow}</Eyebrow>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="mt-6 max-w-3xl text-balance text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.1] tracking-[-0.03em] text-cream">
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

      <SectionShell>
        <Reveal>
          <p className="max-w-[88ch] font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-body">
            {p.entityDefinition}
          </p>
        </Reveal>
      </SectionShell>

      <SectionShell>
        <div
          className="grid items-stretch gap-6"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}
        >
          {p.blocks.map((block, i) => (
            <Reveal key={block.title} delay={i * 0.08} className="h-full">
              <GlassPanel elevated className="h-full p-[clamp(22px,3vw,40px)]">
                <h2 className="font-assistant text-[13px] font-semibold tracking-[0.04em] text-gold rtl:tracking-normal">
                  {block.title}
                </h2>
                <p className="mt-4 font-assistant font-light leading-[1.8] text-muted">
                  {block.body}
                </p>
              </GlassPanel>
            </Reveal>
          ))}
        </div>
      </SectionShell>

      <SectionShell>
        <Reveal>
          <Eyebrow>{p.principlesLabel}</Eyebrow>
        </Reveal>
        <RevealStagger className="mt-8">
          <HairlineGrid minCell={280}>
            {p.principles.map((principle) => (
              <motion.div key={principle.title} variants={staggerItem} className="h-full">
                <HairlineGridCell className="transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.05)]">
                  <h3 className="text-[1.12rem] font-normal text-cream">{principle.title}</h3>
                  <p className="mt-2 font-assistant text-sm font-light leading-[1.7] text-muted">
                    {principle.body}
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
