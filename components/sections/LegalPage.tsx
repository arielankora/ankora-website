import type { Dictionary, Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { SectionShell } from "@/components/ui/SectionShell";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Reveal } from "@/components/motion/Reveal";

/**
 * Privacy and terms, sharing one body.
 *
 * These two were the last pages still on the old cream theme, and the first pass at
 * them only moved them onto the dark palette: eight headings and eight paragraphs in
 * one undifferentiated stack, which is a colour change, not a design. A legal page is
 * a *reference* document — people arrive looking for one clause, not to read it
 * through — so the structure it needs is the structure of a document: numbered
 * sections, a contents index that stays with you, and an anchor per section so a
 * clause can be linked to directly.
 *
 * All of that is the site's existing vocabulary rather than anything new: numbering
 * derived from position (the how-it-works rows), a sticky rail (the same page's
 * progress rail), hairline separators, mono meta. The one thing deliberately absent is
 * the closing CTA every other inner page ends on. A privacy policy that pitches you at
 * the bottom undermines the trust it exists to establish.
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
   *  terms' is `termsPlaceholder`. */
  sub: string;
  sections: { title: string; body: string }[];
}) {
  // Positional rather than slugified: stable across both locales, and it survives a
  // section being reworded. The number is already the section's visible name.
  const idFor = (i: number) => `section-${i + 1}`;

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

      <SectionShell>
        <div className="grid gap-[clamp(32px,4vw,64px)] lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* Sticky on desktop, a plain list above the document on a phone, where a
              sticky rail would eat a third of the screen. */}
          <nav aria-label={dict.pages.legal.contentsLabel} className="lg:sticky lg:top-32 lg:self-start">
            <MonoLabel tracking="0.15em" className="text-tone-muted">
              {dict.pages.legal.contentsLabel}
            </MonoLabel>
            <ol className="mt-5 flex flex-col">
              {sections.map((section, i) => (
                <li key={section.title} className="border-t border-[rgba(243,234,219,0.11)] first:border-t-0">
                  <a
                    href={`#${idFor(i)}`}
                    className="flex items-baseline gap-3 py-[11px] font-assistant text-[14px] font-light leading-[1.5] text-tone-muted transition-colors duration-200 hover:text-gold"
                  >
                    <MonoLabel
                      script="latin"
                      size={10}
                      tracking="0.12em"
                      className="flex-none text-tone-muted"
                    >
                      {String(i + 1).padStart(2, "0")}
                    </MonoLabel>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
            <p className="mt-6 border-t border-[rgba(243,234,219,0.11)] pt-5 font-assistant text-[13px] font-light text-tone-muted">
              {dict.pages.legal.updated}
            </p>
          </nav>

          <div className="flex flex-col gap-px">
            {sections.map((section, i) => (
              <Reveal key={section.title}>
                <section
                  id={idFor(i)}
                  // Clears the fixed header when an index link jumps here.
                  className="scroll-mt-32 bg-[rgba(11,27,51,0.5)] p-[clamp(22px,2.6vw,38px)] outline outline-1 outline-[rgba(243,234,219,0.11)] backdrop-blur-[12px]"
                >
                  <div className="flex items-center gap-[18px]">
                    <MonoLabel script="latin" tracking="0.15em" className="flex-none text-gold">
                      {String(i + 1).padStart(2, "0")}
                    </MonoLabel>
                    <h2 className="text-[1.16rem] font-normal leading-[1.3] text-paper">
                      {section.title}
                    </h2>
                    <span className="h-px flex-1 bg-[rgba(243,234,219,0.14)]" />
                  </div>
                  <p className="mt-4 max-w-[68ch] font-assistant text-[15px] font-light leading-[1.85] text-tone-muted">
                    {section.body}
                  </p>
                </section>
              </Reveal>
            ))}
          </div>
        </div>
      </SectionShell>
    </>
  );
}
