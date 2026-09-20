"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { SectionShell } from "@/components/ui/SectionShell";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";

/**
 * The "who it's for" index: four cards, one per profile.
 *
 * This page was left on the old cream theme — the redesign's scope named the four
 * profile pages but not the index that links to them, so the nav's own "who it's for"
 * destination was a light page between two dark ones. Same cards as the home page's
 * audience grid, same link treatment, no copy change.
 */
export default function SolutionsIndexClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.solutionsIndex;

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
        <RevealStagger>
          <HairlineGrid minCell={280}>
            {dict.industries.items.map((item) => (
              <motion.div key={item.href} variants={staggerItem} className="h-full">
                <Link href={withLocale(locale, item.href)} className="group block h-full">
                  <HairlineGridCell className="flex min-h-[230px] flex-col gap-3 transition-colors duration-[350ms] group-hover:bg-[rgba(176,141,87,0.09)]">
                    <h2 className="text-[1.22rem] font-normal text-paper">{item.title}</h2>
                    <p className="flex-1 font-assistant text-sm font-light leading-[1.7] text-tone-muted">
                      {item.body}
                    </p>
                    <span className="inline-flex items-center self-start border-b border-[rgba(176,141,87,0.4)] pb-[9px] pt-2.5 font-assistant text-[15px] font-medium text-gold transition-colors duration-300 group-hover:border-gold-light group-hover:text-gold-light">
                      {dict.industries.itemCta}
                    </span>
                  </HairlineGridCell>
                </Link>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
      </SectionShell>

      <InnerCTA dict={dict} locale={locale} />
    </>
  );
}
