"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { RevealStagger, Reveal, staggerItem } from "@/components/motion/Reveal";

/**
 * Home page capabilities: six full-width rows in a 1px grid, business operations
 * first. Each row is a link to the coverage page, carrying a Latin mono key, the
 * title, the body and a 44x44 arrow box that inverts to solid gold on hover.
 *
 * The index and the arrow are both derived rather than stored — the index from the
 * row's position, the arrow from the document direction — so neither can fall out of
 * step with the data the way the previous parallel key array did.
 */
export function Capabilities({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <SectionShell>
      <Reveal>
        <Eyebrow>{dict.capabilities.label}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mt-6 max-w-[24ch] text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-paper">
          {dict.capabilities.title}
        </h2>
      </Reveal>
      <Reveal delay={0.14}>
        <p className="mt-4 max-w-[44ch] font-assistant font-light text-tone-muted">
          {dict.capabilities.sub}
        </p>
      </Reveal>

      <RevealStagger className="mt-14 flex flex-col gap-px border border-[rgba(243,234,219,0.11)] bg-[rgba(243,234,219,0.11)]">
        {dict.capabilities.items.map((item, i) => (
          <motion.div key={item.key} variants={staggerItem}>
            <Link
              href={withLocale(locale, "/coverage")}
              // One column on a phone, the spec's three-track row from md up. The
              // three-track template on its own would squeeze the body column to zero
              // at 390px, since its first track has a 240px floor.
              className="group grid items-center gap-6 bg-[rgba(11,27,51,0.5)] p-[clamp(22px,3vw,36px)] text-paper backdrop-blur-[12px] transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.05)] [grid-template-columns:minmax(0,1fr)] md:[grid-template-columns:minmax(min(100%,240px),1fr)_minmax(0,1.6fr)_auto]"
            >
              <div>
                <span className="flex items-baseline gap-3">
                  <MonoLabel script="latin" tracking="0.15em" className="text-tone-muted">
                    {String(i + 1).padStart(2, "0")}
                  </MonoLabel>
                  <MonoLabel script="latin" tracking="0.15em" className="text-tone-muted">
                    {item.key}
                  </MonoLabel>
                </span>
                <h3 className="mt-2 text-[1.16rem] font-normal text-paper">{item.title}</h3>
              </div>
              <p className="font-assistant text-sm font-light leading-[1.7] text-tone-muted">
                {item.body}
              </p>
              {/* 44x44 is the spec's minimum touch target, and the whole row is the
                  link, so this box is a visual affordance rather than a second target. */}
              <span
                aria-hidden="true"
                className="flex h-11 w-11 flex-none items-center justify-center justify-self-end border border-[rgba(176,141,87,0.35)] text-[19px] leading-none text-gold transition-colors duration-[350ms] group-hover:border-gold group-hover:bg-gold group-hover:text-ink"
              >
                <span className="rtl:hidden">→</span>
                <span className="hidden rtl:inline">←</span>
              </span>
            </Link>
          </motion.div>
        ))}
      </RevealStagger>
    </SectionShell>
  );
}
