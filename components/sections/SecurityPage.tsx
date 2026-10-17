"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { getDictionary, type Locale } from "@/content";
import { getSecurityContent, openOnly, openText } from "@/content/security";
import { withLocale } from "@/lib/nav";
import { PageHero } from "@/components/sections/PageHero";
import { Breadcrumbs } from "@/components/sections/Breadcrumbs";
import { InnerCTA } from "@/components/sections/InnerCTA";
import { PageFaqSection } from "@/components/sections/PageFaqSection";
import { SectionShell } from "@/components/ui/SectionShell";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Ltr } from "@/components/ui/Ltr";
import { HairlineGrid, HairlineGridCell } from "@/components/ui/HairlineGrid";
import { Reveal, RevealStagger, staggerItem } from "@/components/motion/Reveal";

/**
 * Security and Trust, as a product page rather than a legal one.
 *
 * The page is organised around what a client hands over (credentials, data, calls),
 * then what the AI may and may not see, then people, platform, regulation, vendors,
 * incidents and freshness. The legal detail lives in the DPA and the privacy policy;
 * this page links to both instead of repeating them.
 *
 * Every claim that waits on an open step carries a gate (content/security/gates.ts)
 * and is filtered out here until the gate opens, so the page never says more than
 * is true on the day it is read.
 */
