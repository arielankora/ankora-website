"use client";

import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

export function Trust({ dict }: { dict: Dictionary }) {
  return (
    <section className="bg-navy py-24 md:py-32">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <Reveal><Badge>{dict.trust.label}</Badge></Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-6 text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[38px]">
                {dict.trust.title}
              </h2>
            </Reveal>
            <Reveal delay={0.14}>
              <p className="mt-5 max-w-lg text-paper/55">{dict.trust.body}</p>
            </Reveal>
          </div>
          <RevealStagger className="grid grid-cols-2 gap-4">
            {dict.trust.badges.map((b) => (
              <motion.div
                key={b}
                variants={staggerItem}
                className="flex items-center gap-3 rounded-xl border border-line px-5 py-4"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-light" />
                <span className="text-sm text-paper/80">{b}</span>
              </motion.div>
            ))}
          </RevealStagger>
        </div>
      </Container>
    </section>
  );
}