"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal } from "@/components/motion/Reveal";

// Decorative demo data for the /he redesign's "live operations panel" (design_handoff_
// ankora_redesign/README.md, Home section). Illustrative only -- not a real feed, per
// the spec's own note ("keep the rotation client-side -- it reads as illustrative, not
// as a dashboard"). Hebrew strings are copied verbatim from the design spec, which is
// new UI chrome (not existing page copy), so this is not covered by the frozen-copy rule.
const LIVE_TASKS = [
  "חידוש פוליסת ביטוח רכב",
  "תיאום טכנאי מיזוג בדירה",
  "השוואת הצעות מול שני ספקים",
  "הזמנת טיסה וקישור לפגישות",
  "מסמכים לרשות המקומית",
  "תור למרפאת שיניים",
];
const ORCHESTRATION_ROWS = ["זיכרון העדפות", "ניטור מועדים", "עדכון יזום"];

function LiveOpsPanel() {
  const [offset, setOffset] = useState(0);
  const [closedToday, setClosedToday] = useState(12);

  useEffect(() => {
    const id = setInterval(() => {
      setOffset((o) => (o + 3) % LIVE_TASKS.length);
      setClosedToday((n) => (n >= 16 ? 12 : n + 1));
    }, 3200);
    return () => clearInterval(id);
  }, []);

  const visible = [0, 1, 2].map((i) => LIVE_TASKS[(offset + i) % LIVE_TASKS.length]);

  return (
    <div className="mt-16" aria-hidden="true">
      <HairlineGrid minCell={260}>
        <HairlineGridCell elevated>
          <span className="font-jbmono text-[11px] tracking-[0.12em] text-[#7C8EA3]">בטיפול כרגע</span>
          <ul className="mt-4 space-y-3">
            {visible.map((t) => (
              <li key={t} className="flex items-center gap-2.5 text-sm text-[#C3CEDA]">
                <span className="h-1 w-1 shrink-0 rounded-full bg-gold" />
                {t}
              </li>
            ))}
          </ul>
        </HairlineGridCell>
        <HairlineGridCell elevated>
          <span className="font-jbmono text-[11px] tracking-[0.12em] text-[#7C8EA3]">נסגר היום</span>
          <div className="mt-3 text-[clamp(2.6rem,4.6vw,4rem)] font-extralight text-paper">{closedToday}</div>
          <p className="mt-1 text-xs text-[#7C8EA3]">פריטים שלא הגיעו אליך</p>
        </HairlineGridCell>
        <HairlineGridCell elevated>
          <span className="font-jbmono text-[11px] tracking-[0.12em] text-[#7C8EA3]">שכבת התזמור</span>
          <div className="mt-4 space-y-3">
            {ORCHESTRATION_ROWS.map((r) => (
              <div key={r} className="flex items-center justify-between text-sm text-[#C3CEDA]">
                <span>{r}</span>
                <span className="font-jbmono text-[11px] text-gold">פעיל</span>
              </div>
            ))}
          </div>
        </HairlineGridCell>
      </HairlineGrid>
    </div>
  );
}

