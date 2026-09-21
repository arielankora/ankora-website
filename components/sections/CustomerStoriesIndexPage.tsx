import type { Dictionary, Locale } from "@/content";
import type { CustomerStory } from "@/content/customer-stories/types";
import { storiesUi } from "@/content/customer-stories/ui";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { SectionShell } from "@/components/ui/SectionShell";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { SummaryPanel } from "@/components/sections/SummaryPanel";
import { RelatedLinks } from "@/components/sections/RelatedLinks";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { Reveal } from "@/components/motion/Reveal";
import { CustomerStoryCard } from "@/components/sections/CustomerStoryCard";

/**
 * The Customer Stories hub.
 *
 * A server component with no client-side state: the corpus, the count and every
 * headline are in the first byte of HTML, which is the whole point of the section - it
 * exists so a crawler or an answer engine can read that Ankora has real customers
 * without executing anything.
 *
 * No filter row. The taxonomy is in the content model from day one (customer type, use
 * case, outcome) and the filters render the moment there are enough stories to make
 * filtering an answer rather than a formality - see the threshold note below. A filter
 * bar over one story is a filter bar that returns one story.
 */
const FILTER_THRESHOLD = 8;

export function CustomerStoriesIndexPage({
  dict,
  locale,
  stories,
}: {
  dict: Dictionary;
  locale: Locale;
  stories: CustomerStory[];
}) {
  const ui = storiesUi(locale);
  const count =
    stories.length === 1
      ? ui.countLabel.one
      : ui.countLabel.many.replace("{n}", String(stories.length));

  return (
    <>
      <PageHero
        eyebrow={ui.eyebrow}
        title={ui.h1}
        sub={ui.leadQuestion}
        breadcrumb={
          <Breadcrumbs locale={locale} items={[{ label: dict.nav.home, href: "/" }, { label: ui.eyebrow }]} />
        }
      />

      <SectionShell containerClassName="max-w-[1100px]">
        <Reveal>
          <SummaryPanel label={ui.eyebrow}>{ui.lead}</SummaryPanel>
        </Reveal>

        {stories.length > 0 && (
          <>
            <div className="mt-[clamp(28px,4vw,44px)] border-t border-[rgba(243,234,219,0.12)] pt-5">
              <MonoLabel size={11} className="text-muted">
                {count}
              </MonoLabel>
            </div>
            <div className="mt-2">
              {stories.map((story) => (
                <CustomerStoryCard key={story.slug} story={story} locale={locale} />
              ))}
            </div>
          </>
        )}

        {/* FILTER_THRESHOLD = {FILTER_THRESHOLD}: the taxonomy in
            content/customer-stories/types.ts is the data a filter row would read. */}

        <RelatedLinks
          locale={locale}
          label={ui.relatedLabel}
          items={[
            { label: dict.nav.personalOperationsManagement, href: "/personal-operations-management" },
            { label: dict.nav.howItWorks, href: "/how-it-works" },
            { label: dict.nav.ankoraVsPersonalAssistant, href: "/ankora-vs-personal-assistant" },
          ]}
        />
      </SectionShell>

      <InnerCTA dict={dict} locale={locale} />
    </>
  );
}
