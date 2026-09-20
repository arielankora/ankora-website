"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";

/**
 * Home page "who it's for": four cards in a 1px grid, each ending in a labelled gold
 * link rather than a bare arrow glyph.
 *
 * The link label comes from the dictionary (`industries.itemCta`), because it carries
 * the direction-correct arrow in its own string — a left arrow in Hebrew, a right one
 * in English — exactly as the design specifies. It used to be a Hebrew literal in this
 * file, which meant /en rendered a Hebrew label pointing the wrong way.
 */
export function Industries({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <SectionShell>
      <Reveal>
        <Eyebrow>{dict.industries.label}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mb-14 mt-6 max-w-[26ch] text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-paper">
          {dict.industries.title}
        </h2>
      </Reveal>

      <RevealStagger>
        <HairlineGrid minCell={240}>
          {dict.industries.items.map((item) => (
            <motion.div key={item.title} variants={staggerItem} className="h-full">
              {/* Link wraps the cell rather than being rendered through `as`:
                  HairlineGridCell does not forward unknown props, so an `href` passed
                  to it would be dropped and the card would render as a dead link. */}
              <Link href={withLocale(locale, item.href)} className="group block h-full">
                <HairlineGridCell className="flex min-h-[230px] flex-col gap-3 transition-colors duration-[350ms] group-hover:bg-[rgba(176,141,87,0.09)]">
                  <h3 className="text-[1.22rem] font-normal text-paper">{item.title}</h3>
                  <p className="flex-1 font-assistant text-sm font-light leading-[1.7] text-tone-muted">
                    {item.body}
                  </p>
                  <span className="inline-flex items-center self-start border-b border-[rgba(176,141,87,0.4)] pb-[9px] pt-2.5 font-assistant text-[15px] font-medium text-gold transition-colors duration-300 group-hover:border-gold-light group-hover:text-gold-light">
                    {dict.industries.itemCta}
                  </span>
                </HairlineGridCell>
              </Link>
            </motion.div>
          ))}
        </HairlineGrid>
      </RevealStagger>
    </SectionShell>
  );
}