function HeHero({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  // The live copy is one frozen sentence ("X. Y?"); split it on the period so the
  // redesign's two-tone two-line treatment can apply without altering a single
  // character of the underlying string. Falls back to one line if the copy ever
  // changes shape.
  const splitAt = dict.hero.title.indexOf(". ");
  const titleLine1 = splitAt === -1 ? dict.hero.title : dict.hero.title.slice(0, splitAt + 1);
  const titleLine2 = splitAt === -1 ? "" : dict.hero.title.slice(splitAt + 2);

  return (
    <section className="relative overflow-hidden pb-24 pt-40 md:pb-32 md:pt-48">
      <WideContainer className="relative z-[1]">
        <Reveal>
          <Eyebrow>{dict.hero.eyebrow}</Eyebrow>
        </Reveal>
        <Reveal delay={0.08}>
          <h1 className="mt-6 max-w-4xl text-[clamp(2.6rem,6.6vw,6rem)] leading-[1.02] tracking-[-0.03em]">
            <span className="block font-extralight text-paper">{titleLine1}</span>
            {titleLine2 && <span className="block font-light text-gold">{titleLine2}</span>}
          </h1>
        </Reveal>

        <div
          className="mt-10 grid items-end gap-8"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}
        >
          <Reveal delay={0.16}>
            <p className="max-w-[38ch] font-assistant text-[clamp(1.06rem,1.4vw,1.32rem)] font-extralight leading-[1.55] text-[#D8CAB5]">
              {dict.hero.sub}
            </p>
          </Reveal>
          <Reveal delay={0.24} className="flex flex-wrap items-center gap-6">
            <Link
              href={withLocale(locale, "/contact")}
              className="bg-gold px-8 py-[17px] text-[15px] font-medium text-ink transition-colors hover:bg-paper"
            >
              {dict.hero.ctaPrimary}
            </Link>
            <Link
              href={withLocale(locale, "/how-it-works")}
              className="border-b border-[rgba(232,226,214,0.28)] pb-1 text-[15px] text-paper/80 transition-colors hover:text-gold"
            >
              {dict.hero.ctaSecondary}
            </Link>
          </Reveal>
        </div>

        <Reveal delay={0.32}>
          <p className="mt-14 max-w-2xl border-t border-[rgba(243,234,219,0.12)] pt-7 text-sm leading-relaxed text-[#7C8EA3]">
            {dict.hero.definitionPre}
            <Link
              href={withLocale(locale, "/personal-operations-management")}
              className="text-[#A9B8C9] underline decoration-[rgba(176,141,87,0.4)] underline-offset-4 transition-colors hover:text-gold"
            >
              {dict.hero.definitionLinked}
            </Link>
            {dict.hero.definitionPost}
          </p>
        </Reveal>

        <Reveal delay={0.4}>
          <LiveOpsPanel />
        </Reveal>
      </WideContainer>
    </section>
  );
}

function OrbitField() {
  const nodes = [
    { cx: 120, cy: 90, r: 3 },
    { cx: 340, cy: 40, r: 2.4 },
    { cx: 520, cy: 140, r: 3.4 },
    { cx: 260, cy: 220, r: 2.2 },
    { cx: 460, cy: 260, r: 2.8 },
    { cx: 80, cy: 260, r: 2 },
  ];
  return (
    <svg
      viewBox="0 0 600 320"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
      aria-hidden
    >
      <defs>
        <linearGradient id="line-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#B08D57" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#B08D57" stopOpacity="0" />
        </linearGradient>
      </defs>
      {nodes.map((n, i) =>
        nodes.slice(i + 1).map((m, j) => (
          <line
            key={`${i}-${j}`}
            x1={n.cx}
            y1={n.cy}
            x2={m.cx}
            y2={m.cy}
            stroke="url(#line-grad)"
            strokeWidth="0.6"
          />
        ))
      )}
      {nodes.map((n, i) => (
        <motion.circle
          key={i}
          cx={n.cx}
          cy={n.cy}
          r={n.r}
          fill="#C7AC7E"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 3 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
        />
      ))}
    </svg>
  );
}

export function Hero({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  if (locale === "he") {
    return <HeHero dict={dict} locale={locale} />;
  }

  return (
    <section className="relative flex min-h-[92vh] items-center overflow-hidden bg-ink pt-28">
      <div className="absolute inset-0 bg-radial-glow" />
      <div className="absolute inset-x-0 top-1/3 h-[420px] opacity-60 md:top-1/4">
        <OrbitField />
      </div>

      <Container className="relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <Badge>{dict.hero.eyebrow}</Badge>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-7 max-w-4xl whitespace-pre-line text-[40px] font-medium leading-[1.08] tracking-tight text-paper md:text-[64px] lg:text-[76px]"
        >
          {dict.hero.title}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="mt-7 max-w-xl text-lg leading-relaxed text-paper/60 md:text-xl"
        >
          {dict.hero.sub}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.34, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 flex flex-wrap items-center gap-4"
        >
          <Button href={withLocale(locale, "/contact")} variant="primary">
            {dict.hero.ctaPrimary}
          </Button>
          <Button href={withLocale(locale, "/how-it-works")} variant="secondary">
            {dict.hero.ctaSecondary}
          </Button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.44, ease: [0.16, 1, 0.3, 1] }}
          className="mt-14 max-w-2xl border-t border-line pt-7 text-sm leading-relaxed text-paper/45"
        >
          {dict.hero.definitionPre}
          <Link
            href={withLocale(locale, "/personal-operations-management")}
            className="text-paper/70 underline decoration-gold/40 underline-offset-4 transition-colors hover:text-gold-light"
          >
            {dict.hero.definitionLinked}
          </Link>
          {dict.hero.definitionPost}
        </motion.p>
      </Container>
    </section>
  );
}
