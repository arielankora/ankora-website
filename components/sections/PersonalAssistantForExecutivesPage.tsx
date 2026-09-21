import type { Dictionary, Locale } from "@/content";
import { withLocale } from "@/lib/nav";
import { plural } from "@/lib/plural";
import { readingMinutes } from "@/lib/reading";
import { contentUpdated } from "@/lib/content-updated";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { PageFAQ } from "@/components/sections/PageFAQ";
import { RelatedLinks } from "@/components/sections/RelatedLinks";
import { LongFormNav } from "@/components/sections/LongFormNav";
import { LongFormSection, Prose, ItemGrid, SubSection } from "@/components/sections/LongForm";
import { WideContainer } from "@/components/ui/WideContainer";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/motion/Reveal";
import { ProfileCrossLinks } from "@/components/sections/ProfileCrossLinks";

/**
 * The executive segment page: the same reading engine as the other two long-form pages,
 * with two differences the handoff calls out.
 *
 * No summary panel. It is not a definition page -- the definition lives on
 * /personal-operations-management -- and a second answer block competing with the
 * canonical one for the same query helps neither.
 *
 * It ends by cross-linking the other three profiles, reusing the /solutions cross-link
 * block rather than inventing a second pattern for the same job. `RelatedLinks` handles
 * the editorial links; the profile cross-link is its own grid.
 */
export function PersonalAssistantForExecutivesPage({
  dict,
  locale,
}: {
  dict: Dictionary;
  locale: Locale;
}) {
  const p = dict.pages.personalAssistantForExecutives;
  const seo = dict.pages.seo;
  const minutes = readingMinutes(p);
  const updated = contentUpdated(locale, seo);

  const sections: { title: string; body: React.ReactNode }[] = [
    { title: p.expectations.title, body: <ItemGrid items={p.expectations.items} /> },
    { title: p.whenPARight.title, body: <Prose>{p.whenPARight.body}</Prose> },
    {
      title: p.wherePAFalls.title,
      body: (
        <>
          <Prose>{p.wherePAFalls.body}</Prose>
          <ItemGrid items={p.wherePAFalls.items} />
        </>
      ),
    },
    {
      title: p.ankoraModel.title,
      body: (
        <>
          <Prose>{p.ankoraModel.body}</Prose>
          {p.ankoraModel.points.map((pt) => (
            <SubSection key={pt.title} title={pt.title}>
              <Prose className="mt-3">{pt.body}</Prose>
            </SubSection>
          ))}
        </>
      ),
    },
    {
      title: p.whenFullTimePA.title,
      body: (
        <>
          <Prose>{p.whenFullTimePA.body}</Prose>
          <ItemGrid items={p.whenFullTimePA.items} />
        </>
      ),
    },
    { title: dict.faq.label, body: <PageFAQ items={p.faq} /> },
  ];

  const navItems = sections.map((s, i) => ({ id: `section-${i + 1}`, title: s.title }));
  const otherProfiles = dict.nav.solutionsMenu.filter(
    (item) => item.href !== "/solutions/executives"
  );

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
              <Prose className="mt-0 text-cream">{p.directAnswer}</Prose>
            </Reveal>

            {sections.map((s, i) => (
              <LongFormSection key={s.title} id={navItems[i].id} index={i} title={s.title}>
                {s.body}
              </LongFormSection>
            ))}

            <section className="mt-[clamp(52px,6vw,80px)] border-t border-[rgba(243,234,219,0.12)] pt-[22px]">
              <Reveal>
                <Eyebrow>{dict.pages.segmentBridge.moreLabel}</Eyebrow>
              </Reveal>
              <ProfileCrossLinks locale={locale} items={otherProfiles} />
            </section>

            <RelatedLinks
              locale={locale}
              label={dict.nav.relatedReading}
              items={[
                { label: dict.nav.personalOperationsManagement, href: "/personal-operations-management" },
                { label: dict.nav.ankoraVsPersonalAssistant, href: "/ankora-vs-personal-assistant" },
                { label: dict.nav.ankoraVsAiAssistants, href: "/ankora-vs-ai-assistants" },
                { label: dict.nav.roi, href: "/roi" },
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
