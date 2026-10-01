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
import Image from "next/image";
import { FOUNDERS } from "@/lib/founders";

/**
 * About: intro paragraph, vision and mission as two glass panels, the founders,
 * then the four principle cards.
 *
 * The founders section exists because this is the page search engines and AI
 * models read to learn who stands behind Ankora; before it, the page named no
 * one (SEO/GEO audit, 1.10.2026). Photos are monochrome so two portraits shot
 * against different backgrounds sit as one editorial pair on navy.
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
          <Eyebrow>{p.foundersLabel}</Eyebrow>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-5 max-w-2xl text-balance text-[clamp(1.6rem,3vw,2.4rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-cream">
            {p.foundersTitle}
          </h2>
        </Reveal>
        <div
          className="mt-10 grid gap-6"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}
        >
          {FOUNDERS.map((f, i) => (
            <Reveal key={f.linkedin} delay={i * 0.08} className="h-full">
              <GlassPanel elevated className="flex h-full items-center gap-6 p-[clamp(20px,2.4vw,32px)]">
                <Image
                  src={f.image}
                  alt={f.name[locale]}
                  width={112}
                  height={112}
                  className="h-24 w-24 shrink-0 rounded-full object-cover grayscale contrast-[1.05] md:h-28 md:w-28"
                />
                <div className="min-w-0">
                  <h3 className="text-[1.2rem] font-normal text-cream">{f.name[locale]}</h3>
                  <p className="mt-1 font-assistant text-sm font-light leading-[1.6] text-muted">{f.role[locale]}</p>
                  <a
                    href={f.linkedin}
                    target="_blank"
                    rel="noopener noreferrer me"
                    className="mt-3 inline-flex min-h-[24px] items-center font-assistant text-[13px] text-gold underline-offset-4 transition-colors hover:text-gold-light hover:underline"
                  >
                    {p.foundersLinkLabel}
                  </a>
                </div>
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
