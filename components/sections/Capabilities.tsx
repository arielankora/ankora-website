"use client";

import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";
import { Clock, Handshake, FileText, Briefcase, Home, Plane } from "lucide-react";

// One icon per capability card, in the same order as dict.capabilities.items
// (personal ops, vendor coordination, admin liaison, business ops, property/household, travel/logistics).
const CAPABILITY_ICONS = [Clock, Handshake, FileText, Briefcase, Home, Plane];

// Latin mono keys, same order as dict.capabilities.items -- design_handoff_ankora_redesign/
// README.md, "Capabilities list": "a Latin mono key on its own line above the Hebrew title".
const CAPABILITY_KEYS = ["PERSONAL OPS", "VENDORS", "ADMIN", "BUSINESS OPS", "PROPERTY", "TRAVEL"];

// /he redesign: home page capabilities list as six full-width rows in a 1px grid
// (design_handoff_ankora_redesign/README.md, "Capabilities list"), not a card grid.
function HeCapabilities({ dict }: { dict: Dictionary }) {
  return (
    <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
      <WideContainer>
        <Reveal><Eyebrow>{dict.capabilities.label}</Eyebrow></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.14] tracking-[-0.02em] text-paper">
            {dict.capabilities.title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 max-w-xl font-assistant text-[#A9B8C9]">{dict.capabilities.sub}</p>
        </Reveal>

        <RevealStagger className="mt-14">
          <HairlineGrid minCell={9999}>
            {dict.capabilities.items.map((item, i) => (
              <motion.div key={item.title} variants={staggerItem}>
                <HairlineGridCell>
                  <div
                    className="grid items-start gap-6"
                    style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}
                  >
                    <div>
                      <span className="font-jbmono text-[11px] tracking-[0.15em] text-[#7C8EA3]">{CAPABILITY_KEYS[i]}</span>
                      <h3 className="mt-2 text-lg font-medium text-paper">{item.title}</h3>
                    </div>
                    <p className="text-sm leading-relaxed text-[#A9B8C9]">{item.body}</p>
                  </div>
                </HairlineGridCell>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
      </WideContainer>
    </section>
  );
}

export function Capabilities({ dict, locale }: { dict: Dictionary; locale?: "he" | "en" }) {
  if (locale === "he") {
    return <HeCapabilities dict={dict} />;
  }

  return (
    <section className="bg-ink py-24 md:py-36">
      <Container>
        <Reveal><Badge>{dict.capabilities.label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-2xl text-[28px] font-medium leading-[1.2] tracking-tight text-paper md:text-[42px]">
            {dict.capabilities.title}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 max-w-xl text-paper/50">{dict.capabilities.sub}</p>
        </Reveal>

        <RevealStagger className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {dict.capabilities.items.map((item, i) => {
            const Icon = CAPABILITY_ICONS[i % CAPABILITY_ICONS.length];
            return (
              <motion.div
                key={item.title}
                variants={staggerItem}
                className="group rounded-2xl border border-line p-7 transition-colors hover:border-lineGold hover:bg-white/[0.02]"
              >
                <div className="flex h-8 w-8 items-center justify-center">
                  <Icon className="h-5 w-5 text-gold-light" strokeWidth={1.5} />
                </div>
                <h3 className="mt-5 text-lg font-medium text-paper">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-paper/50">{item.body}</p>
              </motion.div>
            );
          })}
        </RevealStagger>
      </Container>
    </section>
  );
}
