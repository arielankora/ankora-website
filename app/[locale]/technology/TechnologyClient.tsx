"use client";

import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Container } from "@/components/ui/Container";
import { WideContainer } from "@/components/ui/WideContainer";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// /he redesign: orchestration pipeline (design_handoff_ankora_redesign/README.md,
// "Technology"). Mono stage labels + the matching Hebrew term are new diagram chrome,
// using vocabulary already established elsewhere in the page's own frozen copy (the
// request / AI orchestration / the Operations Manager / the execution network) rather
// than inventing new phrasing -- flagged in the Stage 3 report either way.
const PIPELINE = [
  { key: "INPUT", label: "הבקשה" },
  { key: "LAYER", label: "תזמור AI", emphasis: true },
  { key: "DECISION", label: "מנהל התפעול" },
  { key: "OUTPUT", label: "רשת הביצוע" },
];

function HeTechnologyClient({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const p = dict.pages.technology;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} locale="he" />

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <HairlineGrid minCell={330}>
            {PIPELINE.map((stage) => (
              <HairlineGridCell
                key={stage.key}
                className={cn(
                  "text-center",
                  stage.emphasis ? "border border-gold bg-[rgba(176,141,87,0.09)] backdrop-blur-[12px]" : undefined
                )}
              >
                <span className="font-jbmono text-[11px] tracking-[0.15em] text-[#7C8EA3]">{stage.key}</span>
                <div className={cn("mt-3 text-lg font-medium", stage.emphasis ? "text-gold" : "text-paper")}>
                  {stage.label}
                </div>
              </HairlineGridCell>
            ))}
          </HairlineGrid>
        </WideContainer>
      </section>

      <section className="border-t border-[rgba(243,234,219,0.12)] py-[clamp(36px,6vw,80px)]">
        <WideContainer>
          <RevealStagger>
            <HairlineGrid minCell={280}>
              {p.blocks.map((b) => (
                <motion.div key={b.title} variants={staggerItem}>
                  <HairlineGridCell>
                    <h3 className="text-lg font-medium text-paper">{b.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#A9B8C9]">{b.body}</p>
                  </HairlineGridCell>
                </motion.div>
              ))}
            </HairlineGrid>
          </RevealStagger>
        </WideContainer>
      </section>
    </>
  );
}

export default function TechnologyClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;

  if (locale === "he") {
    return <HeTechnologyClient locale={locale} />;
  }

  const dict = getDictionary(locale);
  const p = dict.pages.technology;

  return (
    <>
      <PageHero eyebrow={p.eyebrow} title={p.title} sub={p.sub} />
      <section className="bg-cream py-20 md:py-28">
        <Container>
          <RevealStagger className="grid gap-4 md:grid-cols-2">
            {p.blocks.map((b) => (
              <motion.div key={b.title} variants={staggerItem} className="rounded-2xl border border-lineDark bg-paper p-8 hover:border-gold/50 transition-colors">
                <h3 className="text-lg font-medium text-gold">{b.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-navy/60">{b.body}</p>
              </motion.div>
            ))}
          </RevealStagger>
        </Container>
      </section>
    </>
  );
}
