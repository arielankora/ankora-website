"use client";

import Link from "next/link";
import type { Locale, SegmentContent } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { RevealStagger, staggerItem, Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { withLocale } from "@/lib/nav";
import { motion } from "framer-motion";

const bridge = {
  en: {
    pre: "This is one application of Ankora's ",
    pomLabel: "Personal Operations Management",
    mid: ", an outsourced ",
    paLabel: "alternative to hiring a personal assistant",
    post: " for executives, founders and family offices.",
  },
  he: {
    pre: "זהו יישום של ",
    pomLabel: "ניהול תפעול אישי",
    mid: " מבית Ankora, ",
    paLabel: "חלופה להעסקת עוזר אישי",
    post: " למנהלים בכירים, יזמים ומשרדי משפחה.",
  },
} as const;

type SolutionsMenuItem = { label: string; blurb: string; href: string };

// /he redesign: solutions pages (design_handoff_ankora_redesign/README.md, section
// "6-9. Solutions"). Structure per spec: eyebrow/H1/lead, the frozen boilerplate two-link
// paragraph, three glass cards, a gold closing line, then a NEW "פתרונות נוספים" cross-link
// block to the other three segment pages (new UI chrome, not a copy rewrite -- flagging for
// Ariel's sanity-check), then CTA.
function HeSegmentPage({
  content,
  locale,
  cta,
  currentHref,
  solutionsMenu,
  crossLinkLabel,
}: {
  content: SegmentContent;
  locale: Locale;
  cta: string;
  currentHref: string;
  solutionsMenu: SolutionsMenuItem[];
  crossLinkLabel: string;
}) {
  const copy = bridge.he;
  const otherSolutions = solutionsMenu.filter((item) => item.href !== currentHref);

  return (
    <>
      <section className="relative overflow-hidden pb-16 pt-40 md:pb-20 md:pt-48">
        <WideContainer className="relative z-[1]">
          <div className="mb-8">
            <Breadcrumbs locale={locale} items={[{ label: "עבור מי", href: "/solutions" }, { label: content.eyebrow }]} />
          </div>
          <Reveal><Eyebrow>{content.eyebrow}</Eyebrow></Reveal>
          <Reveal delay={0.08}>
            <h1 className="mt-6 max-w-3xl text-[clamp(2.2rem,5.2vw,4.7rem)] font-extralight leading-[1.05] tracking-[-0.03em] text-paper">
              {content.title}
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mt-6 max-w-xl font-assistant text-lg leading-relaxed text-[#D8CAB5]">{content.sub}</p>
          </Reveal>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <Reveal>
            <p className="max-w-2xl font-assistant leading-relaxed text-[#A9B8C9]">
              {copy.pre}
              <Link
                href={withLocale(locale, "/personal-operations-management")}
                className="text-paper underline decoration-gold/40 underline-offset-4 hover:text-gold"
              >
                {copy.pomLabel}
              </Link>
              {copy.mid}
              <Link
                href={withLocale(locale, "/personal-assistant-for-executives")}
                className="text-paper underline decoration-gold/40 underline-offset-4 hover:text-gold"
              >
                {copy.paLabel}
              </Link>
              {copy.post}
            </p>
          </Reveal>
          <RevealStagger className="mt-10">
            <HairlineGrid minCell={280}>
              {content.bullets.map((b) => (
                <motion.div key={b.title} variants={staggerItem}>
                  <HairlineGridCell>
                    <h3 className="text-lg font-medium text-paper">{b.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#A9B8C9]">{b.body}</p>
                  </HairlineGridCell>
                </motion.div>
              ))}
            </HairlineGrid>
          </RevealStagger>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer className="max-w-2xl">
          <Reveal>
            <p className="text-center text-[clamp(1.5rem,2.6vw,2.3rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-gold">
              {content.closing}
            </p>
          </Reveal>
        </WideContainer>
      </section>

      {otherSolutions.length > 0 && (
        <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
          <WideContainer>
            <Reveal><Eyebrow>{crossLinkLabel}</Eyebrow></Reveal>
            <RevealStagger className="mt-8">
              <HairlineGrid minCell={280}>
                {otherSolutions.map((item) => (
                  <motion.div key={item.href} variants={staggerItem}>
                    <HairlineGridCell>
                      <Link href={withLocale(locale, item.href)} className="group block">
                        <h4 className="text-base font-medium text-paper transition-colors group-hover:text-gold">{item.label}</h4>
                        <p className="mt-2 text-sm leading-relaxed text-[#A9B8C9]">{item.blurb}</p>
                      </Link>
                    </HairlineGridCell>
                  </motion.div>
                ))}
              </HairlineGrid>
            </RevealStagger>
          </WideContainer>
        </section>
      )}

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(44px,7vw,112px)]">
        <WideContainer className="max-w-2xl text-center">
          <Reveal delay={0.1} className="flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{cta}</Button>
          </Reveal>
        </WideContainer>
      </section>
    </>
  );
}

export function SegmentPage({
  content,
  locale,
  cta,
  currentHref,
  solutionsMenu,
  crossLinkLabel,
}: {
  content: SegmentContent;
  locale: Locale;
  cta: string;
  currentHref: string;
  solutionsMenu: SolutionsMenuItem[];
  crossLinkLabel: string;
}) {
  if (locale === "he") {
    return (
      <HeSegmentPage
        content={content}
        locale={locale}
        cta={cta}
        currentHref={currentHref}
        solutionsMenu={solutionsMenu}
        crossLinkLabel={crossLinkLabel}
      />
    );
  }

  const copy = bridge[locale];
  return (
    <>
      <PageHero eyebrow={content.eyebrow} title={content.title} sub={content.sub} />
      <section className="bg-cream py-20 md:py-28">
        <Container>
          <Reveal>
            <p className="mx-auto mb-12 max-w-2xl text-center text-sm leading-relaxed text-navy/55">
              {copy.pre}
              <Link
                href={withLocale(locale, "/personal-operations-management")}
                className="text-navy underline decoration-gold/40 underline-offset-4 hover:text-gold"
              >
                {copy.pomLabel}
              </Link>
              {copy.mid}
              <Link
                href={withLocale(locale, "/personal-assistant-for-executives")}
                className="text-navy underline decoration-gold/40 underline-offset-4 hover:text-gold"
              >
                {copy.paLabel}
              </Link>
              {copy.post}
            </p>
          </Reveal>
          <RevealStagger className="grid gap-4 md:grid-cols-3">
            {content.bullets.map((b) => (
              <motion.div key={b.title} variants={staggerItem} className="rounded-2xl border border-lineDark bg-paper p-7">
                <h3 className="text-lg font-medium text-navy">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy/55">{b.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>
      <section className="bg-ink py-20 md:py-28">
        <Container className="text-center">
          <Reveal>
            <p className="mx-auto max-w-lg text-xl font-medium text-paper md:text-2xl">{content.closing}</p>
          </Reveal>
          <Reveal delay={0.1} className="mt-8 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{cta}</Button>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
