"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { WideContainer } from "@/components/ui/WideContainer";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal } from "@/components/motion/Reveal";

/**
 * The convergence graphic (design_handoff_ankora_site/README.md, "Hero"): seven
 * inbound threads resolve into a single hub, and one clean line leaves it. Many
 * sources, one point of contact, one outcome.
 *
 * Authored left-to-right — sources on the left, resolved line on the right — and
 * mirrored as a whole for Hebrew, so the resolved line always runs in the reading
 * direction. That mirror is the spec's own mechanism and the pattern any future
 * directional graphic should copy; it is not a forked layout.
 */
const FEEDS = [
  { x: 26, y: 64, delay: "0s" },
  { x: 14, y: 152, delay: "0.35s" },
  { x: 34, y: 230, delay: "0.7s" },
  { x: 14, y: 308, delay: "1.05s" },
  { x: 26, y: 396, delay: "1.4s" },
  { x: 158, y: 22, delay: "1.75s" },
  { x: 148, y: 438, delay: "2.1s" },
];

const HUB = { x: 560, y: 230 };
const RESOLVED_END_X = 878;
// Straight horizontal line, so its length is just the run. Used as both the dash
// array and the starting dash offset, which is what makes `drawLine` draw it once.
const RESOLVED_LENGTH = RESOLVED_END_X - HUB.x;

function ConvergenceGraphic({ locale }: { locale: Locale }) {
  return (
    // Decorative, so it is dropped below the md breakpoint rather than allowed to sit
    // behind the headline at phone widths, where a 58%-wide graphic would run under the
    // text and cost contrast.
    <svg
      viewBox="0 0 900 460"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className="pointer-events-none absolute top-0 hidden h-[56%] w-[58%] opacity-85 md:block"
      style={{ insetInlineEnd: 0 }}
    >
      <g transform={locale === "he" ? "translate(900,0) scale(-1,1)" : undefined}>
        {FEEDS.map((f) => (
          <line
            key={`thread-${f.x}-${f.y}`}
            x1={f.x}
            y1={f.y}
            x2={HUB.x}
            y2={HUB.y}
            stroke="#B08D57"
            strokeWidth={1.1}
            strokeOpacity={0.5}
            strokeDasharray="4 10"
            className="animate-flow"
            style={{ animationDelay: f.delay }}
          />
        ))}

        {FEEDS.map((f) => (
          <circle
            key={`node-${f.x}-${f.y}`}
            cx={f.x}
            cy={f.y}
            r={4}
            fill="#7C8EA3"
            className="animate-nodePulse"
            style={{ animationDelay: f.delay }}
          />
        ))}

        {/* Hairline ring around the hub, 26px across. */}
        <circle cx={HUB.x} cy={HUB.y} r={26} fill="none" stroke="#B08D57" strokeOpacity={0.28} strokeWidth={1} />
        <circle cx={HUB.x} cy={HUB.y} r={9} fill="#B08D57" className="animate-hubPulse" />

        {/* The one resolved outcome: solid, drawn once on load, ending in a cream dot. */}
        <line
          x1={HUB.x}
          y1={HUB.y}
          x2={RESOLVED_END_X}
          y2={HUB.y}
          stroke="#B08D57"
          strokeWidth={2}
          strokeDasharray={RESOLVED_LENGTH}
          strokeDashoffset={RESOLVED_LENGTH}
          className="animate-drawLine"
        />
        <circle
          cx={RESOLVED_END_X}
          cy={HUB.y}
          r={4.5}
          fill="#F8F4EC"
          className="animate-nodePulse"
          style={{ animationDelay: "1.8s" }}
        />
      </g>
    </svg>
  );
}

/** Seven-bar sparkline whose bars breathe on each tick. Decorative. */
const SPARK_BASE = [42, 64, 38, 80, 56, 72, 100];

