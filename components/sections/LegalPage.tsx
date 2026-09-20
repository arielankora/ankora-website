import type { Dictionary, Locale, LegalPageKey, LegalSection } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { SectionShell } from "@/components/ui/SectionShell";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Reveal } from "@/components/motion/Reveal";

/**
 * The five legal documents, sharing one body.
 *
 * A legal page is a *reference* document: people arrive looking for one clause, not to
 * read it through, so the structure it needs is the structure of a document. Numbered
 * sections, a contents index that stays with you, and an anchor per section so a clause
 * can be linked to directly. All of it is the site's existing vocabulary rather than
 * anything new: numbering derived from position, a sticky rail, hairline separators,
 * mono meta. The one thing deliberately absent is the closing CTA every other inner page
 * ends on. A privacy policy that pitches you at the bottom undermines the trust it
 * exists to establish.
 *
 * Two things changed when the documents were rewritten in September 2026. A clause is
 * now several paragraphs rather than one, because clauses that had been compressed into
 * a single sentence were the ones a client asked about twice. And anchors moved from
 * positional (#section-4) to named (#recording), because the commercial proposal points
 * at specific clauses of the service terms and those links have to survive an edit.
 */
export function LegalPage({
  dict,
  locale,
  page,
}: {
  dict: Dictionary;
  locale: Locale;
  page: LegalPageKey;
}) {
  const legal = dict.pages.legal;
  const doc = legal.pages[page];
  const eyebrow = doc.title;

  return (
    <>
      <PageHero
        eyebrow={eyebrow}
        title={doc.title}
        sub={doc.sub}
        meta={
          <MonoLabel tracking="0.15em" className="text-muted">
            <time dateTime={legal.updatedISO}>{legal.updated}</time>
          </MonoLabel>
        }
        breadcrumb={
          <Breadcrumbs locale={locale} items={[{ label: dict.nav.home, href: "/" }, { label: eyebrow }]} />
        }
      />

      <SectionShell>
        <div className="grid gap-[clamp(32px,4vw,64px)] lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* Sticky on desktop, a plain list above the document on a phone, where a
              sticky rail would eat a third of the screen. */}
          <nav aria-label={legal.contentsLabel} className="lg:sticky lg:top-32 lg:self-start">
            <MonoLabel tracking="0.15em" className="text-muted">
              {legal.contentsLabel}
            </MonoLabel>
            <ol className="mt-5 flex flex-col">
              {doc.sections.map((section, i) => (
                <li key={section.id} className="border-t border-[rgba(243,234,219,0.11)] first:border-t-0">
                  <a
                    href={`#${section.id}`}
                    className="flex items-baseline gap-3 py-[11px] font-assistant text-[14px] font-light leading-[1.5] text-muted transition-colors duration-200 hover:text-gold"
                  >
                    <MonoLabel
                      script="latin"
                      size={10}
                      tracking="0.12em"
                      className="flex-none text-muted"
                    >
                      {String(i + 1).padStart(2, "0")}
                    </MonoLabel>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="flex flex-col gap-px">
            {doc.sections.map((section, i) => (
              <Reveal key={section.id}>
                <Clause section={section} index={i} tableLabel={legal.tableLabel} />
              </Reveal>
            ))}
          </div>
        </div>
      </SectionShell>
    </>
  );
}

function Clause({
  section,
  index,
  tableLabel,
}: {
  section: LegalSection;
  index: number;
  tableLabel: string;
}) {
  return (
    <section
      id={section.id}
      // scroll-mt clears the fixed header when an index link jumps here. target: a
      // visitor arriving on /privacy#recording from a shared link otherwise lands with
      // no confirmation of having arrived anywhere in particular. A persistent gold edge
      // on the inline start, no motion.
      className="scroll-mt-32 border-s-2 border-transparent bg-[rgba(11,27,51,0.5)] p-[clamp(22px,2.6vw,38px)] outline outline-1 outline-[rgba(243,234,219,0.11)] backdrop-blur-[12px] target:border-s-gold"
    >
      <div className="flex items-center gap-[18px]">
        <MonoLabel script="latin" tracking="0.15em" className="flex-none text-gold">
          {String(index + 1).padStart(2, "0")}
        </MonoLabel>
        <h2 className="text-[1.16rem] font-normal leading-[1.3] text-cream">{section.title}</h2>
        <span className="h-px flex-1 bg-[rgba(243,234,219,0.14)]" />
      </div>

      {section.body.map((paragraph, i) => (
        <p
          key={i}
          className="mt-4 max-w-[68ch] font-assistant text-[15px] font-light leading-[1.85] text-muted"
        >
          <Emphasised text={paragraph} />
        </p>
      ))}

      {section.table ? <ClauseTable table={section.table} label={tableLabel} /> : null}
    </section>
  );
}

/**
 * `**like this**` marks the lead-in of a clause, the half-sentence that carries the
 * commitment. It is the only inline formatting these documents use, so a full markdown
 * parser would be three orders of magnitude more machinery than the job needs.
 */
function Emphasised({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-normal text-cream">
            {part}
          </strong>
        ) : (
          part
        )
      )}
    </>
  );
}

/**
 * The sub-processor list. It scrolls horizontally on a phone rather than reflowing into
 * cards: a reader comparing where their data sits is comparing the rows against each
 * other, and stacked cards break exactly that comparison.
 */
function ClauseTable({
  table,
  label,
}: {
  table: { head: string[]; rows: string[][] };
  label: string;
}) {
  return (
    <div className="mt-7 -mx-[clamp(22px,2.6vw,38px)] overflow-x-auto px-[clamp(22px,2.6vw,38px)]">
      <table className="w-full min-w-[560px] border-collapse text-start">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {table.head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="border-b border-[rgba(243,234,219,0.22)] pb-3 pe-5 text-start font-assistant text-[12.5px] font-normal uppercase tracking-[0.1em] text-muted last:pe-0"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={`border-b border-[rgba(243,234,219,0.09)] py-[13px] pe-5 align-top font-assistant text-[14px] font-light leading-[1.6] last:pe-0 ${
                    i === 0 ? "text-cream" : "text-muted"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
