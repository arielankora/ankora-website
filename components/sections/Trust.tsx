"use client";

import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

// /he redesign: home page trust panel + three bordered chips (design_handoff_ankora_
// redesign/README.md).
function HeTrust({ dict }: { dict: Dictionary }) {
  return (
    <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
      <WideContainer>
        <div
          className="grid items-center gap-12"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))" }}
        >
          <div>
            <Reveal><Eyebrow>{dict.trust.label}</Eyebrow></Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-6 text-[clamp(1.5rem,2.6vw,2.3rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-paper">
                {dict.trust.title}
              </h2>
            </Reveal>
            <Reveal delay={0.14}>
              <p className="mt-5 max-w-lg font-assistant text-[#A9B8C9]">{dict.trust.body}</p>
            </Reveal>
          </div>
          <RevealStagger className="grid gap-3">
            {dict.trust.badges.map((b) => (
              <motion.div
                key={b}
                variants={staggerItem}
                className="flex items-center gap-3 border border-[rgba(243,234,219,0.18)] px-5 py-4"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                <span className="text-sm text-paper">{b}</span>
              </motion.div>
            ))}
          </RevealStagger>
        </div>
      </WideContainer>
    </section>
  );
}

export function Trust({ dict, locale }: { dict: Dictionary; locale?: "he" | "en" }) {
  if (locale === "he") {
    return <HeTrust dict={dict} />;
  }

  return (
    <section className="bg-navy py-24 md:py-32">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <Reveal><Badge>{dict.trust.label}</Badge></Reveal>
            <Reveal delay={0.08}>
              <h2 className="mt-6 text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[38px]">
                {dict.trust.title}
              </h2>
            </Reveal>
            <Reveal delay={0.14}>
              <p className="mt-5 max-w-lg text-paper/55">{dict.trust.body}</p>
            </Reveal>
          </div>
          <RevealStagger className="grid grid-cols-2 gap-4">
            {dict.trust.badges.map((b) => (
              <motion.div
                key={b}
                variants={staggerItem}
                className="flex items-center gap-3 rounded-xl border border-line px-5 py-4"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-light" />
                <span className="text-sm text-paper/80">{b}</span>
              </motion.div>
            ))}
          </RevealStagger>
        </div>
      </Container>
    </section>
  );
}
