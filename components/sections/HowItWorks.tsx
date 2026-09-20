"use client";

import { motion } from "framer-motion";
import type { Dictionary } from "@/content";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";

/**
 * Home page "how it works": the two-lane comparison, then the five step cards.
 *
 * The lanes run the same task twice on one 12s loop. Without Ankora, the token stalls
 * at five interruption points — each one a tick that lights as the token reaches it —
 * and ends short of the target. With Ankora, the token crosses once, uninterrupted,
 * and a ring lands on the target. The lanes argue by showing rather than by claiming,
 * which is the whole reason the section exists in this form.
 *
 * Everything positional uses `inset-inline-start`, so the lanes read left-to-right in
 * English and right-to-left in Hebrew from the same markup.
 *
 * The inner /how-it-works page renders `steps` against its own sticky progress rail
 * instead; this is the home page's shorter treatment of the same five steps.
 */

// Where the five interruptions sit along the "without" lane. The positions match the
// stalls in the `tokenSlow` keyframe, and the delays stagger the flashes so each one
// lights as the token arrives rather than all at once.
const TICKS = [
  { position: "13%", delay: "0.9s" },
  { position: "29%", delay: "3.1s" },
  { position: "47%", delay: "6.2s" },
  { position: "61%", delay: "8.4s" },
  { position: "79%", delay: "10.6s" },
];

function LaneHeader({ label, attention, gold }: { label: string; attention: string; gold?: boolean }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-3">
      <span
        className={`font-assistant text-[13.5px] font-semibold ${gold ? "text-gold" : "text-paper"}`}
      >
        {label}
      </span>
      <MonoLabel className="text-tone-muted">{attention}</MonoLabel>
    </div>
  );
}

function SwimLanes({ dict }: { dict: Dictionary }) {
  const h = dict.howItWorks;

  return (
    // Decorative animation carrying an argument the two notes below state in words,
    // so the lanes themselves are hidden from assistive tech and the notes are not.
    <div className="bg-[rgba(243,234,219,0.04)] p-[clamp(24px,3.4vw,44px)] outline outline-1 outline-[rgba(243,234,219,0.11)] backdrop-blur-[16px]">
      <MonoLabel size={10} tracking="0.16em" className="text-tone-muted">
        {h.railLabel}
      </MonoLabel>

      <div
        className="mt-7 grid gap-[clamp(30px,4vw,56px)]"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}
      >
        <div>
          <LaneHeader label={h.laneWithout} attention={h.attentionLabel} />
          <div
            className="relative h-[30px] border-b border-dashed border-[rgba(243,234,219,0.16)]"
            aria-hidden="true"
          >
            {TICKS.map((tick) => (
              <span
                key={tick.position}
                className="absolute bottom-0 h-full w-px animate-tickFlash bg-[rgba(248,244,236,0.5)]"
                style={{ insetInlineStart: tick.position, animationDelay: tick.delay }}
              >
                <span
                  className="absolute -top-[3px] h-1.5 w-1.5 rounded-full bg-paper"
                  style={{ insetInlineStart: "-2.5px" }}
                />
              </span>
            ))}
          </div>
          <div className="relative mt-[29px] h-[3px] bg-[rgba(243,234,219,0.14)]" aria-hidden="true">
            <span className="absolute top-1/2 -mt-1.5 h-3 w-3 animate-tokenSlow rounded-full bg-paper" />
            <span
              className="absolute -top-1.5 h-[15px] w-0.5 bg-[rgba(243,234,219,0.4)]"
              style={{ insetInlineEnd: 0 }}
            />
          </div>
          <p className="mt-[18px] max-w-[50ch] font-assistant text-sm font-light leading-[1.75] text-tone-muted">
            {h.noteWithout}
          </p>
        </div>

        <div>
          <LaneHeader label={h.laneWith} attention={h.attentionLabel} gold />
          <div
            className="relative h-[30px] border-b border-dashed border-[rgba(176,141,87,0.28)]"
            aria-hidden="true"
          >
            {/* One tick, at the start: the single point where the task touches you. */}
            <span
              className="absolute bottom-0 h-full w-px animate-tickFlash bg-[rgba(176,141,87,0.6)]"
              style={{ insetInlineStart: 0 }}
            >
              <span
                className="absolute -top-[3px] h-1.5 w-1.5 rounded-full bg-gold"
                style={{ insetInlineStart: "-2.5px" }}
              />
            </span>
          </div>
          <div className="relative mt-[29px] h-[3px] bg-[rgba(176,141,87,0.22)]" aria-hidden="true">
            <span className="absolute inset-0 bg-gold opacity-55" />
            <span className="absolute top-1/2 -mt-1.5 h-3 w-3 animate-tokenFast rounded-full bg-gold" />
            <span
              className="absolute -top-2 h-[18px] w-[18px] animate-arrive rounded-full border-2 border-gold"
              style={{ insetInlineEnd: "-4px" }}
            />
          </div>
          <p className="mt-[18px] max-w-[50ch] font-assistant text-sm font-light leading-[1.75] text-tone-body">
            {h.noteWith}
          </p>
        </div>
      </div>
    </div>
  );
}

export function HowItWorks({ dict }: { dict: Dictionary }) {
  return (
    <SectionShell>
      <Reveal>
        <Eyebrow>{dict.howItWorks.label}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mt-6 max-w-[22ch] text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-paper">
          {dict.howItWorks.title}
        </h2>
      </Reveal>
      <Reveal delay={0.14}>
        <p className="mt-4 max-w-[40ch] font-assistant font-light text-tone-muted">
          {dict.howItWorks.sub}
        </p>
      </Reveal>

      <div className="mt-14 flex flex-col gap-px">
        <Reveal>
          <SwimLanes dict={dict} />
        </Reveal>

        {/* Five across on desktop, two at laptop width, one on a phone. Explicit
            breakpoints rather than auto-fit: five equal steps are a sequence, and
            auto-fit would silently land on three or four and break the reading.
            The grid lives on RevealStagger itself — a plain wrapper div in between
            would stop the stagger variants reaching the cards. */}
        <RevealStagger className="grid gap-px [grid-template-columns:minmax(0,1fr)] min-[641px]:[grid-template-columns:repeat(2,minmax(0,1fr))] min-[1181px]:[grid-template-columns:repeat(5,minmax(0,1fr))]">
          {dict.howItWorks.steps.map((step, i) => (
            <motion.div
              key={step.title}
              variants={staggerItem}
              className="bg-[rgba(11,27,51,0.5)] p-[clamp(22px,2.4vw,32px)] outline outline-1 outline-[rgba(243,234,219,0.11)] backdrop-blur-[12px] transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.05)]"
            >
              {/* Derived from position, so it can never disagree with the order. */}
              <MonoLabel script="latin" tracking="0.15em" className="text-gold">
                {String(i + 1).padStart(2, "0")}
              </MonoLabel>
              <h3 className="mt-3.5 text-[1.12rem] font-normal leading-[1.3] text-paper">
                {step.title}
              </h3>
              <p className="mt-2.5 font-assistant text-sm font-light leading-[1.7] text-tone-muted">
                {step.body}
              </p>
            </motion.div>
          ))}
        </RevealStagger>
      </div>
    </SectionShell>
  );
}
