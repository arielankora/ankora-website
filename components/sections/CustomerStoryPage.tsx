import Link from "next/link";
import Image from "next/image";
import type { Dictionary, Locale } from "@/content";
import type { CustomerStory } from "@/content/customer-stories/types";
import { storiesUi } from "@/content/customer-stories/ui";
import { withLocale } from "@/lib/nav";
import { WideContainer } from "@/components/ui/WideContainer";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Iso, Ltr } from "@/components/ui/Ltr";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { SummaryPanel } from "@/components/sections/SummaryPanel";
import { RelatedLinks } from "@/components/sections/RelatedLinks";
import { CustomerStoryCard } from "@/components/sections/CustomerStoryCard";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { Reveal } from "@/components/motion/Reveal";

/**
 * A single customer story.
 *
 * The editorial shape is the story's own: sections render in the order the content file
 * lists them, with the headings the section kind resolves to, and a story that has no
 * evidence for a movement simply does not carry it. What is fixed is the *semantics* -
 * context, problem, why the alternatives fell short, the Ankora model, how the work is
 * managed, outcome - so every story answers the same questions where it can.
 *
 * Owned and independent evidence are visually and verbally separated. The story on this
 * page is Ankora's own account; the customer's own post lives behind an external link
 * that says so.
 */
