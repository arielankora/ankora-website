"use client";

import { useEffect, useState } from "react";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { cn } from "@/lib/utils";

/**
 * Sticky contents for a page with twelve or more sections.
 *
 * Justified as a new primitive rather than a reuse: `SectionShell` has no navigation;
 * the how-it-works rail is a five-item progress device with fixed step heights and no
 * collapsed state; the legal-page contents index is a static list of eight designed to
 * be read in full. None of them survive twenty items on a phone. What is reused is the
 * vocabulary — mono index, hairline rail, positional numbering — not the components.
 *
 * Everything is derived from position: the indices, the current item, the progress
 * fraction. Nothing is authored, so a section added to the dictionary appears here.
 *
 * Wide: a 238px sticky column with a 1px rail at its inline-start edge, filled to the
 * page's scroll progress. That is the how-it-works idiom carrying a different quantity,
 * which is the point of having a vocabulary.
 *
 * Narrow: a sticky bar under the header showing one line — index, current title, `+` —
 * at 44px, opening the full list inline. That is the whole affordance; there is no
 * second progress indicator, because a bar and a rail measuring the same thing is two
 * answers to one question.
 *
 * The rail fills downward in both locales. It tracks vertical scroll, so unlike the
 * horizontal how-it-works rail it needs no `transform-origin` flip.
 */
export function LongFormNav({
  label,
  countLabel,
  sections,
}: {
  label: string;
  /** Already formatted, e.g. "10 פרקים" — plural handling belongs to the caller. */
  countLabel: string;
  sections: { id: string; title: string }[];
}) {
  const [current, setCurrent] = useState(0);
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const els = sections
        .map((s) => document.getElementById(s.id))
        .filter((e): e is HTMLElement => e !== null);
      if (els.length === 0) return;

      // The section whose top has most recently passed the reading line, which sits
      // below both sticky bars rather than at the viewport top.
      const line = 160;
      let cur = 0;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= line) cur = i;
      });
      setCurrent(cur);

      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sections]);

  const num = (i: number) => String(i + 1).padStart(2, "0");

  return (
    <nav
      aria-label={label}
      className="lg:sticky lg:top-24 lg:self-start max-lg:sticky max-lg:top-[57px] max-lg:z-[15] max-lg:-mx-[clamp(18px,4vw,32px)] max-lg:border-b max-lg:border-[rgba(243,234,219,0.12)] max-lg:bg-[rgba(11,27,51,0.92)] max-lg:px-[clamp(18px,4vw,32px)] max-lg:py-2.5 max-lg:backdrop-blur-[14px]"
    >
      <div className="relative lg:py-1">
        {/* The rail: track plus a fill whose height is the scroll fraction. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 start-0 w-px bg-[rgba(243,234,219,0.12)] max-lg:hidden"
        >
          <div
            className="w-px bg-gold opacity-75 transition-[height] duration-150 ease-out"
            style={{ height: `${Math.round(progress * 100)}%` }}
          />
        </div>

        <div className="mb-3.5 ps-[18px] max-lg:hidden">
          <MonoLabel size={10} className="text-muted">
            {label} · {countLabel}
          </MonoLabel>
        </div>

        {/* Narrow only: the collapsed line. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-[44px] w-full items-center gap-3 py-1 text-start lg:hidden"
        >
          <MonoLabel script="latin" className="flex-none text-gold">
            {num(current)}
          </MonoLabel>
          <span className="flex-1 font-assistant text-sm text-cream">
            {sections[current]?.title}
          </span>
          <MonoLabel size={12} aria-hidden className="flex-none text-muted">
            {/* A real minus sign, not a hyphen. */}
            {open ? "−" : "+"}
          </MonoLabel>
        </button>

        <ol
          className={cn(
            "flex list-none flex-col",
            open
              ? "max-lg:max-h-[50vh] max-lg:overflow-auto max-lg:pb-3.5 max-lg:pt-2"
              : "max-lg:hidden"
          )}
        >
          {sections.map((s, i) => {
            const isCurrent = i === current;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={() => setOpen(false)}
                  aria-current={isCurrent ? "true" : undefined}
                  className={cn(
                    "flex items-baseline gap-3 py-[7px] ps-[18px] font-assistant text-[13.5px] font-light leading-[1.45] transition-colors duration-200 hover:text-gold",
                    isCurrent ? "text-cream" : "text-muted"
                  )}
                >
                  <MonoLabel
                    script="latin"
                    size={10}
                    tracking="0.1em"
                    className={cn("flex-none", isCurrent ? "text-gold" : "text-muted")}
                  >
                    {num(i)}
                  </MonoLabel>
                  {s.title}
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
