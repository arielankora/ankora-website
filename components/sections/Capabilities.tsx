"use client";

import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { Badge } from "@/components/ui/Badge";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";
import { Clock, Handshake, FileText, Briefcase, Home, Plane } from "lucide-react";

// One icon per capability card, in the same order as dict.capabilities.items
// (personal ops, vendor coordination, admin liaison, business ops, property/household, travel/logistics).
const CAPABILITY_ICONS = [Clock, Handshake, FileText, Briefcase, Home, Plane];

export function Capabilities({ dict }: { dict: Dictionary }) {
  return (
    <section className="bg-ink py-24 md:py-36">
      <Container>
        <Reveal><Badge>{dict.capabilities.label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
            {dict.capabilities.title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 max-w-xl text-paper/50">{dict.capabilities.sub}</p>
        </Reveal>

        <RevealStagger className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {dict.capabilities.items.map((item, i) => {
            const Icon = CAPABILITY_ICONS[i % CAPABILITY_ICONS.length];
            return (
              <motion.div
                key={item.title}
                variants={staggerItem}
                className="group rounded-2xl border border-line p-7 transition-colors hover:border-lineGold hover:bg-white/[0.02]"
              >
                <div className="flex h-8 w-8 items-center justify-center">
                  <Icon className="h-5 w-5 text-gold-light" strokeWidth={1.5} />
                </div>
                <h3 className="mt-5 text-lg font-medium text-paper">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-paper/50">{item.body}</p>
              </motion.div>
            );
          })}
        </RevealStagger>
      </Container>
    </section>
  );
}