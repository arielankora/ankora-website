"use client";

import { motion } from "framer-motion";
import type { Dictionary } from "@/content";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";

/** Home page trust block: heading and paragraph on one side, the badge rows on the other. */
export function Trust({ dict }: { dict: Dictionary }) {
  return (
    <SectionShell>
      <div
        className="grid items-center gap-12"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))" }}
      >
        <div>
          <Reveal>
            <Eyebrow>{dict.trust.label}</Eyebrow>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 text-pretty text-[clamp(1.5rem,2.6vw,2.3rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-cream">
              {dict.trust.title}
            </h2>
          </Reveal>
          <Reveal delay={0.14}>
            <p className="mt-5 max-w-[52ch] font-assistant font-light leading-[1.8] text-muted">
              {dict.trust.body}
            </p>
          </Reveal>
        </div>

        <RevealStagger className="flex flex-col gap-3">
          {dict.trust.badges.map((badge) => (
            <motion.div
              key={badge}
              variants={staggerItem}
              className="flex items-center gap-3 border border-[rgba(243,234,219,0.18)] px-5 py-[17px] transition-colors duration-[350ms] hover:border-[rgba(176,141,87,0.5)]"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              <span className="font-assistant text-sm font-light text-cream">{badge}</span>
            </motion.div>
          ))}
        </RevealStagger>
      </div>
    </SectionShell>
  );
}