export function CustomerStoryPage({
  dict,
  locale,
  story,
  otherStories,
}: {
  dict: Dictionary;
  locale: Locale;
  story: CustomerStory;
  otherStories: CustomerStory[];
}) {
  const ui = storiesUi(locale);
  const arrow = locale === "he" ? "←" : "→";

  const relatedItems = (story.relatedSolutions ?? []).map((href) => ({
    href,
    label:
      href === "/personal-operations-management"
        ? dict.nav.personalOperationsManagement
        : href === "/ankora-vs-personal-assistant"
        ? dict.nav.ankoraVsPersonalAssistant
        : href === "/personal-assistant-for-executives"
        ? dict.nav.personalAssistantForExecutives
        : href === "/how-it-works"
        ? dict.nav.howItWorks
        : (dict.nav.solutionsMenu.find((s) => s.href === href)?.label ?? dict.nav.solutions),
  }));

  return (
    <>
      <section className="relative overflow-hidden pb-10 pt-40 md:pt-48">
        <WideContainer className="relative z-[1]">
          <div className="mx-auto max-w-[900px]">
            <Breadcrumbs
              locale={locale}
              items={[
                { label: dict.nav.home, href: "/" },
                { label: ui.eyebrow, href: "/customer-stories" },
                { label: story.customerName },
              ]}
            />

            <Reveal delay={0.06}>
              <div className="mt-8">
                <MonoLabel size={10} tracking="0.12em" className="text-gold">
                  {ui.storyEyebrow}
                </MonoLabel>
              </div>
            </Reveal>

            <Reveal delay={0.12}>
              <h1 className="mt-4 max-w-[26ch] text-[clamp(1.95rem,3.8vw,3rem)] font-extralight leading-[1.2] tracking-[-0.03em] text-cream">
                {story.headline}
              </h1>
            </Reveal>

            {/* The customer identity is a named, crawlable line rather than a caption
                under a portrait: name, role, segment. This is the sentence an answer
                engine lifts when asked who uses Ankora. */}
            {/* The portrait sits with the identity line, at 96px, square. It is the
                one place a face belongs on this page: next to the name it names. It is
                never a full-width band (a square source cropped to 16:7 is a strip of
                forehead) and never sits behind the headline. */}
            <Reveal delay={0.18}>
              <div className="mt-8 flex items-center gap-5">
                {story.image && (
                  <div className="relative h-24 w-24 flex-none overflow-hidden rounded-full outline outline-1 outline-[rgba(243,234,219,0.11)]">
                    <Image src={story.image.src} alt={story.image.alt} fill sizes="96px" className="object-cover" />
                  </div>
                )}
              <p className="font-assistant text-[1.02rem] font-light leading-[1.8] text-body">
                <span className="text-cream">{story.customerName}</span>
                {story.customerRole && (
                  <>
                    {" · "}
                    <Ltr className="text-muted">{story.customerRole}</Ltr>
                  </>
                )}
                {story.customerCompany && (
                  <>
                    {" · "}
                    <Iso className="text-muted">{story.customerCompany}</Iso>
                  </>
                )}
              </p>
              </div>
            </Reveal>

            <Reveal delay={0.24}>
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <MonoLabel size={10} className="text-muted">
                  {ui.customerTypes[story.customerType]}
                </MonoLabel>
                <MonoLabel size={10} aria-hidden className="text-line">
                  ·
                </MonoLabel>
                <MonoLabel size={10} className="text-muted">
                  <time dateTime={story.updatedDate || story.publishedDate}>
                    {story.updatedDate || story.publishedDate}
                  </time>
                </MonoLabel>
                {story.independentEvidence && (
                  <>
                    <MonoLabel size={10} aria-hidden className="text-line">
                      ·
                    </MonoLabel>
                    {/* An in-page jump, not an outbound link: from the top of the page
                        the reader learns the customer published his own account, and
                        gets there without leaving before reading it. */}
                    <a href="#independent-evidence" className="inline-flex min-h-[44px] items-center py-[15px] -my-[15px]">
                      <MonoLabel size={10} className="text-gold transition-colors hover:text-gold-light">
                        {ui.independentEvidencePointer} · {story.independentEvidence.type} ↓
                      </MonoLabel>
                    </a>
                  </>
                )}
              </div>
            </Reveal>
          </div>
        </WideContainer>
      </section>

      <WideContainer>
        <div className="mx-auto max-w-[900px]">
          <Reveal>
            <div className="mt-[clamp(28px,4vw,44px)]">
              <SummaryPanel label={ui.eyebrow}>{story.summary}</SummaryPanel>
            </div>
          </Reveal>

          <article className="longform mt-[clamp(28px,4vw,44px)] max-w-none">
            {story.sections.map((section) => (
              <section key={section.kind}>
                <h2>{section.title ?? ui.sectionTitles[section.kind]}</h2>
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.items && section.items.length > 0 && (
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            {story.quote && (
              <blockquote>
                <p>{story.quote.text}</p>
              </blockquote>
            )}
          </article>

          {/* Independent evidence, and it sits immediately after the account it
              corroborates rather than at the foot of the page.

              This is the strongest thing on the page: everything above it is Ankora
              describing its own customer, and this is the customer describing it
              himself, somewhere Ankora does not control. So it gets section weight -
              gold rule, headline-scale lead, a real call to action - and it says
              plainly which of the two accounts is which. An Ankora-hosted page is
              owned evidence and never appears here. */}
          {story.independentEvidence && (
            <section
              id="independent-evidence"
              className="mt-[clamp(44px,5.5vw,72px)] scroll-mt-28 border-t border-gold bg-navy-deep p-[clamp(26px,3.4vw,44px)]"
            >
              <MonoLabel size={10} className="text-gold">
                {ui.independentEvidenceLabel} · {story.independentEvidence.type}
              </MonoLabel>
              <p className="mt-4 max-w-[30ch] text-[clamp(1.4rem,2.4vw,2rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
                {ui.independentEvidenceLead}
              </p>
              <a
                href={story.independentEvidence.url}
                rel="noopener nofollow"
                target="_blank"
                className="group mt-6 inline-flex min-h-[44px] flex-wrap items-center gap-3 border border-[rgba(176,141,87,0.5)] bg-[rgba(176,141,87,0.08)] px-[22px] py-[13px] transition-colors duration-300 hover:border-gold hover:bg-gold"
              >
                <span className="font-assistant text-[15px] font-medium text-cream transition-colors group-hover:text-navy">
                  {ui.independentEvidenceCta}
                </span>
                <MonoLabel size={10} className="text-gold transition-colors group-hover:text-navy">
                  <Iso>{story.independentEvidence.label}</Iso>
                </MonoLabel>
              </a>
              <p className="mt-4 max-w-[62ch] font-assistant text-[14px] font-light leading-[1.7] text-muted">
                {ui.independentEvidenceNote}
              </p>
            </section>
          )}

          {/* Taxonomy, rendered as readable text rather than as chips: these are the
              operational areas the customer actually transferred, and they are the part
              of the page most likely to be quoted back as "what Ankora manages". */}
          {((story.areasManaged?.length ?? 0) > 0 || (story.outcomes?.length ?? 0) > 0) && (
            <div className="mt-[clamp(40px,5vw,64px)] grid gap-px sm:grid-cols-2">
              {story.areasManaged && story.areasManaged.length > 0 && (
                <div className="p-6 outline outline-1 outline-[rgba(243,234,219,0.11)]">
                  <MonoLabel size={10} className="text-gold">
                    {ui.areasManagedLabel}
                  </MonoLabel>
                  <ul className="mt-3 flex flex-col gap-1.5 font-assistant text-[15px] font-light text-body">
                    {story.areasManaged.map((a) => (
                      <li key={a}>{ui.useCases[a]}</li>
                    ))}
                  </ul>
                </div>
              )}
              {story.outcomes && story.outcomes.length > 0 && (
                <div className="p-6 outline outline-1 outline-[rgba(243,234,219,0.11)]">
                  <MonoLabel size={10} className="text-gold">
                    {ui.outcomesLabel}
                  </MonoLabel>
                  <ul className="mt-3 flex flex-col gap-1.5 font-assistant text-[15px] font-light text-body">
                    {story.outcomes.map((o) => (
                      <li key={o}>{ui.outcomes[o]}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="mt-[clamp(40px,5vw,64px)] border-t border-[rgba(243,234,219,0.12)] pt-6">
            <Link
              href={withLocale(locale, "/customer-stories")}
              className="inline-flex min-h-[44px] items-center transition-colors hover:text-gold"
            >
              <MonoLabel className="text-muted transition-colors hover:text-gold">
                {arrow} {ui.backToHub}
              </MonoLabel>
            </Link>
          </div>

          {otherStories.length > 0 && (
            <section className="mt-[clamp(40px,5vw,64px)] border-t border-[rgba(243,234,219,0.12)] pt-[22px]">
              <MonoLabel size={10} className="text-muted">
                {ui.eyebrow}
              </MonoLabel>
              <div className="mt-4 flex flex-col gap-px">
                {otherStories.slice(0, 3).map((s) => (
                  <CustomerStoryCard key={s.slug} story={s} locale={locale} variant="compact" />
                ))}
              </div>
            </section>
          )}

          {relatedItems.length > 0 && (
            <RelatedLinks locale={locale} label={ui.relatedLabel} items={relatedItems} />
          )}
        </div>
      </WideContainer>

      <InnerCTA dict={dict} locale={locale} />
    </>
  );
}
