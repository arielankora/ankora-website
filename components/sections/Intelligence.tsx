"use client";

import { motion } from "framer-motion";
import type { Dictionary } from "@/content";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";

/**
 * Home page technology block: two-line H2 with the second line in gold, a lead, then
 * the four pillars in a 1px grid.
 *
 * The pillar cards carry no Latin mono key. The spec's prose says they do, but the
 * prototype renders title and body only, and the earlier round had removed the key
 * for a reason that still holds — a Latin keyword above a Hebrew title restates it.
 * The `key` field stays in the dictionary so turning them on is a one-line change.
 */
export function Intelligence({ dict }: { dict: Dictionary }) {
  return (
    <SectionShell>
      <Reveal>
        <Eyebrow>{dict.intelligence.label}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mt-6 max-w-[22ch] text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
          <span className="block">{dict.intelligence.titleLine1}</span>
          <span className="block font-light text-gold">{dict.intelligence.titleLine2}</span>
        </h2>
      </Reveal>
      <Reveal delay={0.14}>
        <p className="mt-6 max-w-[56ch] font-assistant font-light leading-[1.75] text-muted">
          {dict.intelligence.body}
        </p>
      </Reveal>

      <RevealStagger className="mt-14">
        <HairlineGrid minCell={260}>
          {dict.intelligence.pillars.map((pillar) => (
            <motion.div key={pillar.key} variants={staggerItem} className="h-full">
              <HairlineGridCell className="transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.05)]">
                <h3 className="text-[1.12rem] font-normal text-cream">{pillar.title}</h3>
                <p className="mt-2 font-assistant text-sm font-light leading-[1.7] text-muted">
                  {pillar.body}
                </p>
              </HairlineGridCell>
            </motion.div>
          ))}
        </HairlineGrid>
      </RevealStagger>
    </SectionShell>
  );
}
