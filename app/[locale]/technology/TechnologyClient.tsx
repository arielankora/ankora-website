"use client";

import { motion } from "framer-motion";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { SectionShell } from "@/components/ui/SectionShell";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils";

/**
 * Technology: the four-layer diagram, then the four technology cards.
 *
 * Colour encodes exactly one thing on this diagram — which side does the work. The
 * client's layer is a light card with a cream hairline; Ankora's three are uniform
 * navy glass. That uniformity is the argument: the request enters once and everything
 * after it is one system, not three vendors. Gold appears only in the step tags, so it
 * never competes with the light/dark distinction that carries the meaning.
 *
 * It replaces a four-stage "pipeline" strip that had the same four ideas but gave the
 * AI layer its own gold emphasis, which read as though the AI were the centre of the
 * service rather than one layer inside it.
 */
export default function TechnologyClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.technology;

  return (
    <>
      <PageHero
        eyebrow={p.eyebrow}
        title={p.title}
        sub={p.sub}
        breadcrumb={
          <Breadcrumbs
            locale={locale}
            items={[{ label: dict.nav.home, href: "/" }, { label: p.eyebrow }]}
          />
        }
      />

      <SectionShell>
        <MonoLabel tracking="0.15em" className="text-muted">
          {p.orchestrationLabel}
        </MonoLabel>

        <Reveal>
          <div className="mt-7 bg-[rgba(243,234,219,0.04)] p-[clamp(26px,3.4vw,52px)] outline outline-1 outline-[rgba(243,234,219,0.11)] backdrop-blur-[16px]">
            <div
              className="grid gap-px"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))" }}
            >
              {p.layers.map((layer) => {
                const isYou = layer.side === "you";
                return (
                  <div
                    key={layer.tag}
                    className={cn(
                      "flex min-h-[170px] flex-col gap-2.5 px-[22px] py-[26px] outline outline-1",
                      isYou
                        ? "bg-[rgba(243,234,219,0.1)] outline-[rgba(243,234,219,0.4)]"
                        : "bg-[rgba(11,27,51,0.6)] outline-[rgba(243,234,219,0.14)]"
                    )}
                  >
                    <span
                      className={cn(
                        "font-assistant text-[11px] font-semibold tracking-[0.14em] rtl:tracking-normal",
                        isYou ? "text-cream" : "text-muted"
                      )}
                    >
                      {isYou ? p.sideYou : p.sideAnkora}
                    </span>
                    {/* The tag is "01 · REQUEST" in English and "01 · בקשה" in Hebrew,
                        so it follows the page language rather than staying Latin. */}
                    <MonoLabel tracking="0.16em" className={isYou ? "text-cream" : "text-gold"}>
                      {layer.tag}
                    </MonoLabel>
                    <span className="text-[1.06rem] font-normal leading-[1.3] text-cream">
                      {layer.title}
                    </span>
                    <span className="font-assistant text-[13.5px] font-light leading-[1.7] text-muted">
                      {layer.body}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-[26px] flex items-center gap-3.5 border-t border-[rgba(243,234,219,0.12)] pt-6">
              <span className="h-[7px] w-[7px] shrink-0 animate-eyebrowPulse rounded-full bg-gold" />
              <span className="font-assistant text-sm font-light text-body">
                {p.persistenceNote}
              </span>
            </div>
          </div>
        </Reveal>
      </SectionShell>

      <SectionShell>
        <RevealStagger>
          <HairlineGrid minCell={280}>
            {p.blocks.map((block) => (
              <motion.div key={block.title} variants={staggerItem} className="h-full">
                <HairlineGridCell className="transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.05)]">
                  <h2 className="text-[1.2rem] font-normal text-cream">{block.title}</h2>
                  <p className="mt-3.5 font-assistant text-[14.5px] font-light leading-[1.8] text-muted">
                    {block.body}
                  </p>
                </HairlineGridCell>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
      </SectionShell>

      <InnerCTA dict={dict} locale={locale} title={p.ctaTitle} />
    </>
  );
}
