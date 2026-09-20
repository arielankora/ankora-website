"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { getDictionary, type Locale } from "@/content";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { SectionShell } from "@/components/ui/SectionShell";
import { WideContainer } from "@/components/ui/WideContainer";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Button } from "@/components/ui/Button";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";
import { withLocale } from "@/lib/nav";
import { cn } from "@/lib/utils";

function SectionHead({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <>
      <Reveal>
        <Eyebrow>{label}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mt-6 max-w-[24ch] text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream">
          {title}
        </h2>
      </Reveal>
      <Reveal delay={0.14}>
        <p className="mt-6 max-w-[60ch] font-assistant font-light leading-[1.8] text-muted">{body}</p>
      </Reveal>
    </>
  );
}

function PointGrid({ points, minCell = 260 }: { points: { title: string; body: string }[]; minCell?: number }) {
  return (
    <RevealStagger className="mt-14">
      <HairlineGrid minCell={minCell}>
        {points.map((point) => (
          <motion.div key={point.title} variants={staggerItem} className="h-full">
            <HairlineGridCell>
              <h3 className="text-[1.12rem] font-normal text-cream">{point.title}</h3>
              <p className="mt-2 font-assistant text-sm font-light leading-[1.7] text-muted">
                {point.body}
              </p>
            </HairlineGridCell>
          </motion.div>
        ))}
      </HairlineGrid>
    </RevealStagger>
  );
}

export default function PricingClient({ params }: { params: { locale: string } }) {
  const locale = (params.locale === "en" ? "en" : "he") as Locale;
  const dict = getDictionary(locale);
  const p = dict.pages.pricing;

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
        <SectionHead label={p.billing.label} title={p.billing.title} body={p.billing.body} />
        <PointGrid points={p.billing.points} />
      </SectionShell>

      <SectionShell>
        <SectionHead label={p.costCompare.label} title={p.costCompare.title} body={p.costCompare.body} />

        {/* Two dimensions, each asking one question of both columns. The previous
            shape put six in-house costs beside three Ankora lines and left the reader
            to work out which line answered which -- the comparison only lands when
            the two sides answer the same question. */}
        <RevealStagger className="mt-14 flex flex-col gap-px border border-[rgba(243,234,219,0.11)] bg-[rgba(243,234,219,0.11)]">
          {p.costCompare.rows.map((row) => (
            <motion.div
              key={row.dimension}
              variants={staggerItem}
              className="grid gap-x-8 gap-y-6 bg-[rgba(11,27,51,0.5)] p-[clamp(22px,3vw,36px)] backdrop-blur-[12px] [grid-template-columns:minmax(0,1fr)] lg:[grid-template-columns:minmax(200px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)]"
            >
              <MonoLabel tracking="0.12em" className="self-start text-muted">
                {row.dimension}
              </MonoLabel>
              {(
                [
                  { title: p.costCompare.inHouseTitle, items: row.inHouse, gold: false },
                  { title: p.costCompare.ankoraTitle, items: row.ankora, gold: true },
                ] as const
              ).map((column) => (
                <div key={column.title}>
                  <div
                    className={cn(
                      "border-b pb-2.5 font-assistant text-[13px] font-semibold tracking-[0.04em] rtl:tracking-normal",
                      column.gold
                        ? "border-[rgba(176,141,87,0.35)] text-gold"
                        : "border-[rgba(243,234,219,0.16)] text-muted"
                    )}
                  >
                    {column.title}
                  </div>
                  <ul className="mt-4 flex flex-col gap-2.5">
                    {column.items.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2.5 font-assistant text-sm font-light text-cream"
                      >
                        <span
                          className={cn(
                            "mt-[7px] h-1 w-1 shrink-0 rounded-full",
                            column.gold ? "bg-gold" : "bg-line-strong"
                          )}
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </motion.div>
          ))}
        </RevealStagger>
      </SectionShell>

      <SectionShell>
        <SectionHead label={p.hourBank.label} title={p.hourBank.title} body={p.hourBank.body} />
        <PointGrid points={p.hourBank.points} minCell={280} />
      </SectionShell>

      {/* The packages. Their copy has been in the dictionary since before this
          redesign but no component ever rendered it, so the page carried no concrete
          number at all. The handoff's pricing page has no tier block either; this is
          an addition, made on Ariel's decision that the page needs one. */}
      <SectionShell>
        <SectionHead label={p.tiers.label} title={p.tiers.title} body={p.tiers.sub} />
        <RevealStagger className="mt-14">
          <HairlineGrid minCell={260}>
            {p.tiers.items.map((tier) => (
              <motion.div key={tier.name} variants={staggerItem} className="h-full">
                <HairlineGridCell
                  className={cn(
                    "flex h-full flex-col",
                    tier.highlighted && "bg-[rgba(176,141,87,0.09)]"
                  )}
                >
                  <MonoLabel tracking="0.15em" className={tier.highlighted ? "text-gold-light" : "text-muted"}>
                    {tier.name}
                  </MonoLabel>
                  <div className="mt-4 text-[clamp(1.6rem,2.4vw,2.1rem)] font-extralight tabular-nums leading-none text-cream">
                    {tier.rate}
                  </div>
                  <div className="mt-2 font-assistant text-sm text-muted">{tier.hours}</div>
                  <p className="mt-5 font-assistant text-sm font-light leading-[1.7] text-muted">
                    {tier.blurb}
                  </p>
                </HairlineGridCell>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
        <Reveal delay={0.1}>
          <p className="mt-6 font-assistant text-xs font-light leading-[1.7] text-muted">
            {p.tiers.footnote}
          </p>
        </Reveal>
      </SectionShell>

      {/* This page's own closing, not the shared InnerCTA: it carries a second link to
          the ROI calculator, which answers its heading's question directly. */}
      <section className="relative overflow-hidden border-t border-[rgba(243,234,219,0.12)] py-[clamp(64px,9vw,130px)]">
        <WideContainer className="relative flex flex-col items-center gap-5 text-center">
          <Reveal>
            <h2 className="mx-auto max-w-[18ch] text-balance text-[clamp(2rem,4.4vw,3.6rem)] font-extralight leading-[1.1] tracking-[-0.03em] text-cream">
              {p.closing.title}
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mx-auto font-assistant text-[1.05rem] font-light text-muted">
              {p.closing.body}
            </p>
          </Reveal>
          <Reveal delay={0.2} className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <Button href={withLocale(locale, "/contact")}>{p.closing.cta}</Button>
            {p.closing.secondaryCta && (
              <Link
                href={withLocale(locale, "/roi")}
                className="inline-flex min-h-[44px] items-center border-b border-[rgba(232,226,214,0.28)] font-assistant text-[15px] text-cream/80 transition-colors duration-200 hover:text-gold"
              >
                {p.closing.secondaryCta}
              </Link>
            )}
          </Reveal>
        </WideContainer>
      </section>
    </>
  );
}