export default function SecurityPage({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const p = getSecurityContent(locale);

  const chips = openOnly(p.chips);
  const never = openOnly(p.ai.never);
  const commitments = openOnly(p.ai.commitments);
  const people = openOnly(p.people.items);
  const vendors = openOnly(p.vendors.rows);
  const documents = openOnly(p.documents.cards);
  const faqItems = openOnly(p.faq.items).map(({ q, a }) => ({ q, a }));

  return (
    <>
      <PageHero
        eyebrow={p.eyebrow}
        title={p.title}
        sub={p.sub}
        breadcrumb={
          <Breadcrumbs locale={locale} items={[{ label: dict.nav.home, href: "/" }, { label: p.breadcrumb }]} />
        }
        meta={
          <ul className="mt-3 flex flex-wrap gap-2.5">
            {chips.map((chip) => (
              <li
                key={chip.text}
                className="inline-flex items-center gap-2 border border-[rgba(243,234,219,0.16)] bg-[rgba(243,234,219,0.03)] px-3.5 py-2 font-assistant text-[13px] font-normal text-body"
              >
                <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-gold" />
                {chip.text}
              </li>
            ))}
          </ul>
        }
      />

      {/* What you hand over */}
      <SectionShell id="what-you-hand-over">
        <SectionHead label={p.handover.label} title={p.handover.title} />
        <RevealStagger>
          <HairlineGrid minCell={300} className="mt-10">
            {p.handover.cards.map((card) => {
              const points = card.points ? openOnly(card.points) : [];
              return (
                <motion.div key={card.key} variants={staggerItem} className="h-full">
                  <HairlineGridCell>
                    <MonoLabel tracking="0.15em" className="text-gold">
                      {card.key}
                    </MonoLabel>
                    <h3 className="mt-4 text-[1.25rem] font-normal leading-[1.35] text-cream">{card.title}</h3>
                    <p className="mt-3.5 font-assistant text-[14.5px] font-light leading-[1.8] text-muted">
                      {openText(card.intro)}
                    </p>
                    {points.length > 0 && (
                      <ul className="mt-5 space-y-2.5 border-t border-[rgba(243,234,219,0.1)] pt-5">
                        {points.map((point) => (
                          <li
                            key={point.text}
                            className="flex gap-3 font-assistant text-[14px] font-light leading-[1.7] text-body"
                          >
                            <span aria-hidden className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-gold" />
                            <span>{point.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </HairlineGridCell>
                </motion.div>
              );
            })}
          </HairlineGrid>
        </RevealStagger>
      </SectionShell>

      {/* AI, in the open */}
      <SectionShell id="ai">
        <SectionHead label={p.ai.label} title={p.ai.title} body={p.ai.body} />
        <Reveal>
          <HairlineGrid minCell={300} className="mt-10">
            <HairlineGridCell>
              <h3 className="text-[1.1rem] font-normal text-cream">{p.ai.seesTitle}</h3>
              <BulletList items={p.ai.sees.map((i) => i.text)} />
            </HairlineGridCell>
            <HairlineGridCell elevated>
              <h3 className="text-[1.1rem] font-normal text-cream">{p.ai.neverTitle}</h3>
              <BulletList items={never.map((i) => i.text)} marker="never" />
            </HairlineGridCell>
          </HairlineGrid>
        </Reveal>
        <RevealStagger>
          <ol className="mt-px grid gap-px" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
            {commitments.map((c) => (
              <motion.li key={c.title} variants={staggerItem} className="h-full">
                <HairlineGridCell>
                  <p className="text-[1.1rem] font-normal text-cream">{c.title}</p>
                  <p className="mt-2.5 font-assistant text-[14.5px] font-light leading-[1.8] text-muted">{c.body}</p>
                </HairlineGridCell>
              </motion.li>
            ))}
          </ol>
        </RevealStagger>
      </SectionShell>

      {/* People */}
      <SectionShell id="people">
        <SectionHead label={p.people.label} title={p.people.title} />
        <RevealStagger>
          <HairlineGrid minCell={260} className="mt-10">
            {people.map((item) => (
              <motion.div key={item.title} variants={staggerItem} className="h-full">
                <HairlineGridCell>
                  <h3 className="text-[1.1rem] font-normal text-cream">{item.title}</h3>
                  <p className="mt-3 font-assistant text-[14.5px] font-light leading-[1.8] text-muted">{item.body}</p>
                </HairlineGridCell>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
        <Reveal>
          <div className="mt-px border-s-2 border-gold bg-[rgba(243,234,219,0.04)] p-[clamp(22px,3vw,40px)] outline outline-1 outline-[rgba(248,244,236,0.18)]">
            <h3 className="text-[1.3rem] font-normal leading-[1.35] text-cream">{p.people.offboarding.title}</h3>
            <p className="mt-3.5 max-w-[72ch] font-assistant text-[15px] font-light leading-[1.85] text-body">
              {p.people.offboarding.body}
            </p>
          </div>
        </Reveal>
      </SectionShell>

      {/* Platform */}
      <SectionShell id="platform">
        <SectionHead label={p.platform.label} title={p.platform.title} />
        <RevealStagger>
          <HairlineGrid columns="grid-cols-1 md:grid-cols-2 lg:grid-cols-3" className="mt-10">
            {p.platform.items.map((item) => (
              <motion.div key={item.title} variants={staggerItem} className="h-full">
                <HairlineGridCell className="transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.05)]">
                  <h3 className="text-[1.1rem] font-normal text-cream">{item.title}</h3>
                  <p className="mt-3 font-assistant text-[14.5px] font-light leading-[1.8] text-muted">{item.body}</p>
                </HairlineGridCell>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
      </SectionShell>

      {/* Standards */}
      <SectionShell id="standards">
        <div className="grid gap-10 lg:grid-cols-2">
          <SectionHead label={p.standards.label} title={p.standards.title} />
          <Reveal>
            <p className="font-assistant text-[15.5px] font-light leading-[1.85] text-body">{p.standards.body}</p>
            <BulletList items={p.standards.items} />
            <Link
              href={withLocale(locale, "/dpa")}
              className="mt-6 inline-flex min-h-[24px] items-center font-assistant text-[14px] text-gold underline-offset-4 transition-colors hover:text-gold-light hover:underline"
            >
              {p.standards.dpaLink}
            </Link>
          </Reveal>
        </div>
      </SectionShell>

      {/* Vendors */}
      <SectionShell id="vendors">
        <SectionHead label={p.vendors.label} title={p.vendors.title} body={openText(p.vendors.body)} />
        <Reveal>
          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-start">
              <caption className="sr-only">{p.vendors.title}</caption>
              <thead>
                <tr>
                  {[p.vendors.head.name, p.vendors.head.role, p.vendors.head.location, p.vendors.head.policy].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="border-b border-[rgba(243,234,219,0.22)] pb-3 pe-5 text-start font-assistant text-[12.5px] font-normal uppercase tracking-[0.1em] text-muted last:pe-0 rtl:tracking-normal"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.name}>
                    <th
                      scope="row"
                      className="border-b border-[rgba(243,234,219,0.09)] py-[13px] pe-5 text-start align-top font-assistant text-[14.5px] font-normal text-cream"
                    >
                      <Ltr>{v.name}</Ltr>
                    </th>
                    <td className="border-b border-[rgba(243,234,219,0.09)] py-[13px] pe-5 align-top font-assistant text-[14px] font-light leading-[1.6] text-muted">
                      {v.role}
                    </td>
                    <td className="border-b border-[rgba(243,234,219,0.09)] py-[13px] pe-5 align-top font-assistant text-[14px] font-light leading-[1.6] text-muted">
                      {v.location}
                    </td>
                    <td className="border-b border-[rgba(243,234,219,0.09)] py-[13px] align-top font-assistant text-[14px]">
                      <a
                        href={v.policyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gold underline-offset-4 transition-colors hover:text-gold-light hover:underline"
                      >
                        {p.vendors.policyLink}
                        <span className="sr-only"> {v.name}</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </SectionShell>

      {/* Incident */}
      <SectionShell id="incident">
        <div className="grid gap-10 lg:grid-cols-2">
          <SectionHead label={p.incident.label} title={p.incident.title} />
          <Reveal>
            <p className="font-assistant text-[15.5px] font-light leading-[1.85] text-body">{p.incident.body}</p>
          </Reveal>
        </div>
      </SectionShell>

      {/* Freshness */}
      <SectionShell id="freshness">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHead label={p.review.label} title={p.review.title} />
            <Reveal>
              <p className="mt-6 flex items-center gap-3 font-assistant text-[15px] font-normal text-cream">
                <span aria-hidden className="h-[7px] w-[7px] shrink-0 animate-eyebrowPulse rounded-full bg-gold" />
                {p.review.lastReview}
              </p>
              <p className="mt-2 font-assistant text-[14px] font-light text-muted">{p.review.updated}</p>
            </Reveal>
          </div>
          <Reveal>
            <h3 className="font-assistant text-[13px] font-semibold text-muted">{p.review.changelogTitle}</h3>
            <ol className="mt-4">
              {p.review.changelog.map((entry) => (
                <li
                  key={entry.change}
                  className="grid grid-cols-[minmax(0,9rem)_1fr] gap-4 border-b border-[rgba(243,234,219,0.09)] py-3 font-assistant text-[14px]"
                >
                  <span className="font-light text-muted">{entry.date}</span>
                  <span className="font-light text-body">{entry.change}</span>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </SectionShell>

      {/* Documents and disclosure */}
      <SectionShell id="documents">
        <SectionHead label={p.documents.label} title={p.documents.title} />
        <RevealStagger>
          <HairlineGrid minCell={260} className="mt-10">
            {documents.map((doc) => (
              <motion.div key={doc.title} variants={staggerItem} className="h-full">
                <HairlineGridCell className="transition-colors duration-[350ms] hover:bg-[rgba(243,234,219,0.05)]">
                  {doc.href?.startsWith("mailto:") ? (
                    <a href={doc.href} className="group block">
                      <h3 className="text-[1.1rem] font-normal text-cream transition-colors group-hover:text-gold-light">
                        {doc.title}
                      </h3>
                      <p className="mt-3 font-assistant text-[14.5px] font-light leading-[1.8] text-muted">{doc.body}</p>
                    </a>
                  ) : doc.href ? (
                    <Link href={withLocale(locale, doc.href)} className="group block">
                      <h3 className="text-[1.1rem] font-normal text-cream transition-colors group-hover:text-gold-light">
                        {doc.title}
                      </h3>
                      <p className="mt-3 font-assistant text-[14.5px] font-light leading-[1.8] text-muted">{doc.body}</p>
                    </Link>
                  ) : (
                    <>
                      <h3 className="text-[1.1rem] font-normal text-cream">{doc.title}</h3>
                      <p className="mt-3 font-assistant text-[14.5px] font-light leading-[1.8] text-muted">{doc.body}</p>
                    </>
                  )}
                </HairlineGridCell>
              </motion.div>
            ))}
          </HairlineGrid>
        </RevealStagger>
        <Reveal>
          <div id="report" className="mt-10 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-assistant text-[15px]">
            <span className="font-normal text-cream">{p.documents.disclosureTitle}</span>
            <span className="font-light text-body">{p.documents.disclosureBody}</span>
            <a
              href={`mailto:${p.documents.disclosureEmail}`}
              className="text-gold underline decoration-[rgba(176,141,87,0.45)] underline-offset-4 transition-colors hover:text-gold-light"
            >
              <Ltr>{p.documents.disclosureEmail}</Ltr>
            </a>
          </div>
        </Reveal>
      </SectionShell>

      <PageFaqSection faq={{ label: p.faq.label, title: p.faq.title, items: faqItems }} />

      <InnerCTA dict={dict} locale={locale} title={p.cta.title} body={p.cta.body} />
    </>
  );
}

function SectionHead({ label, title, body }: { label: string; title: string; body?: string }) {
  return (
    <div>
      <Reveal>
        <Eyebrow>{label}</Eyebrow>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="mt-6 max-w-[24ch] text-pretty text-[clamp(1.8rem,3.3vw,3rem)] font-extralight leading-[1.24] tracking-[-0.02em] text-cream rtl:tracking-normal">
          {title}
        </h2>
      </Reveal>
      {body && (
        <Reveal delay={0.12}>
          <p className="mt-5 max-w-[64ch] font-assistant text-[15.5px] font-light leading-[1.85] text-body">{body}</p>
        </Reveal>
      )}
    </div>
  );
}

function BulletList({ items, marker = "dot" }: { items: string[]; marker?: "dot" | "never" }) {
  return (
    <ul className="mt-5 space-y-3">
      {items.map((text) => (
        <li key={text} className="flex gap-3 font-assistant text-[14.5px] font-light leading-[1.75] text-body">
          {marker === "never" ? (
            <span aria-hidden className="mt-[0.1em] shrink-0 font-jbmono text-[13px] text-gold">
              ×
            </span>
          ) : (
            <span aria-hidden className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-gold" />
          )}
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}
