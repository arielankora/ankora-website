"use client";

import Link from "next/link";
import {
  getDictionary,
  type Dictionary,
  type GravityWeight,
  type Locale,
  type ProfileId,
  type SegmentContent,
} from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Reveal } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";

/**
 * The "who it's for" index.
 *
 * It used to re-render `industries.items` — the identical four cards the home page
 * already shows — which made it a router rather than a page: a visitor who had
 * scrolled the home page learned nothing by opening it. The four profile pages can
 * each argue for themselves, but none of them can answer the question this page is
 * actually for: *which one is me, and what changes if I pick a different one?*
 *
 * So the rows below surface the segment content the index never showed — the
 * situation each profile is in, the three areas that carry the weight for them, and
 * the promise each page closes on — and the section after them makes the point no
 * single profile page can: the centre of gravity moves, the operating layer does not.
 *
 * Each row is clickable in full through the stretched-link pattern (`after:inset-0`
 * on the heading's link), so the accessible name stays the profile's promise rather
 * than the whole row read aloud.
 */
const PROFILE_ORDER = ["executives", "founders", "companies", "familyOffice"] as const;

const PROFILE_HREF: Record<(typeof PROFILE_ORDER)[number], string> = {
  executives: "/solutions/executives",
  founders: "/solutions/founders",
  companies: "/solutions/companies",
  familyOffice: "/solutions/family-office",
};

