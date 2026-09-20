"use client";

import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { plural } from "@/lib/plural";
import { readingMinutes } from "@/lib/reading";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { ComparisonTable } from "@/components/sections/ComparisonTable";
import { PageFAQ } from "@/components/sections/PageFAQ";
import { RelatedLinks } from "@/components/sections/RelatedLinks";
import { SummaryPanel } from "@/components/sections/SummaryPanel";
import { LongFormNav } from "@/components/sections/LongFormNav";
import { LongFormSection, Prose, ItemGrid } from "@/components/sections/LongForm";
import { WideContainer } from "@/components/ui/WideContainer";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";

/**
 * The objection-handling page, built around one object.
 *
 * Section 01 is the table, because it is what the visitor came for; everything after it
 * is elaboration. The two "choose X when…" sections get identical treatment — same
 * ground, same type, same cell size. The page's credibility rests on the case for a
 * personal assistant not being visually weaker than the case for Ankora, so it is not
 * tinted, shrunk or under-weighted.
 */
export function AnkoraVsPersonalAssistantPage({
  dict,
  locale,
}: {
  dict: Dictionary;
  locale: Locale;
}) {
  const p = dict.pages.ankoraVsPersonalAssistant;
  const seo = dict.pages.seo;
  const minutes = readingMinutes(p);

  const sections: { title: string; body: React.ReactNode }[] = [
    {
      title: p.tableTitle,
      body: (
        <ComparisonTable
          criterionLabel={seo.criterionLabel}
          columnA={p.columnA}
          columnB={p.columnB}
          rows={p.table}
        />
      ),
    },
    { title: p.choosePA.title, body: <ItemGrid items={p.choosePA.items} /> },
    { title: p.chooseAnkora.title, body: <ItemGrid items={p.chooseAnkora.items} /> },
    { title: p.whereAnkoraFits.title, body: <Prose>{p.whereAnkoraFits.body}</Prose> },
    { title: dict.faq.label, body: <PageFAQ items={p.faq} /> },
  ];

  const navItems = sections.map((s, i) => ({ id: `section-${i + 1}`, title: s.title }));

  return (
    <>
      <PageHero
        eyebrow={p.eyebrow}
        title={p.title}
        sub={p.sub}
        meta={
          <MonoLabel className="text-muted">
            <time dateTime={seo.updatedISO}>{seo.updated}</time>
            {" · "}
            {plural(seo.readingMinutes, minutes, locale)}
          </MonoLabel>
        }
        breadcrumb={
          <Breadcrumbs
            locale={locale}
            items={[{ label: dict.nav.home, href: "/" }, { label: p.eyebrow }]}
          />
        }
      />

      <WideContainer>
        <div className="grid items-start gap-[clamp(32px,5vw,72px)] lg:grid-cols-[238px_minmax(0,1fr)]">
          <LongFormNav
            label={seo.navLabel}
            countLabel={plural(seo.navCount, navItems.length, locale)}
            sections={navItems}
          />

          <article className="lg:max-w-[900px]">
            <Reveal>
              <SummaryPanel label={seo.summaryLabel}>{p.directAnswer}</SummaryPanel>
            </Reveal>

            {sections.map((s, i) => (
              <LongFormSection key={s.title} id={navItems[i].id} index={i} title={s.title}>
                {s.body}
              </LongFormSection>
            ))}

            <RelatedLinks
              locale={locale}
              label={dict.nav.relatedReading}
              items={[
                { label: dict.nav.personalOperationsManagement, href: "/personal-operations-management" },
                { label: dict.nav.personalAssistantForExecutives, href: "/personal-assistant-for-executives" },
                { label: dict.nav.pricing, href: "/pricing" },
              ]}
            />
          </article>
        </div>
      </WideContainer>

      <section className="mt-[clamp(56px,7vw,100px)] border-t border-[rgba(243,234,219,0.12)] py-[clamp(48px,7vw,96px)] text-center">
        <WideContainer>
          <Reveal>
            <h2 className="mx-auto max-w-[20ch] text-[clamp(1.7rem,3.4vw,2.7rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
              {p.ctaTitle}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mx-auto mt-4 max-w-[44ch] font-assistant text-[1.02rem] font-light leading-[1.8] text-body">
              {p.ctaBody}
            </p>
          </Reveal>
          <Reveal delay={0.16}>
            <div className="mt-7 flex justify-center">
              <Button href={withLocale(locale, "/contact")}>{p.cta}</Button>
            </div>
          </Reveal>
        </WideContainer>
      </section>
    </>
  );
}
