"use client";

import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";

// /he redesign: home page five-step rail (design_handoff_ankora_redesign/README.md,
// "Five-step rail"). Horizontal scroll-snap strip; each card's order marker is a
// progress track (not a number) filled from the right (RTL) to 20/40/60/80/100%.
function HeHowItWorks({ dict }: { dict: Dictionary }) {
  const fills = [20, 40, 60, 80, 100];
  return (
    <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
      <WideContainer>
        <Reveal>
          <Eyebrow>{dict.howItWorks.label}</Eyebrow>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
            {dict.howItWorks.title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 max-w-xl font-assistant text-[#A9B8C9]">{dict.howItWorks.sub}</p>
        </Reveal>

        <div
          className="mt-14 flex gap-[26px] overflow-x-auto pb-4"
          style={{ scrollSnapType: "x mandatory", scrollbarColor: "#B08D57 transparent", scrollbarWidth: "thin" }}
        >
          {dict.howItWorks.steps.map((step, i) => (
            <div
              key={step.title}
              className="flex-none border border-[rgba(243,234,219,0.1)] bg-[rgba(11,27,51,0.5)] p-7 backdrop-blur-[12px]"
              style={{ flex: "0 0 min(340px, 78vw)", minHeight: 210, scrollSnapAlign: "start" }}
            >
              <div className="h-[2px] w-full bg-[rgba(243,234,219,0.16)]">
                <div className="h-full bg-gold" style={{ width: `${fills[i]}%`, marginInlineStart: "auto" }} />
              </div>
              <h3 className="mt-6 text-lg font-medium text-paper">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#A9B8C9]">{step.body}</p>
            </div>
          ))}
        </div>
      </WideContainer>
    </section>
  );
}

export function HowItWorks({ dict, locale }: { dict: Dictionary; locale?: "he" | "en" }) {
  if (locale === "he") {
    return <HeHowItWorks dict={dict} />;
  }

  return (
    <section className="bg-ink py-24 md:py-36">
      <Container>
        <Reveal><Badge>{dict.howItWorks.label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
            {dict.howItWorks.title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 text-paper/50">{dict.howItWorks.sub}</p>
        </Reveal>

        <RevealStagger className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-5">
          {dict.howItWorks.steps.map((step, i) => (
            <motion.div key={step.title} variants={staggerItem} className="bg-navy p-7">
              <span className="font-mono text-xs text-gold-light/70">0{i + 1}</span>
              <h3 className="mt-4 text-lg font-medium text-paper">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-paper/50">{step.body}</p>
            </motion.div>
          ))}
        </RevealStagger>
      </Container>
    </section>
  );
}
