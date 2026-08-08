"use client";

import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

export default function AboutPage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.about;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />
      <section className="bg-navy py-20 md:py-28">
        <Container className="grid gap-8 md:grid-cols-2">
          {p.blocks.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.08}>
              <h3 className="text-xl font-medium text-paper">{b.title}</h3>
              <p className="mt-3 leading-relaxed text-paper/55">{b.body}</p>
            </Reveal>
          ))}
        </Container>
      </section>
      <section className="bg-ink py-20 md:py-28">
        <Container>
          <Reveal><span className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/40">Principles</span></Reveal>
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