"use client";

import type { Dictionary, Locale } from "@/content";
import Link from "next/link";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

// /he redesign: home page audience grid, four cards each ending in a labelled gold
// link -- "it must be a labelled link, not a bare arrow glyph" (design_handoff_
// ankora_redesign/README.md). "לפרטים ←" ("details") is new UI chrome text specified
// verbatim by the design file, not a rewrite of existing page copy.
function HeIndustries({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
      <WideContainer>
        <Reveal><Eyebrow>{dict.industries.label}</Eyebrow></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
            {dict.industries.title}
          </h2>
        </Reveal>

        <RevealStagger className="mt-14">
          <HairlineGrid minCell={320}>
            {dict.industries.items.map((item) => (
              <motion.div key={item.title} variants={staggerItem}>
                <Link href={withLocale(locale, item.href)} className="group block">
                  <HairlineGridCell className="transition-colors duration-300 group-hover:bg-[rgba(176,141,87,0.08)]">
                    <h3 className="text-xl font-medium text-paper">{item.title}</h3>
                    <p className="mt-2 text-sm text-[#A9B8C9]">{item.body}</p>
                    <span className="mt-6 inline-block border-b border-[rgba(176,141,87,0.45)] pb-0.5 text-[15px] font-semibold text-gold">
                      לפרטים ←
                    </span>
                  </HairlineGridCell>
                </Link>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
      </WideContainer>
    </section>
  );
}

export function Industries({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  if (locale === "he") {
    return <HeIndustries dict={dict} locale={locale} />;
  }

  return (
    <section className="bg-ink py-24 md:py-36">
      <Container>
        <Reveal><Badge>{dict.industries.label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
            {dict.industries.title}
          </h2>
        </Reveal>

        <RevealStagger className="mt-16 grid gap-4 md:grid-cols-2">
          {dict.industries.items.map((item) => (
            <motion.div key={item.title} variants={staggerItem}>
              <Link
                href={withLocale(locale, item.href)}
                className="group flex items-center justify-between rounded-2xl border border-line p-8 transition-colors hover:border-lineGold hover:bg-white/[0.02]"
              >
                <div>
                  <h3 className="text-xl font-medium text-paper">{item.title}</h3>
                  <p className="mt-2 text-sm text-paper/50">{item.body}</p>
                </div>
                <span className="text-gold-light opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180">→</span>
              </Link>
            </motion.div>
          ))}
        </RevealStagger>
      </Container>
    </section>
  );
}
