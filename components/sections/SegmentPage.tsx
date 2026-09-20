"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { Dictionary, Locale, SegmentContent } from "@/content";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { SectionShell } from "@/components/ui/SectionShell";
import { WideContainer } from "@/components/ui/WideContainer";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Button } from "@/components/ui/Button";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";

/**
 * A "who it's for" page: hero, the bridge paragraph with its two inline links, three
 * capability cards, a centred gold closing line, then cross-links to the other three
 * profiles.
 *
 * The bridge paragraph and the cross-link heading now come from the dictionary
 * (`segmentBridge`) rather than from a `bridge` constant and a ternary at four call
 * sites. They were copy living in component files, which is how the English half of
 * the site ended up with strings nobody reviewing `content/en.ts` could see.
 */
export function SegmentPage({
  content,
  dict,
  locale,
  cta,
  currentHref,
}: {
  content: SegmentContent;
  dict: Dictionary;
  locale: Locale;
  cta: string;
  currentHref: string;
}) {
  const bridge = dict.pages.segmentBridge;
  const otherSolutions = dict.nav.solutionsMenu.filter((item) => item.href !== currentHref);
  const link =
    "text-cream underline decoration-gold/40 underline-offset-4 transition-colors hover:text-gold";

  return (
    <>
      <section className="relative overflow-hidden pb-16 pt-40 md:pb-20 md:pt-48">
        <WideContainer className="relative z-[1]">
          <div className="mb-8">
            <Breadcrumbs
              locale={locale}
              items={[
                { label: dict.nav.home, href: "/" },
                { label: dict.nav.solutions, href: "/solutions" },
                { label: content.eyebrow },
              ]}
            />
          </div>
          <Reveal>
            <Eyebrow>{content.eyebrow}</Eyebrow>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="mt-6 max-w-3xl text-balance text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.1] tracking-[-0.03em] text-cream">
              {content.title}
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mt-6 max-w-[48ch] font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-body">
              {content.sub}
            </p>
          </Reveal>
        </WideContainer>
      </section>

      <SectionShell>
        <Reveal>
          <p className="max-w-[72ch] font-assistant font-light leading-[1.8] text-muted">
            {bridge.pre}
            <Link href={withLocale(locale, "/personal-operations-management")} className={link}>
              {bridge.categoryLink}
            </Link>
            {bridge.mid}
            <Link href={withLocale(locale, "/personal-assistant-for-executives")} className={link}>
              {bridge.comparisonLink}
            </Link>
            {bridge.post}
          </p>
        </Reveal>
        <RevealStagger className="mt-10">
          <HairlineGrid minCell={280}>
            {content.bullets.map((bullet) => (
              <motion.div key={bullet.title} variants={staggerItem} className="h-full">
                <HairlineGridCell>
                  <h2 className="text-[1.12rem] font-normal text-cream">{bullet.title}</h2>
                  <p className="mt-2 font-assistant text-sm font-light leading-[1.7] text-muted">
                    {bullet.body}
                  </p>
                </HairlineGridCell>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
      </SectionShell>

      <SectionShell containerClassName="max-w-2xl">
        <Reveal>
          <p className="text-center text-pretty text-[clamp(1.5rem,2.6vw,2.3rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-gold">
            {content.closing}
          </p>
        </Reveal>
      </SectionShell>

      {otherSolutions.length > 0 && (
        <SectionShell>
          <Reveal>
            <Eyebrow>{bridge.moreLabel}</Eyebrow>
          </Reveal>
          <RevealStagger className="mt-8">
            <HairlineGrid minCell={280}>
              {otherSolutions.map((item) => (
                <motion.div key={item.href} variants={staggerItem} className="h-full">
                  <Link href={withLocale(locale, item.href)} className="group block h-full">
                    <HairlineGridCell className="transition-colors duration-[350ms] group-hover:bg-[rgba(176,141,87,0.08)]">
                      <h2 className="text-base font-medium text-cream transition-colors group-hover:text-gold">
                        {item.label}
                      </h2>
                      <p className="mt-2 font-assistant text-sm font-light leading-[1.7] text-muted">
                        {item.blurb}
                      </p>
                    </HairlineGridCell>
                  </Link>
                </motion.div>
              ))}
            </HairlineGrid>
          </RevealStagger>
        </SectionShell>
      )}

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(64px,9vw,130px)]">
        <WideContainer className="flex justify-center text-center">
          <Reveal>
            <Button href={withLocale(locale, "/contact")}>{cta}</Button>
          </Reveal>
        </WideContainer>
      </section>
    </>
  );
}
