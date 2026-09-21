import Link from "next/link";
import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { storiesUi } from "@/content/customer-stories/ui";
import { plural } from "@/lib/plural";
import { readingMinutes } from "@/lib/reading";
import { contentUpdated } from "@/lib/content-updated";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { ComparisonTable } from "@/components/sections/ComparisonTable";
import { PageFAQ } from "@/components/sections/PageFAQ";
import { RelatedLinks } from "@/components/sections/RelatedLinks";
import { SummaryPanel } from "@/components/sections/SummaryPanel";
import { LongFormNav } from "@/components/sections/LongFormNav";
import { LongFormSection, Prose, ItemGrid, SubSection } from "@/components/sections/LongForm";
import { WideContainer } from "@/components/ui/WideContainer";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";

/**
 * The AI-agent objection page. Sibling of AnkoraVsPersonalAssistantPage, same reading
 * engine, and deliberately the same component vocabulary: a visitor who reads both
 * should feel one publication, not two landing pages.
 *
 * Two structural decisions worth keeping.
 *
 * Section 01 concedes rather than argues. The page's whole credibility rests on the
 * reader believing we have actually used these tools, and a page that opens by
 * attacking a product the reader likes is closed before the table. The argument only
 * starts at 04, once 01 has granted the capability and 03 has laid out the axis.
 *
 * The table compares CATEGORIES, never named products. The names are carried by 02 and
 * by the FAQ, which is where a generative engine reads entity names from anyway, and
 * where a factual sentence can be dated and sourced. A column header reading "Instinct"
 * would be stale the week they ship, and it invites a misrepresentation claim that a
 * category label does not.
 */
export function AnkoraVsAiAssistantsPage({
  dict,
  locale,
}: {
  dict: Dictionary;
  locale: Locale;
}) {
  const p = dict.pages.ankoraVsAiAssistants;
  const seo = dict.pages.seo;
  const stories = storiesUi(locale);
  const minutes = readingMinutes(p);
  const updated = contentUpdated(locale, seo);

  const sections: { title: string; body: React.ReactNode }[] = [
    {
      title: p.whatAiDoesWell.title,
      body: (
        <>
          {p.whatAiDoesWell.body.map((para) => (
            <Prose key={para}>{para}</Prose>
          ))}
        </>
      ),
    },
    {
      title: p.landscape.title,
      body: (
        <>
          <Prose>{p.landscape.intro}</Prose>
          {p.landscape.items.map((item) => (
            <SubSection key={item.title} title={item.title} quote={item.body} />
          ))}
        </>
      ),
    },
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
    {
      title: p.gaps.title,
      body: (
        <>
          {p.gaps.items.map((item) => (
            <SubSection key={item.title} title={item.title}>
              <Prose>{item.body}</Prose>
            </SubSection>
          ))}
        </>
      ),
    },
    {
      title: p.sameLayer.title,
      body: (
        <>
          {p.sameLayer.body.map((para) => (
            <Prose key={para}>{para}</Prose>
          ))}
        </>
      ),
    },
    {
      title: p.accountability.title,
      body: (
        <>
          {p.accountability.body.map((para) => (
            <Prose key={para}>{para}</Prose>
          ))}
          <Prose>
            {p.accountability.linkPre}
            <Link
              href={withLocale(locale, "/service-terms")}
              className="text-body underline decoration-[rgba(176,141,87,0.4)] underline-offset-4 transition-colors duration-200 hover:text-gold"
            >
              {p.accountability.linkLabel}
            </Link>
            {p.accountability.linkPost}
          </Prose>
        </>
      ),
    },
    { title: p.chooseTool.title, body: <ItemGrid items={p.chooseTool.items} /> },
    { title: p.chooseAnkora.title, body: <ItemGrid items={p.chooseAnkora.items} /> },
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
            <time dateTime={updated.iso}>{updated.label}</time>
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
                { label: dict.nav.ankoraVsPersonalAssistant, href: "/ankora-vs-personal-assistant" },
                // The page argues accountability; the stories are where a reader goes
                // to check whether the claim survives contact with a real client.
                { label: stories.navLabel, href: "/customer-stories" },
                { label: dict.nav.technology, href: "/technology" },
                { label: dict.nav.pricing, href: "/pricing" },
              ]}
            />
          </article>
        </div>
      </WideContainer>

      <section className="mt-[clamp(56px,7vw,100px)] border-t border-[rgba(243,234,219,0.12)] py-[clamp(48px,7vw,96px)] text-center">
        <WideContainer>
          <Reveal>
            <h2 className="mx-auto max-w-[26ch] text-[clamp(1.7rem,3.4vw,2.7rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
              {p.ctaTitle}
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mx-auto mt-4 max-w-[52ch] font-assistant text-[1.02rem] font-light leading-[1.8] text-body">
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
