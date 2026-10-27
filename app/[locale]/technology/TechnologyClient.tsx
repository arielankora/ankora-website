"use client";

import { motion } from "framer-motion";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { PageFaqSection } from "@/components/sections/PageFaqSection";
import { OperationalBrain } from "@/components/sections/OperationalBrain";
import { SectionShell } from "@/components/ui/SectionShell";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";

/**
 * Technology: the Ankora brain (four layers in a closed loop), then the four
 * technology cards.
 *
 * The brain replaced an earlier four-layer diagram (request, Operations Manager, AI
 * orchestration, execution network) that described the service rather than the
 * system. The same block, in its compact form, is the home page's technology section.
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

      <OperationalBrain dict={dict} locale={locale} variant="full" />

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

      <PageFaqSection faq={p.faq} />

      <InnerCTA dict={dict} locale={locale} title={p.ctaTitle} />
    </>
  );
}
