"use client";

import type { Locale, SegmentContent } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { RevealStagger, staggerItem, Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { withLocale } from "@/lib/nav";
import { motion } from "framer-motion";

export function SegmentPage({
  content,
  locale,
  cta,
}: {
  content: SegmentContent;
  locale: Locale;
  cta: string;
}) {
  return (
    <>
      <PageHero eyebrow={content.eyebrow} title={content.title} sub={content.sub} />
      <section className="bg-navy py-20 md:py-28">
        <Container>
          <RevealStagger className="grid gap-4 md:grid-cols-3">
            {content.bullets.map((b) => (
              <motion.div key={b.title} variants={staggerItem} className="rounded-2xl border border-line p-7">
                <h3 className="text-lg font-medium text-paper">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-paper/50">{b.body}</p>
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