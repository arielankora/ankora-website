"use client";

import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

export function HowItWorks({ dict }: { dict: Dictionary }) {
  return (
    <section className="bg-ink py-24 md:py-36">
      <Container>
        <Reveal><Badge>{dict.howItWorks.label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
            {dict.howItWorks.title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 text-paper/50">{dict.howItWorks.sub}</p>
        </Reveal>

        <RevealStagger className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-5">
          {dict.howItWorks.steps.map((step, i) => (
            <motion.div key={step.title} variants={staggerItem} className="bg-navy p-7">
              <span className="font-mono text-xs text-gold-light/70">0{i + 1}</span>
              <h3 className="mt-4 text-lg font-medium text-paper">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-paper/50">{step.body}</p>
            </motion.div>
          ))}
        </RevealStagger>
      </Container>
    </section>
  );
}