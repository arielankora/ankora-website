"use client";

import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

// /he redesign: home page "Technology block" (design_handoff_ankora_redesign/README.md).
// Two-line H2 (second line gold, nowrap), then a four-cell glass grid with no label
// above the card title -- "a rule we removed deliberately: the grid dividers already
// supply rhythm, and a Latin keyword duplicated the Hebrew title."
function HeIntelligence({ dict }: { dict: Dictionary }) {
  const splitAt = dict.intelligence.title.indexOf(". ");
  const line1 = splitAt === -1 ? dict.intelligence.title : dict.intelligence.title.slice(0, splitAt + 1);
  const line2 = splitAt === -1 ? "" : dict.intelligence.title.slice(splitAt + 2);

  return (
    <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
      <WideContainer>
        <Reveal><Eyebrow>{dict.intelligence.label}</Eyebrow></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
            <span className="block">{line1}</span>
            {line2 && <span className="block whitespace-nowrap font-light text-gold">{line2}</span>}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-6 max-w-2xl font-assistant text-[#A9B8C9]">{dict.intelligence.body}</p>
        </Reveal>

        <RevealStagger className="mt-14">
          <HairlineGrid minCell={260}>
            {dict.intelligence.pillars.map((p) => (
              <motion.div key={p.title} variants={staggerItem}>
                <HairlineGridCell>
                  <h3 className="text-lg font-medium text-paper">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#A9B8C9]">{p.body}</p>
                </HairlineGridCell>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
      </WideContainer>
    </section>
  );
}

export function Intelligence({ dict, locale }: { dict: Dictionary; locale?: "he" | "en" }) {
  if (locale === "he") {
    return <HeIntelligence dict={dict} />;
  }

  return (
    <section className="relative overflow-hidden bg-cream py-24 md:py-36">
      <Container className="relative">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
          <div>
            <Reveal><Badge tone="light">{dict.intelligence.label}</Badge></Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-6 text-[28px] font-medium leading-[1.2] tracking-tight text-navy md:text-[42px]">
                {dict.intelligence.title}
              </h2>
            </Reveal>
            <Reveal delay={0.14}>
              <p className="mt-6 max-w-lg text-base leading-relaxed text-navy/60 md:text-lg">
                {dict.intelligence.body}
              </p>
            </Reveal>
          </div>

          <RevealStagger className="grid grid-cols-2 gap-4">
            {dict.intelligence.pillars.map((p) => (
              <motion.div
                key={p.title}
                variants={staggerItem}
                className="rounded-2xl border border-lineDark bg-paper p-6 transition-colors hover:border-gold/50"
              >
                <h3 className="text-base font-medium text-gold">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy/55">{p.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </div>
      </Container>
    </section>
  );
}
