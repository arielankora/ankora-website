"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { RevealStagger, staggerItem } from "@/components/motion/Reveal";

/**
 * The "other profiles" grid, extracted so the page around it can stay a server
 * component. `framer-motion` needs a client boundary -- without one the page throws
 * `createContext is not a function` and returns a 500, which typecheck and lint both
 * pass cleanly. The accessibility gate is what caught it, by noticing the page had no
 * h1 at all.
 */
export function ProfileCrossLinks({
  locale,
  items,
}: {
  locale: Locale;
  items: { label: string; blurb: string; href: string }[];
}) {
  return (
    <RevealStagger className="mt-6">
      <HairlineGrid minCell={240}>
        {items.map((item) => (
          <motion.div key={item.href} variants={staggerItem} className="h-full">
            <Link href={withLocale(locale, item.href)} className="group block h-full">
              <HairlineGridCell className="transition-colors duration-[350ms] group-hover:bg-[rgba(176,141,87,0.08)]">
                <h3 className="text-base font-medium text-cream transition-colors group-hover:text-gold">
                  {item.label}
                </h3>
                <p className="mt-2 font-assistant text-sm font-light leading-[1.7] text-muted">
                  {item.blurb}
                </p>
              </HairlineGridCell>
            </Link>
          </motion.div>
        ))}
      </HairlineGrid>
    </RevealStagger>
  );
}
