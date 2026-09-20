import type { Dictionary, Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { SectionShell } from "@/components/ui/SectionShell";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Reveal } from "@/components/motion/Reveal";

/**
 * Privacy and terms, sharing one body: eyebrow, title, the updated-on line, then the
 * numbered sections.
 *
 * These two pages were left on the old cream theme by the redesign's own scope, which
 * named eight inner pages and not these. They are linked from every footer, so a
 * visitor clicking "privacy" was landing on a light page in the middle of a dark site.
 * Bringing them across is a few lines and no copy change.
 */
export function LegalPage({
  dict,
  locale,
  eyebrow,
  title,
  sub,
  sections,
}: {
  dict: Dictionary;
  locale: Locale;
  eyebrow: string;
  title: string;
  /** Each page passes its own standfirst: privacy's is the data-contact line,
   *  terms' is `termsPlaceholder`, which nothing had been rendering. */
  sub: string;
  sections: { title: string; body: string }[];
}) {
  return (
    <>
      <PageHero
        eyebrow={eyebrow}
        title={title}
        sub={sub}
        breadcrumb={
          <Breadcrumbs locale={locale} items={[{ label: dict.nav.home, href: "/" }, { label: eyebrow }]} />
        }
      />
      <SectionShell containerClassName="max-w-[80ch]">
        <MonoLabel tracking="0.15em" className="text-tone-muted">
          {dict.pages.legal.updated}
        </MonoLabel>
        <div className="mt-10 space-y-10">
          {sections.map((section, i) => (
            <Reveal key={section.title} delay={i * 0.04}>
              <h2 className="text-[1.12rem] font-normal text-paper">{section.title}</h2>
              <p className="mt-3 font-assistant font-light leading-[1.8] text-tone-muted">
                {section.body}
              </p>
            </Reveal>
          ))}
        </div>
      </SectionShell>
    </>
  );
}