function LiveOpsPanels({ dict }: { dict: Dictionary }) {
  const live = dict.hero.live;
  const [tick, setTick] = useState(0);
  const [closedToday, setClosedToday] = useState(12);

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      // Cycles 12 -> 17 inclusive, then restarts. The previous implementation
      // stopped at 16.
      setClosedToday((n) => (n >= 17 ? 12 : n + 1));
    }, 3200);
    return () => clearInterval(id);
  }, []);

  // Always exactly two business items and one personal one: two indices advance
  // through the business pool per tick, one through the personal pool. Composed,
  // not sampled — the mix is the point the panel is making.
  const visible = [
    live.businessTasks[(tick * 2) % live.businessTasks.length],
    live.businessTasks[(tick * 2 + 1) % live.businessTasks.length],
    live.personalTasks[tick % live.personalTasks.length],
  ];

  const spark = SPARK_BASE.map((h, i) => ({
    height: `${Math.max(14, Math.round(h * (0.7 + 0.3 * Math.abs(Math.sin(tick * 0.7 + i)))))}%`,
    last: i === SPARK_BASE.length - 1,
  }));

  return (
    // Illustrative, not a real feed: hidden from assistive tech so it is never read
    // out as live operational data.
    <div className="mt-16" aria-hidden="true">
      <HairlineGrid minCell={260}>
        <HairlineGridCell elevated>
          <span className="font-jbmono text-[11px] tracking-[0.12em] text-tone-muted rtl:tracking-normal">
            {live.nowLabel}
          </span>
          <ul className="mt-4 space-y-4">
            {visible.map((task) => (
              <li key={task.text}>
                <div className="flex items-start gap-2.5 text-sm text-tone-body">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-gold" />
                  <span>{task.text}</span>
                </div>
                <span className="mt-1 block ps-[14px] font-jbmono text-[10px] tracking-[0.1em] text-tone-muted rtl:tracking-normal">
                  {task.domain}
                </span>
              </li>
            ))}
          </ul>
        </HairlineGridCell>

        <HairlineGridCell elevated>
          <span className="font-jbmono text-[11px] tracking-[0.12em] text-tone-muted rtl:tracking-normal">
            {live.closedLabel}
          </span>
          <div className="mt-3 text-[clamp(2.6rem,4.6vw,4rem)] font-extralight tabular-nums text-paper">
            {closedToday}
          </div>
          <p className="mt-1 text-xs text-tone-muted">{live.closedSub}</p>
          <div className="mt-6 flex h-14 items-end gap-1.5">
            {spark.map((bar, i) => (
              <span
                key={i}
                className="flex-1 transition-[height] duration-700 ease-out"
                style={{
                  height: bar.height,
                  background: bar.last ? "#B08D57" : "rgba(176,141,87,0.32)",
                }}
              />
            ))}
          </div>
          <span className="mt-3 block font-jbmono text-[10px] tracking-[0.1em] text-tone-muted rtl:tracking-normal">
            {live.sparkLabel}
          </span>
        </HairlineGridCell>

        <HairlineGridCell elevated>
          <span className="font-jbmono text-[11px] tracking-[0.12em] text-tone-muted rtl:tracking-normal">
            {live.orchLabel}
          </span>
          <div className="mt-4 space-y-4">
            {live.orchRows.map((row, i) => (
              <div key={row} className="flex items-center justify-between gap-4 text-sm text-tone-body">
                <span>{row}</span>
                {/* A breathing dot rather than the word "active" — option B of the
                    four treatments explored in Orchestration Cell Options. */}
                <span
                  className="h-1.5 w-1.5 shrink-0 animate-eyebrowPulse rounded-full bg-gold"
                  style={{ animationDelay: `${i * 0.6}s` }}
                />
              </div>
            ))}
          </div>
        </HairlineGridCell>
      </HairlineGrid>
    </div>
  );
}

export function Hero({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  return (
    <section className="relative overflow-hidden pb-24 pt-[clamp(72px,9vw,150px)] md:pb-32">
      <ConvergenceGraphic locale={locale} />

      <WideContainer className="relative z-[1]">
        <Reveal>
          <Eyebrow>{dict.hero.eyebrow}</Eyebrow>
        </Reveal>

        {/* line-height 1.2, not the 1.12 in the spec's type-scale table: the prototype
            itself renders 1.2, and that is the version that was reviewed on screen with
            real Hebrew, where the tall ascenders need the extra room the README's own
            Hebrew paragraph argues for.

            The -0.03em stays on Hebrew. The spec's "never letter-spacing on Hebrew"
            rule is about positive tracking, which breaks Hebrew's reading rhythm --
            every example it gives is positive (.05em eyebrow, .1-.16em mono) -- and the
            prototype applies this negative optical tightening in both panes. */}
        <h1 className="mt-6 max-w-[20ch] text-balance text-[clamp(2.6rem,6.2vw,6rem)] leading-[1.2] tracking-[-0.03em]">
          <Reveal delay={0.08}>
            <span className="block font-extralight text-paper">{dict.hero.titleLine1}</span>
          </Reveal>
          <Reveal delay={0.16}>
            <span className="block font-light text-gold">{dict.hero.titleLine2}</span>
          </Reveal>
        </h1>

        <div
          className="mt-10 grid items-end gap-8"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}
        >
          <Reveal delay={0.24}>
            <p className="max-w-[40ch] font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.85] text-tone-body">
              {dict.hero.sub}
            </p>
          </Reveal>
          <Reveal delay={0.32} className="flex flex-wrap items-center gap-6">
            <Link
              href={withLocale(locale, "/contact")}
              className="bg-gold px-8 py-[17px] text-[15px] font-medium text-ink transition-colors duration-200 hover:bg-paper"
            >
              {dict.hero.ctaPrimary}
            </Link>
            <Link
              href={withLocale(locale, "/how-it-works")}
              className="border-b border-[rgba(232,226,214,0.28)] pb-1 text-[15px] text-paper/80 transition-colors duration-200 hover:text-gold"
            >
              {dict.hero.ctaSecondary}
            </Link>
          </Reveal>
        </div>

        <Reveal delay={0.4}>
          <p className="mt-14 max-w-2xl border-t border-[rgba(243,234,219,0.12)] pt-7 text-sm leading-relaxed text-tone-muted">
            {dict.hero.definitionPre}
            <Link
              href={withLocale(locale, "/personal-operations-management")}
              className="text-tone-muted underline decoration-[rgba(176,141,87,0.4)] underline-offset-4 transition-colors duration-200 hover:text-gold"
            >
              {dict.hero.definitionLinked}
            </Link>
            {dict.hero.definitionPost}
          </p>
        </Reveal>

        <Reveal delay={0.48}>
          <LiveOpsPanels dict={dict} />
        </Reveal>
      </WideContainer>
    </section>
  );
}
