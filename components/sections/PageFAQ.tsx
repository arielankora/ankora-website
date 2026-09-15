"use client";

import { useState } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/motion/Reveal";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// Wraps one exact phrase in an answer string with an internal link, leaving the rest
// of the sentence untouched (no rewording). Opt-in via the `linkify` prop rather than a
// blanket replace, because PageFAQ is shared by three different pages' FAQs -- a global
// substring match here would silently add the same link to another page's copy that
// happens to contain the same phrase, which wasn't asked for.
function linkifyPhrase(text: string, linkify?: { phrase: string; href: string }): React.ReactNode {
  if (!linkify) return text;
  const idx = text.indexOf(linkify.phrase);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <Link href={linkify.href} className="text-gold underline decoration-gold/40 underline-offset-4 hover:text-paper">
        {linkify.phrase}
      </Link>
      {text.slice(idx + linkify.phrase.length)}
    </>
  );
}

function HePageFAQ({
  label,
  title,
  items,
  linkify,
}: {
  label: string;
  title: string;
  items: { q: string; a: string }[];
  linkify?: { phrase: string; href: string };
}) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
      <WideContainer className="max-w-[104ch]">
        <Reveal><Eyebrow>{label}</Eyebrow></Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 text-[clamp(1.5rem,2.6vw,2.3rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-paper">
            {title}
          </h2>
        </Reveal>

        <div className="mt-12 divide-y divide-[rgba(243,234,219,0.12)] border-y border-[rgba(243,234,219,0.12)]">
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between py-6 text-start"
                  aria-expanded={isOpen}
                >
                  <span className="text-base font-medium text-paper md:text-lg">{item.q}</span>
                  <span className={cn("ms-6 shrink-0 text-xl text-gold transition-transform duration-[250ms] ease-out", isOpen && "rotate-45")}>+</span>
                </button>
                <motion.div
                  initial={false}
                  animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <p className="max-w-[80ch] pb-6 text-sm leading-relaxed text-[#A9B8C9] md:text-base">{linkifyPhrase(item.a, linkify)}</p>
                </motion.div>
              </div>
            );
          })}
        </div>
      </WideContainer>
    </section>
  );
}

export function PageFAQ({
  label,
  title,
  items,
  tone = "light",
  locale,
  linkify,
}: {
  label: string;
  title: string;
  items: { q: string; a: string }[];
  tone?: "light" | "dark";
  locale?: "he" | "en";
  // /he only: wraps one exact phrase in one answer with an internal link. Opt-in per
  // call site (see linkifyPhrase above) since PageFAQ is shared across pages.
  linkify?: { phrase: string; href: string };
}) {
  const [open, setOpen] = useState<number | null>(0);
  const isLight = tone === "light";

  if (locale === "he") {
    return <HePageFAQ label={label} title={title} items={items} linkify={linkify} />;
  }

  return (
    <section className={cn("py-24 md:py-36", isLight ? "bg-paper" : "bg-navy")}>
      <Container className="max-w-3xl">
        <Reveal><Badge tone={isLight ? "light" : "dark"}>{label}</Badge></Reveal>
        <Reveal delay={0.08}>
          <h2
            className={cn(
              "mt-6 text-[28px] font-medium leading-[1.2] tracking-tight md:text-[38px]",
              isLight ? "text-navy" : "text-paper"
            )}
          >
            {title}
          </h2>
        </Reveal>

        <div className={cn("mt-12 divide-y border-y", isLight ? "divide-lineDark border-lineDark" : "divide-line border-line")}>
          {items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between py-6 text-start"
                  aria-expanded={isOpen}
                >
                  <span className={cn("text-base font-medium md:text-lg", isLight ? "text-navy" : "text-paper")}>
                    {item.q}
                  </span>
                  <span
                    className={cn(
                      "ms-6 shrink-0 text-xl text-gold transition-transform duration-300",
                      isOpen && "rotate-45"
                    )}
                  >
                    +
                  </span>
                </button>
                {/* Answers stay mounted at all times so every FAQ answer is present in the
                    server-rendered HTML, not only the one open by default. */}
                <motion.div
                  initial={false}
                  animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <p className={cn("pb-6 text-sm leading-relaxed md:text-base", isLight ? "text-navy/60" : "text-paper/55")}>
                    {item.a}
                  </p>
                </motion.div>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
