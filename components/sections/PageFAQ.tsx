"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MonoLabel } from "@/components/ui/MonoLabel";

/**
 * The FAQ accordion. Rows only — the section's numbered heading comes from the page,
 * because on the long-form pages the FAQ is the last section of the article and has to
 * carry the same header treatment as every other one.
 *
 * All rows are closed on load. The previous version opened the first, which makes the
 * first question look like the answer to the section.
 *
 * Every answer stays mounted at every state. That is deliberate and predates this
 * redesign: these pages carry `FAQPage` structured data and are meant to be read by
 * answer engines, so every answer has to be in the server-rendered HTML and not only
 * the one that happens to be open. A collapsed panel is `aria-hidden` so assistive tech
 * does not read out eleven answers at once, which is a different question from whether
 * a crawler can see them.
 */
function linkifyPhrase(text: string, linkify?: { phrase: string; href: string }): React.ReactNode {
  if (!linkify) return text;
  const idx = text.indexOf(linkify.phrase);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <Link
        href={linkify.href}
        className="text-gold underline decoration-[rgba(176,141,87,0.4)] underline-offset-4 transition-colors hover:text-gold-light"
      >
        {linkify.phrase}
      </Link>
      {text.slice(idx + linkify.phrase.length)}
    </>
  );
}

export function PageFAQ({
  items,
  linkify,
}: {
  items: { q: string; a: string }[];
  /** Wraps one exact phrase in one answer with an internal link. Opt-in per call site:
   *  this component is shared by three pages, and a blanket substring match would
   *  silently add the same link to another page's copy. */
  linkify?: { phrase: string; href: string };
}) {
  const [open, setOpen] = useState<number | null>(null);
  const base = useId();

  return (
    <div className="mt-[26px] border-t border-[rgba(243,234,219,0.12)]">
      {items.map((item, i) => {
        const isOpen = open === i;
        const panelId = `${base}-panel-${i}`;
        const buttonId = `${base}-button-${i}`;
        return (
          <div key={item.q} className="border-b border-[rgba(243,234,219,0.12)]">
            <button
              type="button"
              id={buttonId}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex min-h-[56px] w-full items-center justify-between gap-5 py-[18px] text-start font-assistant text-[16px] font-normal leading-[1.5] text-cream"
            >
              {item.q}
              <MonoLabel
                size={12}
                aria-hidden
                className="w-6 flex-none text-center text-[16px] text-muted"
              >
                {/* A real minus sign, U+2212, not a hyphen. */}
                {isOpen ? "−" : "+"}
              </MonoLabel>
            </button>
            <motion.div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              aria-hidden={!isOpen}
              initial={false}
              animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <p className="max-w-[64ch] pb-5 font-assistant text-[16px] font-light leading-[1.8] text-body">
                {linkifyPhrase(item.a, linkify)}
              </p>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
