"use client";

import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

export function Intelligence({ dict }: { dict: Dictionary }) {
  return (
    <section className="relative overflow-hidden bg-navy py-24 md:py-36">
      <div className="absolute inset-0 bg-radial-glow opacity-60" />
      <Container className="relative">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
          <div>
            <Reveal><Badge>{dict.intelligence.label}</Badge></Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-6 text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
                {dict.intelligence.title}
              </h2>
            </Reveal>
            <Reveal delay={0.14}>
              <p className="mt-6 max-w-lg text-base leading-relaxed text-paper/55 md:text-lg">
                {dict.intelligence.body}
              </p>
            </Reveal>
          </div>

          <RevealStagger className="grid grid-cols-2 gap-4">
            {dict.intelligence.pillars.map((p) => (
              <motion.div
                key={p.title}
                variants={staggerItem}
                className="rounded-2xl border border-line bg-white/[0.02] p-6 backdrop-blur-sm transition-colors hover:border-lineGold"
              >
                <h3 className="text-base font-medium text-gold-light">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-paper/50">{p.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </div>
      </Container>
    </section>
  );
}