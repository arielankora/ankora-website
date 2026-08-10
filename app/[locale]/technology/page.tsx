"use client";

import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

export default function TechnologyPage({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.technology;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />
      <section className="bg-cream py-20 md:py-28">
        <Container>
          <RevealStagger className="grid gap-4 md:grid-cols-2">
            {p.blocks.map((b) => (
              <motion.div key={b.title} variants={staggerItem} className="rounded-2xl border border-lineDark bg-paper p-8 hover:border-gold/50 transition-colors">
                <h3 className="text-lg font-medium text-gold">{b.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-navy/60">{b.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>
    </>
  );
}
