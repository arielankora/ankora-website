"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { getDictionary, type Locale, type SegmentContent } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
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
        {/* Explicit columns, not auto-fit: six items divide evenly by 3, 2 and 1, and
            auto-fit was landing on five across — one orphan on a second row, with the
            grid's own hairline background showing through the five empty tracks as a
            solid slab. The five-step grid on the home page takes the same approach for
            the same reason. */}
        <RevealStagger className="mt-11">
          <HairlineGrid columns="[grid-template-columns:minmax(0,1fr)] min-[641px]:[grid-template-columns:repeat(2,minmax(0,1fr))] min-[1024px]:[grid-template-columns:repeat(3,minmax(0,1fr))]">
            {dict.capabilities.items.map((item) => (
              <motion.div key={item.id} variants={staggerItem} className="h-full">
                {/* Not `elevated`: an elevated cell's 0.04 wash sits on top of the
                    grid's own 0.11 hairline background, and the two together lift the
                    ground to #2D394B, where gold measures 3.77:1 — under AA. The
                    default navy cell keeps it at 4.9:1, and matches every other
                    HairlineGrid on the site. */}
                <HairlineGridCell className="flex flex-col gap-2.5">
                  <MonoLabel script="latin" tracking="0.15em" className="text-gold">
                    {item.key}
                  </MonoLabel>
                  <span className="text-[1.04rem] font-normal leading-[1.35] text-cream">
                    {item.title}
                  </span>
                </HairlineGridCell>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
      </SectionShell>

      <InnerCTA dict={dict} locale={locale} />
    </>
  );
}
