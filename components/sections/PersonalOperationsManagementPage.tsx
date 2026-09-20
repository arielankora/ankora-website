import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
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
 * The category-definition page, and the most important SEO/GEO asset on the site.
 *
 * Ten movements, so the structure is doing as much work as the type. It replaces a
 * forked pair of he/en implementations, each of which restyled the marketing language
 * onto a page three times the length of anything that language was designed for.
 *
 * The section list is built once and used twice -- by the contents rail and by the
 * article -- so the rail cannot describe a page the article does not render. Indices
 * and anchors derive from position.
 */
export function PersonalOperationsManagementPage({
  dict,
  locale,
}: {
  dict: Dictionary;
  locale: Locale;
}) {
  const p = dict.pages.personalOperationsManagement;
  const seo = dict.pages.seo;
  const minutes = readingMinutes(p);
  const updated = contentUpdated(locale, seo);

  const sections: { title: string; body: React.ReactNode }[] = [
    {
      title: p.problem.title,
      body: (
        <>
          <Prose>{p.problem.intro}</Prose>
          <ItemGrid items={p.problem.items} />
          <Prose className="mt-[22px]">{p.problem.closing}</Prose>
        </>
      ),
    },
    {
      title: p.whatManagerDoes.title,
      body: (
        <>
          <Prose>{p.whatManagerDoes.body}</Prose>
          {p.whatManagerDoes.examples.map((e) => (
            <SubSection key={e.title} title={e.title}>
              <Prose className="mt-3">{e.body}</Prose>
            </SubSection>
          ))}
        </>
      ),
    },
    {
      title: p.comparisonPA.title,
      body: (
        <>
          <Prose>{p.comparisonPA.intro}</Prose>
          <ComparisonTable
            criterionLabel={seo.criterionLabel}
            columnA={p.comparisonPA.columnA}
            columnB={p.comparisonPA.columnB}
            rows={p.comparisonPA.rows}
          />
        </>
      ),
    },
    {
      title: p.comparisonConcierge.title,
      body: (
        <>
          <Prose>{p.comparisonConcierge.intro}</Prose>
          <ComparisonTable
            criterionLabel={seo.criterionLabel}
            columnA={p.comparisonConcierge.columnA}
            columnB={p.comparisonConcierge.columnB}
            rows={p.comparisonConcierge.rows}
          />
        </>
      ),
    },
    {
      title: p.humanAI.title,
      body: (
        <>
          <Prose>{p.humanAI.body}</Prose>
          {p.humanAI.points.map((pt) => (
            <SubSection key={pt.title} title={pt.title}>
              <Prose className="mt-3">{pt.body}</Prose>
            </SubSection>
          ))}
        </>
      ),
    },
    {
      title: p.whoFor.title,
      body: <ItemGrid items={p.whoFor.items} />,
    },
    {
      title: p.examples.title,
      body: (
        <>
          {p.examples.items.map((item) => (
            <SubSection key={item.scenario} title={item.scenario} quote={item.shallow}>
              <Prose className="mt-3">{item.deep}</Prose>
            </SubSection>
          ))}
        </>
      ),
    },
    {
      // The honesty section, and it keeps the same treatment as every other one -- no
      // dimming, no warning colour, no smaller type. A disclaimer set quieter than the
      // pitch is not a disclaimer.
      title: p.notRightFit.title,
      body: (
        <>
          <Prose>{p.notRightFit.body}</Prose>
          <ItemGrid items={p.notRightFit.items} />
        </>
      ),
    },
    {
      title: dict.faq.label,
      body: (
        <PageFAQ
          items={p.faq}
          linkify={{ phrase: dict.nav.pricing, href: withLocale(locale, "/pricing") }}
        />
      ),
    },
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
              <SummaryPanel label={p.directAnswerLabel}>{p.directAnswer}</SummaryPanel>
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
                { label: dict.nav.personalAssistantForExecutives, href: "/personal-assistant-for-executives" },
                { label: dict.nav.coverage, href: "/coverage" },
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
