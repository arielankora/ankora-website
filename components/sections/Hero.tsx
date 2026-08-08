"use client";

import { motion } from "framer-motion";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

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
          <stop offset="0%" stopColor="#C9A24B" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#C9A24B" stopOpacity="0" />
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
          fill="#E8C77A"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 3 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}
        />
      ))}
    </svg>
  );
}

export function Hero({ dict, locale }: { dict: Dictionary; locale: Locale }) {
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
      </Container>
    </section>
  );
}
