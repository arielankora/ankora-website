"use client";

import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { withLocale } from "@/lib/nav";
import { motion } from "framer-motion";

export default function HowItWorksPage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.howItWorks;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />
      <section className="bg-cream py-20 md:py-28">
        <Container>
          <RevealStagger className="grid gap-px overflow-hidden rounded-2xl border border-lineDark bg-lineDark md:grid-cols-2 lg:grid-cols-5">
            {p.blocks.map((b, i) => (
              <motion.div key={b.title} variants={staggerItem} className="bg-paper p-7">
                <span className="font-mono text-xs text-gold/70">0{i + 1}</span>
                <h3 className="mt-4 text-lg font-medium text-navy">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy/55">{b.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>
      <section className="bg-ink py-24 md:py-32">
        <Container className="max-w-2xl text-center">
          <Reveal>
            <h2 className="text-[26px] font-medium tracking-tight text-paper md:text-[36px]">{p.vignette.title}</h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-5 leading-relaxed text-paper/55">{p.vignette.body}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-9 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{dict.hero.ctaPrimary}</Button>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
