"use client";

import Link from "next/link";
import type { Locale, SegmentContent } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
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

export function SegmentPage({
  content,
  locale,
  cta,
}: {
  content: SegmentContent;
  locale: Locale;
  cta: string;
}) {
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
