"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils";

/**
 * The Ankora brain: four layers (intake, rules, triggers, execution) in a closed loop.
 *
 * Two treatments of one dictionary block. `compact` is the home page section: the four
 * layers in a hairline grid and a link onward. `full` is the technology page: the
 * sources, the layers as a row the visitor can step through, what the chosen layer
 * takes in, does and puts out, then the three ways a task is executed.
 *
 * The layers carry no 01..04 index. The chevrons between them already say the order,
 * and a number above a one-word Hebrew name only restates it (design review, 19.10.2026).
 * The chevron points in the reading direction in both locales: it is drawn pointing
 * right and mirrored under `rtl:`.
 */

function Chevron({ gold = false }: { gold?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn("shrink-0 rtl:-scale-x-100", gold ? "text-gold" : "text-[rgba(243,234,219,0.45)]")}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 3 L11 8 L6 13" />
    </svg>
  );
}

function Heading({ dict }: { dict: Dictionary }) {
  const b = dict.brain;
  return (
    <>
      <Reveal>
        <Eyebrow>{b.label}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mt-6 max-w-[22ch] text-balance text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
          {b.title}
        </h2>
      </Reveal>
      <Reveal delay={0.14}>
        <p className="mt-4 max-w-[56ch] font-assistant font-light leading-[1.75] text-muted">{b.sub}</p>
      </Reveal>
    </>
  );
}

const layerName = "font-assistant text-base font-semibold text-gold";

function Compact({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const b = dict.brain;
  return (
    <SectionShell>
      <Heading dict={dict} />
      <RevealStagger className="mt-14">
        <HairlineGrid minCell={240}>
          {b.layers.map((layer) => (
            <motion.div key={layer.name} variants={staggerItem} className="h-full">
              <HairlineGridCell className="flex flex-col gap-2">
                <span className={layerName}>{layer.name}</span>
                <h3 className="text-[1.3rem] font-normal leading-[1.3] text-cream">{layer.verb}</h3>
                <p className="font-assistant text-sm font-light leading-[1.7] text-muted">{layer.short}</p>
              </HairlineGridCell>
            </motion.div>
          ))}
        </HairlineGrid>
      </RevealStagger>
      <Reveal>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <p className="font-assistant font-light text-body">{b.principle}</p>
          <Link
            href={withLocale(locale, "/technology")}
            className="inline-flex min-h-11 items-center gap-2 border-b border-[rgba(176,141,87,0.4)] text-gold-light transition-colors hover:text-cream"
          >
            {b.moreLabel}
            <Chevron gold />
          </Link>
        </div>
      </Reveal>
    </SectionShell>
  );
}

function Full({ dict }: { dict: Dictionary }) {
  const b = dict.brain;
  const [picked, setPicked] = useState(0);
  const sel = b.layers[picked];

  return (
    <SectionShell>
      <Heading dict={dict} />

      <Reveal>
        <div className="mt-12 flex flex-wrap items-center gap-2">
          <span className="font-assistant text-[13.5px] font-semibold text-muted me-2">{b.sourcesLabel}</span>
          {b.sources.map((s) => (
            <span
              key={s}
              className="bg-[rgba(243,234,219,0.04)] px-4 py-2 font-assistant text-[15px] text-body outline outline-1 outline-[rgba(243,234,219,0.11)]"
            >
              {s}
            </span>
          ))}
        </div>
      </Reveal>

      <Reveal>
        <div className="mt-5 flex flex-wrap items-stretch gap-3">
          {b.layers.map((layer, i) => {
            const on = i === picked;
            return (
              <div key={layer.name} className="flex min-w-0 flex-[1_1_220px] items-center gap-3">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(i)}
                  className={cn(
                    "flex min-h-[168px] min-w-0 flex-1 flex-col gap-1.5 p-5 text-start outline outline-1 transition-colors duration-[350ms] focus-visible:outline-2 focus-visible:outline-gold-light",
                    on
                      ? "bg-[rgba(243,234,219,0.07)] outline-gold"
                      : "bg-[rgba(11,27,51,0.5)] outline-[rgba(243,234,219,0.11)] hover:bg-[rgba(243,234,219,0.05)]"
                  )}
                >
                  <span className={layerName}>{layer.name}</span>
                  <span className="text-[1.45rem] font-normal leading-[1.3] text-cream">{layer.verb}</span>
                  <span className="font-assistant text-sm font-light leading-[1.6] text-muted">{layer.short}</span>
                </button>
                {i < b.layers.length - 1 && <Chevron />}
              </div>
            );
          })}
        </div>
      </Reveal>

      <Reveal>
        <div className="mt-5 flex items-center gap-3 font-assistant text-[15px] text-gold-light">
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
            <path d="M3 6 A5 5 0 1 1 3 10" />
            <path d="M3 3 L3 6 L6 6" />
          </svg>
          <span>{b.learning}</span>
        </div>
      </Reveal>

      {/* What the chosen layer takes in, does and puts out. aria-live so a screen
          reader hears the new layer when a button above is pressed. */}
      <div className="mt-8" aria-live="polite">
        <HairlineGrid minCell={240}>
          {(["input", "does", "output"] as const).map((key) => (
            <HairlineGridCell key={key} elevated className="flex flex-col gap-2">
              <span className={layerName}>{b.columns[key]}</span>
              <p className="font-assistant text-base font-light leading-[1.7] text-cream">{sel[key]}</p>
            </HairlineGridCell>
          ))}
        </HairlineGrid>
      </div>

      <Reveal>
        <h3 className="mt-16 max-w-[26ch] text-balance text-[clamp(1.4rem,2.4vw,2rem)] font-extralight leading-[1.3] text-cream">
          {b.modesTitle}
        </h3>
      </Reveal>
      <RevealStagger className="mt-8">
        <HairlineGrid minCell={280}>
          {b.modes.map((mode) => (
            <motion.div key={mode.title} variants={staggerItem} className="h-full">
              <HairlineGridCell>
                <h4 className="text-[1.2rem] font-normal text-cream">{mode.title}</h4>
                <p className="mt-3 font-assistant text-[14.5px] font-light leading-[1.8] text-muted">{mode.body}</p>
              </HairlineGridCell>
            </motion.div>
          ))}
        </HairlineGrid>
      </RevealStagger>

      <Reveal>
        <p className="mt-10 border-t border-[rgba(243,234,219,0.12)] pt-6 font-assistant font-light text-body">{b.principle}</p>
      </Reveal>
    </SectionShell>
  );
}

export function OperationalBrain({
  dict,
  locale,
  variant,
}: {
  dict: Dictionary;
  locale: Locale;
  variant: "compact" | "full";
}) {
  return variant === "compact" ? <Compact dict={dict} locale={locale} /> : <Full dict={dict} />;
}
