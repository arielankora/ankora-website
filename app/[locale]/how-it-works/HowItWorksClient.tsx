"use client";

import { useEffect, useRef, useState } from "react";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { withLocale } from "@/lib/nav";
import { motion } from "framer-motion";

// /he redesign: vertical gold line that fills with scroll (design_handoff_ankora_
// redesign/README.md, "How it works"). fillFraction = clamp(0,1, (innerHeight*0.72 -
// railTop) / (railHeight*0.82)); each step marker is an 8px gold square sitting on the
// line, not a number -- the line itself carries the order.
function HeSteps({ steps }: { steps: { title: string; body: string }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fill, setFill] = useState(0);

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const railHeight = rect.height;
      const railTop = rect.top;
      const raw = (window.innerHeight * 0.72 - railTop) / (railHeight * 0.82);
      setFill(Math.min(1, Math.max(0, raw)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {/* Track (grey) + fill (gold, height driven by scroll position) -- both sit at the
          horizontal centre of the 8px marker column (w-2, so centre = 4px from its own
          start edge, which is flush with this container's start edge). */}
      <div className="absolute bottom-0 top-1 w-px bg-[rgba(243,234,219,0.14)]" style={{ insetInlineStart: 4 }} aria-hidden />
      <div className="absolute top-1 w-px bg-gold" style={{ insetInlineStart: 4, height: `${fill * 100}%` }} aria-hidden />
      <div className="flex flex-col gap-12">
        {steps.map((step, i) => (
          <Reveal key={step.title} delay={i * 0.06} className="flex gap-8">
            <span className="relative z-[1] mt-1 h-2 w-2 flex-none bg-gold" aria-hidden />
            <div>
              <h3 className="text-lg font-medium text-paper">{step.title}</h3>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#A9B8C9]">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

function HeHowItWorksClient({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const p = dict.pages.howItWorks;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} locale="he" />
      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <HeSteps steps={p.blocks} />
        </WideContainer>
      </section>
      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer className="max-w-2xl">
          <Reveal>
            <GlassPanel elevated className="p-[clamp(22px,3vw,40px)] text-center">
              <h2 className="text-[clamp(1.5rem,2.6vw,2.3rem)] font-extralight leading-[1.2] tracking-[-0.02em] text-paper">
                {p.vignette.title}
              </h2>
              <p className="mt-5 font-assistant leading-relaxed text-[#A9B8C9]">{p.vignette.body}</p>
            </GlassPanel>
          </Reveal>
          <Reveal delay={0.1} className="mt-9 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{dict.hero.ctaPrimary}</Button>
          </Reveal>
        </WideContainer>
      </section>
    </>
  );
}

export default function HowItWorksClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;

  if (locale === "he") {
    return <HeHowItWorksClient locale={locale} />;
  }

  const dict = getDictionary(locale);
  const p = dict.pages.howItWorks;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />
      <section className="bg-cream py-20 md:py-28">
        <Container>
          <RevealStagger className="grid gap-px overflow-hidden rounded-2xl border border-lineDark bg-lineDark md:grid-cols-2 lg:grid-cols-5">
            {p.blocks.map((b, i) => (
              <motion.div key={b.title} variants={staggerItem} className="bg-paper p-7">
                <span className="font-mono text-xs text-gold/70">0{i + 1}</span>
                <h3 className="mt-4 text-lg font-medium text-navy">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy/55">{b.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>
      <section className="bg-ink py-24 md:py-32">
        <Container className="max-w-2xl text-center">
          <Reveal>
            <h2 className="text-[26px] font-medium tracking-tight text-paper md:text-[36px]">{p.vignette.title}</h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-5 leading-relaxed text-paper/55">{p.vignette.body}</p>
          </Reveal>
          <Reveal delay={0.2} className="mt-9 flex justify-center">
            <Button href={withLocale(locale, "/contact")}>{dict.hero.ctaPrimary}</Button>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
