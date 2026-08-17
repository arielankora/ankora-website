"use client";

import type { Dictionary, Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

export function AboutPageClient({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const p = dict.pages.about;

  return (
    <>
      <PageHero
        eyebrow={p.eyebrow}
        title={p.title}
        sub={p.sub}
        breadcrumb={
          <Breadcrumbs locale={locale} items={[{ label: dict.hero.eyebrow, href: "/" }, { label: p.eyebrow }]} />
        }
      />

      {/* Factual entity definition, first, ahead of the brand story below */}
      <section className="bg-cream py-16 md:py-20">
        <Container className="max-w-3xl">
          <Reveal>
            <p className="text-lg leading-relaxed text-navy md:text-xl">{p.entityDefinition}</p>
          </Reveal>
        </Container>
      </section>

      <section className="bg-paper py-20 md:py-28">
        <Container className="grid gap-8 md:grid-cols-2">
          {p.blocks.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.08}>
              <h3 className="text-xl font-medium text-navy">{b.title}</h3>
              <p className="mt-3 leading-relaxed text-navy/60">{b.body}</p>
            </Reveal>
          ))}
        </Container>
      </section>
      <section className="bg-ink py-20 md:py-28">
        <Container>
          <Reveal><span className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/40">{p.principlesLabel}</span></Reveal>
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
