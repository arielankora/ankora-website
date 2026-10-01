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
import { CustomerProof } from "@/components/sections/CustomerProof";
import type { CustomerStory } from "@/content/customer-stories/types";
import { withLocale } from "@/lib/nav";
import { LongFormSection, Prose } from "@/components/sections/LongForm";
import { PageFAQ } from "@/components/sections/PageFAQ";
import { MonoLabel } from "@/components/ui/MonoLabel";

/**
 * A "who it's for" page: hero, the bridge paragraph with its two inline links, the
 * "In short" answer, then four numbered sections (typical situations, what Ankora
 * takes on, what changes after a month, FAQ), a centred gold closing line, and
 * cross-links to the other three profiles.
 *
 * Rewritten 2.10.2026 (SEO/GEO audit, item 11): the page had 110 to 190 words and its
 * only H2s were card titles ("Founders", "Growing Companies"), so the outline did not
 * describe the page. Section titles are now the H2s; cards are H3.
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
  stories = [],
}: {
  content: SegmentContent;
  dict: Dictionary;
  locale: Locale;
  cta: string;
  currentHref: string;
  stories?: CustomerStory[];
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

      <WideContainer>
        <article className="max-w-[900px]">
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

          <Reveal>
            <div className="mt-10 border-s border-gold/40 ps-6">
              <MonoLabel tracking="0.16em" className="text-gold">
                {bridge.inShortLabel}
              </MonoLabel>
              <Prose className="mt-3 text-cream">{content.directAnswer}</Prose>
            </div>
          </Reveal>

          <LongFormSection id="situations" index={0} title={bridge.situationsTitle}>
            <div className="mt-8">
              <HairlineGrid minCell={300}>
                {content.situations.map((item) => (
                  <HairlineGridCell key={item.title}>
                    <h3 className="text-[1.08rem] font-normal text-cream">{item.title}</h3>
                    <p className="mt-2 font-assistant text-[15px] font-light leading-[1.75] text-muted">
                      {item.body}
                    </p>
                  </HairlineGridCell>
                ))}
              </HairlineGrid>
            </div>
          </LongFormSection>

          <LongFormSection id="takes" index={1} title={bridge.takesTitle}>
            <RevealStagger className="mt-8">
              <HairlineGrid minCell={240}>
                {content.bullets.map((bullet) => (
                  <motion.div key={bullet.title} variants={staggerItem} className="h-full">
                    <HairlineGridCell>
                      <h3 className="text-[1.08rem] font-normal text-cream">{bullet.title}</h3>
                      <p className="mt-2 font-assistant text-sm font-light leading-[1.7] text-muted">
                        {bullet.body}
                      </p>
                    </HairlineGridCell>
                  </motion.div>
                ))}
              </HairlineGrid>
            </RevealStagger>
          </LongFormSection>

          <LongFormSection id="after-a-month" index={2} title={bridge.afterMonthTitle}>
            <ul className="mt-6 space-y-4">
              {content.afterMonth.map((line) => (
                <li key={line} className="flex gap-4">
                  <span aria-hidden className="mt-[0.85em] h-px w-5 flex-none bg-gold/60" />
                  <span className="font-assistant text-[17px] font-light leading-[1.8] text-body">{line}</span>
                </li>
              ))}
            </ul>
          </LongFormSection>

          <LongFormSection id="faq" index={3} title={bridge.faqTitle}>
            <div className="mt-6">
              <PageFAQ
                items={content.faq}
                linkify={{
                  phrase: locale === "he" ? "דף המחירים" : "pricing page",
                  href: withLocale(locale, "/pricing"),
                }}
              />
            </div>
          </LongFormSection>
        </article>
      </WideContainer>

      <SectionShell containerClassName="max-w-2xl">
        <Reveal>
          <p className="text-center text-pretty text-[clamp(1.5rem,2.6vw,2.3rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-gold">
            {content.closing}
          </p>
        </Reveal>
      </SectionShell>

      <CustomerProof locale={locale} stories={stories} />

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
                      <h3 className="text-base font-medium text-cream transition-colors group-hover:text-gold">
                        {item.label}
                      </h3>
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
