"use client";

import { motion } from "framer-motion";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { SectionShell } from "@/components/ui/SectionShell";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";

/**
 * How it works: five full-width step rows, then the "one day" panel.
 *
 * Each row's header is number, title, and a progress hairline that fills to 20 / 40 /
 * 60 / 80 / 100% as the row comes into view — the rail reads as one continuous
 * measure of how far through the process you are, rather than five unrelated bars.
 * The fill is a `scaleX` transform with `transform-origin` on the inline start, so it
 * grows in the reading direction in both locales without a mirrored stylesheet.
 */
const FILLS = [0.2, 0.4, 0.6, 0.8, 1];

export default function HowItWorksClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.howItWorks;

  return (
    <>
      <PageHero
        eyebrow={p.eyebrow}
        title={p.title}
        sub={p.sub}
        breadcrumb={
          <Breadcrumbs locale={locale}
            items={[{ label: dict.nav.home, href: "/" }, { label: p.eyebrow }]}
          />
        }
      />

      <SectionShell>
        <div className="flex flex-col gap-px">
          {p.blocks.map((step, i) => (
            <Reveal key={step.title}>
              <div className="bg-[rgba(11,27,51,0.5)] p-[clamp(24px,3vw,40px)] outline outline-1 outline-[rgba(243,234,219,0.11)] backdrop-blur-[12px] transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.05)]">
                <div className="flex items-center gap-[18px]">
                  <MonoLabel script="latin" tracking="0.15em" className="flex-none text-gold">
                    {String(i + 1).padStart(2, "0")}
                  </MonoLabel>
                  <h3 className="text-[1.34rem] font-normal leading-[1.3] text-paper">{step.title}</h3>
                  <span className="h-0.5 min-w-10 flex-1 overflow-hidden bg-[rgba(243,234,219,0.14)]">
                    <motion.span
                      className="block h-full origin-left bg-gold rtl:origin-right"
                      initial={{ scaleX: 0 }}
                      whileInView={{ scaleX: FILLS[i] }}
                      viewport={{ once: true, margin: "-80px" }}
                      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </span>
                </div>
                <p className="mt-4 max-w-[72ch] font-assistant text-[15px] font-light leading-[1.8] text-tone-muted">
                  {step.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </SectionShell>

      <SectionShell>
        <Reveal>
          <h2 className="max-w-[18ch] text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-paper">
            {p.vignette.title}
          </h2>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="mt-[22px] max-w-[62ch] font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-tone-body">
            {p.vignette.body}
          </p>
        </Reveal>

        {/* The four tasks the paragraph just named, as one day. auto-fit rather than a
            fixed four, so they stack cleanly on a phone. */}
        <RevealStagger
          className="mt-11 grid gap-px"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}
        >
          {p.vignette.items.map((item) => (
            <motion.div
              key={item.title}
              variants={staggerItem}
              className="bg-[rgba(243,234,219,0.04)] p-[clamp(22px,2.6vw,34px)] outline outline-1 outline-[rgba(243,234,219,0.11)] backdrop-blur-[16px]"
            >
              <MonoLabel className="text-gold">{item.time}</MonoLabel>
              <div className="mt-3.5 text-[1.04rem] font-normal leading-[1.35] text-paper">
                {item.title}
              </div>
              <div className="mt-2 font-assistant text-[13.5px] font-light leading-[1.7] text-tone-dim">
                {item.note}
              </div>
            </motion.div>
          ))}
        </RevealStagger>
      </SectionShell>

      <InnerCTA dict={dict} locale={locale} />
    </>
  );
}