function ProfileRow({
  segment,
  href,
  index,
  focusLabel,
  cta,
  locale,
}: {
  segment: SegmentContent;
  href: string;
  index: number;
  focusLabel: string;
  cta: string;
  locale: Locale;
}) {
  return (
    <article className="group relative bg-[rgba(11,27,51,0.5)] p-[clamp(24px,3vw,44px)] outline outline-1 outline-[rgba(243,234,219,0.11)] backdrop-blur-[12px] transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.05)]">
      <div className="flex items-center gap-[18px]">
        {/* Derived from position, so it can never disagree with the order. */}
        <MonoLabel script="latin" tracking="0.15em" className="flex-none text-gold">
          {String(index + 1).padStart(2, "0")}
        </MonoLabel>
        <span className="font-assistant text-[13.5px] font-semibold tracking-[0.05em] text-cream rtl:tracking-normal">
          {segment.eyebrow}
        </span>
        <span className="h-px flex-1 bg-[rgba(243,234,219,0.14)]" />
      </div>

      <div className="mt-6 grid gap-[clamp(24px,3.4vw,56px)] [grid-template-columns:minmax(0,1fr)] min-[860px]:[grid-template-columns:minmax(0,1.45fr)_minmax(0,1fr)]">
        <div>
          <h2 className="text-balance text-[clamp(1.4rem,2.3vw,2.05rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
            <Link
              href={withLocale(locale, href)}
              className="transition-colors duration-200 after:absolute after:inset-0 after:content-[''] group-hover:text-gold"
            >
              {segment.title}
            </Link>
          </h2>
          <p className="mt-4 max-w-[52ch] font-assistant text-[15px] font-light leading-[1.8] text-muted">
            {segment.sub}
          </p>
        </div>

        <div>
          <MonoLabel tracking="0.16em" className="text-muted">
            {focusLabel}
          </MonoLabel>
          <ul className="mt-4 flex flex-col gap-px">
            {segment.bullets.map((bullet) => (
              <li
                key={bullet.title}
                className="flex items-start gap-2.5 border-t border-[rgba(243,234,219,0.11)] pt-3 font-assistant text-[14.5px] font-light leading-[1.6] text-body first:border-t-0 first:pt-0"
              >
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-gold" />
                {bullet.title}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 border-t border-[rgba(243,234,219,0.12)] pt-6">
        <p className="max-w-[44ch] font-assistant text-[15px] font-light leading-[1.6] text-gold">
          {segment.closing}
        </p>
        {/* Visual affordance only: the stretched link above already carries the row,
            and a second link to the same page would be read out twice. */}
        <span
          aria-hidden="true"
          className="font-assistant text-[15px] font-medium text-muted transition-colors duration-200 group-hover:text-gold"
        >
          {cta}
        </span>
      </div>
    </article>
  );
}

/**
 * The 6 x 4 weighting: capabilities down, profiles across, three states.
 *
 * A real `<table>` rather than the `HairlineGrid` the handoff specified, and the
 * vendor accepted the change as a correction rather than a departure: a filled dot, a
 * hollow dot and a dash are meaning carried by shape alone. With `th` on both axes and
 * a visually-hidden word in every cell, a screen reader announces "Executives, Travel,
 * lead" instead of announcing nothing at all.
 *
 * Five columns, not the seven the handoff counted -- one label column plus four
 * profiles -- and seven rows including the header.
 *
 * Narrow: rows become blocks, so the page gets six capability-major blocks rather than
 * the four profile-major ones the handoff asked for. Transposing a table across axes
 * needs a second copy of the content in the DOM, which the same handoff rules out for
 * the comparison table and for the same reasons. The desktop orientation is the one
 * that matters -- long capability names belong in a label column, short profile names
 * make better headers -- so the narrow layout falls out of it.
 */
const PROFILE_COLUMNS: ProfileId[] = ["executives", "founders", "companies", "familyOffice"];

/** Non-text marks, so the dim greys are legal here; the word beside each carries the meaning. */
function WeightMark({ weight }: { weight: GravityWeight }) {
  if (weight === "lead") return <span className="block h-2 w-2 rounded-full bg-gold" />;
  if (weight === "support")
    return <span className="block h-2 w-2 rounded-full border border-line-strong" />;
  return <span className="block h-px w-2.5 bg-line" />;
}

function GravityMatrix({ dict }: { dict: Dictionary }) {
  const g = dict.pages.solutionsIndex.gravity;
  const cell = "border-t border-[rgba(243,234,219,0.11)] px-3 py-3.5 align-middle";

  return (
    <div className="mt-11">
      {/* Breaking a table needs display:block on every level -- table, thead, tbody,
          tr, th and td. Setting it on `tr` alone does nothing, because a tbody that is
          still a row group rebuilds anonymous row boxes around the cells. */}
      <table className="w-full border-collapse text-start max-[760px]:block">
        <caption className="sr-only">
          {dict.pages.solutionsIndex.constantTitle}
        </caption>
        {/* Hidden narrow: each cell carries its own profile name there. */}
        <thead className="max-[760px]:hidden">
          <tr>
            <th scope="col" className="px-3 pb-3 text-start">
              <MonoLabel tracking="0.16em" className="text-muted">
                {g.capabilityLabel}
              </MonoLabel>
            </th>
            {PROFILE_COLUMNS.map((id) => (
              <th key={id} scope="col" className="px-3 pb-3 text-start font-normal">
                <MonoLabel tracking="0.16em" className="text-muted">
                  {dict.pages.segments[id].eyebrow}
                </MonoLabel>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-[760px]:block">
          {dict.capabilities.items.map((item) => (
            <tr
              key={item.id}
              className="max-[760px]:block max-[760px]:border-t max-[760px]:border-[rgba(243,234,219,0.11)] max-[760px]:pb-3 max-[760px]:pt-4"
            >
              <th
                scope="row"
                className={`${cell} text-start align-top font-normal max-[760px]:block max-[760px]:border-t-0 max-[760px]:px-0 max-[760px]:pb-2 max-[760px]:pt-0`}
              >
                <span className="text-[15px] font-normal leading-[1.35] text-cream">
                  {item.title}
                </span>
              </th>
              {PROFILE_COLUMNS.map((id) => {
                const weight = g.weights[id][item.id];
                return (
                  <td
                    key={id}
                    className={`${cell} max-[760px]:flex max-[760px]:items-center max-[760px]:gap-2.5 max-[760px]:border-t-0 max-[760px]:px-0 max-[760px]:py-1`}
                  >
                    {/* The profile name rides along at narrow widths, where the column
                        header has scrolled far out of sight. */}
                    <MonoLabel
                      size={10}
                      tracking="0.12em"
                      className="hidden text-muted max-[760px]:inline"
                    >
                      {dict.pages.segments[id].eyebrow}
                    </MonoLabel>
                    <WeightMark weight={weight} />
                    {/* The sr-only copy is the accessible one at every width. The
                        visible narrow copy is aria-hidden, or the word lands in the
                        tree twice below 760px. */}
                    <span className="sr-only">{g.legend[weight]}</span>
                    <span
                      aria-hidden="true"
                      className="hidden font-assistant text-[13px] font-light text-muted max-[760px]:inline"
                    >
                      {g.legend[weight]}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-2.5 border-t border-[rgba(243,234,219,0.12)] pt-5">
        {(["lead", "support", "light"] as GravityWeight[]).map((w) => (
          <li key={w} className="flex items-center gap-2.5">
            <WeightMark weight={w} />
            <span className="font-assistant text-[13px] font-light text-muted">{g.legend[w]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
        <Reveal>
          <Eyebrow>{p.profilesLabel}</Eyebrow>
        </Reveal>
        <div className="mt-8 flex flex-col gap-px">
          {PROFILE_ORDER.map((key, i) => (
            <Reveal key={key}>
              <ProfileRow
                segment={dict.pages.segments[key]}
                href={PROFILE_HREF[key]}
                index={i}
                focusLabel={p.focusLabel}
                cta={dict.industries.itemCta}
                locale={locale}
              />
            </Reveal>
          ))}
        </div>
      </SectionShell>

      <SectionShell>
        <Reveal>
          <Eyebrow>{p.constantLabel}</Eyebrow>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="mt-6 max-w-[22ch] text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
            {p.constantTitle}
          </h2>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-4 max-w-[58ch] font-assistant text-[clamp(1.02rem,1.2vw,1.14rem)] font-light leading-[1.8] text-body">
            {p.constantBody}
          </p>
        </Reveal>

        {/* The six capabilities, titles only. The home page's capabilities section
            carries the bodies; repeating them here would be the same mistake this
            page was already making. Titles alone make the argument: this list is
            identical whichever profile you came from. */}
        <Reveal delay={0.2}>
          <GravityMatrix dict={dict} />
        </Reveal>

        <Reveal delay={0.26}>
          <p className="mt-10 font-assistant text-[15px] font-light text-muted">
            {p.undecided.label}{" "}
            <Link
              href={withLocale(locale, "/roi")}
              className="text-gold underline decoration-[rgba(176,141,87,0.45)] underline-offset-4 transition-colors duration-200 hover:text-gold-light"
            >
              {p.undecided.link}
            </Link>
          </p>
        </Reveal>
      </SectionShell>

      <InnerCTA dict={dict} locale={locale} />
    </>
  );
}
