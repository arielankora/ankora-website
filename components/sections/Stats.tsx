"use client";

import { motion } from "framer-motion";
import type { Dictionary } from "@/content";
import { SectionShell } from "@/components/ui/SectionShell";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { RevealStagger, staggerItem } from "@/components/motion/Reveal";

/**
 * The four-cell stats strip below the hero: 1 / 24-7 / 0 / 20 minutes.
 *
 * The values are Latin numerals in both dictionaries but the captions are not, so the
 * figure is `tabular-nums` and the caption is ordinary body text. Nothing here is a
 * measured claim — each cell restates a property of the service, which is why there
 * are no units, deltas or trend lines.
 */
export function Stats({ dict }: { dict: Dictionary }) {
  return (
    <SectionShell>
      <RevealStagger>
        <HairlineGrid minCell={220}>
          {dict.stats.map((stat) => (
            <motion.div key={stat.label} variants={staggerItem} className="h-full">
              <HairlineGridCell>
                <div className="text-[clamp(1.9rem,3vw,2.8rem)] font-extralight tabular-nums leading-none text-gold">
                  {stat.value}
                </div>
                <p className="mt-4 font-assistant text-sm font-light leading-[1.7] text-tone-muted">
                  {stat.label}
                </p>
              </HairlineGridCell>
            </motion.div>
          ))}
        </HairlineGrid>
      </RevealStagger>
    </SectionShell>
  );
}
