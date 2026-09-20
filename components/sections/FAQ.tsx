"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/motion/Reveal";

/**
 * Wraps one exact phrase inside an answer with a link to the coverage page, leaving
 * every other character untouched — the words get linked, the sentence is not
 * reworded. The phrase differs per locale because the sentence does; if neither
 * matches, the answer renders as plain text and nothing breaks.
 */
const COVERAGE_PHRASE: Record<Locale, string> = {
  he: "דף תחומי הפעולה",
  en: "Areas of Coverage page",
};

function linkifyCoverage(text: string, locale: Locale): React.ReactNode {
  const phrase = COVERAGE_PHRASE[locale];
  const index = text.indexOf(phrase);
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <Link
        href={withLocale(locale, "/coverage")}
        className="text-gold underline decoration-gold/40 underline-offset-4 transition-colors hover:text-paper"
      >
        {phrase}
      </Link>
      {text.slice(index + phrase.length)}
    </>
  );
}

export function FAQ({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <SectionShell containerClassName="max-w-[104ch]">
      <Reveal>
        <Eyebrow>{dict.faq.label}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mb-11 mt-6 max-w-[26ch] text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-paper">
          {dict.faq.title}
        </h2>
      </Reveal>

      <div className="divide-y divide-[rgba(243,234,219,0.12)] border-y border-[rgba(243,234,219,0.12)]">
        {dict.faq.items.map((item, i) => {
          const isOpen = open === i;
          const panelId = `faq-panel-${i}`;
          const buttonId = `faq-button-${i}`;
          return (
            <div key={item.q}>
              <h3>
                <button
                  id={buttonId}
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="flex w-full items-center gap-5 py-6 text-start text-[clamp(1rem,1.5vw,1.2rem)] font-light leading-[1.4] text-paper transition-colors duration-[250ms] hover:text-gold-light"
                >
                  <span className="flex-1">{item.q}</span>
                  {/* Mono + / − rather than a rotating plus, per the spec. */}
                  <span aria-hidden="true" className="flex-none font-jbmono text-base text-gold">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
              </h3>
              {/* The answer stays mounted at all times — height and opacity only
                  toggle visually — so every answer is in the server-rendered HTML,
                  not just the one open by default. Crawlers that never click still
                  see the full text, which is what the FAQPage structured data on the
                  home page is asserting. */}
              <motion.div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                initial={false}
                animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <p className="max-w-[76ch] pb-7 font-assistant text-[15.5px] font-light leading-[1.85] text-tone-muted">
                  {linkifyCoverage(item.a, locale)}
                </p>
              </motion.div>
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}
