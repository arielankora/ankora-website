"use client";

import { useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/content";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/motion/Reveal";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// /he redesign: home page FAQ, restyled to the hairline/gold-plus-glyph language
// (design_handoff_ankora_redesign/README.md, "FAQ accordions": "a `+` glyph that
// rotates 45deg"). Keeps the same accessibility/SEO behaviour as the /en version --
// every answer stays mounted in the server-rendered HTML at all times, not just the
// one open by default, so crawlers that don't execute click interactions still see
// the full answer text.
// Wraps one exact phrase in an answer string with an internal link, leaving every
// other character untouched. Used to add the /coverage link inside the existing FAQ
// answer text (Ariel: wrap the words, don't reword the sentence). Scoped to HeFAQ only
// -- this component has a single caller (the home page) so a plain substring match is
// safe and won't accidentally touch another page's copy.
function linkifyCoverage(text: string): React.ReactNode {
  const phrase = "דף תחומי הפעולה";
  const idx = text.indexOf(phrase);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <Link href="/he/coverage" className="text-gold underline decoration-gold/40 underline-offset-4 hover:text-paper">
        {phrase}
      </Link>
      {text.slice(idx + phrase.length)}
    </>
  );
}

function HeFAQ({ dict }: { dict: Dictionary }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
      <WideContainer className="max-w-[104ch]">
        <Reveal><Eyebrow>{dict.faq.label}</Eyebrow></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 text-[clamp(1.5rem,2.6vw,2.3rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-paper">
            {dict.faq.title}
          </h2>
        </Reveal>

        <div className="mt-12 divide-y divide-[rgba(243,234,219,0.12)] border-y border-[rgba(243,234,219,0.12)]">
          {dict.faq.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between py-6 text-start"
                  aria-expanded={isOpen}
                >
                  <span className="text-base font-medium text-paper md:text-lg">{item.q}</span>
                  <span
                    className={cn(
                      "ms-6 shrink-0 text-xl text-gold transition-transform duration-[250ms] ease-out",
                      isOpen && "rotate-45"
                    )}
                  >
                    +
                  </span>
                </button>
                <motion.div
                  initial={false}
                  animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <p className="pb-6 max-w-[80ch] text-sm leading-relaxed text-[#A9B8C9] md:text-base">{linkifyCoverage(item.a)}</p>
                </motion.div>
              </div>
            );
          })}
        </div>
      </WideContainer>
    </section>
  );
}

export function FAQ({ dict, locale }: { dict: Dictionary; locale?: "he" | "en" }) {
  const [open, setOpen] = useState<number | null>(0);

  if (locale === "he") {
    return <HeFAQ dict={dict} />;
  }

  return (
    <section className="bg-paper py-24 md:py-36">
      <Container className="max-w-3xl">
        <Reveal><Badge tone="light">{dict.faq.label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 text-[28px] font-medium leading-[1.2] tracking-tight text-navy md:text-[38px]">
            {dict.faq.title}
          </h2>
        </Reveal>

        <div className="mt-12 divide-y divide-lineDark border-y border-lineDark">
          {dict.faq.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between py-6 text-start"
                  aria-expanded={isOpen}
                >
                  <span className="text-base font-medium text-navy md:text-lg">{item.q}</span>
                  <span
                    className={cn(
                      "ms-6 shrink-0 text-xl text-gold transition-transform duration-300",
                      isOpen && "rotate-45"
                    )}
                  >
                    +
                  </span>
                </button>
                {/* The answer stays mounted at all times (height/opacity only toggle
                    visually) so every FAQ answer is present in the server-rendered HTML,
                    not just the one open by default. Search engines and AI crawlers that
                    don't execute click interactions still see the full answer text. */}
                <motion.div
                  initial={false}
                  animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <p className="pb-6 text-sm leading-relaxed text-navy/60 md:text-base">{item.a}</p>
                </motion.div>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
